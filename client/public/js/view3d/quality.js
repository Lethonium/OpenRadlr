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
 * (cheap tufts beyond), `interiorReach` and `interiorSpacing` the plants across the field (0 = only the edges), `buildings` how far
 * (metres from a town's or farm's centre) its detailed mesh is drawn (`near`) and its cheap twin (`far`), `weather` the
 * rain streaks and snowflakes in the box round the camera, `lampLights` the street lamps (nearest first) that
 * light the ground at night, `headlightShadows` whether the rider's headlight casts shadows, `animals` how far (metres) from the camera the
 * animals are re-posed each frame (`animateReach`).
 * @typedef {Readonly<{pixelRatioMax: number, shadows: boolean, detail: boolean, shadowMapSize: number,
 *   msaa: number, ssao: Readonly<{samples: number, full: boolean}> | null, sunRays: number,
 *   bloom: boolean, depthOfField: boolean, resolutionFloor: number,
 *   grassRings: readonly Readonly<{r: number, dens: number, w: number, segs: number, h?: number}>[],
 *   treeLod: Readonly<{cards: number, hulls: number}>, leafShadows: boolean, roadsideReach: number,
 *   cropStalks: Readonly<{edgeBand: number, spacing: number, reach: number, nearReach: number, interiorReach: number, interiorSpacing: number}>,
 *   buildings: Readonly<{near: number, far: number}>, weather: Readonly<{rain: number, snow: number}>, lampLights: number, headlightShadows: boolean, animals: Readonly<{animateReach: number}>}>} QualitySettings
 */

const rings = (...list) => Object.freeze(list.map((ring) => Object.freeze(ring)));

const level = (settings) =>
  Object.freeze({ ...settings, ssao: settings.ssao && Object.freeze(settings.ssao), treeLod: Object.freeze(settings.treeLod), cropStalks: Object.freeze(settings.cropStalks), buildings: Object.freeze(settings.buildings), weather: Object.freeze(settings.weather), animals: Object.freeze(settings.animals) });

const RINGS = Object.freeze({
  low: rings({ r: 10, dens: 32, w: 0.085, segs: 4 }, { r: 30, dens: 10, w: 0.17, segs: 3 }, { r: 80, dens: 1.5, w: 0.4, segs: 2, h: 1.05 }, { r: 160, dens: 0.3, w: 0.9, segs: 1, h: 1.1 }),
  medium: rings({ r: 12, dens: 44, w: 0.077, segs: 4 }, { r: 37, dens: 13, w: 0.15, segs: 4 }, { r: 98, dens: 2, w: 0.35, segs: 3, h: 1.05 }, { r: 205, dens: 0.38, w: 0.8, segs: 2, h: 1.1 }),
  high: rings({ r: 14, dens: 54, w: 0.07, segs: 5 }, { r: 44, dens: 16, w: 0.13, segs: 4 }, { r: 115, dens: 3.2, w: 0.3, segs: 3, h: 1.05 }, { r: 250, dens: 0.45, w: 0.68, segs: 2, h: 1.1 }),
  ultra: rings({ r: 18, dens: 68, w: 0.065, segs: 5 }, { r: 56, dens: 19, w: 0.12, segs: 4 }, { r: 145, dens: 3.6, w: 0.27, segs: 3, h: 1.05 }, { r: 330, dens: 0.55, w: 0.6, segs: 2, h: 1.1 }),
});

const SETTINGS = Object.freeze({
  low: level({ animals: { animateReach: 60 }, lampLights: 0, headlightShadows: false, weather: { rain: 1500, snow: 1500 }, pixelRatioMax: 1, shadows: false, detail: false, shadowMapSize: 0, msaa: 0, ssao: null, sunRays: 0, bloom: false, depthOfField: false, resolutionFloor: 0.6, grassRings: RINGS.low, treeLod: { cards: 420, hulls: 1400 }, leafShadows: false, roadsideReach: 120, cropStalks: { edgeBand: 2, spacing: 1.8, reach: 80, nearReach: 28, interiorReach: 0, interiorSpacing: 0 }, buildings: { near: 250, far: 1500 } }),
  medium: level({ animals: { animateReach: 120 }, lampLights: 4, headlightShadows: false, weather: { rain: 4000, snow: 3500 }, pixelRatioMax: 1.5, shadows: true, detail: true, shadowMapSize: 2048, msaa: 2, ssao: { samples: 10, full: false }, sunRays: 0, bloom: true, depthOfField: false, resolutionFloor: 0.7, grassRings: RINGS.medium, treeLod: { cards: 600, hulls: 2000 }, leafShadows: true, roadsideReach: 200, cropStalks: { edgeBand: 3, spacing: 1.3, reach: 130, nearReach: 40, interiorReach: 0, interiorSpacing: 0 }, buildings: { near: 400, far: 2500 } }),
  high: level({ animals: { animateReach: 200 }, lampLights: 8, headlightShadows: true, weather: { rain: 7000, snow: 6000 }, pixelRatioMax: 2, shadows: true, detail: true, shadowMapSize: 4096, msaa: 4, ssao: { samples: 12, full: false }, sunRays: 24, bloom: true, depthOfField: true, resolutionFloor: 0.75, grassRings: RINGS.high, treeLod: { cards: 750, hulls: 2600 }, leafShadows: true, roadsideReach: 300, cropStalks: { edgeBand: 4, spacing: 1, reach: 200, nearReach: 55, interiorReach: 35, interiorSpacing: 2.2 }, buildings: { near: 600, far: 4000 } }),
  ultra: level({ animals: { animateReach: 300 }, lampLights: 12, headlightShadows: true, weather: { rain: 12000, snow: 10000 }, pixelRatioMax: 2, shadows: true, detail: true, shadowMapSize: 4096, msaa: 8, ssao: { samples: 16, full: true }, sunRays: 40, bloom: true, depthOfField: true, resolutionFloor: 0.85, grassRings: RINGS.ultra, treeLod: { cards: 1300, hulls: 3600 }, leafShadows: true, roadsideReach: 400, cropStalks: { edgeBand: 5, spacing: 0.9, reach: 300, nearReach: 75, interiorReach: 55, interiorSpacing: 1.8 }, buildings: { near: 900, far: 6000 } }),
});

/**
 * What a level turns on. An unknown level gets the high settings.
 * @param {string} level
 * @returns {QualitySettings}
 */
export function qualitySettings(level) {
  return SETTINGS[qualityLevel(level)];
}
