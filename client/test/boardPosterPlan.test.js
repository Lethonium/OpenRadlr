import { test } from "node:test";
import assert from "node:assert/strict";
import { boardPosterPlan, ridePosterPlan } from "../public/js/view3d/posters/plan.js";

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

/** Twelve stored uploads (more than the atlas can hold) and a decoder that counts what it opens and closes. */
const stored = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, text: `Mine ${i}`, blob: { id: `u${i}` } }));
function decoder() {
  const opened = [];
  const closed = [];
  const decode = async (blob) => {
    opened.push(blob.id);
    return { width: 1024, height: 512, close: () => closed.push(blob.id) };
  };
  return { opened, closed, decode };
}
const ride = (extra) => ({ routeId: "r", uploads: stored, dateKey: "2026-11-27", atlas: 1024, makeCanvas, lang: "en", ...extra });

test("a ride's atlas decodes only the uploads chosen for its boards and closes them after painting", async () => {
  const { opened, closed, decode } = decoder();
  const plan = await ridePosterPlan(boards, ride({ decode }));
  // Two general boards: at most two uploads get a slot.
  assert.ok(opened.length >= 1 && opened.length <= 2, `decoded ${opened.length}`);
  assert.deepEqual([...closed].sort(), [...opened].sort());
  assert.equal(plan.slotOf.length, boards.length);
});

test("an upload that cannot be decoded still paints its text", async () => {
  const plan = await ridePosterPlan(boards, ride({ decode: async () => Promise.reject(new Error("bad")) }));
  assert.equal(plan.slotOf.length, boards.length);
});

test("the same posters at the same atlas size reuse the painted atlas without decoding", async () => {
  const first = await ridePosterPlan(boards, ride({ decode: decoder().decode }));
  const again = decoder();
  const second = await ridePosterPlan(boards, ride({ decode: again.decode, previous: first }));
  assert.equal(second, first);
  assert.deepEqual(again.opened, []);
});

test("another atlas size or language paints a new atlas", async () => {
  const first = await ridePosterPlan(boards, ride({ decode: decoder().decode }));
  assert.notEqual(await ridePosterPlan(boards, ride({ decode: decoder().decode, previous: first, atlas: 2048 })), first);
  assert.notEqual(await ridePosterPlan(boards, ride({ decode: decoder().decode, previous: first, lang: "de" })), first);
});
