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
 * lowest share of the resolution dynamic scaling may drop to.
 * @typedef {Readonly<{pixelRatioMax: number, shadows: boolean, detail: boolean, shadowMapSize: number,
 *   msaa: number, ssao: Readonly<{samples: number, full: boolean}> | null, sunRays: number,
 *   bloom: boolean, depthOfField: boolean, resolutionFloor: number}>} QualitySettings
 */

const level = (settings) => Object.freeze({ ...settings, ssao: settings.ssao && Object.freeze(settings.ssao) });

const SETTINGS = Object.freeze({
  low: level({ pixelRatioMax: 1, shadows: false, detail: false, shadowMapSize: 0, msaa: 0, ssao: null, sunRays: 0, bloom: false, depthOfField: false, resolutionFloor: 0.6 }),
  medium: level({ pixelRatioMax: 1.5, shadows: true, detail: true, shadowMapSize: 2048, msaa: 2, ssao: { samples: 10, full: false }, sunRays: 0, bloom: true, depthOfField: false, resolutionFloor: 0.7 }),
  high: level({ pixelRatioMax: 2, shadows: true, detail: true, shadowMapSize: 4096, msaa: 4, ssao: { samples: 12, full: false }, sunRays: 24, bloom: true, depthOfField: true, resolutionFloor: 0.75 }),
  ultra: level({ pixelRatioMax: 2, shadows: true, detail: true, shadowMapSize: 4096, msaa: 8, ssao: { samples: 16, full: true }, sunRays: 40, bloom: true, depthOfField: true, resolutionFloor: 0.85 }),
});

/**
 * What a level turns on. An unknown level gets the high settings.
 * @param {string} level
 * @returns {QualitySettings}
 */
export function qualitySettings(level) {
  return SETTINGS[qualityLevel(level)];
}
