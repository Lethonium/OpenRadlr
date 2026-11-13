import { test } from "node:test";
import assert from "node:assert/strict";
import { dropIndex } from "../../public/js/cockpit/editMode.js";

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
// Two columns: 0 1 / 2 (wide)
const RECTS = [rect(0, 0, 100, 50), rect(110, 0, 210, 50), rect(0, 60, 210, 110)];

test("dropIndex picks the slot under the pointer", () => {
  assert.equal(dropIndex(RECTS, 10, 10), 0);
  assert.equal(dropIndex(RECTS, 150, 20), 1);
  assert.equal(dropIndex(RECTS, 100, 80), 2);
});

test("dropIndex picks the nearest slot when the pointer is in a gap or outside", () => {
  assert.equal(dropIndex(RECTS, 104, 25), 0);
  assert.equal(dropIndex(RECTS, 108, 25), 1);
  assert.equal(dropIndex(RECTS, 100, 500), 2);
  assert.equal(dropIndex(RECTS, -50, -50), 0);
});

test("dropIndex has no slot without tiles", () => {
  assert.equal(dropIndex([], 10, 10), -1);
});
