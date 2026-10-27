/**
 * A Zwift Click, Play or Ride controller as an input device.
 *
 *   on("buttons", (pressed: string[]) => ...)  every button state change
 *   on("battery", (percent) => ...)
 *   on("disconnected") / on("reconnected")
 *   disconnect(): void
 *   label: string
 *
 * Controllers fall asleep after a few idle minutes and drop the connection;
 * the controller then keeps trying to reconnect in the background until
 * disconnect() is called. Button presses wake it up again.
 */

import { Emitter } from "../util/emitter.js";
import { toHex } from "./deviceLog.js";
import { Reconnector } from "./reconnector.js";
import {
  ASYNC_CHARACTERISTIC,
  SYNC_RX_CHARACTERISTIC,
  SYNC_TX_CHARACTERISTIC,
  ZWIFT_COMPANY_ID,
  ZWIFT_RIDE_SERVICE,
  ZWIFT_SERVICE,
  encodeHandshake,
  parseControllerMessage,
} from "./zwiftProtocol.js";

export { RECONNECT_DELAYS_MS } from "./reconnector.js";

/** What the chooser lists: Zwift devices, or the remembered ones by name. */
function requestOptions(names) {
  return {
    filters: names?.length ? names.map((name) => ({ name })) : [{ manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }, { namePrefix: "Zwift" }],
    optionalServices: [ZWIFT_SERVICE, ZWIFT_RIDE_SERVICE],
  };
}

export class ZwiftController extends Emitter {
  #device;
  #log;
  #reconnector;
  #lastButtons = "";
  battery = null;
  connected = false;

  /**
   * @param {{device: object, log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} deps
   */
  constructor({ device, log = null, setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancel = (id) => globalThis.clearTimeout(id) }) {
    super();
    this.#device = device;
    this.#log = log;
    this.label = device.name ?? "Zwift controller";
    this.id = device.id;
    this.#reconnector = new Reconnector({
      open: () => this.#open(),
      release: () => device.gatt.disconnect(),
      onLost: () => {
        log?.error("Controller disconnected; reconnecting");
        this.emit("disconnected");
      },
      onBack: () => {
        log?.info("Controller reconnected");
        this.emit("reconnected");
      },
      onFailed: (error, attempt) => {
        this.connected = false;
        log?.info(`Controller reconnect attempt ${attempt} failed (${error.message})`);
      },
      setTimeout: schedule,
      clearTimeout: cancel,
    });
  }

  /**
   * Opens the browser's device picker and connects to the chosen controller.
   * @param {Bluetooth} [bluetooth]
   * `isConnected(device)` guards against pairing the same controller twice,
   * which would run every button press twice.
   * `names` lists only the controllers with these names (reconnecting remembered ones).
   * @param {{log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function, isConnected?: (device: object) => boolean, names?: string[]}} [options]
   */
  static async connect(bluetooth = globalThis.navigator.bluetooth, { isConnected = () => false, names, ...options } = {}) {
    const device = await bluetooth.requestDevice(requestOptions(names));
    options.log?.info(`Selected controller "${device.name ?? "unnamed"}"`);
    if (isConnected(device)) throw new Error(`${device.name ?? "This controller"} is already connected.`);
    return ZwiftController.open(device, options);
  }

  /**
   * Connects to a controller the browser already granted (no chooser), e.g.
   * one from `navigator.bluetooth.getDevices()`.
   * @param {{log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} [options]
   */
  static async open(device, options = {}) {
    const controller = new ZwiftController({ device, ...options });
    try {
      await controller.#open();
    } catch (error) {
      device.gatt.disconnect();
      throw error;
    }
    device.addEventListener("gattserverdisconnected", () => controller.#lost());
    return controller;
  }

  async #open() {
    const server = await this.#device.gatt.connect();
    const service = await firstService(server, [ZWIFT_SERVICE, ZWIFT_RIDE_SERVICE]);
    if (!service) throw new Error("This device is not a Zwift Click, Play or Ride controller.");
    const notifications = await service.getCharacteristic(ASYNC_CHARACTERISTIC);
    const commands = await service.getCharacteristic(SYNC_RX_CHARACTERISTIC);
    const answers = await service.getCharacteristic(SYNC_TX_CHARACTERISTIC);
    // The same listener function on every (re)connect, so it is never added twice.
    notifications.addEventListener("characteristicvaluechanged", this.#onPacket);
    answers.addEventListener("characteristicvaluechanged", this.#onPacket);
    await notifications.startNotifications();
    await answers.startNotifications();
    await write(commands, encodeHandshake());
    this.connected = true;
    this.#log?.info("Controller: sent RideOn handshake");
  }

  #onPacket = (event) => {
    const message = parseControllerMessage(event.target.value);
    // Idle messages come every second: counted only, so a report shows whether anything arrives at all.
    if (message.kind === "idle") this.#log?.count("zwift idle");
    else this.#log?.packet("zwift", event.target.value, message);
    if (message.kind === "buttons") {
      // Every change is logged with its bytes, so a rider can report what each button sends.
      const key = message.buttons.join("+");
      if (key !== this.#lastButtons) this.#log?.info(`${this.label}: ${key || "released"} (${toHex(event.target.value)})`);
      this.#lastButtons = key;
      this.emit("buttons", message.buttons);
    } else if (message.kind === "battery") {
      this.battery = message.level;
      this.emit("battery", message.level);
    } else if (message.kind === "handshake") this.#log?.info("Controller answered RideOn");
  };

  #lost() {
    this.connected = false;
    this.#reconnector.lost();
  }

  disconnect() {
    this.#reconnector.close();
    this.#device.gatt?.disconnect();
  }
}

async function firstService(server, uuids) {
  for (const uuid of uuids) {
    try {
      return await server.getPrimaryService(uuid);
    } catch {
      // try the next one
    }
  }
  return null;
}

/** The command characteristic accepts writes with or without response, depending on firmware. */
async function write(characteristic, bytes) {
  try {
    await characteristic.writeValueWithResponse(bytes);
  } catch {
    await characteristic.writeValueWithoutResponse(bytes);
  }
}
