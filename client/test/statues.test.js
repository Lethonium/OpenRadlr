import assert from "node:assert/strict";
import test from "node:test";
import { STATUE_MOMENT } from "../public/js/view3d/clips.js";
import { PLINTHS, STATUE_MATERIALS, statueSlots } from "../public/js/view3d/statues.js";

test("statue slots spread over the row", () => {
  assert.deepEqual(statueSlots(1), [{ x: 0 }]);
  assert.deepEqual(statueSlots(6).map((s) => s.x), [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]);
  assert.deepEqual(statueSlots(2).map((s) => s.x), [-1.5, 1.5]);
});

test("every statue moment has a plinth, and every material a figure and a plinth colour", () => {
  for (const [name, { plinth }] of Object.entries(STATUE_MOMENT)) assert.ok(PLINTHS[plinth], name);
  for (const [name, material] of Object.entries(STATUE_MATERIALS)) assert.ok(material.figure.length === 3 && material.plinth.length === 3, name);
});
