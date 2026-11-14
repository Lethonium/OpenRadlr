import { test } from "node:test";
import assert from "node:assert/strict";
import { workoutFromPlan, workoutState } from "../../public/js/vr/workoutFromPlan.js";

const plan = (steps) => ({ id: "Test", name: "Test", steps });

test("watts become fractions of FTP", () => {
  const workout = workoutFromPlan(plan([{ s: 60, from_w: 200, to_w: 300 }]), 200);
  assert.equal(workout.segments[0].durationS, 60);
  assert.equal(workout.segments[0].from, 1);
  assert.equal(workout.segments[0].to, 1.5);
});

test("the blocks have no label", () => {
  const workout = workoutFromPlan(plan([{ s: 60, from_w: 100, to_w: 100 }]), 200);
  assert.equal(workout.segments[0].label, "");
});

test("the workout keeps the plan's id as its name", () => {
  assert.equal(workoutFromPlan(plan([{ s: 60, from_w: 100, to_w: 100 }]), 200).name, "Test");
});

test("an unknown FTP gives a flat zero chart, not NaN", () => {
  const workout = workoutFromPlan(plan([{ s: 60, from_w: 100, to_w: 100 }]), 0);
  assert.equal(workout.segments[0].from, 0);
});

const two = workoutFromPlan(plan([{ s: 60, from_w: 100, to_w: 100 }, { s: 120, from_w: 200, to_w: 200 }]), 200);

test("the position comes from the step and the seconds into it", () => {
  const state = workoutState(two, { id: "Test", step: 1, step_elapsed_s: 30, target_w: 200 });
  assert.equal(state.index, 1);
  assert.equal(state.elapsedS, 90);
  assert.equal(state.remainingS, 90);
  assert.equal(state.segmentRemainingS, 90);
  assert.equal(state.segment, two.segments[1]);
  assert.equal(state.finished, false);
});

test("a step the plan does not have gives no position", () => {
  assert.equal(workoutState(two, { id: "Test", step: 2, step_elapsed_s: 0, target_w: 200 }), null);
});
