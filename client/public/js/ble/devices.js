/**
 * Device adapters. Every power source implements the same small interface:
 *
 *   on("data", ({ power, cadence, heartRate }) => ...)
 *   setGrade(gradePercent, {cw}?): Promise<void> simulation mode
 *   setTargetPower(watts): Promise<void>       ERG mode
 *   disconnect(): void
 *   label: string
 *
 * The app only depends on that interface, so a real FTMS trainer and the
 * simulated trainer are interchangeable (and tests can use fakes).
 * Real devices also emit "disconnected" and write to an optional DeviceLog.
 */

import { Emitter } from "../util/emitter.js";
import { PaddleModel } from "../ride/paddleModel.js";
import { CYCLING_POWER_MEASUREMENT, CYCLING_POWER_SERVICE, CadenceCalculator, parseCyclingPowerMeasurement } from "./cyclingPower.js";
import {
  CONTROL_POINT,
  FTMS_SERVICE,
  INDOOR_BIKE_DATA,
  encodeRequestControl,
  encodeSetTargetPower,
  encodeSimulationParameters,
  encodeStartOrResume,
  parseControlPointResponse,
  parseIndoorBikeData,
} from "./ftms.js";
import { ReadingMerger } from "./readingMerger.js";
import { Reconnector } from "./reconnector.js";
import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE, parseHeartRate } from "./heartRate.js";
import { t } from "../i18n/i18n.js";

export function isBluetoothAvailable(nav = globalThis.navigator) {
  return Boolean(nav?.bluetooth);
}

/**
 * A smart trainer (e.g. Wahoo KICKR Core, Van Rysel D500).
 *
 * Data: FTMS Indoor Bike Data and/or Cycling Power Measurement, whichever the
 * trainer offers; both are merged (see ReadingMerger).
 * Control: FTMS control point (simulation mode). If control fails the trainer
 * still delivers data, it just does not change resistance.
 */
export class SmartTrainer extends Emitter {
  #device;
  #controlPoint = null;
  #pending = null;
  #writing = null;
  #merger;
  #now;
  #cadence = new CadenceCalculator();
  #reconnector;
  /** The last grade or target command, sent again after a reconnect. */
  #lastCommand = null;
  connected = false;

  /**
   * @param {{device: object, log?: import("./deviceLog.js").DeviceLog | null, merger?: ReadingMerger, now?: () => number, setTimeout?: Function, clearTimeout?: Function}} deps
   */
  constructor({ device, log = null, merger = new ReadingMerger(), now = () => Date.now(), setTimeout, clearTimeout }) {
    super();
    this.#device = device;
    this.#merger = merger;
    this.#now = now;
    this.log = log;
    this.label = device.name ?? t("devices.smartTrainer");
    this.id = device.id;
    this.sources = [];
    this.#reconnector = new Reconnector({
      open: () => this.#open(),
      release: () => device.gatt.disconnect(),
      onLost: () => {
        log?.error("Trainer disconnected; reconnecting");
        this.emit("disconnected");
      },
      onBack: () => {
        log?.info("Trainer reconnected");
        this.emit("reconnected");
        // The trainer forgot the road while it was away.
        if (this.#lastCommand) this.#send(this.#lastCommand).catch((error) => log?.error(`Resending resistance failed: ${error.message}`));
      },
      onFailed: (error, attempt) => log?.info(`Trainer reconnect attempt ${attempt} failed (${error.message})`),
      ...(setTimeout && { setTimeout }),
      ...(clearTimeout && { clearTimeout }),
    });
  }

  get canControlResistance() {
    return this.#controlPoint !== null;
  }

  /**
   * Opens the browser's device picker and connects to the chosen trainer.
   * `names` lists only trainers with these names (reconnecting a remembered one).
   * @param {Bluetooth} [bluetooth]
   * @param {{log?: import("./deviceLog.js").DeviceLog | null, merger?: ReadingMerger, now?: () => number, names?: string[], setTimeout?: Function, clearTimeout?: Function}} [options]
   */
  static async connect(bluetooth = globalThis.navigator.bluetooth, { names, ...options } = {}) {
    const device = await bluetooth.requestDevice({
      filters: names?.length ? names.map((name) => ({ name })) : [{ services: [FTMS_SERVICE] }, { services: [CYCLING_POWER_SERVICE] }],
      optionalServices: [FTMS_SERVICE, CYCLING_POWER_SERVICE],
    });
    options.log?.info(`Selected "${device.name ?? "unnamed"}"`);
    return SmartTrainer.open(device, options);
  }

  /**
   * Connects to a trainer the browser already granted (no chooser), e.g. one
   * from `navigator.bluetooth.getDevices()`.
   * @param {{log?: import("./deviceLog.js").DeviceLog | null, merger?: ReadingMerger, now?: () => number, setTimeout?: Function, clearTimeout?: Function}} [options]
   */
  static async open(device, options = {}) {
    const trainer = new SmartTrainer({ device, ...options });
    await trainer.#open();
    device.addEventListener("gattserverdisconnected", () => {
      trainer.connected = false;
      trainer.#reconnector.lost();
    });
    return trainer;
  }

  /** Connects, subscribes to every data source and takes control; again after a drop. */
  async #open() {
    const device = this.#device;
    const log = this.log;
    const server = await device.gatt.connect();
    log?.info("GATT connected");

    const ftms = await optionalService(server, FTMS_SERVICE, "FTMS", log);
    const cps = await optionalService(server, CYCLING_POWER_SERVICE, "Cycling Power", log); // i18n-ok
    const bikeData = ftms && (await optionalCharacteristic(ftms, INDOOR_BIKE_DATA, "Indoor Bike Data", log)); // i18n-ok
    const controlPoint = ftms && (await optionalCharacteristic(ftms, CONTROL_POINT, "FTMS Control Point", log)); // i18n-ok
    const powerMeasurement = cps && (await optionalCharacteristic(cps, CYCLING_POWER_MEASUREMENT, "Cycling Power Measurement", log)); // i18n-ok

    if (!bikeData && !powerMeasurement) {
      device.gatt.disconnect();
      throw new Error(t("devices.error.noData"));
    }

    // Subscribe to data first: data must flow even if taking control fails.
    // The listeners are the same functions on every connect, so they are never added twice.
    this.sources = [];
    if (bikeData) {
      bikeData.addEventListener("characteristicvaluechanged", this.#onBikeData);
      if (await subscribe(bikeData, "Indoor Bike Data", log)) this.sources.push("ftms"); // i18n-ok
    }
    if (powerMeasurement) {
      this.#cadence = new CadenceCalculator();
      powerMeasurement.addEventListener("characteristicvaluechanged", this.#onPowerMeasurement);
      if (await subscribe(powerMeasurement, "Cycling Power Measurement", log)) this.sources.push("cps"); // i18n-ok
    }
    if (this.sources.length === 0) {
      device.gatt.disconnect();
      throw new Error(t("devices.error.noSubscribe"));
    }

    this.#controlPoint = controlPoint || null;
    if (controlPoint) await this.#takeControl();
    else log?.info("No FTMS control point: resistance will not follow the road");
    this.connected = true;
  }

  #emitMerged(source, reading) {
    this.emit("data", this.#merger.update(source, reading));
  }

  #onBikeData = (event) => {
    const parsed = parseIndoorBikeData(event.target.value);
    this.log?.packet("ftms", event.target.value, parsed);
    this.#emitMerged("ftms", parsed);
  };

  #onPowerMeasurement = (event) => {
    const parsed = parseCyclingPowerMeasurement(event.target.value);
    this.log?.packet("cps", event.target.value, parsed);
    const reading = { power: parsed.power };
    if (parsed.crankRevolutions !== undefined) {
      reading.cadence = this.#cadence.update({ revolutions: parsed.crankRevolutions, eventTime: parsed.crankEventTime }, this.#now()) ?? undefined;
    }
    this.#emitMerged("cps", reading);
  };

  #onControlPointAnswer = (event) => {
    const response = parseControlPointResponse(event.target.value);
    if (!response) return;
    const opcode = `0x${response.requestOpCode.toString(16).padStart(2, "0")}`;
    if (response.success) this.log?.info(`Control point: ${opcode} accepted`);
    else this.log?.error(`Control point: ${opcode} rejected with result code ${response.resultCode}`);
  };

  async #takeControl() {
    const controlPoint = this.#controlPoint;
    try {
      controlPoint.addEventListener("characteristicvaluechanged", this.#onControlPointAnswer);
      await controlPoint.startNotifications();
      await controlPoint.writeValueWithResponse(encodeRequestControl());
      await controlPoint.writeValueWithResponse(encodeStartOrResume());
      this.log?.info("Requested control and started the trainer");
    } catch (error) {
      this.log?.error(`Taking control failed (${error.message}); power data still works`);
    }
  }

  /** Simulation mode: the trainer models this road grade. */
  /** @param {{cw?: number}} [options] the trainer's own air drag (kg/m), FTMS default without */
  setGrade(gradePercent, { cw } = {}) {
    return this.#send(encodeSimulationParameters({ gradePercent, ...(Number.isFinite(cw) && { cw }) }));
  }

  /** ERG mode: the trainer holds this power regardless of cadence. */
  setTargetPower(watts) {
    return this.#send(encodeSetTargetPower(watts));
  }

  /**
   * Writes a control point command. Writes never overlap (BLE allows one GATT
   * operation at a time); if commands arrive faster than they can be written,
   * only the latest one is sent — older grades or targets are obsolete anyway.
   */
  #send(bytes) {
    if (!this.#controlPoint) return Promise.resolve();
    this.#lastCommand = bytes;
    // While the trainer is away the command waits for the reconnect.
    if (!this.connected) return Promise.resolve();
    this.#pending = bytes;
    if (this.#writing) return this.#writing;
    this.#writing = (async () => {
      try {
        while (this.#pending !== null) {
          const next = this.#pending;
          this.#pending = null;
          await this.#controlPoint.writeValueWithResponse(next);
        }
      } finally {
        this.#writing = null;
      }
    })();
    return this.#writing;
  }

  disconnect() {
    this.#reconnector.close();
    this.#device.gatt?.disconnect();
  }
}

/** @deprecated Use SmartTrainer. Kept for compatibility. */
export const FtmsTrainer = SmartTrainer;

async function optionalService(server, uuid, name, log) {
  try {
    const service = await server.getPrimaryService(uuid);
    log?.info(`Service ${name} found`);
    return service;
  } catch (error) {
    log?.info(`Service ${name} not available (${error.name ?? error.message})`);
    return null;
  }
}

async function optionalCharacteristic(service, uuid, name, log) {
  try {
    return await service.getCharacteristic(uuid);
  } catch (error) {
    log?.info(`Characteristic ${name} not available (${error.name ?? error.message})`);
    return null;
  }
}

async function subscribe(characteristic, name, log) {
  try {
    await characteristic.startNotifications();
    log?.info(`Subscribed to ${name}`);
    return true;
  } catch (error) {
    log?.error(`Subscribing to ${name} failed: ${error.message}`);
    return false;
  }
}

/** A heart rate strap. Emits `{ heartRate }`, "disconnected" and "reconnected". */
export class HeartRateMonitor extends Emitter {
  #device;
  #reconnector;
  connected = false;

  /** @param {{device: object, log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} deps */
  constructor({ device, log = null, setTimeout, clearTimeout }) {
    super();
    this.#device = device;
    this.label = device.name ?? t("devices.hrMonitor");
    this.id = device.id;
    this.#reconnector = new Reconnector({
      open: () => this.#open(),
      release: () => device.gatt.disconnect(),
      onLost: () => {
        log?.error("Heart rate monitor disconnected; reconnecting");
        this.emit("disconnected");
      },
      onBack: () => {
        log?.info("Heart rate monitor reconnected");
        this.emit("reconnected");
      },
      ...(setTimeout && { setTimeout }),
      ...(clearTimeout && { clearTimeout }),
    });
  }

  /**
   * Opens the browser's device picker. `names` lists only straps with these
   * names (reconnecting a remembered one).
   * @param {{log?: import("./deviceLog.js").DeviceLog | null, names?: string[], setTimeout?: Function, clearTimeout?: Function}} [options]
   */
  static async connect(bluetooth = globalThis.navigator.bluetooth, { names, ...options } = {}) {
    const device = await bluetooth.requestDevice(
      names?.length ? { filters: names.map((name) => ({ name })), optionalServices: [HEART_RATE_SERVICE] } : { filters: [{ services: [HEART_RATE_SERVICE] }] },
    );
    return HeartRateMonitor.open(device, options);
  }

  /** Connects to a strap the browser already granted (no chooser). */
  static async open(device, options = {}) {
    const monitor = new HeartRateMonitor({ device, ...options });
    await monitor.#open();
    device.addEventListener("gattserverdisconnected", () => {
      monitor.connected = false;
      monitor.#reconnector.lost();
    });
    return monitor;
  }

  async #open() {
    const server = await this.#device.gatt.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const measurement = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    measurement.addEventListener("characteristicvaluechanged", this.#onMeasurement);
    await measurement.startNotifications();
    this.connected = true;
  }

  #onMeasurement = (event) => this.emit("data", { heartRate: parseHeartRate(event.target.value) });

  disconnect() {
    this.#reconnector.close();
    this.#device.gatt?.disconnect();
  }
}

/**
 * Trainer stand-in for testing without hardware. Power is set by the UI;
 * grade changes are only recorded.
 */
export class SimulatedTrainer extends Emitter {
  label = t("devices.simulatedLabel");
  canControlResistance = true;
  power = 150;
  grade = 0;
  targetPower = null;
  #timer = null;

  /** @param {{setInterval?: Function, clearInterval?: Function, periodMs?: number}} [deps] */
  constructor({ setInterval: schedule = (fn, ms) => globalThis.setInterval(fn, ms), clearInterval: cancel = (id) => globalThis.clearInterval(id), periodMs = 250 } = {}) {
    super();
    this.cancel = cancel;
    this.#timer = schedule(() => this.emit("data", this.reading()), periodMs);
  }

  reading() {
    return { power: this.power, cadence: this.power > 0 ? 85 : 0 };
  }

  setPower(watts) {
    this.power = Math.max(0, Math.min(2000, Math.round(watts)));
  }

  async setGrade(gradePercent) {
    this.grade = gradePercent;
    this.targetPower = null;
  }

  /** In ERG mode a trainer holds the target, so the simulated rider "produces" it. */
  async setTargetPower(watts) {
    this.targetPower = watts;
    this.setPower(watts);
  }

  disconnect() {
    this.cancel(this.#timer);
  }
}

/**
 * Phone paddles: power from tapping left and right in turn (see
 * ride/paddleModel.js). It can't change resistance, so ERG and virtual
 * shifting stay off; the road's grade only moves the sweet spot.
 */
export class PaddleTrainer extends Emitter {
  label = t("devices.paddlesLabel");
  canControlResistance = false;
  #timer = null;

  /** @param {{ftp?: number, now?: () => number, setInterval?: Function, clearInterval?: Function, periodMs?: number}} [deps] */
  constructor({
    ftp,
    now = () => globalThis.performance.now(),
    setInterval: schedule = (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: cancel = (id) => globalThis.clearInterval(id),
    periodMs = 250,
  } = {}) {
    super();
    this.model = new PaddleModel({ ftp });
    this.now = now;
    this.cancel = cancel;
    this.#timer = schedule(() => this.emit("data", this.reading()), periodMs);
  }

  /** The FTP can change on the start screen after picking the paddles. */
  setFtp(ftp) {
    this.model.ftp = Math.max(50, Number(ftp) || this.model.ftp);
  }

  /** @param {"left" | "right"} side @returns {"stroke" | "stumble" | "ignored"} */
  tap(side) {
    return this.model.tap(side, this.now());
  }

  /** Power and cadence for the ride, plus what the paddle view shows. */
  state() {
    return this.model.reading(this.now());
  }

  reading() {
    const { power, cadence } = this.state();
    return { power, cadence };
  }

  async setGrade(gradePercent) {
    this.model.setGrade(gradePercent);
  }

  disconnect() {
    this.cancel(this.#timer);
  }
}

/** What a ride's power comes from: a real trainer, the simulated trainer or phone paddles. */
export function deviceKind(trainer) {
  if (trainer instanceof PaddleTrainer) return "paddle";
  if (trainer instanceof SimulatedTrainer) return "sim";
  return "trainer";
}

/** Only rides measured by a real trainer go to Strava. */
export const hasRealPowerSource = (trainer) => Boolean(trainer) && deviceKind(trainer) === "trainer";

/** Phone paddle rides stay in the game: no ride files that could end up on Strava by hand. */
export const canExportRide = (trainer) => deviceKind(trainer) !== "paddle";
