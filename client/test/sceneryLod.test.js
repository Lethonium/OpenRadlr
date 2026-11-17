/**
 * Which copy of a model group the view draws at a distance (#117): a group and
 * its cheap twin split at one distance, so exactly one of them draws a chunk.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { drawnAt } from "../public/js/view3d/lod.js";

const SPLITS = { scenery: 150, village: 350, farm: 300 };

test("a near group draws within its split and its far twin beyond it", () => {
  assert.equal(drawnAt("village", 300, SPLITS), true);
  assert.equal(drawnAt("villageFar", 300, SPLITS), false);
  assert.equal(drawnAt("village", 400, SPLITS), false);
  assert.equal(drawnAt("villageFar", 400, SPLITS), true);
});

test("exactly one copy draws at every distance", () => {
  for (const near of ["scenery", "village", "farm"]) {
    for (let distance = 0; distance < 1000; distance += 25) {
      assert.equal(drawnAt(near, distance, SPLITS) !== drawnAt(`${near}Far`, distance, SPLITS), true, `${near} at ${distance}`);
    }
  }
});

test("without a split the near group draws everywhere and the far one nowhere", () => {
  assert.equal(drawnAt("scenery", 5000, { scenery: null }), true);
  assert.equal(drawnAt("sceneryFar", 0, { scenery: null }), false);
});

test("a group with no twin is not split", () => {
  assert.equal(drawnAt("structures", 5000, SPLITS), true);
});
