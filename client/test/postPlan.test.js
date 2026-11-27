import { test } from "node:test";
import assert from "node:assert/strict";

import { atmosOptions, gradeFor, postPlan } from "../public/js/view3d/engine/postPlan.js";
import { qualitySettings } from "../public/js/view3d/quality.js";

test("low has no atmosphere pass", () => {
  assert.deepEqual(postPlan(qualitySettings("low"), { ride: true }), ["render", "output"]);
});

test("ultra has every pass", () => {
  assert.deepEqual(postPlan(qualitySettings("ultra"), { ride: true }), ["render", "atmos", "bloom", "output"]);
});

test("medium has occlusion and bloom", () => {
  assert.deepEqual(postPlan(qualitySettings("medium"), { ride: false }), ["render", "atmos", "bloom", "output"]);
});

test("sun rays alone are enough for the atmosphere pass", () => {
  const settings = { ...qualitySettings("low"), sunRays: 24 };
  assert.deepEqual(postPlan(settings, { ride: false }), ["render", "atmos", "output"]);
});

test("depth of field only while riding", () => {
  const high = qualitySettings("high");
  assert.equal(atmosOptions(high, { ride: true }).depthOfField, true);
  assert.equal(atmosOptions(high, { ride: false }).depthOfField, false);
  assert.equal(atmosOptions(qualitySettings("medium"), { ride: true }).depthOfField, false);
});

test("the atmosphere options come from the level", () => {
  assert.deepEqual(atmosOptions(qualitySettings("ultra"), { ride: true }), { aoSamples: 16, aoFull: true, raySamples: 40, depthOfField: true });
  assert.deepEqual(atmosOptions(qualitySettings("medium"), { ride: true }), { aoSamples: 10, aoFull: false, raySamples: 0, depthOfField: false });
});

test("a clear day keeps the warm grade", () => {
  assert.deepEqual(gradeFor({ overcast: 0 }), { saturation: 1.05, tint: [1.03, 1, 0.93] });
  assert.deepEqual(gradeFor({}), gradeFor({ overcast: 0 }));
});

test("cloud cover greys and cools the grade", () => {
  const dull = gradeFor({ overcast: 1 });
  assert.ok(dull.saturation <= 0.8, `saturation ${dull.saturation}`);
  assert.ok(dull.tint[2] > dull.tint[0], "bluer than red under full cloud");
  const half = gradeFor({ overcast: 0.5 });
  assert.ok(half.saturation < 1.05 && half.saturation > dull.saturation);
});
