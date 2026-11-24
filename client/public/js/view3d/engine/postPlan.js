/**
 * Which passes the post chain runs, decided from a quality level alone so it
 * can be tested without WebGL.
 */

/**
 * Pass names in order: `render` (the scene target the engine fills), `atmos`
 * (occlusion, sun rays, far depth of field), `bloom` and `output` (tone map and
 * grade). Depth of field is part of `atmos` (see `atmosOptions`) and does not
 * add a pass on its own, so the plan is the same for every kind of view.
 * @param {import("../quality.js").QualitySettings} settings
 * @returns {string[]}
 */
export function postPlan(settings) {
  const passes = ["render"];
  if (settings.ssao || settings.sunRays > 0) passes.push("atmos");
  if (settings.bloom) passes.push("bloom");
  passes.push("output");
  return passes;
}

/**
 * The atmosphere pass's switches for a level and a kind of view.
 * Depth of field softens the far distance, so it is for ride views only.
 * @param {import("../quality.js").QualitySettings} settings
 * @param {{ride: boolean}} view
 * @returns {{aoSamples: number, aoFull: boolean, raySamples: number, depthOfField: boolean}}
 */
export function atmosOptions(settings, { ride }) {
  return {
    aoSamples: settings.ssao?.samples ?? 0,
    aoFull: settings.ssao?.full ?? false,
    raySamples: settings.sunRays,
    depthOfField: settings.depthOfField && ride,
  };
}

/** The grade on a clear day (warm) and under full cloud (grey and cool). */
const CLEAR_GRADE = Object.freeze({ saturation: 1.05, tint: Object.freeze([1.03, 1, 0.93]) });
const OVERCAST_GRADE = Object.freeze({ saturation: 0.78, tint: Object.freeze([0.96, 0.99, 1.04]) });

/**
 * The colour grade for an environment: cloud cover (`overcast`, 0..1) drains the warmth and some colour.
 * @param {{overcast?: number}} env
 * @returns {{saturation: number, tint: number[]}}
 */
export function gradeFor(env) {
  const k = Math.min(1, Math.max(0, env.overcast ?? 0));
  const mix = (a, b) => a + (b - a) * k;
  return {
    saturation: mix(CLEAR_GRADE.saturation, OVERCAST_GRADE.saturation),
    tint: CLEAR_GRADE.tint.map((c, i) => mix(c, OVERCAST_GRADE.tint[i])),
  };
}
