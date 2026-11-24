/**
 * What the workbench page shows, read from its address: `?asset=<id>&season=<s>&time=<t>`.
 * Pure, so the page's composition root has no parsing of its own.
 */
import { BUILDINGS } from "./view3d/assets/buildings/index.js";
import { CREATURES } from "./view3d/assets/creatures/index.js";
import { NATURE } from "./view3d/assets/nature/index.js";
import { PROPS } from "./view3d/assets/props/index.js";
import { SEASONS } from "./world/seasons.js";
import { TIME_PRESETS } from "./world/daylight.js";

/**
 * Every asset on the bench by id: the plants, the buildings, the props and the animals. All take `create({season, track, ...options})`;
 * the buildings ignore the plants' `uniforms`.
 */
export const WORKBENCH_ASSETS = Object.freeze({ ...NATURE, ...BUILDINGS, ...PROPS, ...CREATURES });

/** The times of day the workbench lights an asset with (no "auto": there is no clock here). */
export const WORKBENCH_TIMES = Object.freeze(Object.keys(TIME_PRESETS));

/**
 * @param {string} search the page's `location.search`
 * @param {readonly string[]} [ids] the assets on offer, the first is the fallback
 * @returns {{asset: string, season: string, time: string}} unknown values read as the first asset, summer and day
 */
export function workbenchState(search, ids = Object.keys(WORKBENCH_ASSETS)) {
  const params = new URLSearchParams(search);
  const asset = params.get("asset");
  const season = params.get("season");
  const time = params.get("time");
  return {
    asset: ids.includes(asset) ? asset : ids[0],
    season: SEASONS.includes(season) ? season : "summer",
    time: WORKBENCH_TIMES.includes(time) ? time : "day",
  };
}
