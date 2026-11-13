import { test } from "node:test";
import assert from "node:assert/strict";
import { RideGoal, goalTarget, goalUnit } from "../public/js/ride/rideGoal.js";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";

for (const [kind, field] of [["time", "durationS"], ["distance", "distanceM"], ["climbing", "elevationGainM"]]) {
  test(`${kind} goals use the recorded total and complete once`, () => {
    const goal = new RideGoal();
    goal.set(kind, 100);
    assert.equal(goal.update({ [field]: 40 }), false);
    assert.equal(goal.progress, 0.4);
    assert.equal(goal.update({ [field]: 110 }), true);
    assert.equal(goal.progress, 1);
    assert.equal(goal.update({ [field]: 120 }), false);
    assert.equal(goal.completed, true);
  });
}

test("invalid targets and kinds are rejected", () => {
  for (const value of [0, -1, NaN, Infinity, "10", null]) {
    assert.throws(() => new RideGoal().set("time", value));
  }
  assert.throws(() => new RideGoal().set("watts", 100));
});

test("replacing and removing a goal clears completion", () => {
  const goal = new RideGoal();
  goal.set("time", 10);
  goal.update({ durationS: 20 });
  goal.set("distance", 100);
  assert.equal(goal.completed, false);
  assert.equal(goal.progress, 0);
  goal.clear();
  assert.equal(goal.snapshot(), null);
  assert.equal(goal.update({ distanceM: 1000 }), false);
});

test("restoring an achieved goal never announces it again", () => {
  const original = new RideGoal();
  original.set("time", 100);
  original.update({ durationS: 110 });
  const restored = new RideGoal(original.snapshot());
  assert.equal(restored.update({ durationS: 120 }), false);
  assert.equal(restored.completed, true);
});

test("old or corrupt autosave goals are ignored", () => {
  for (const saved of [undefined, null, {}, { kind: "bad", target: 10 }, { kind: "time", target: -1 }]) {
    assert.equal(new RideGoal(saved).snapshot(), null);
  }
});

test("input targets use minutes and the rider's distance and elevation units", () => {
  assert.equal(goalTarget("time", 45, "metric"), 2700);
  assert.equal(goalTarget("distance", 20, "metric"), 20000);
  assert.equal(goalTarget("distance", 10, "imperial"), 16093.44);
  assert.equal(goalTarget("climbing", 100, "imperial"), 30.48);
  assert.equal(goalUnit("distance", "imperial"), "mi");
  assert.equal(goalUnit("climbing", "metric"), "m");
});

test("time goals exclude paused time from the recorder", () => {
  const recorder = new RideRecorder();
  recorder.add({ t: 0, distance: 0 });
  recorder.add({ t: 10000, distance: 20 });
  recorder.pause(10000);
  recorder.resume(70000);
  recorder.add({ t: 70000, distance: 20 });
  const goal = new RideGoal();
  goal.set("time", 30);
  assert.equal(goal.update(recorder.summary()), false);
  assert.equal(goal.progress, 1 / 3);
});
