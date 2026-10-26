import { test } from "node:test";
import assert from "node:assert/strict";
import { CURVE_DURATIONS, POWER_CAP_W, powerSeries, bestEfforts, weightedPower, rideLoad } from "../public/js/ride/powerAnalysis.js";

const T0 = Date.UTC(2026, 9, 14, 13, 30, 0);

/** 1 Hz samples with the given powers, starting `startT` seconds after T0. */
function ride(powers, { startT = 0 } = {}) {
  return powers.map((power, i) => ({ t: T0 + (startT + i) * 1000, power }));
}
const steady = (watts, seconds) => Array(seconds).fill(watts);
const pause = (fromS, toS) => ({ from: T0 + fromS * 1000, to: T0 + toS * 1000 });

test("steady power gives the same best effort for every duration that fits", () => {
  const best = bestEfforts(ride(steady(200, 1300)), []);
  for (const d of CURVE_DURATIONS) assert.equal(best[d], d <= 1200 ? 200 : null, `${d} s`);
});

test("best efforts pick the strongest window", () => {
  const best = bestEfforts(ride([...steady(150, 600), ...steady(300, 300), ...steady(150, 600)]), []);
  assert.equal(best[300], 300);
  assert.equal(best[60], 300);
  assert.equal(best[1200], 188);
});

test("a pause splits the ride so no window spans it", () => {
  const first = ride(steady(250, 150));
  const second = ride(steady(250, 150), { startT: 270 });
  const best = bestEfforts([...first, ...second], [pause(150, 270)]);
  assert.equal(best[300], null);
  assert.equal(best[60], 250);
});

test("a closed pause splits even when the samples are close together", () => {
  const samples = ride(steady(250, 20));
  assert.equal(powerSeries(samples, [pause(9, 10)]).length, 2);
});

test("spikes are capped", () => {
  assert.equal(POWER_CAP_W, 2000);
  const [series] = powerSeries(ride([200, 5000, 200]), []);
  assert.deepEqual(series, [200, 2000, 200]);
});

test("a gap over 5 s without a pause splits the stretch", () => {
  const samples = [...ride(steady(200, 10)), ...ride(steady(200, 10), { startT: 20 })];
  assert.deepEqual(powerSeries(samples, []).map((s) => s.length), [10, 10]);
});

test("a short gap holds the last value", () => {
  const samples = [...ride([100, 100]), ...ride([300, 300], { startT: 5 })];
  assert.deepEqual(powerSeries(samples, []), [[100, 100, 100, 100, 100, 300, 300]]);
});

test("weighted power of steady riding is the power", () => {
  assert.equal(weightedPower(ride(steady(200, 600)), []), 200);
});

test("weighted power rises above the average for variable riding", () => {
  const powers = Array.from({ length: 20 * 60 }, (_, i) => (Math.floor(i / 30) % 2 === 0 ? 100 : 300));
  const wp = weightedPower(ride(powers), []);
  assert.ok(wp > 200 && wp < 260, `${wp}`);
});

test("weighted power needs 30 s of riding", () => {
  assert.equal(weightedPower(ride(steady(200, 29)), []), null);
  assert.equal(weightedPower([], []), null);
});

test("rideLoad", () => {
  assert.equal(rideLoad({ weightedPower: 250, durationS: 3600, ftp: 250 }), 100);
  assert.equal(rideLoad({ weightedPower: 200, durationS: 1800, ftp: 250 }), 32);
  assert.equal(rideLoad({ weightedPower: 200, durationS: 1800, ftp: null }), null);
  assert.equal(rideLoad({ weightedPower: 200, durationS: 1800, ftp: 0 }), null);
  assert.equal(rideLoad({ weightedPower: null, durationS: 1800, ftp: 250 }), null);
});
