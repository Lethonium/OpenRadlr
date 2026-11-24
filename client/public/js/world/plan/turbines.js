/**
 * Wind turbines: a row on the highest open ground a good way from the roads, across the wind. A pure, seeded
 * function; each tower's foot is stamped built so nothing grows under it. The models come later from this data.
 */
import { seededRandom } from "../noise.js";
import { MASK, maskAt, stampDisc } from "./masks.js";
import { normalize } from "../vec.js";

/** The wind direction, the turbines' spacing and the rules for a site. */
export const TURBINE = Object.freeze({
  count: 6,
  tries: 300, // random sites tried for the row's centre; the highest wins
  margin: 300, // metres the search reaches past the map's bounds
  centreRoad: Object.freeze([260, 950]), // road distance of the row's centre
  towerRoad: 180, // road distance of every tower
  spacing: 170,
  jitter: 30,
  keepClear: 60, // clear circle round the row centre (half of it round each tower)
  aboveWater: 2,
  foot: 8, // stamped built
  wind: Object.freeze(normalize([1, 0, 0.35])),
});

/**
 * @typedef {object} Turbine
 * @property {number} x tower foot
 * @property {number} y ground height there
 * @property {number} z
 * @property {number} yaw rotation of the nacelle; the rotor faces the wind
 * @property {number} phase rotor angle at time zero
 * @property {number} speed rotor speed factor, 0.9 to 1.3
 */

/** True where something already stands within `radius` of (x, z): a road, river, field or building. */
function taken(masks, x, z, radius) {
  return [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([dx, dz]) => maskAt(masks, x + dx, z + dz) !== MASK.free);
}

/**
 * Plans the turbines and stamps their feet on `masks`.
 * @param {{terrain: {height: (x: number, z: number) => number}, roads: import("../roads.js").RoadIndex, seed: number, masks: import("./masks.js").Masks, water: number, bounds: {x0: number, z0: number, x1: number, z1: number}}} input
 * @returns {Turbine[]}
 */
export function planTurbines({ terrain, roads, seed, masks, water, bounds }) {
  const random = seededRandom(seed ^ 0x7b1e);
  const blocked = (x, z, radius) => terrain.height(x, z) < water + 2.5 || taken(masks, x, z, radius * 0.8);
  let best = null;
  for (let i = 0; i < TURBINE.tries; i += 1) {
    const x = bounds.x0 - TURBINE.margin + random() * (bounds.x1 - bounds.x0 + 2 * TURBINE.margin);
    const z = bounds.z0 - TURBINE.margin + random() * (bounds.z1 - bounds.z0 + 2 * TURBINE.margin);
    const road = roads.farDistance(x, z);
    if (road < TURBINE.centreRoad[0] || road > TURBINE.centreRoad[1] || blocked(x, z, TURBINE.keepClear)) continue;
    const y = terrain.height(x, z);
    if (!best || y > best.y) best = { x, z, y };
  }
  if (!best) return [];
  const [wx, , wz] = TURBINE.wind;
  const yaw = Math.atan2(-wz, wx);
  const turbines = [];
  for (let i = 0; i < TURBINE.count; i += 1) {
    const offset = (i - (TURBINE.count - 1) / 2) * TURBINE.spacing + (random() - 0.5) * TURBINE.jitter;
    const x = best.x - wz * offset;
    const z = best.z + wx * offset;
    if (roads.farDistance(x, z) < TURBINE.towerRoad || blocked(x, z, TURBINE.keepClear / 2)) continue;
    const y = terrain.height(x, z);
    if (y < water + TURBINE.aboveWater) continue;
    stampDisc(masks, x, z, TURBINE.foot, MASK.built);
    turbines.push({ x, y, z, yaw, phase: random() * Math.PI * 2, speed: 0.9 + random() * 0.4 });
  }
  return turbines;
}
