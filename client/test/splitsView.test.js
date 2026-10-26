import { test } from "node:test";
import assert from "node:assert/strict";
import { splitRows } from "../public/js/view/splitsView.js";

const lap = (n, speed, extra = {}) => ({ kind: "lap", lap: n, durationS: 700, distanceM: 7000, toM: 7000 * n, avgSpeed: speed, avgPower: 200, avgHeartRate: null, elevationGainM: 20, partial: false, ...extra });

test("rows: hints against the average of comparable splits, one best", () => {
  const rows = splitRows([lap(1, 10), lap(2, 9.7), lap(3, 10.3), { ...lap(0, 8), kind: "free", lap: null, partial: true }]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.best), [false, false, true, false]);
  assert.deepEqual(rows.map((r) => r.hint), ["0 %", "−3 %", "+3 %", ""]);
  assert.equal(rows[0].label, "Lap 1");
  assert.equal(rows[0].time, "11:40");
  assert.equal(rows[0].speed, "36.0 km/h");
  assert.equal(rows[0].power, "200 W");
  assert.equal(rows[0].heartRate, "–");
  assert.equal(rows[3].label, "7.0 km");
});

test("rows: heart rate when there is one", () => {
  assert.equal(splitRows([lap(1, 10, { avgHeartRate: 141.6 })])[0].heartRate, "142 bpm");
});
