import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";
import { PRESET_WORKOUTS, createWorkout, steady, positionAt } from "../public/js/ride/workout.js";
import { displayFrame, workoutPlanFrame, DISPLAY_LIMIT_BYTES } from "../public/js/display/displayFrame.js";

const T0 = Date.UTC(2026, 10, 12, 10, 0, 0);

/** A recording of 1 Hz samples at the given watts. */
function recording(powers) {
  const samples = powers.map((power, i) => ({ t: T0 + i * 1000, power, heartRate: 140, distance: i * 10, elevation: i * 0.1 }));
  const pauses = [];
  return { summary: RideRecorder.from({ samples, pauses }).summary(), samples, pauses };
}
const size = (value) => JSON.stringify(value).length;

test("a frame carries heart rate, grade and live stats", () => {
  const frame = displayFrame({ heartRate: 142, grade: 3.5, ftp: 200, recording: recording(Array(61).fill(200)), workout: null });
  assert.equal(frame.hr, 142);
  assert.equal(frame.grade, 3.5);
  assert.equal(frame.ftp, 200);
  assert.equal(frame.stats.elapsedS, 60);
  assert.equal(frame.stats.avgPower, 200);
});

test("a frame without heart rate or workout leaves them out", () => {
  const frame = displayFrame({ heartRate: null, grade: undefined, ftp: 200, recording: recording([100, 100]), workout: null });
  for (const key of ["hr", "grade", "workout"]) assert.equal(key in frame, false, key);
});

test("time in zones adds up to the ridden seconds", () => {
  const powers = [...Array(10).fill(100), ...Array(20).fill(200), ...Array(5).fill(400)];
  const { zones_s: zones } = displayFrame({ ftp: 200, recording: recording(powers) });
  assert.equal(zones.length, 6);
  assert.equal(zones.reduce((a, b) => a + b, 0), powers.length);
  assert.ok(zones[0] >= 10 || zones[1] >= 10, "easy riding lands in the low zones");
  assert.equal(zones[5], 5);
});

test("samples without a known FTP are in no zone", () => {
  const { zones_s: zones } = displayFrame({ ftp: 0, recording: recording([100, 200]) });
  assert.deepEqual(zones, [0, 0, 0, 0, 0, 0]);
});

test("the workout step and target come from the training state", () => {
  const workout = createWorkout({ name: "Test", segments: [steady(60, 0.5), steady(120, 1)] });
  const state = { ...positionAt(workout, 90), targetWatts: 190, elapsedS: 90 };
  const frame = displayFrame({ ftp: 190, cadence: 88, recording: recording([100, 100]), workout: { workout, state } });
  assert.deepEqual(frame.workout, { id: "Test", step: 1, step_elapsed_s: 30, target_w: 190 });
});

test("cadence is sent on every ride, not only in a workout", () => {
  assert.equal(displayFrame({ ftp: 190, cadence: 88, recording: recording([100]) }).cadence, 88);
  assert.equal("cadence" in displayFrame({ ftp: 190, cadence: null, recording: recording([100]) }), false);
});

test("a finished workout adds no workout field", () => {
  const workout = createWorkout({ name: "Test", segments: [steady(60, 0.5)] });
  const state = { ...positionAt(workout, 90), targetWatts: 0, elapsedS: 90 };
  const frame = displayFrame({ ftp: 190, recording: recording([100, 100]), workout: { workout, state } });
  assert.equal("workout" in frame, false);
});

test("every frame of a 2-hour ride stays under the limit", () => {
  const powers = Array.from({ length: 7201 }, (_, i) => 100 + ((i * 37) % 300));
  const workout = PRESET_WORKOUTS.at(-1);
  const state = { ...positionAt(workout, 100), targetWatts: 250, elapsedS: 100 };
  const frame = displayFrame({ heartRate: 160, grade: -12.5, ftp: 250, cadence: 95, recording: recording(powers), workout: { workout, state } });
  assert.ok(size(frame) <= DISPLAY_LIMIT_BYTES, `${size(frame)} bytes`);
});

test("the plan of the longest preset workout stays under the limit", () => {
  for (const workout of PRESET_WORKOUTS) {
    const plan = workoutPlanFrame(workout, 250);
    assert.ok(size(plan) <= DISPLAY_LIMIT_BYTES, `${workout.name}: ${size(plan)} bytes`);
  }
});

test("the plan of a very long workout is cut to fit the limit", () => {
  const workout = createWorkout({ name: "Long", segments: Array.from({ length: 500 }, (_, i) => steady(40, 0.5 + (i % 5) / 10)) });
  const plan = workoutPlanFrame(workout, 250);
  assert.ok(size(plan) <= DISPLAY_LIMIT_BYTES, `${size(plan)} bytes`);
  assert.equal(plan.workout_plan.steps[0].s, 40);
});

test("the plan lists each step's duration and watts", () => {
  const workout = createWorkout({ name: "Ramp", segments: [steady(60, 0.5), { durationS: 120, from: 0.5, to: 1, label: "Ramp", kind: "ramp" }] });
  assert.deepEqual(workoutPlanFrame(workout, 200, T0), {
    ride: T0,
    workout_plan: { id: "Ramp", name: "Ramp", steps: [{ s: 60, from_w: 100, to_w: 100 }, { s: 120, from_w: 100, to_w: 200 }] },
  });
});

test("frames name the ride by its first sample, so a cockpit can tell rides apart", () => {
  const rec = recording([100, 100]);
  assert.equal(displayFrame({ ftp: 200, recording: rec }).ride, T0);
  const workout = createWorkout({ name: "Test", segments: [steady(60, 0.5)] });
  assert.equal(workoutPlanFrame(workout, 200, T0).ride, T0);
  assert.equal("ride" in displayFrame({ ftp: 200, recording: recording([]) }), false);
});
