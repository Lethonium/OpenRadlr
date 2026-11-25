/**
 * What the workbench page shows, read from its address: `?asset=<id>&season=<s>&time=<t>`.
 * Pure, so the page's composition root has no parsing of its own.
 */
import * as THREE from "./three.js";
import { BUILDINGS } from "./view3d/assets/buildings/index.js";
import { CREATURES } from "./view3d/assets/creatures/index.js";
import { NATURE } from "./view3d/assets/nature/index.js";
import { PROPS } from "./view3d/assets/props/index.js";
import { RIDERS } from "./view3d/assets/riders/index.js";
import { vehicleAssets } from "./view3d/assets/riders/vehicles.js";
import { vehicleLayout } from "./view3d/vehicleModel.js";
import { SEASONS } from "./world/seasons.js";
import { TIME_PRESETS } from "./world/daylight.js";

/**
 * Every asset on the bench by id: the plants, the buildings, the props, the animals, the riders and the vehicles with their seated riders. All take `create({season, track, ...options})`;
 * the buildings ignore the plants' `uniforms`.
 */
export const WORKBENCH_ASSETS = Object.freeze({ ...NATURE, ...BUILDINGS, ...PROPS, ...CREATURES, ...RIDERS, ...vehicleAssets(vehicleLayout) });

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

/** Lifts `object` so its lowest point rests on y = 0: the centred animals (dolphin, bird, butterfly) would otherwise sink into the ground. Standing things stay. */
export function groundAsset(object) {
  object.position.y = 0;
  const { min } = new THREE.Box3().setFromObject(object.updateMatrixWorld(true) || object);
  object.position.y = Math.max(0, -min.y);
  object.updateMatrixWorld(true);
}
