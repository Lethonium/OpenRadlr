import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlan, planDuration, planPositionAt, planSummary, withGetReady } from "../public/js/workout/plan.js";
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
test("the summary lists the first blocks", () => {
  assert.match(planSummary(PRESETS.find((p) => p.id === "tabata")), /^Squats 20 s · Rest 10 s · Burpees 20 s/);
});
test("the position knows how many blocks the plan has", () => {
  const plan = createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 }, { kind: "rest", seconds: 20 }] });
  assert.deepEqual([planPositionAt(plan, 5).count, planPositionAt(plan, 99).count], [2, 2]);
});
