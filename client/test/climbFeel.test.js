import { test } from "node:test";
import assert from "node:assert/strict";
import { climbFeelVisible } from "../public/js/ride/climbFeel.js";

test("climb feel shows without a trainer that offers virtual shifting", () => {
  assert.equal(climbFeelVisible({ shiftingOffered: false, shiftingChecked: false }), true);
});

test("climb feel shows when shifting is offered but off", () => {
  assert.equal(climbFeelVisible({ shiftingOffered: true, shiftingChecked: false }), true);
});

test("climb feel shows when a checked shifting box isn't offered", () => {
  assert.equal(climbFeelVisible({ shiftingOffered: false, shiftingChecked: true }), true);
});

test("climb feel hides while virtual shifting is on: the gears do it", () => {
  assert.equal(climbFeelVisible({ shiftingOffered: true, shiftingChecked: true }), false);
});
