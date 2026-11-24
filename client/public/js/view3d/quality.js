/**
 * Graphics levels in one place. The same world runs on every device; a level
 * turns effects, grass, draw distance and asset detail up or down (step 3 of
 * the Three.js world widens the gaps between them).
 *
 * Stored as `openride.quality`. A value from before this branch — `"low"` or
 * `"high"` — is a known level; anything unknown or missing reads as `"high"`.
 */

export const QUALITY_LEVELS = Object.freeze(["low", "medium", "high", "ultra"]);

/** A stored value as a level: a known one as is, anything else `"high"`. */
export function qualityLevel(stored) {
  return QUALITY_LEVELS.includes(stored) ? stored : "high";
}

/** The next level in the list, wrapping from ultra to low. */
export function nextQuality(level) {
  const index = QUALITY_LEVELS.indexOf(qualityLevel(level));
  return QUALITY_LEVELS[(index + 1) % QUALITY_LEVELS.length];
}

/**
 * One level's switches.
 * `detail` is grass and fine scenery, `shadows` the sun's shadow map,
 * `pixelRatioMax` the cap on device pixels per CSS pixel, `shadowMapSize` its
 * texels per side (0 = none), `msaa` the samples of the scene target, `ssao`
 * the occlusion pass (null = off), `sunRays` the samples of the shafts (0 =
 * off), `bloom` and `depthOfField` the post effects, `resolutionFloor` the
 * lowest share of the resolution dynamic scaling may drop to, `grassRings` the
 * concentric grass tiles around the camera (outer radius in metres, roots per
 * square metre, blade width, segments, height factor), `treeLod` how far
 * (metres) leaf cards and hulls are drawn, `leafShadows` whether leaf cards
 * cast shadows, `roadsideReach` how far (metres) the verge clumps are drawn, `cropStalks` the
 * individual crop plants: `edgeBand` metres of plants along every field edge, `spacing` their spacing (1 = the crop's
 * own, larger is sparser), `reach` and `nearReach` how far (metres) the plants are drawn and how far as detailed ones
 * (cheap tufts beyond), `interiorReach` and `interiorSpacing` the plants across the field (0 = only the edges).
 * @typedef {Readonly<{pixelRatioMax: number, shadows: boolean, detail: boolean, shadowMapSize: number,
 *   msaa: number, ssao: Readonly<{samples: number, full: boolean}> | null, sunRays: number,
 *   bloom: boolean, depthOfField: boolean, resolutionFloor: number,
 *   grassRings: readonly Readonly<{r: number, dens: number, w: number, segs: number, h?: number}>[],
 *   treeLod: Readonly<{cards: number, hulls: number}>, leafShadows: boolean, roadsideReach: number,
 *   cropStalks: Readonly<{edgeBand: number, spacing: number, reach: number, nearReach: number, interiorReach: number, interiorSpacing: number}>}>} QualitySettings
 */

const rings = (...list) => Object.freeze(list.map((ring) => Object.freeze(ring)));

const level = (settings) =>
  Object.freeze({ ...settings, ssao: settings.ssao && Object.freeze(settings.ssao), treeLod: Object.freeze(settings.treeLod), cropStalks: Object.freeze(settings.cropStalks) });

const RINGS = Object.freeze({
  low: rings({ r: 10, dens: 26, w: 0.085, segs: 4 }, { r: 30, dens: 8, w: 0.17, segs: 3 }, { r: 80, dens: 1.5, w: 0.4, segs: 2, h: 1.05 }, { r: 160, dens: 0.3, w: 0.9, segs: 1, h: 1.1 }),
  medium: rings({ r: 12, dens: 33, w: 0.077, segs: 4 }, { r: 37, dens: 10, w: 0.15, segs: 4 }, { r: 98, dens: 2, w: 0.35, segs: 3, h: 1.05 }, { r: 205, dens: 0.38, w: 0.8, segs: 2, h: 1.1 }),
  high: rings({ r: 14, dens: 40, w: 0.07, segs: 5 }, { r: 44, dens: 12, w: 0.13, segs: 4 }, { r: 115, dens: 2.4, w: 0.3, segs: 3, h: 1.05 }, { r: 250, dens: 0.45, w: 0.68, segs: 2, h: 1.1 }),
  ultra: rings({ r: 18, dens: 52, w: 0.065, segs: 5 }, { r: 56, dens: 14, w: 0.12, segs: 4 }, { r: 145, dens: 2.8, w: 0.27, segs: 3, h: 1.05 }, { r: 330, dens: 0.55, w: 0.6, segs: 2, h: 1.1 }),
});

const SETTINGS = Object.freeze({
  low: level({ pixelRatioMax: 1, shadows: false, detail: false, shadowMapSize: 0, msaa: 0, ssao: null, sunRays: 0, bloom: false, depthOfField: false, resolutionFloor: 0.6, grassRings: RINGS.low, treeLod: { cards: 420, hulls: 1400 }, leafShadows: false, roadsideReach: 120, cropStalks: { edgeBand: 2, spacing: 1.8, reach: 80, nearReach: 28, interiorReach: 0, interiorSpacing: 0 } }),
  medium: level({ pixelRatioMax: 1.5, shadows: true, detail: true, shadowMapSize: 2048, msaa: 2, ssao: { samples: 10, full: false }, sunRays: 0, bloom: true, depthOfField: false, resolutionFloor: 0.7, grassRings: RINGS.medium, treeLod: { cards: 600, hulls: 2000 }, leafShadows: true, roadsideReach: 200, cropStalks: { edgeBand: 3, spacing: 1.3, reach: 130, nearReach: 40, interiorReach: 0, interiorSpacing: 0 } }),
  high: level({ pixelRatioMax: 2, shadows: true, detail: true, shadowMapSize: 4096, msaa: 4, ssao: { samples: 12, full: false }, sunRays: 24, bloom: true, depthOfField: true, resolutionFloor: 0.75, grassRings: RINGS.high, treeLod: { cards: 750, hulls: 2600 }, leafShadows: true, roadsideReach: 300, cropStalks: { edgeBand: 4, spacing: 1, reach: 200, nearReach: 55, interiorReach: 35, interiorSpacing: 2.2 } }),
  ultra: level({ pixelRatioMax: 2, shadows: true, detail: true, shadowMapSize: 4096, msaa: 8, ssao: { samples: 16, full: true }, sunRays: 40, bloom: true, depthOfField: true, resolutionFloor: 0.85, grassRings: RINGS.ultra, treeLod: { cards: 1300, hulls: 3600 }, leafShadows: true, roadsideReach: 400, cropStalks: { edgeBand: 5, spacing: 0.9, reach: 300, nearReach: 75, interiorReach: 55, interiorSpacing: 1.8 } }),
});

/**
 * What a level turns on. An unknown level gets the high settings.
 * @param {string} level
 * @returns {QualitySettings}
 */
export function qualitySettings(level) {
  return SETTINGS[qualityLevel(level)];
}
