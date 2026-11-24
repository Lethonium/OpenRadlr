import { test } from "node:test";
import assert from "node:assert/strict";

import { QUALITY_LEVELS, nextQuality, qualityLevel, qualitySettings } from "../public/js/view3d/quality.js";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";

test("a stored level is kept", () => {
  assert.equal(qualityLevel("low"), "low");
  assert.equal(qualityLevel("high"), "high");
  assert.equal(qualityLevel("medium"), "medium");
  assert.equal(qualityLevel("ultra"), "ultra");
});

test("a missing or unknown level reads as high", () => {
  assert.equal(qualityLevel(null), "high");
  assert.equal(qualityLevel(undefined), "high");
  assert.equal(qualityLevel("potato"), "high");
});

test("the next level wraps from ultra to low", () => {
  assert.equal(nextQuality("low"), "medium");
  assert.equal(nextQuality("medium"), "high");
  assert.equal(nextQuality("high"), "ultra");
  assert.equal(nextQuality("ultra"), "low");
});

test("each level's settings", () => {
  assert.deepEqual(qualitySettings("low"), { pixelRatioMax: 1, shadows: false, detail: false });
  assert.deepEqual(qualitySettings("medium"), { pixelRatioMax: 1.5, shadows: true, detail: true });
  assert.deepEqual(qualitySettings("high"), { pixelRatioMax: 2, shadows: true, detail: true });
  assert.deepEqual(qualitySettings("ultra"), { pixelRatioMax: 2, shadows: true, detail: true });
});

test("an unknown level gets the high settings", () => {
  assert.deepEqual(qualitySettings("potato"), qualitySettings("high"));
});

test("every level has a label in both languages", () => {
  for (const level of QUALITY_LEVELS) {
    assert.equal(typeof en[`graphics.${level}`], "string", `en graphics.${level}`);
    assert.equal(typeof de[`graphics.${level}`], "string", `de graphics.${level}`);
  }
});
