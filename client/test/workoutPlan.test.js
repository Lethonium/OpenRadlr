import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, createPlan, planDuration, planPositionAt, planSummary, withGetReady } from "../public/js/workout/plan.js";
import { PRESETS } from "../public/js/workout/presets.js";

test("a plan keeps its blocks and labels them", () => {
  const plan = createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "situps", seconds: 40 }, { kind: "rest", seconds: 20 }] });
  assert.deepEqual(plan.blocks.map((b) => b.label), ["Sit-ups", "Rest"]);
});
test("a plan refuses unknown exercises, empty and too long plans", () => {
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: [] }), /at least one block/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "pullups", seconds: 30 }] }), /Block 1/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: [{ kind: "rest", seconds: 601 }] }), /Block 1/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: Array(13).fill({ kind: "rest", seconds: 600 }) }), /2 hours/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: Array(201).fill({ kind: "rest", seconds: 1 }) }), /200/);
});
test("get ready adds 30 s in front", () => {
  const plan = withGetReady(createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 }] }));
  assert.deepEqual([plan.blocks[0].label, plan.blocks[0].seconds, planDuration(plan)], ["Get ready", 30, 70]);
});
test("the position names the block, what is left and what comes next", () => {
  const plan = createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 }, { kind: "rest", seconds: 20 }] });
  const at = planPositionAt(plan, 35);
  assert.deepEqual([at.index, at.blockRemainingS, at.next.label, at.remainingS, at.finished], [0, 5, "Rest", 25, false]);
  assert.equal(planPositionAt(plan, 60).finished, true);
});
test("presets validate and last as long as they say", () => {
  const minutes = Object.fromEntries(PRESETS.map((p) => [p.id, planDuration(p) / 60]));
  assert.equal(minutes["full-body"], 12);
  assert.equal(minutes.tabata, 4);
  assert.ok(minutes.core >= 7 && minutes.core <= 9);
});
test("the yoga classes last as the spec says, without get-ready", () => {
  const seconds = Object.fromEntries(["sun-salutation", "cool-down", "hip-flow"].map((id) => [id, planDuration(PRESETS.find((p) => p.id === id))]));
  assert.deepEqual(seconds, { "sun-salutation": 240, "cool-down": 545, "hip-flow": 902 });
});
test("the summary lists the first blocks", () => {
  assert.match(planSummary(PRESETS.find((p) => p.id === "tabata")), /^Squats 20 s · Rest 10 s · Burpees 20 s/);
});
test("the position knows how many blocks the plan has", () => {
  const plan = createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 }, { kind: "rest", seconds: 20 }] });
  assert.deepEqual([planPositionAt(plan, 5).count, planPositionAt(plan, 99).count], [2, 2]);
});
test("a plan refuses an unknown venue", () => {
  assert.throws(() => createPlan({ id: "p", name: "P", venue: "nowhere", blocks: [{ kind: "rest", seconds: 1 }] }), /Unknown venue/);
});
test("a plan without a venue has none", () => {
  assert.equal(createPlan({ id: "p", name: "P", blocks: [{ kind: "rest", seconds: 1 }] }).venue, null);
});

test("the yoga poses are exercises", () => {
  for (const id of ["sun_salutation", "forward_fold", "downward_dog", "cobra", "child_pose", "low_lunge", "pigeon"]) assert.ok(Object.hasOwn(EXERCISES, id), id);
});
test("only the lunge and the pigeon are sided", () => {
  assert.deepEqual(Object.keys(EXERCISES).filter((id) => EXERCISES[id].sided), ["low_lunge", "pigeon"]);
});
test("every exercise has a name and a cue", () => {
  for (const [id, exercise] of Object.entries(EXERCISES)) {
    for (const field of ["name", "cue"]) {
      assert.match(exercise[field] ?? "", /\S/, `${id} ${field}`);
      assert.ok(!/^workout\./.test(exercise[field]), `${id} ${field} is a raw key`);
    }
  }
});
test("every exercise has two to eight steps of text", () => {
  for (const [id, exercise] of Object.entries(EXERCISES)) {
    assert.ok(exercise.steps.length >= 2 && exercise.steps.length <= 8, `${id} has ${exercise.steps.length} steps`);
    for (const step of exercise.steps) assert.ok(/\S/.test(step) && !/^workout\./.test(step), `${id}: ${step}`);
  }
});
test("a flow's movements each point at one of its steps", () => {
  const { flow, steps } = EXERCISES.sun_salutation;
  for (const index of flow.order) assert.ok(index >= 0 && index < steps.length, String(index));
  assert.deepEqual([...new Set(flow.order)], steps.map((_, i) => i));
});
