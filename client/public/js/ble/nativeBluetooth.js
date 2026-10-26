/**
 * Web Bluetooth, the part OpenRadlr uses, on top of the BLE plugin of the
 * OpenRadlr app (@capacitor-community/bluetooth-le, see docs/app.md). No
 * browser on iOS has Web Bluetooth, so inside the app `navigator.bluetooth`
 * is this and the trainer, heart rate and controller code runs unchanged.
 *
 * Covered: requestDevice, getDevices, gatt.connect/disconnect,
 * gattserverdisconnected, getPrimaryService, getCharacteristic,
 * startNotifications, characteristicvaluechanged, writeValueWithResponse and
 * writeValueWithoutResponse.
 *
 * `plugin` is the raw native plugin (`Capacitor.Plugins.BluetoothLe`): every
 * method takes one options object, UUIDs are 128-bit strings and values are
 * hex strings.
 */

const BASE_UUID = "-0000-1000-8000-00805f9b34fb";
const GRANTED_KEY = "openradlr.nativeDevices";
/** Remembered devices are few (trainer, strap, two controllers); a few spare ones are kept. */
const MAX_GRANTED = 8;
const CONNECT_TIMEOUT_MS = 10000;

/** A UUID as the plugin spells it: 0x1826 → "00001826-0000-1000-8000-00805f9b34fb". */
export function uuidString(uuid) {
  if (typeof uuid === "number") return `${uuid.toString(16).padStart(8, "0")}${BASE_UUID}`;
  const text = String(uuid).toLowerCase();
  if (/^[0-9a-f]{4}$/.test(text)) return `0000${text}${BASE_UUID}`;
  if (/^[0-9a-f]{8}$/.test(text)) return `${text}${BASE_UUID}`;
  return text;
}

/** "00001826-0000-1000-8000-00805f9b34fb" → "1826"; other UUIDs stay as they are. */
const shortUuid = (uuid) => (uuid.startsWith("0000") && uuid.endsWith(BASE_UUID) ? uuid.slice(4, 8) : uuid);

/** Bytes (ArrayBuffer, typed array or DataView) as the plugin's hex string. */
export function hexOf(source) {
  const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The plugin's hex string ("0a1b", Android: "0a 1b") as a DataView. */
export function dataViewOf(hex = "") {
  const digits = String(hex).replace(/[^0-9a-f]/gi, "");
  const bytes = new Uint8Array(digits.length >> 1);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return new DataView(bytes.buffer);
}

/**
 * Web Bluetooth filters are alternatives, the plugin takes one filter: names
 * (a remembered device) win, then services, then a name prefix.
 * Manufacturer data filters are left out, the name prefix finds those devices.
 */
export function scanOptions({ filters = [] } = {}) {
  const names = [...new Set(filters.flatMap((filter) => (filter.name ? [filter.name] : [])))];
  if (names.length === 1) return { name: names[0] };
  if (names.length > 1) {
    const prefix = commonPrefix(names);
    return prefix ? { namePrefix: prefix } : {};
  }
  const services = [...new Set(filters.flatMap((filter) => filter.services ?? []).map(uuidString))];
  if (services.length) return { services };
  const prefix = commonPrefix(filters.flatMap((filter) => (filter.namePrefix ? [filter.namePrefix] : [])));
  return prefix ? { namePrefix: prefix } : {};
}

function commonPrefix(texts) {
  if (!texts.length) return "";
  let prefix = texts[0];
  for (const text of texts) while (!text.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}

const domError = (name, message) => Object.assign(new Error(message), { name });

export class NativeBluetooth {
  #plugin;
  #storage;
  #ready = null;
  #devices = new Map();

  /** @param {{plugin: object, storage?: Storage | null}} deps */
  constructor({ plugin, storage = defaultStorage() }) {
    this.#plugin = plugin;
    this.#storage = storage;
  }

  /** Opens the app's device picker. Cancelling it rejects with a NotFoundError, as in browsers. */
  async requestDevice(options) {
    await this.#initialize();
    let found;
    try {
      found = await this.#plugin.requestDevice(scanOptions(options));
    } catch (error) {
      if (/cancel/i.test(error?.message ?? "")) throw domError("NotFoundError", "User cancelled the requestDevice() chooser.");
      throw error;
    }
    this.#grant(found.deviceId);
    return this.#device(found);
  }

  /** The devices picked before, so remembered ones connect without the picker (#43). */
  async getDevices() {
    const ids = this.#granted();
    if (!ids.length) return [];
    await this.#initialize();
    const { devices = [] } = await this.#plugin.getDevices({ deviceIds: ids });
    return devices.map((found) => this.#device(found));
  }

  /** Asks for the Bluetooth permission once; again on the next call if it failed. */
  #initialize() {
    this.#ready ??= Promise.resolve(this.#plugin.initialize({ androidNeverForLocation: true })).catch((error) => {
      this.#ready = null;
      throw error;
    });
    return this.#ready;
  }

  /** One object per device, like a browser: listeners and identity survive reconnects. */
  #device({ deviceId, name }) {
    let device = this.#devices.get(deviceId);
    if (!device) {
      device = new NativeDevice(this.#plugin, deviceId, name);
      this.#devices.set(deviceId, device);
    } else if (name) device.name = name;
    return device;
  }

  #granted() {
    try {
      const ids = JSON.parse(this.#storage?.getItem(GRANTED_KEY) ?? "[]");
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  #grant(id) {
    const ids = [...this.#granted().filter((known) => known !== id), id].slice(-MAX_GRANTED);
    try {
      this.#storage?.setItem(GRANTED_KEY, JSON.stringify(ids));
    } catch {
      // A convenience: without storage the rider just picks devices again.
    }
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A BluetoothDevice with its `gatt` server. */
class NativeDevice {
  #plugin;
  #listeners = new Set();
  #services = [];
  #characteristics = new Map();
  #watchingDisconnects = null;
  /** GATT operations on one device run one at a time, as the plugin expects. */
  #queue = Promise.resolve();

  constructor(plugin, id, name) {
    this.#plugin = plugin;
    this.id = id;
    this.name = name;
    const server = {
      device: this,
      connected: false,
      connect: () => this.#connect(),
      disconnect: () => this.#disconnect(),
      getPrimaryService: async (uuid) => this.#service(uuid),
    };
    this.gatt = server;
  }

  addEventListener(type, listener) {
    if (type === "gattserverdisconnected") this.#listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "gattserverdisconnected") this.#listeners.delete(listener);
  }

  /** Runs `operation` after the device's earlier ones; a failure does not block later ones. */
  run(operation) {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }

  async listen(eventName, callback) {
    return this.#plugin.addListener(eventName, callback);
  }

  get plugin() {
    return this.#plugin;
  }

  async #connect() {
    if (this.gatt.connected) return this.gatt;
    this.#watchingDisconnects ??= this.listen(`disconnected|${this.id}`, () => this.#dropped());
    await this.#watchingDisconnects;
    try {
      await this.run(() => this.#plugin.connect({ deviceId: this.id, timeout: CONNECT_TIMEOUT_MS }));
      const { services = [] } = await this.run(() => this.#plugin.getServices({ deviceId: this.id }));
      this.#services = services;
    } catch (error) {
      this.run(() => this.#plugin.disconnect({ deviceId: this.id })).catch(() => {});
      throw domError("NetworkError", error?.message ?? String(error));
    }
    this.gatt.connected = true;
    return this.gatt;
  }

  /** Like a browser: disconnecting on purpose also fires gattserverdisconnected. */
  #disconnect() {
    if (!this.gatt.connected) return;
    this.run(() => this.#plugin.disconnect({ deviceId: this.id })).catch(() => {});
    this.#dropped();
  }

  #dropped() {
    if (!this.gatt.connected) return;
    this.gatt.connected = false;
    const event = { type: "gattserverdisconnected", target: this };
    for (const listener of [...this.#listeners]) listener(event);
  }

  #service(uuid) {
    if (!this.gatt.connected) throw domError("NetworkError", "GATT Server is disconnected.");
    const serviceUuid = uuidString(uuid);
    const service = this.#services.find((candidate) => uuidString(candidate.uuid) === serviceUuid);
    if (!service) throw domError("NotFoundError", "No Services matching UUID found in Device.");
    return {
      uuid: serviceUuid,
      getCharacteristic: async (characteristicUuid) => {
        const wanted = uuidString(characteristicUuid);
        if (!service.characteristics?.some((candidate) => uuidString(candidate.uuid) === wanted)) {
          throw domError("NotFoundError", "No Characteristics matching UUID found in Service.");
        }
        return this.#characteristic(serviceUuid, wanted);
      },
    };
  }

  #characteristic(serviceUuid, uuid) {
    const key = `${serviceUuid}|${uuid}`;
    if (!this.#characteristics.has(key)) this.#characteristics.set(key, new NativeCharacteristic(this, serviceUuid, uuid));
    return this.#characteristics.get(key);
  }
}

/** A BluetoothRemoteGATTCharacteristic. */
class NativeCharacteristic {
  #device;
  #listeners = new Set();
  #subscribed = null;
  value = null;

  constructor(device, serviceUuid, uuid) {
    this.#device = device;
    this.service = { uuid: serviceUuid };
    this.uuid = uuid;
  }

  addEventListener(type, listener) {
    if (type === "characteristicvaluechanged") this.#listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "characteristicvaluechanged") this.#listeners.delete(listener);
  }

  async startNotifications() {
    // Once per characteristic: the native listener outlives reconnects.
    this.#subscribed ??= this.#listenForValues();
    await this.#subscribed;
    await this.#run("startNotifications");
    return this;
  }

  writeValueWithResponse(bytes) {
    return this.#run("write", { value: hexOf(bytes) });
  }

  writeValueWithoutResponse(bytes) {
    return this.#run("writeWithoutResponse", { value: hexOf(bytes) });
  }

  /**
   * The plugin names the event after the device and both UUIDs. The iOS side
   * spells the UUIDs the way CoreBluetooth prints them, which can be the short
   * form for standard ones ("1826"), so both spellings are listened to.
   */
  async #listenForValues() {
    const device = this.#device;
    const spellings = new Set([`${this.service.uuid}|${this.uuid}`, `${shortUuid(this.service.uuid)}|${shortUuid(this.uuid)}`]);
    const onValue = (event) => this.#changed(dataViewOf(event?.value));
    await Promise.all([...spellings].map((uuids) => device.listen(`notification|${device.id}|${uuids}`, onValue)));
  }

  #changed(value) {
    this.value = value;
    const event = { type: "characteristicvaluechanged", target: this };
    for (const listener of [...this.#listeners]) listener(event);
  }

  #run(method, options = {}) {
    const device = this.#device;
    if (!device.gatt.connected) return Promise.reject(domError("NetworkError", "GATT Server is disconnected."));
    return device.run(() => device.plugin[method]({ deviceId: device.id, service: this.service.uuid, characteristic: this.uuid, ...options }));
  }
}
