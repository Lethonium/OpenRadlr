/**
 * In-memory stand-in for the app's native BLE plugin
 * (`Capacitor.Plugins.BluetoothLe`): describe the devices around, push
 * notifications and drop links from tests.
 */

const BASE = "-0000-1000-8000-00805f9b34fb";
const full = (uuid) => (typeof uuid === "number" ? `${uuid.toString(16).padStart(8, "0")}${BASE}` : uuid);

export function fakeBlePlugin({ devices = [], chosen = devices[0]?.deviceId } = {}) {
  const listeners = new Map();
  const connected = new Set();
  const calls = [];
  const writes = [];
  const fail = {};

  const emit = (eventName, data) => [...(listeners.get(eventName) ?? [])].forEach((callback) => callback(data));
  const find = (deviceId) => devices.find((device) => device.deviceId === deviceId);
  const record = (method, options) => {
    calls.push({ method, options });
    if (fail[method]) throw new Error(fail[method]);
  };

  const plugin = {
    async initialize(options) {
      record("initialize", options);
    },
    async requestDevice(options) {
      record("requestDevice", options);
      const device = find(chosen);
      return { deviceId: device.deviceId, name: device.name };
    },
    async getDevices(options) {
      record("getDevices", options);
      return { devices: devices.filter((device) => options.deviceIds.includes(device.deviceId)).map(({ deviceId, name }) => ({ deviceId, name })) };
    },
    async connect(options) {
      record("connect", options);
      connected.add(options.deviceId);
    },
    async disconnect(options) {
      record("disconnect", options);
      connected.delete(options.deviceId);
    },
    async getServices(options) {
      record("getServices", options);
      const services = find(options.deviceId).services;
      return {
        services: Object.entries(services).map(([uuid, characteristics]) => ({
          uuid: full(Number(uuid) || uuid),
          characteristics: characteristics.map((characteristic) => ({ uuid: full(characteristic), properties: {}, descriptors: [] })),
        })),
      };
    },
    async startNotifications(options) {
      record("startNotifications", options);
    },
    async write(options) {
      record("write", options);
      writes.push(options);
    },
    async writeWithoutResponse(options) {
      record("writeWithoutResponse", options);
      writes.push(options);
    },
    /** Like the iOS bridge: hands back the handle at once, not a promise. */
    addListener(eventName, callback) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(callback);
      return { remove: async () => listeners.get(eventName).delete(callback) };
    },
  };

  return {
    plugin,
    calls,
    writes,
    /** Set `fail.connect = "message"` to make that method reject. */
    fail,
    isConnected: (deviceId) => connected.has(deviceId),
    /** A notification with the UUIDs spelled as given (`"1826"` or the full form). */
    notify(deviceId, service, characteristic, hex) {
      emit(`notification|${deviceId}|${service}|${characteristic}`, { value: hex });
    },
    /** The device went away (switched off, out of range). */
    drop(deviceId) {
      connected.delete(deviceId);
      emit(`disconnected|${deviceId}`);
    },
    listenerCount: (eventName) => listeners.get(eventName)?.size ?? 0,
  };
}

/** A trainer with FTMS (bike data and control point). */
export const trainerDevice = (deviceId = "trainer-1", name = "KICKR CORE") => ({ deviceId, name, services: { [0x1826]: [0x2ad2, 0x2ad9] } });

/** A heart rate strap. */
export const strapDevice = (deviceId = "strap-1", name = "HRM-Pro") => ({ deviceId, name, services: { [0x180d]: [0x2a37] } });

/** In-memory Storage. */
export function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
}
