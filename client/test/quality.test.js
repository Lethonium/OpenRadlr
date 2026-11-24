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

test("each level keeps its first three switches", () => {
  const first = ({ pixelRatioMax, shadows, detail }) => ({ pixelRatioMax, shadows, detail });
  assert.deepEqual(first(qualitySettings("low")), { pixelRatioMax: 1, shadows: false, detail: false });
  assert.deepEqual(first(qualitySettings("medium")), { pixelRatioMax: 1.5, shadows: true, detail: true });
  assert.deepEqual(first(qualitySettings("high")), { pixelRatioMax: 2, shadows: true, detail: true });
  assert.deepEqual(first(qualitySettings("ultra")), { pixelRatioMax: 2, shadows: true, detail: true });
});

test("each level has every switch", () => {
  for (const level of QUALITY_LEVELS) {
    const settings = qualitySettings(level);
    for (const key of ["shadowMapSize", "msaa", "ssao", "sunRays", "bloom", "depthOfField", "resolutionFloor"]) {
      assert.ok(key in settings, `${level}.${key}`);
    }
    assert.ok(Object.isFrozen(settings), `${level} is frozen`);
  }
});

test("the post switches of each level", () => {
  const pick = (level) => {
    const s = qualitySettings(level);
    return [s.shadowMapSize, s.msaa, s.ssao, s.sunRays, s.bloom, s.depthOfField, s.resolutionFloor];
  };
  assert.deepEqual(pick("low"), [0, 0, null, 0, false, false, 0.6]);
  assert.deepEqual(pick("medium"), [2048, 2, { samples: 10, full: false }, 0, true, false, 0.7]);
  assert.deepEqual(pick("high"), [4096, 4, { samples: 12, full: false }, 24, true, true, 0.75]);
  assert.deepEqual(pick("ultra"), [4096, 8, { samples: 16, full: true }, 40, true, true, 0.85]);
});

test("levels never get lighter going up", () => {
  const cost = (level) => {
    const s = qualitySettings(level);
    return [s.shadowMapSize, s.msaa, s.ssao?.samples ?? 0, s.sunRays, s.pixelRatioMax, s.resolutionFloor];
  };
  for (let i = 1; i < QUALITY_LEVELS.length; i += 1) {
    const lower = cost(QUALITY_LEVELS[i - 1]);
    const upper = cost(QUALITY_LEVELS[i]);
    lower.forEach((value, k) => assert.ok(upper[k] >= value, `${QUALITY_LEVELS[i]} column ${k}`));
  }
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
