import { test } from "node:test";
import assert from "node:assert/strict";

import { QualityProbe, adjustQuality, chooseQuality, firstRunQuality, menuUses3d } from "../public/js/view3d/qualityPick.js";
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

test("a coarse pointer starts with Low", () => {
  assert.equal(chooseQuality({ ...strong, coarsePointer: true }), "low");
});

test("4 GB or less starts with Low", () => {
  assert.equal(chooseQuality({ ...strong, deviceMemory: 4 }), "low");
});

test("a strong device picks high", () => {
  assert.equal(chooseQuality(strong), "high");
});

test("unknown device memory starts with Medium", () => {
  assert.equal(chooseQuality({ ...strong, deviceMemory: undefined }), "medium");
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
  assert.deepEqual(firstRunQuality(null, { ...strong, deviceMemory: 4 }, null), { quality: "low", auto: true, view: null, notice: false });
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

/** Feeds frames at these times (seconds) on `level`; returns what the probe asked for, null where nothing. */
const feed = (probe, times, level = "high") => times.map((time) => probe.frame(time, level));

test("a hidden page's gap never reaches the decision", () => {
  const probe = new QualityProbe({ frames: 2 });
  feed(probe, [0, 0.016]);
  probe.pause();
  assert.deepEqual(feed(probe, [30, 30.016]), [null, null], "16 ms frames keep the level");
});

test("long stalls of a visible page count", () => {
  const probe = new QualityProbe({ frames: 2 });
  assert.deepEqual(feed(probe, [0, 1.5, 3]), [null, null, "medium"]);
});

test("a fast window keeps listening, and a later slow one steps down", () => {
  const probe = new QualityProbe({ frames: 2 });
  assert.deepEqual(feed(probe, [0, 0.016, 0.032]), [null, null, null]);
  assert.deepEqual(feed(probe, [0.1, 0.2]), [null, "medium"]);
});

test("after a step the probe waits out a cooldown, then may step down again", () => {
  const probe = new QualityProbe({ frames: 2, cooldownS: 10 });
  assert.equal(feed(probe, [0, 0.1, 0.2]).at(-1), "medium");
  // Slow frames while the new level settles in do not count.
  assert.deepEqual(feed(probe, [0.3, 0.4, 0.5, 9], "medium"), [null, null, null, null]);
  assert.deepEqual(feed(probe, [10.3, 10.4, 10.5], "medium"), [null, null, "low"]);
});

test("a reset drops the partial window and the frame baseline", () => {
  const probe = new QualityProbe({ frames: 2 });
  feed(probe, [0, 0.5]);
  probe.reset();
  assert.deepEqual(feed(probe, [5, 5.016, 5.032]), [null, null, null]);
});


test("the start screen stays on the light map until a high level is selected manually", () => {
  assert.equal(menuUses3d(null), false);
  assert.equal(menuUses3d("high", { automatic: true }), false);
  assert.equal(menuUses3d("medium"), false);
  assert.equal(menuUses3d("high"), true);
});

test("the start screen respects reduced motion and data saving", () => {
  assert.equal(menuUses3d("ultra", { reducedMotion: true }), false);
  assert.equal(menuUses3d("ultra", { saveData: true }), false);
});
