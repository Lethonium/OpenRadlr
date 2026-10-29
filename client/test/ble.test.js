import { test } from "node:test";
import { DeviceLog, deviceLogOptions } from "../public/js/ble/deviceLog.js";
import assert from "node:assert/strict";
import {
  encodeRequestControl,
  encodeSimulationParameters,
  parseControlPointResponse,
  parseIndoorBikeData,
} from "../public/js/ble/ftms.js";
import { parseHeartRate } from "../public/js/ble/heartRate.js";
import { PaddleTrainer, SimulatedTrainer, canExportRide, deviceKind, hasRealPowerSource } from "../public/js/ble/devices.js";
import { dataView, fakeScheduler } from "./helpers.js";

test("parses speed, cadence and power from indoor bike data", () => {
  // flags 0x0044: speed present (bit0 clear), cadence (bit2), power (bit6)
  const view = dataView([0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00]);
  assert.deepEqual(parseIndoorBikeData(view), { speedKmh: 25, cadence: 90, power: 250 });
});

test("skips optional fields it does not use", () => {
  // flags: avg speed (bit1), cadence (bit2), total distance (bit4), power (bit6), heart rate (bit9)
  const flags = (1 << 1) | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 9);
  const view = dataView([
    flags & 0xff, flags >> 8,
    0x10, 0x27, // speed 100.00 km/h
    0x00, 0x00, // average speed
    0xa0, 0x00, // cadence 80
    0x01, 0x02, 0x03, // total distance
    0x2c, 0x01, // power 300
    0x8c, // heart rate 140
  ]);
  assert.deepEqual(parseIndoorBikeData(view), { speedKmh: 100, cadence: 80, power: 300, heartRate: 140 });
});

test("handles the 'more data' flag meaning no speed field", () => {
  const view = dataView([0x41, 0x00, 0x64, 0x00]);
  assert.deepEqual(parseIndoorBikeData(view), { power: 100 });
});

test("encodes simulation parameters in FTMS units", () => {
  const bytes = encodeSimulationParameters({ gradePercent: 5.25 });
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint8(0), 0x11);
  assert.equal(view.getInt16(1, true), 0);
  assert.equal(view.getInt16(3, true), 525);
  assert.equal(view.getUint8(5), 40);
  assert.equal(view.getUint8(6), 51);
});

test("encodes negative grades and clamps absurd ones", () => {
  const down = new DataView(encodeSimulationParameters({ gradePercent: -3 }).buffer);
  assert.equal(down.getInt16(3, true), -300);
  const absurd = new DataView(encodeSimulationParameters({ gradePercent: 1e6 }).buffer);
  assert.equal(absurd.getInt16(3, true), 32767);
});

test("request control is a single opcode", () => {
  assert.deepEqual([...encodeRequestControl()], [0x00]);
});

test("parses control point responses", () => {
  assert.deepEqual(parseControlPointResponse(dataView([0x80, 0x11, 0x01])), { requestOpCode: 0x11, resultCode: 1, success: true });
  assert.equal(parseControlPointResponse(dataView([0x80, 0x00, 0x05])).success, false);
  assert.equal(parseControlPointResponse(dataView([0x11])), null);
});

test("parses 8 and 16 bit heart rate values", () => {
  assert.equal(parseHeartRate(dataView([0x00, 72])), 72);
  assert.equal(parseHeartRate(dataView([0x01, 0x2c, 0x01])), 300);
});

test("simulated trainer emits its power on every tick and clamps input", () => {
  const scheduler = fakeScheduler();
  const trainer = new SimulatedTrainer(scheduler);
  const readings = [];
  trainer.on("data", (reading) => readings.push(reading));
  trainer.setPower(220.4);
  scheduler.fire();
  trainer.setPower(-50);
  scheduler.fire();
  assert.deepEqual(readings, [{ power: 220, cadence: 85 }, { power: 0, cadence: 0 }]);
  trainer.disconnect();
  assert.equal(scheduler.active, 0);
});

test("phone paddles turn taps into power and can't change resistance", async () => {
  const scheduler = fakeScheduler();
  let t = 0;
  const trainer = new PaddleTrainer({ ftp: 200, now: () => t, ...scheduler });
  const readings = [];
  trainer.on("data", (reading) => readings.push(reading));
  assert.equal(trainer.canControlResistance, false);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(trainer.tap(i % 2 ? "right" : "left"), "stroke");
    t += 500;
  }
  scheduler.fire();
  assert.ok(readings.at(-1).power > 100, `power ${readings.at(-1).power}`);
  assert.equal(readings.at(-1).cadence, 90);
  await trainer.setGrade(8);
  assert.ok(trainer.state().sweetSpot.high < 120);
  trainer.disconnect();
  assert.equal(scheduler.active, 0);
});

test("only a real trainer counts as a power source for Strava", () => {
  const scheduler = fakeScheduler();
  const sim = new SimulatedTrainer(scheduler);
  const paddles = new PaddleTrainer(scheduler);
  const real = { label: "KICKR", on: () => () => {} };
  assert.equal(deviceKind(sim), "sim");
  assert.equal(deviceKind(paddles), "paddle");
  assert.equal(deviceKind(real), "trainer");
  assert.equal(hasRealPowerSource(sim), false);
  assert.equal(hasRealPowerSource(paddles), false);
  assert.equal(hasRealPowerSource(real), true);
  assert.equal(hasRealPowerSource(null), false);
  // Ride files: everyone but phone paddlers.
  assert.equal(canExportRide(real), true);
  assert.equal(canExportRide(sim), true);
  assert.equal(canExportRide(paddles), false);
});

test("the device report counts packets it doesn't log, e.g. a controller's idle messages", () => {
  const log = new DeviceLog();
  log.count("zwift idle");
  log.count("zwift idle");
  assert.deepEqual(log.packets, { "zwift idle": 2 });
  assert.equal(log.entries.length, 0, "counted, not logged");
  assert.match(log.report(), /"zwift idle":2/);
});

test("?debug=controller captures every controller packet, the trainer's stay capped", () => {
  assert.deepEqual(deviceLogOptions(""), {});
  assert.deepEqual(deviceLogOptions("?route=col"), {});
  const options = deviceLogOptions("?debug=controller");
  const log = new DeviceLog(options);
  const view = new DataView(new Uint8Array([0x19, 0x10, 0x46]).buffer);
  for (let i = 0; i < 50; i += 1) log.packet("zwift", view, {});
  for (let i = 0; i < 50; i += 1) log.packet("ftms", view, {});
  const logged = (source) => log.entries.filter((e) => e.message.startsWith(`${source} #`)).length;
  assert.equal(logged("zwift"), 50);
  assert.equal(logged("ftms"), 20);
  assert.match(log.report(), /Capturing: zwift/);
});
