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
import { t } from "../i18n/i18n.js";
import { FIRST_CONNECT_ATTEMPTS, connectGatt } from "./gattConnect.js";
import {
  ASYNC_CHARACTERISTIC,
  SYNC_RX_CHARACTERISTIC,
  SYNC_TX_CHARACTERISTIC,
  ZWIFT_COMPANY_ID,
  ZWIFT_RIDE_SERVICE,
  ZWIFT_SERVICE,
  encodeHandshake,
  encodePodReset,
  parseControllerMessage,
} from "./zwiftProtocol.js";

export { RECONNECT_DELAYS_MS } from "./reconnector.js";

/**
 * A controller asleep only wakes for a button press and then advertises for a
 * few seconds: waits that grow to half a minute miss it. Attempts against a
 * sleeping controller are cheap, so they stay short.
 */
export const CONTROLLER_RECONNECT_DELAYS_MS = Object.freeze([500, 1000, 2000]);

/** What the chooser lists: Zwift devices, or the remembered ones by name. */
function requestOptions(names) {
  return {
    filters: names?.length ? names.map((name) => ({ name })) : [{ manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }, { namePrefix: "Zwift" }], // i18n-ok
    optionalServices: [ZWIFT_SERVICE, ZWIFT_RIDE_SERVICE],
  };
}

export class ZwiftController extends Emitter {
  #device;
  #log;
  #reconnector;
  #lastButtons = "";
  #timers;
  #mode = null;
  #commands = null;
  /** Rebooting on purpose (locked): the link drops and comes back without alarming the rider. */
  #rebooting = false;
  battery = null;
  connected = false;
  /**
   * Says more than its own buttons (battery, status): the Click half that relays
   * the other's presses. A half that never does sends only its own side.
   */
  relays = false;
  /**
   * Its status reports mode 1: Zwift's firmware stopped its plain button messages
   * (a Click v2's left half, about a minute after connecting unless the Zwift app
   * unlocked it). Reconnecting doesn't undo it; the app offers a fallback instead.
   */
  locked = false;

  /**
   * @param {{device: object, log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} deps
   */
  constructor({ device, log = null, setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancel = (id) => globalThis.clearTimeout(id) }) {
    super();
    this.#device = device;
    this.#log = log;
    this.label = device.name ?? t("devices.zwiftController");
    this.id = device.id;
    this.#timers = { setTimeout: schedule, clearTimeout: cancel };
    this.#reconnector = new Reconnector({
      open: () => this.#open(),
      release: () => device.gatt.disconnect(),
      onLost: () => {
        if (this.#rebooting) return log?.info("Controller rebooting");
        log?.error("Controller disconnected; reconnecting");
        this.emit("disconnected");
      },
      onBack: () => {
        if (this.#rebooting) {
          this.#rebooting = false;
          return log?.info("Controller back after the reboot");
        }
        log?.info("Controller reconnected");
        this.emit("reconnected");
      },
      onFailed: (error, attempt) => {
        this.connected = false;
        log?.info(`Controller reconnect attempt ${attempt} failed (${error.message})`);
      },
      setTimeout: schedule,
      clearTimeout: cancel,
      delays: CONTROLLER_RECONNECT_DELAYS_MS,
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
    if (isConnected(device)) throw new Error(t("devices.error.connected", { name: device.name ?? t("devices.error.thisController") }));
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
      await controller.#open({ attempts: FIRST_CONNECT_ATTEMPTS });
    } catch (error) {
      device.gatt.disconnect();
      throw error;
    }
    device.addEventListener("gattserverdisconnected", () => controller.#lost());
    return controller;
  }

  /** Connects, subscribes and sends the handshake; a hanging attempt gives up (connectGatt), so reconnecting goes on. */
  async #open({ attempts = 1 } = {}) {
    const server = await connectGatt(this.#device, { attempts, log: this.#log, ...this.#timers });
    const service = await firstService(server, [ZWIFT_SERVICE, ZWIFT_RIDE_SERVICE]);
    if (!service) throw new Error(t("devices.error.notZwift"));
    const notifications = await service.getCharacteristic(ASYNC_CHARACTERISTIC);
    const commands = await service.getCharacteristic(SYNC_RX_CHARACTERISTIC);
    const answers = await service.getCharacteristic(SYNC_TX_CHARACTERISTIC);
    // The same listener function on every (re)connect, so it is never added twice.
    notifications.addEventListener("characteristicvaluechanged", this.#onPacket);
    answers.addEventListener("characteristicvaluechanged", this.#onPacket);
    await notifications.startNotifications();
    await answers.startNotifications();
    this.#mode = null;
    this.#commands = commands;
    await write(commands, encodeHandshake());
    this.connected = true;
    this.#log?.info("Controller: sent RideOn handshake");
  }

  #onPacket = (event) => {
    const message = parseControllerMessage(event.target.value);
    // Idle messages and an unchanged battery level come every few seconds: counted only, so the
    // report's packet budget is left for what matters (buttons, messages we don't know yet).
    if (message.kind === "idle") this.#log?.count("zwift idle");
    else if (message.kind === "battery" && message.level === this.battery) this.#log?.count("zwift battery");
    else this.#log?.packet("zwift", event.target.value, message);
    // Anything beyond buttons and the handshake (battery, status, device info): the half that relays.
    if (!["buttons", "handshake", "idle"].includes(message.kind)) this.relays = true;
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
    else if (message.kind === "status") this.#onStatus(message.mode);
  };

  /**
   * A Click v2 locks its plain buttons about 50 s after the handshake and then
   * reports mode 1 (Zwift's app presumably unlocks it with its encrypted
   * handshake, which we don't speak). A second RideOn on the same link does not
   * help; a fresh connection does, for another ~50 s. So on mode 1 the
   * controller reconnects quietly (no "disconnected" for the rider), at most
   * every 10 s; if that fails, the usual reconnecting takes over.
   */
  #onStatus(mode) {
    if (mode !== this.#mode) this.#log?.info(`${this.label} reports mode ${mode}${mode === 1 ? " (locked: no plain buttons)" : ""}`);
    this.#mode = mode;
    const locked = mode === 1;
    if (locked === this.locked) return;
    this.locked = locked;
    this.emit("locked", locked);
    if (locked) this.#reboot();
  }

  /** Locked: a reboot (not a reconnect, which doesn't help) gives about another minute of plain buttons. */
  #reboot() {
    if (this.#rebooting || !this.#commands) return;
    this.#rebooting = true;
    this.#log?.info(`${this.label} locked: rebooting it for plain buttons`);
    write(this.#commands, encodePodReset()).catch((error) => {
      this.#rebooting = false;
      this.#log?.error(`Reboot failed: ${error.message}`);
    });
  }

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
