import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceLog } from "../public/js/ble/deviceLog.js";
import { HeartRateMonitor, SmartTrainer } from "../public/js/ble/devices.js";
import { KnownDevices, MAX_CONTROLLERS, grantedDevices, whenInRange } from "../public/js/ble/knownDevices.js";
import { RECONNECT_DELAYS_MS } from "../public/js/ble/reconnector.js";
import { ZwiftController } from "../public/js/ble/zwiftController.js";
import { fakeTrainer } from "./fakeBluetooth.js";

const FTMS = 0x1826;
const BIKE_DATA = 0x2ad2;
const CONTROL = 0x2ad9;
const HEART_RATE = 0x180d;
const HR_MEASUREMENT = 0x2a37;
const bikeData = (power, cadence) => [0x44, 0x00, 0x00, 0x00, (cadence * 2) & 0xff, (cadence * 2) >> 8, power & 0xff, power >> 8];

/** Timers that only run when the test says so. */
function manualTimers() {
  const timers = [];
  return {
    setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimeout: (id) => (timers[id] = null),
    pending: () => timers.filter(Boolean),
    async runNext() {
      const index = timers.findIndex(Boolean);
      const timer = timers[index];
      timers[index] = null;
      await timer.fn();
    },
  };
}

async function trainer() {
  const fake = fakeTrainer({ name: "KICKR CORE", id: "kickr", services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: {} } } });
  const timers = manualTimers();
  const log = new DeviceLog();
  const device = await SmartTrainer.connect(fake.bluetooth, { log, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const events = [];
  device.on("disconnected", () => events.push("disconnected"));
  device.on("reconnected", () => events.push("reconnected"));
  return { ...fake, trainer: device, timers, events, log, control: fake.characteristics[CONTROL] };
}

// ---------------------------------------------------------------- trainer ---

test("a trainer that drops reconnects on its own, with a growing delay", async () => {
  const { device, trainer: t, timers, events, characteristics } = await trainer();
  device.failConnect = true;
  device.gatt.disconnect();
  assert.deepEqual(events, ["disconnected"]);
  assert.equal(t.connected, false);
  assert.equal(timers.pending()[0].ms, RECONNECT_DELAYS_MS[0]);

  await timers.runNext(); // still off
  assert.equal(timers.pending()[0].ms, RECONNECT_DELAYS_MS[1]);

  device.failConnect = false;
  await timers.runNext();
  assert.deepEqual(events, ["disconnected", "reconnected"]);
  assert.equal(t.connected, true);
  assert.equal(timers.pending().length, 0);

  const readings = [];
  t.on("data", (reading) => readings.push(reading));
  characteristics[BIKE_DATA].notify(bikeData(200, 85));
  assert.equal(readings.length, 1, "one data listener after the reconnect, not two");
  assert.equal(readings[0].power, 200);
});

test("after a reconnect the trainer takes control again and gets the last grade", async () => {
  const { device, trainer: t, timers, control } = await trainer();
  await t.setGrade(4);
  device.gatt.disconnect();
  // Commands while it is away wait for the reconnect: no writes, no errors.
  await t.setGrade(6);
  await t.setTargetPower(220);
  const writesBefore = control.writes.length;
  await timers.runNext();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const after = control.writes.slice(writesBefore);
  assert.deepEqual(after.slice(0, 2), [[0x00], [0x07]], "request control, start");
  assert.equal(after.length, 3);
  assert.equal(after[2][0], 0x05, "the last command, the ERG target, is sent again");
});

test("disconnecting a trainer on purpose stops reconnecting", async () => {
  const { device, trainer: t, timers, events } = await trainer();
  device.failConnect = true;
  device.gatt.disconnect();
  t.disconnect();
  assert.equal(timers.pending().length, 0);

  // Switching trainers: the old one goes quietly.
  const other = await trainer();
  other.trainer.disconnect();
  assert.deepEqual(other.events, []);
  assert.deepEqual(events, ["disconnected"]);
});

test("a remembered trainer can be asked for by name and opened without the chooser", async () => {
  const fake = fakeTrainer({ name: "KICKR CORE", services: { [FTMS]: { [BIKE_DATA]: {} } } });
  await SmartTrainer.connect(fake.bluetooth, { names: ["KICKR CORE"] });
  assert.deepEqual(fake.bluetooth.requests[0].filters, [{ name: "KICKR CORE" }]);
  assert.deepEqual(fake.bluetooth.requests[0].optionalServices, [FTMS, 0x1818], "services stay reachable with a name filter");

  const known = fakeTrainer({ name: "KICKR CORE", services: { [FTMS]: { [BIKE_DATA]: {} } } });
  const opened = await SmartTrainer.open(known.device);
  assert.equal(known.bluetooth.requests.length, 0);
  assert.equal(opened.connected, true);
  assert.equal(opened.id, "fake-device-1");
});

// ------------------------------------------------------------ heart rate ---

test("a heart rate strap reconnects after a drop and keeps one listener", async () => {
  const fake = fakeTrainer({ name: "TICKR", id: "tickr", services: { [HEART_RATE]: { [HR_MEASUREMENT]: {} } } });
  const timers = manualTimers();
  const monitor = await HeartRateMonitor.connect(fake.bluetooth, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  assert.equal(monitor.id, "tickr");
  const events = [];
  monitor.on("disconnected", () => events.push("disconnected"));
  monitor.on("reconnected", () => events.push("reconnected"));
  fake.device.gatt.disconnect();
  await timers.runNext();
  assert.deepEqual(events, ["disconnected", "reconnected"]);
  const beats = [];
  monitor.on("data", ({ heartRate }) => beats.push(heartRate));
  fake.characteristics[HR_MEASUREMENT].notify([0x00, 142]);
  assert.deepEqual(beats, [142]);
});

test("a remembered strap or controller is asked for by name", async () => {
  const strap = fakeTrainer({ name: "TICKR", services: { [HEART_RATE]: { [HR_MEASUREMENT]: {} } } });
  await HeartRateMonitor.connect(strap.bluetooth, { names: ["TICKR"] });
  assert.deepEqual(strap.bluetooth.requests[0].filters, [{ name: "TICKR" }]);
  assert.ok(strap.bluetooth.requests[0].optionalServices.includes(HEART_RATE));

  const click = fakeTrainer({ name: "Zwift Click", services: {} });
  await assert.rejects(ZwiftController.connect(click.bluetooth, { names: ["Zwift Click", "Zwift Play"] }), /not a Zwift/);
  assert.deepEqual(click.bluetooth.requests[0].filters, [{ name: "Zwift Click" }, { name: "Zwift Play" }]);
});

// ---------------------------------------------------------- known devices ---

function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
}

test("remembers one trainer, one strap and the last two controllers", () => {
  const known = new KnownDevices(memoryStorage());
  known.remember("trainer", { id: "a", label: "Old trainer" });
  known.remember("trainer", { id: "b", label: "KICKR CORE" });
  known.remember("hr", { id: "h", label: "TICKR" });
  for (const id of ["c1", "c2", "c1", "c3"]) known.remember("controller", { id, label: `Zwift Click ${id}` });
  assert.deepEqual(known.of("trainer"), [{ kind: "trainer", id: "b", name: "KICKR CORE" }]);
  assert.deepEqual(known.of("hr").map((e) => e.id), ["h"]);
  assert.deepEqual(known.of("controller").map((e) => e.id), ["c1", "c3"]);
  assert.equal(known.of("controller").length, MAX_CONTROLLERS);
});

test("ignores devices without an id or name, and broken storage", () => {
  const storage = memoryStorage();
  const known = new KnownDevices(storage);
  known.remember("trainer", { label: "Simulated trainer" });
  known.remember("bike", { id: "x", label: "?" });
  assert.deepEqual(known.list(), []);
  storage.setItem("openradlr.devices", "not json");
  assert.deepEqual(known.list(), []);
  storage.setItem("openradlr.devices", JSON.stringify([{ kind: "trainer", id: 3 }, { kind: "hr", id: "h", name: "TICKR" }]));
  assert.deepEqual(known.list(), [{ kind: "hr", id: "h", name: "TICKR" }]);
  assert.deepEqual(new KnownDevices(null).list(), []);
  assert.doesNotThrow(() => new KnownDevices({ getItem: () => null, setItem: () => { throw new Error("quota"); } }).remember("hr", { id: "h", label: "TICKR" }));
});

test("finds remembered devices among the granted ones, where the browser can", async () => {
  const entry = { kind: "trainer", id: "kickr", name: "KICKR CORE" };
  const kickr = { id: "kickr" };
  const bluetooth = { getDevices: async () => [{ id: "other" }, kickr] };
  assert.deepEqual(await grantedDevices([entry, { kind: "hr", id: "gone", name: "TICKR" }], bluetooth), [{ entry, device: kickr }]);
  assert.deepEqual(await grantedDevices([entry], {}), [], "no getDevices(): nothing");
  assert.deepEqual(await grantedDevices([entry], { getDevices: async () => Promise.reject(new Error("blocked")) }), []);
  assert.deepEqual(await grantedDevices([], bluetooth), []);
});

test("waits for a device's advertisement before connecting, where the browser can watch", async () => {
  const timers = manualTimers();
  const listeners = new Map();
  const device = {
    name: "Zwift Click",
    watching: null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    async watchAdvertisements({ signal }) {
      this.watching = signal;
    },
  };
  let found = false;
  const waiting = whenInRange(device, timers).then(() => (found = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(found, false);
  listeners.get("advertisementreceived")();
  await waiting;
  assert.equal(device.watching.aborted, true, "stops watching once found");
  assert.equal(timers.pending().length, 0);

  const asleep = whenInRange({ ...device }, { ...timers, timeoutMs: 1000 });
  await timers.runNext();
  await assert.rejects(asleep, /not found nearby/);

  await whenInRange({ name: "KICKR" }); // can't watch: try at once
  await whenInRange({ ...device, watchAdvertisements: async () => Promise.reject(new Error("unsupported")) }, timers);
});
