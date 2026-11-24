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
