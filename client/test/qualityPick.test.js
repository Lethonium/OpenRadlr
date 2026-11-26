import { test } from "node:test";
import assert from "node:assert/strict";

import { adjustQuality, chooseQuality, firstRunQuality } from "../public/js/view3d/qualityPick.js";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";

const strong = { webgl2: true, deviceMemory: 8, saveData: false, coarsePointer: false };

test("no WebGL 2 picks 2D", () => {
  assert.equal(chooseQuality({ ...strong, webgl2: false }), "2d");
});

test("save-data picks low", () => {
  assert.equal(chooseQuality({ ...strong, saveData: true }), "low");
});

test("2 GB or less picks low", () => {
  assert.equal(chooseQuality({ ...strong, deviceMemory: 2 }), "low");
  assert.equal(chooseQuality({ ...strong, deviceMemory: 0.5 }), "low");
});

test("a coarse pointer picks medium", () => {
  assert.equal(chooseQuality({ ...strong, coarsePointer: true }), "medium");
});

test("4 GB or less picks medium", () => {
  assert.equal(chooseQuality({ ...strong, deviceMemory: 4 }), "medium");
});

test("a strong device picks high", () => {
  assert.equal(chooseQuality(strong), "high");
});

test("a missing device memory counts as 8", () => {
  assert.equal(chooseQuality({ ...strong, deviceMemory: undefined }), "high");
});

test("ultra is never picked", () => {
  for (const deviceMemory of [undefined, 1, 2, 4, 8, 64]) {
    for (const coarsePointer of [false, true]) {
      assert.notEqual(chooseQuality({ ...strong, deviceMemory, coarsePointer }), "ultra");
    }
  }
});

const frames = (ms) => Array(90).fill(ms);

test("a slow first ride steps down one level", () => {
  assert.equal(adjustQuality("high", frames(45)), "medium");
  assert.equal(adjustQuality("medium", frames(45)), "low");
});

test("a very slow ride on low goes to 2D", () => {
  assert.equal(adjustQuality("low", frames(80)), "2d");
});

test("a slow ride on low between 40 and 70 ms stays low", () => {
  assert.equal(adjustQuality("low", frames(50)), "low");
});

test("a fast ride keeps the level", () => {
  assert.equal(adjustQuality("high", frames(16)), "high");
});

test("the median decides, not single hitches", () => {
  const samples = [...frames(16).slice(0, 80), ...Array(10).fill(500)];
  assert.equal(adjustQuality("high", samples), "high");
});

test("no samples keep the level", () => {
  assert.equal(adjustQuality("high", []), "high");
});

test("the first run stores the pick and marks it automatic", () => {
  assert.deepEqual(firstRunQuality(null, { ...strong, deviceMemory: 4 }, null), { quality: "medium", auto: true, view: null, notice: false });
});

test("a 2D pick also sets the view and asks for the notice", () => {
  assert.deepEqual(firstRunQuality(null, { ...strong, webgl2: false }, null), { quality: "low", auto: false, view: "map", notice: true });
});

test("a stored choice is never overwritten", () => {
  assert.equal(firstRunQuality("ultra", { ...strong, deviceMemory: 1 }, null), null);
});

test("a stored view is never overwritten", () => {
  const pick = firstRunQuality(null, { ...strong, webgl2: false }, "3d");
  assert.equal(pick.view, null);
});

test("the 2D notice is translated", () => {
  assert.equal(en["quality.picked2d"], "Your device works best with the 2D view. You can switch to 3D in the menu.");
  assert.ok(de["quality.picked2d"]);
});
