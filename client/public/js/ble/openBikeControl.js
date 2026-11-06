/**
 * An OpenBikeControl controller as an input device, with the same interface
 * as a Zwift controller (ble/zwiftController.js):
 *
 *   on("buttons", (pressed: string[]) => ...)  every button state change
 *   on("disconnected") / on("reconnected")
 *   disconnect(): void
 *   label: string
 *
 * After a dropped link it keeps trying to reconnect in the background until
 * disconnect() is called.
 */

import { Emitter } from "../util/emitter.js";
import { toHex } from "./deviceLog.js";
import { Reconnector } from "./reconnector.js";
import { t } from "../i18n/i18n.js";
import { BUILD } from "../build.js";
import { FIRST_CONNECT_ATTEMPTS, connectGatt } from "./gattConnect.js";
import { CONTROLLER_RECONNECT_DELAYS_MS } from "./zwiftController.js";
import { APP_INFO_CHARACTERISTIC, BUTTON_STATE_CHARACTERISTIC, OBC_BUTTONS, OBC_SERVICE, encodeAppInfo, parseButtonState } from "./openBikeControlProtocol.js";

export class OpenBikeControlController extends Emitter {
  #device;
  #log;
  #reconnector;
  #timers;
  /** Button ID → state, for the buttons held now: a notification carries only the changes. */
  #held = new Map();
  #lastButtons = "";
  battery = null;
  connected = false;
  /** Zwift Click specifics (see ZwiftController): never the case here. */
  relays = false;
  locked = false;

  /**
   * @param {{device: object, log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} deps
   */
  constructor({ device, log = null, setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancel = (id) => globalThis.clearTimeout(id) }) {
    super();
    this.#device = device;
    this.#log = log;
    this.label = device.name ?? t("devices.obcController");
    this.id = device.id;
    this.#timers = { setTimeout: schedule, clearTimeout: cancel };
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
      delays: CONTROLLER_RECONNECT_DELAYS_MS,
    });
  }

  /**
   * Connects to a controller the browser already granted (no chooser); see
   * ble/controllers.js for the chooser.
   * @param {{log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} [options]
   */
  static async open(device, options = {}) {
    const controller = new OpenBikeControlController({ device, ...options });
    try {
      await controller.#open({ attempts: FIRST_CONNECT_ATTEMPTS });
    } catch (error) {
      device.gatt.disconnect();
      throw error;
    }
    device.addEventListener("gattserverdisconnected", () => controller.#lost());
    return controller;
  }

  /** Connects, subscribes and says which buttons we act on. */
  async #open({ attempts = 1 } = {}) {
    const server = await connectGatt(this.#device, { attempts, log: this.#log, ...this.#timers });
    const service = await server.getPrimaryService(OBC_SERVICE);
    const buttons = await service.getCharacteristic(BUTTON_STATE_CHARACTERISTIC);
    // The same listener function on every (re)connect, so it is never added twice.
    buttons.addEventListener("characteristicvaluechanged", this.#onPacket);
    await buttons.startNotifications();
    this.#held.clear();
    this.connected = true;
    this.#log?.info("Controller: subscribed to OpenBikeControl buttons");
    await this.#sendAppInfo(service);
  }

  /** Optional on both sides: a controller without it still sends every button. */
  async #sendAppInfo(service) {
    try {
      const info = await service.getCharacteristic(APP_INFO_CHARACTERISTIC);
      await info.writeValueWithResponse(encodeAppInfo({ appId: "openradlr", appVersion: BUILD.sha, buttons: [...OBC_BUTTONS.keys()] }));
    } catch (error) {
      this.#log?.info(`Controller: no app information sent (${error.message})`);
    }
  }

  #onPacket = (event) => {
    const message = parseButtonState(event.target.value);
    this.#log?.packet("obc", event.target.value, message);
    if (message.kind !== "buttons") return;
    for (const [id, state] of message.changes) {
      if (state === 0) this.#held.delete(id);
      else this.#held.set(id, state);
    }
    // Unknown IDs appear in hex, so a rider can report what a button sends.
    const pressed = [...new Set([...this.#held.keys()].map((id) => OBC_BUTTONS.get(id) ?? `0x${id.toString(16)}`))];
    const key = pressed.join("+");
    if (key !== this.#lastButtons) this.#log?.info(`${this.label}: ${key || "released"} (${toHex(event.target.value)})`);
    this.#lastButtons = key;
    this.emit("buttons", pressed);
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
