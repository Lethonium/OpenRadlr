/**
 * In-memory Web Bluetooth stand-in. Describe which services and
 * characteristics a trainer has; push notifications from tests.
 */

class FakeCharacteristic {
  #listeners = [];
  writes = [];
  notifying = false;

  constructor(uuid, { failNotify = false, failWrite = false, onWrite = null } = {}) {
    this.uuid = uuid;
    this.failNotify = failNotify;
    this.failWrite = failWrite;
    this.onWrite = onWrite;
  }

  addEventListener(type, listener) {
    // Like EventTarget: the same listener is only registered once.
    if (type === "characteristicvaluechanged" && !this.#listeners.includes(listener)) this.#listeners.push(listener);
  }

  async startNotifications() {
    if (this.failNotify) throw new Error("GATT operation failed for unknown reason.");
    this.notifying = true;
    return this;
  }

  async writeValueWithResponse(bytes) {
    if (this.failWrite) throw new Error("GATT operation not permitted.");
    if (this.busy) throw new Error("GATT operation already in progress.");
    this.busy = true;
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.busy = false;
    this.writes.push([...bytes]);
    this.onWrite?.(bytes, this);
  }

  async writeValueWithoutResponse(bytes) {
    if (this.failWrite) throw new Error("GATT operation not permitted.");
    this.writes.push([...bytes]);
    this.onWrite?.(bytes, this);
  }

  /** Simulates a notification/indication from the device. */
  notify(bytes) {
    if (!this.notifying) return;
    const value = new DataView(Uint8Array.from(bytes).buffer);
    for (const listener of this.#listeners) listener({ target: { value } });
  }
}

/** Numeric UUIDs (16-bit services) as numbers, 128-bit UUIDs as strings. */
const uuidKey = (uuid) => (/^\d+$/.test(String(uuid)) ? Number(uuid) : String(uuid));

export function fakeTrainer({ name = "Fake Trainer", id = "fake-device-1", services = {} } = {}) {
  const characteristics = {};
  const serviceMap = new Map();
  for (const [serviceUuid, chars] of Object.entries(services)) {
    const map = new Map();
    for (const [charUuid, options] of Object.entries(chars)) {
      const characteristic = new FakeCharacteristic(uuidKey(charUuid), options);
      map.set(uuidKey(charUuid), characteristic);
      characteristics[charUuid] = characteristic;
    }
    serviceMap.set(uuidKey(serviceUuid), map);
  }

  const notFound = () => Object.assign(new Error("No Services matching UUID found in Device."), { name: "NotFoundError" });
  const device = {
    name,
    id,
    connected: false,
    listeners: [],
    addEventListener(type, listener) {
      if (type === "gattserverdisconnected") this.listeners.push(listener);
    },
    /** Set to make the next connect() calls fail, as for a sleeping device. */
    failConnect: false,
    gatt: {
      async connect() {
        if (device.failConnect) throw Object.assign(new Error("Bluetooth Device is no longer in range."), { name: "NetworkError" });
        device.connected = true;
        return {
          async getPrimaryService(uuid) {
            const chars = serviceMap.get(uuid);
            if (!chars) throw notFound();
            return {
              async getCharacteristic(charUuid) {
                const characteristic = chars.get(charUuid);
                if (!characteristic) throw Object.assign(new Error("No Characteristics matching UUID found."), { name: "NotFoundError" });
                return characteristic;
              },
            };
          },
        };
      },
      disconnect() {
        if (!device.connected) return;
        device.connected = false;
        for (const characteristic of Object.values(characteristics)) characteristic.notifying = false;
        device.listeners.forEach((listener) => listener());
      },
    },
  };

  const bluetooth = {
    requests: [],
    async requestDevice(options) {
      this.requests.push(options);
      return device;
    },
    /** Devices this site was granted before (browsers with the new permissions backend). */
    async getDevices() {
      return [device];
    },
  };
  return { bluetooth, device, characteristics };
}
