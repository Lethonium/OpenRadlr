import { test } from "node:test";
import assert from "node:assert/strict";
import { hudValues } from "../../public/js/vr/hud2d.js";

const rider = { id: 3, power: 210, cadence: 88, speed: 10 };

test("power and cadence come from the state rider", () => {
  const values = hudValues({ hr: 140, cadence: 50, grade: 3, workout: null }, rider);
  assert.equal(values.power, 210);
  assert.equal(values.cadence, 88);
  assert.equal(values.speedKmh, 36);
});

test("heart rate comes from the display frame", () => {
  const values = hudValues({ hr: 140, grade: 3, workout: { block: 2 } }, rider);
  assert.equal(values.heartRate, 140);
  assert.deepEqual(values.workout, { block: 2 });
  assert.equal(values.grade, 3);
});

test("heart rate is null without a frame", () => {
  const values = hudValues({ hr: null, grade: null, workout: null }, rider);
  assert.equal(values.heartRate, null);
  assert.equal(values.workout, null);
});
