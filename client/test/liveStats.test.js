import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";
import { liveStats, powerWindow } from "../public/js/ride/liveStats.js";

const T0 = Date.UTC(2026, 9, 30, 10, 0, 0);

/** 1 Hz samples of the given watts, 10 m apart, starting `startS` seconds after T0. */
function ride(powers, { startS = 0, heartRate = null } = {}) {
  return powers.map((power, i) => ({
    t: T0 + (startS + i) * 1000,
    power,
    heartRate,
    distance: (startS + i) * 10,
    elevation: (startS + i) * 0.1,
  }));
}
const steady = (watts, seconds) => Array(seconds).fill(watts);
const statsOf = (samples, pauses = [], ftp = 200) => liveStats({ summary: RideRecorder.from({ samples, pauses }).summary(), samples, pauses, ftp });

test("figures from a steady 200 W ride", () => {
  const stats = statsOf(ride(steady(200, 1301), { heartRate: 140 }));
  assert.equal(stats.elapsedS, 1300);
  assert.equal(stats.distanceM, 13000);
  assert.equal(stats.climbedM, 130);
  assert.equal(stats.kJ, 260);
  assert.equal(stats.avgHeartRate, 140);
  assert.equal(stats.avgPower, 200);
  assert.equal(stats.weightedPower, 200);
  assert.equal(stats.load, 36.1);
  assert.deepEqual(stats.efforts, [5, 60, 300, 1200].map((s) => ({ s, w: 200 })));
});

test("a ride shorter than a window gets no effort for it", () => {
  const stats = statsOf(ride(steady(200, 100)));
  assert.deepEqual(stats.efforts.map((e) => e.s), [5, 60]);
});

test("pauses are not counted as riding time", () => {
  const samples = [...ride(steady(200, 60)), ...ride(steady(200, 60), { startS: 160 })];
  const stats = statsOf(samples, [{ from: T0 + 59000, to: T0 + 160000 }]);
  assert.equal(stats.elapsedS, 118);
});

test("no heart rate gives null", () => {
  assert.equal(statsOf(ride(steady(200, 60))).avgHeartRate, null);
});

test("no FTP gives a null load", () => {
  assert.equal(statsOf(ride(steady(200, 60)), [], null).load, null);
});

test("powerWindow returns only the last ten minutes", () => {
  const points = powerWindow(ride(steady(100, 1000)), { windowS: 600 });
  assert.equal(points.length, 601);
  assert.deepEqual(points[0], { t: 600, w: 100 });
  assert.deepEqual(points.at(-1), { t: 0, w: 100 });
});

test("an empty recording returns zeros and no efforts", () => {
  const stats = statsOf([]);
  assert.deepEqual(
    { e: stats.elapsedS, d: stats.distanceM, c: stats.climbedM, k: stats.kJ, a: stats.avgPower, w: stats.weightedPower, l: stats.load, f: stats.efforts },
    { e: 0, d: 0, c: 0, k: 0, a: 0, w: 0, l: null, f: [] },
  );
  assert.deepEqual(powerWindow([]), []);
});
