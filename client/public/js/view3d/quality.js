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
 * What a level turns on today. `detail` is grass and fine scenery, `shadows`
 * the sun's shadow map, `pixelRatioMax` the cap on device pixels per CSS pixel.
 * @param {string} level
 * @returns {{pixelRatioMax: number, shadows: boolean, detail: boolean}}
 */
export function qualitySettings(level) {
  switch (qualityLevel(level)) {
    case "low":
      return { pixelRatioMax: 1, shadows: false, detail: false };
    case "medium":
      return { pixelRatioMax: 1.5, shadows: true, detail: true };
    case "ultra":
      return { pixelRatioMax: 2, shadows: true, detail: true };
    default:
      return { pixelRatioMax: 2, shadows: true, detail: true };
  }
}
