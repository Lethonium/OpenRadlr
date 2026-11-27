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

test("each level has grass rings that grow outwards, and Low stays lighter than Medium", async () => {
  const { bladeCount } = await import("../public/js/view3d/assets/nature/grass.js");
  let previous = 0;
  for (const level of QUALITY_LEVELS) {
    const { grassRings } = qualitySettings(level);
    assert.equal(grassRings.length, 4);
    grassRings.forEach((ring, i) => i && assert.ok(ring.r > grassRings[i - 1].r, `${level} ring ${i}`));
    const blades = bladeCount(grassRings);
    assert.ok(blades > previous, `${level} has more blades than the level below`);
    previous = blades;
  }
  assert.ok(qualitySettings("low").grassRings[3].r < qualitySettings("medium").grassRings[3].r);
});

test("tree detail: cards come closer than hulls, leaf shadows are off on Low, the roadside reaches further with quality", () => {
  for (const level of QUALITY_LEVELS) {
    const { treeLod } = qualitySettings(level);
    assert.ok(treeLod.cards < treeLod.hulls, level);
  }
  assert.equal(qualitySettings("low").leafShadows, false);
  assert.equal(qualitySettings("high").leafShadows, true);
  const reach = QUALITY_LEVELS.map((level) => qualitySettings(level).roadsideReach);
  assert.deepEqual(reach, [120, 200, 300, 400]);
  assert.deepEqual(QUALITY_LEVELS.map((level) => qualitySettings(level).treeLod.cards), [420, 600, 750, 1300]);
});

test("the quality tables are frozen", () => {
  const { grassRings, treeLod } = qualitySettings("high");
  assert.ok(Object.isFrozen(grassRings) && Object.isFrozen(grassRings[0]) && Object.isFrozen(treeLod));
});

test("every level has riders full and reach", () => {
  const expected = { low: [1, 300], medium: [4, 450], high: [8, 600], ultra: [16, 600] };
  for (const level of QUALITY_LEVELS) assert.deepEqual({ ...qualitySettings(level).riders }, { full: expected[level][0], reach: expected[level][1] }, level);
  const fulls = QUALITY_LEVELS.map((level) => qualitySettings(level).riders.full);
  assert.deepEqual(fulls, [...fulls].sort((a, b) => a - b));
  assert.ok(fulls[0] >= 1);
});

test("every level sets the land-use reaches, growing from low to ultra", () => {
  let before = null;
  for (const level of QUALITY_LEVELS) {
    const { landUse } = qualitySettings(level);
    for (const key of ["rows", "edges", "scrub"]) {
      assert.ok(landUse[key] > 0, `${level}.${key}`);
      if (before) assert.ok(landUse[key] > before[key], `${level}.${key} grows`);
    }
    before = landUse;
  }
});
