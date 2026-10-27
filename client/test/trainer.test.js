import { test } from "node:test";
import assert from "node:assert/strict";
import { CadenceCalculator, parseCyclingPowerMeasurement } from "../public/js/ble/cyclingPower.js";
import { DeviceLog } from "../public/js/ble/deviceLog.js";
import { SmartTrainer } from "../public/js/ble/devices.js";
import { ReadingMerger } from "../public/js/ble/readingMerger.js";
import { dataView } from "./helpers.js";
import { fakeTrainer } from "./fakeBluetooth.js";

const FTMS = 0x1826;
const BIKE_DATA = 0x2ad2;
const CONTROL = 0x2ad9;
const CPS = 0x1818;
const POWER = 0x2a63;

/** Indoor Bike Data with speed, cadence and power. */
const bikeData = (power, cadence) => [0x44, 0x00, 0x00, 0x00, (cadence * 2) & 0xff, (cadence * 2) >> 8, power & 0xff, power >> 8];
/** Cycling Power Measurement with crank revolution data. */
const cpsPacket = (power, revs, time) => [0x20, 0x00, power & 0xff, power >> 8, revs & 0xff, revs >> 8, time & 0xff, time >> 8];
/** Control point answers every write with "success". */
const acknowledging = { onWrite: (bytes, cp) => cp.notify([0x80, bytes[0], 0x01]) };

async function connect(spec, options = {}) {
  const fake = fakeTrainer(spec);
  const log = new DeviceLog();
  const trainer = await SmartTrainer.connect(fake.bluetooth, { log, ...options });
  const readings = [];
  trainer.on("data", (reading) => readings.push(reading));
  return { ...fake, trainer, readings, log };
}

// --- Cycling Power Service codec -------------------------------------------

test("parses power and crank data from a cycling power measurement", () => {
  assert.deepEqual(parseCyclingPowerMeasurement(dataView(cpsPacket(250, 1000, 2048))), {
    power: 250,
    crankRevolutions: 1000,
    crankEventTime: 2048,
  });
});

test("skips wheel data before crank data", () => {
  // flags: wheel (bit4) + crank (bit5); power 180; wheel revs (4) + time (2); crank revs 7, time 1024
  const view = dataView([0x30, 0x00, 0xb4, 0x00, 1, 2, 3, 4, 5, 6, 7, 0, 0x00, 0x04]);
  assert.deepEqual(parseCyclingPowerMeasurement(view), { power: 180, crankRevolutions: 7, crankEventTime: 1024 });
});

test("parses power-only measurements", () => {
  assert.deepEqual(parseCyclingPowerMeasurement(dataView([0x00, 0x00, 0x64, 0x00])), { power: 100 });
});

test("derives cadence from crank revolutions, also across counter wrap-around", () => {
  const cadence = new CadenceCalculator();
  assert.equal(cadence.update({ revolutions: 10, eventTime: 1000 }, 0), null);
  // 1.5 revolutions per second is impossible; one revolution in 0.666 s = 90 rpm
  assert.equal(cadence.update({ revolutions: 11, eventTime: 1000 + 683 }, 700), 90);
  assert.equal(cadence.update({ revolutions: 12, eventTime: (1000 + 683 * 2) }, 1400), 90);
  const wrap = new CadenceCalculator();
  wrap.update({ revolutions: 0xffff, eventTime: 0xff00 }, 0);
  assert.equal(wrap.update({ revolutions: 1, eventTime: (0xff00 + 1366) % 0x10000 }, 1400), 90);
});

test("cadence drops to zero when the rider stops pedalling", () => {
  const cadence = new CadenceCalculator();
  cadence.update({ revolutions: 1, eventTime: 0 }, 0);
  cadence.update({ revolutions: 2, eventTime: 683 }, 700);
  assert.equal(cadence.update({ revolutions: 2, eventTime: 683 }, 2000), 90);
  assert.equal(cadence.update({ revolutions: 2, eventTime: 683 }, 4000), 0);
});

// --- Merging ---------------------------------------------------------------

test("prefers a source that reports real values over one that sends zeros", () => {
  let now = 0;
  const merger = new ReadingMerger({ now: () => now });
  merger.update("ftms", { power: 0, cadence: 0 });
  const merged = merger.update("cps", { power: 210, cadence: 88 });
  assert.equal(merged.power, 210);
  now = 100;
  assert.equal(merger.update("ftms", { power: 0, cadence: 0 }).power, 210, "no flicker back to zero");
});

test("falls back to FTMS when CPS goes quiet and keeps zeros when everyone stops", () => {
  let now = 0;
  const merger = new ReadingMerger({ now: () => now, staleMs: 1000 });
  merger.update("cps", { power: 200 });
  now = 2000;
  assert.equal(merger.update("ftms", { power: 150 }).power, 150);
  now = 2100;
  assert.equal(merger.update("ftms", { power: 0 }).power, 0);
});

test("uses FTMS when it is the only source", () => {
  const merger = new ReadingMerger();
  assert.deepEqual(merger.update("ftms", { power: 180, cadence: 85, heartRate: 140 }), { power: 180, cadence: 85, heartRate: 140 });
});

// --- Connecting to trainers ------------------------------------------------

test("asks the browser for FTMS or Cycling Power trainers", async () => {
  const { bluetooth } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {} } } });
  const request = bluetooth.requests[0];
  assert.deepEqual(request.filters, [{ services: [FTMS] }, { services: [CPS] }]);
  assert.deepEqual(request.optionalServices, [FTMS, CPS]);
});

test("delivers FTMS data and takes control", async () => {
  const { characteristics, trainer, readings, log } = await connect({
    services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: acknowledging } },
  });
  characteristics[BIKE_DATA].notify(bikeData(230, 90));
  assert.deepEqual(readings.at(-1), { power: 230, cadence: 90, heartRate: undefined });
  assert.deepEqual(characteristics[CONTROL].writes, [[0x00], [0x07]]);
  assert.ok(trainer.canControlResistance);
  assert.ok(log.entries.some((e) => e.message.includes("0x00 accepted")));
});

test("subscribes to data before taking control", async () => {
  const order = [];
  const spec = {
    services: {
      [FTMS]: {
        [BIKE_DATA]: {},
        [CONTROL]: { onWrite: () => order.push("control write") },
      },
    },
  };
  const fake = fakeTrainer(spec);
  const original = fake.characteristics[BIKE_DATA].startNotifications.bind(fake.characteristics[BIKE_DATA]);
  fake.characteristics[BIKE_DATA].startNotifications = async () => {
    order.push("data subscribed");
    return original();
  };
  await SmartTrainer.connect(fake.bluetooth);
  assert.equal(order[0], "data subscribed");
});

test("data still flows when the trainer refuses control", async () => {
  const { characteristics, trainer, readings, log } = await connect({
    services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: { failWrite: true } } },
  });
  characteristics[BIKE_DATA].notify(bikeData(150, 80));
  assert.equal(readings.at(-1).power, 150);
  assert.ok(log.entries.some((e) => e.level === "error" && e.message.includes("Taking control failed")));
  await trainer.setGrade(3).catch(() => {});
});

test("uses Cycling Power when FTMS only sends zeros", async () => {
  const { characteristics, readings } = await connect({
    services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: acknowledging }, [CPS]: { [POWER]: {} } },
  });
  characteristics[BIKE_DATA].notify(bikeData(0, 0));
  characteristics[POWER].notify(cpsPacket(240, 100, 0));
  characteristics[POWER].notify(cpsPacket(240, 101, 683));
  characteristics[BIKE_DATA].notify(bikeData(0, 0));
  assert.equal(readings.at(-1).power, 240);
  assert.equal(readings.at(-1).cadence, 90);
});

test("works with a power-only trainer without control", async () => {
  const { characteristics, trainer, readings } = await connect({ services: { [CPS]: { [POWER]: {} } } });
  characteristics[POWER].notify(cpsPacket(200, 1, 0));
  assert.equal(readings.at(-1).power, 200);
  assert.equal(trainer.canControlResistance, false);
  await trainer.setGrade(5);
});

test("refuses devices without any power data and disconnects them", async () => {
  const fake = fakeTrainer({ services: { [FTMS]: { [CONTROL]: {} } } });
  await assert.rejects(SmartTrainer.connect(fake.bluetooth), /neither FTMS Indoor Bike Data nor Cycling Power/);
  assert.equal(fake.device.connected, false);
});

test("refuses devices when no subscription works", async () => {
  const fake = fakeTrainer({ services: { [FTMS]: { [BIKE_DATA]: { failNotify: true } } } });
  await assert.rejects(SmartTrainer.connect(fake.bluetooth), /Could not subscribe/);
});

test("never overlaps grade writes and only sends the latest pending grade", async () => {
  const { characteristics, trainer } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: {} } } });
  characteristics[CONTROL].writes.length = 0;
  await Promise.all([trainer.setGrade(1), trainer.setGrade(2), trainer.setGrade(3), trainer.setGrade(4)]);
  const grades = characteristics[CONTROL].writes.map((bytes) => new DataView(Uint8Array.from(bytes).buffer).getInt16(3, true) / 100);
  assert.deepEqual(grades, [1, 4]);
});

test("logs the first raw packets for diagnostics", async () => {
  const { characteristics, log } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {} } } });
  characteristics[BIKE_DATA].notify(bikeData(100, 60));
  assert.equal(log.packets.ftms, 1);
  const report = log.report({ userAgent: "test" });
  assert.match(report, /ftms #1: 44 00 00 00 78 00 64 00/);
  assert.match(report, /Service Cycling Power not available/);
});

test("reports a disconnect", async () => {
  const { device, trainer } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {} } } });
  let disconnected = false;
  trainer.on("disconnected", () => (disconnected = true));
  device.gatt.disconnect();
  assert.ok(disconnected);
});

// --- reliability ----------------------------------------------------------

/** Timers that run at once (connect retries) and a clock the test moves. */
const instantTimers = { setTimeout: (fn) => (Promise.resolve().then(fn), 1), clearTimeout: () => {} };

test("a trainer that refuses control can't change resistance, and says so", async () => {
  const { trainer } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: { failWrite: true } } } });
  assert.equal(trainer.canControlResistance, false);
  assert.equal(trainer.controlBlocked, true, "blocked, unlike a power-only trainer");
});

test("a trainer that answers 'control not permitted' can't change resistance either", async () => {
  const refusing = { onWrite: (bytes, cp) => cp.notify([0x80, bytes[0], bytes[0] === 0x00 ? 0x05 : 0x01]) };
  const { trainer } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: refusing } } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(trainer.canControlResistance, false);
  assert.equal(trainer.controlBlocked, true);
});

test("control is taken again once the other app lets go, at most every 10 s", async () => {
  let t = 0;
  const changes = [];
  const { characteristics, trainer } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: { failWrite: true } } } }, { now: () => t });
  trainer.on("control", (can) => changes.push(can));
  characteristics[CONTROL].failWrite = false;
  t = 5_000;
  await trainer.setGrade(2);
  assert.equal(trainer.canControlResistance, false, "too soon to ask again");
  t = 11_000;
  await trainer.setGrade(3);
  assert.equal(trainer.canControlResistance, true);
  assert.deepEqual(changes, [true]);
  // The grade at 5 s went out on its own; at 11 s control came first, then the grade.
  assert.deepEqual(characteristics[CONTROL].writes.slice(1, 3), [[0x00], [0x07]], "requested control, then started");
});

test("a power-only trainer is not 'blocked': it never could change resistance", async () => {
  const { trainer } = await connect({ services: { [CPS]: { [POWER]: {} } } });
  assert.equal(trainer.controlBlocked, false);
});

test("the first connect is retried when Chrome's first attempt fails", async () => {
  const fake = fakeTrainer({ services: { [FTMS]: { [BIKE_DATA]: {} } } });
  fake.device.failConnectTimes = 2;
  const trainer = await SmartTrainer.connect(fake.bluetooth, instantTimers);
  assert.ok(trainer.connected);
  assert.equal(fake.device.connectCalls, 3);
});

test("a trainer that never answers gives up with a timeout instead of 'Connecting…' forever", async () => {
  const fake = fakeTrainer({ services: { [FTMS]: { [BIKE_DATA]: {} } } });
  fake.device.hangConnect = true;
  const timers = [];
  const opening = SmartTrainer.connect(fake.bluetooth, { setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(timers.at(-1).ms, 15_000);
  timers.at(-1).fn();
  await assert.rejects(opening, { name: "TimeoutError" });
  assert.equal(fake.device.connectCalls, 1, "a timeout is not retried: 15 s is long enough");
});

test("a blocked trainer can be asked again while nothing is sent yet (the start menu)", async () => {
  let t = 0;
  const { characteristics, trainer } = await connect({ services: { [FTMS]: { [BIKE_DATA]: {}, [CONTROL]: { failWrite: true } } } }, { now: () => t });
  characteristics[CONTROL].failWrite = false;
  await trainer.retryControl();
  assert.equal(trainer.canControlResistance, false, "not before 10 s");
  t = 10_000;
  await trainer.retryControl();
  assert.equal(trainer.canControlResistance, true);
});
