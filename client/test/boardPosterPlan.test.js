import { test } from "node:test";
import assert from "node:assert/strict";
import { boardPosterPlan } from "../public/js/view3d/posters/plan.js";

const boards = [
  { kind: "general", distance: 1000 },
  { kind: "general", distance: 9000 },
  { kind: "climb", distance: 5000 },
];

/** A canvas factory whose 2D context swallows every call and remembers the canvas size. */
const made = [];
function makeCanvas(width, height) {
  const ctx = new Proxy({ measureText: () => ({ width: 1 }) }, { get: (t, p) => (p in t ? t[p] : () => {}), set: () => true });
  const canvas = { width, height, getContext: () => ctx };
  made.push(canvas);
  return canvas;
}

test("the atlas is sized from the quality's atlas edge: 2 slots wide, 4 high", () => {
  made.length = 0;
  const plan = boardPosterPlan(boards, { routeId: "r", uploads: [], dateKey: "2026-11-27", atlas: 1024, makeCanvas });
  assert.equal(plan.atlas, made[0]);
  assert.deepEqual([made[0].width, made[0].height], [1024, 1024]);
});

test("every board gets a slot index below slotCount", () => {
  const plan = boardPosterPlan(boards, { routeId: "r", uploads: [], dateKey: "2026-11-27", atlas: 1024, makeCanvas });
  assert.equal(plan.slotOf.length, boards.length);
  for (const slot of plan.slotOf) assert.ok(slot >= 0 && slot < plan.slotCount);
});

test("an upload fills the first general board and an upload without a picture still paints", () => {
  const uploads = [{ id: "u1", text: "Mine", image: null }];
  const plan = boardPosterPlan(boards, { routeId: "r", uploads, dateKey: "2026-11-27", atlas: 1024, makeCanvas });
  assert.notEqual(plan.slotOf[0], plan.slotOf[1]);
});
