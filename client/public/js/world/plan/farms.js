/**
 * Farms: a yard with a house or two, a barn and silos, a paddock, a gravel drive to the road and sometimes a
 * windpump, set behind a crop field so the land looks worked from the road. A pure, seeded function; each yard
 * is stamped built so nothing grows there. The models come later from this data.
 */
import { seededRandom } from "../noise.js";
import { regionMix } from "../regions.js";
import { REGION_STYLE } from "../regionKinds.js";
import { VERGE, roadHalfWidth } from "../roads.js";
import { MASK, maskAt, stampBuilt, stampDisc } from "./masks.js";

export const FARM = Object.freeze({
  spacing: 540, // between two yards
  roadDistance: Object.freeze([60, 150]), // from the yard to the nearest road
  townReach: 220, // beyond a settlement's radius
  yard: 42, // radius stamped built
  checkRings: Object.freeze([20, 36]), // radii whose ring must be free ground
  ringPoints: 12,
  maxRelief: 8, // metres of ground height across the yard
  aboveWater: 2,
  behind: Object.freeze([60, 75, 90]), // metres past a field's far edge, tried in turn
  slide: Object.freeze([0, -0.3, 0.3]), // sideways shifts as a share of the field's width
  anchorReach: 200, // a field whose half-length plus the yard's offset passes this is no anchor
  gate: 23, // metres from the yard's centre to the gate
  step: 3, // metres between drive points
  paddock: Object.freeze({ width: 54, depth: 38, spots: Object.freeze([[0, -70], [-80, 0], [80, 0]]) }),
  pump: Object.freeze({ chance: 0.6, at: Object.freeze([-38, -26]), radius: 4 }),
  silosChance: 0.4, // of two silos instead of one
  secondHouseChance: 0.35,
});

/**
 * @typedef {object} Farm
 * @property {number} x yard centre
 * @property {number} y yard ground height
 * @property {number} z
 * @property {number} yaw angle of the yard's front, toward the road: (cos yaw, sin yaw) in world x/z
 * @property {number} houses 1 or 2
 * @property {string} style house style of the farm's region (`REGION_STYLE[kind].houses`)
 * @property {1|2} silos
 * @property {{x: number, z: number, width: number, depth: number, yaw: number}|null} paddock
 * @property {Float32Array} drive x, z pairs from the yard gate to the road's edge
 * @property {{x: number, z: number}|null} pump
 */

/** Yard-local (u along the front, v to its left) to world x/z. */
const toWorld = (yard, u, v) => [yard.x + Math.cos(yard.yaw) * u - Math.sin(yard.yaw) * v, yard.z + Math.sin(yard.yaw) * u + Math.cos(yard.yaw) * v];

/** True if the ground at (x, z) is dry and untouched: free of road, verge, river and building; land use may give way (the plan then drops what the yard covers). */
const open = (masks, terrain, water, x, z, onField = false) => (maskAt(masks, x, z) === MASK.free || (onField && [MASK.field, MASK.meadow].includes(maskAt(masks, x, z)))) && terrain.height(x, z) >= water + FARM.aboveWater;

/** The yard's ground height if its rings are open and its ground gentle; else null. */
function yardGround({ terrain, masks, water }, x, z) {
  let [low, high] = [Infinity, -Infinity];
  const sample = (px, pz) => {
    const h = terrain.height(px, pz);
    [low, high] = [Math.min(low, h), Math.max(high, h)];
  };
  sample(x, z);
  if (!open(masks, terrain, water, x, z, true)) return null;
  for (const r of FARM.checkRings) {
    for (let k = 0; k < FARM.ringPoints; k += 1) {
      const a = (k / FARM.ringPoints) * Math.PI * 2;
      const [px, pz] = [x + Math.cos(a) * r, z + Math.sin(a) * r];
      if (!open(masks, terrain, water, px, pz, true)) return null;
      sample(px, pz);
    }
  }
  return high - low <= FARM.maxRelief ? (terrain.height(x, z) * 2 + low + high) / 4 : null;
}

/** The gravel drive from the yard's gate straight to the near edge of the road at `sample`. */
function driveTo(yard, sample) {
  const [gx, gz] = toWorld(yard, FARM.gate, 0);
  const reach = roadHalfWidth(sample.route.lanes) + VERGE + 0.5;
  const length = Math.hypot(gx - sample.x, gz - sample.z) || 1;
  const [ex, ez] = [sample.x + ((gx - sample.x) / length) * reach, sample.z + ((gz - sample.z) / length) * reach];
  const n = Math.max(1, Math.ceil(Math.hypot(ex - gx, ez - gz) / FARM.step));
  const drive = new Float32Array((n + 1) * 2);
  for (let k = 0; k <= n; k += 1) [drive[k * 2], drive[k * 2 + 1]] = [gx + ((ex - gx) * k) / n, gz + ((ez - gz) * k) / n];
  return drive;
}

/** How many farms a road network carries: about one per kilometre of road, one at least per road. */
function farmBudget(roads) {
  const routes = new Set(roads.samples.map((s) => s.route));
  return [...routes].reduce((sum, route) => sum + Math.max(1, Math.round(route.length / 1000)), 0);
}

/**
 * Plans the farms and stamps yards, paddocks and windpumps on `masks`.
 * @param {{fields: import("./fields.js").Field[], terrain: {height: (x: number, z: number) => number}, roads: import("../roads.js").RoadIndex, regions?: object[], seed: number, masks: import("./masks.js").Masks, water: number, settlements?: Array<{center: number[], radius: number}>}} input
 * @returns {Farm[]}
 */
export function planFarms({ fields, terrain, roads, regions = [], seed, masks, water, settlements = [] }) {
  const random = seededRandom(seed ^ 0xfa53);
  const budget = farmBudget(roads);
  const farms = [];
  const ground = { terrain, masks, water };
  for (const field of fields) {
    if (farms.length >= budget) break;
    const near = roads.nearest(field.x, field.z, 3);
    if (!near) continue;
    const [fx, fz] = [field.x - near.sample.x, field.z - near.sample.z];
    const away = Math.hypot(fx, fz) || 1;
    const [ux, uz] = [fx / away, fz / away];
    const [behind, slide] = [FARM.behind[Math.floor(random() * FARM.behind.length)], FARM.slide[Math.floor(random() * FARM.slide.length)]];
    const along = Math.abs(ux * Math.cos(field.yaw) + uz * Math.sin(field.yaw));
    if (along > 0.3 && along < 0.95) continue; // a field set aslant to the road: its corners would reach the yard
    const [reach, flank] = along < 0.7 ? [field.depth / 2, field.width / 2] : [field.width / 2, field.depth / 2];
    const [sx, sz] = [-uz, ux];
    const [pick, gone, silos] = [random(), random(), random()];
    // Behind the field, away from the road; failing that in front of it, beside it, or on its other flank (fields lie far from roads now).
    let [x, z, neighbour] = [0, 0, null];
    for (const [dx, dz, half, tx, tz, wide] of [[ux, uz, reach, sx, sz, flank], [-ux, -uz, reach, sx, sz, flank], [sx, sz, flank, ux, uz, reach], [-sx, -sz, flank, ux, uz, reach]]) {
      if (half + behind > FARM.anchorReach) continue; // a vast parcel would put the yard too far from its edge's middle
      x = field.x + dx * (half + behind) + tx * slide * wide * 2;
      z = field.z + dz * (half + behind) + tz * slide * wide * 2;
      neighbour = roads.nearest(x, z, 3);
      if (neighbour && neighbour.distance >= FARM.roadDistance[0] && neighbour.distance <= FARM.roadDistance[1]) break;
      neighbour = null;
    }
    if (!neighbour) continue;
    if (farms.some((f) => Math.hypot(f.x - x, f.z - z) < FARM.spacing)) continue;
    if (fields.some((f) => rectDistance(f, x, z) < FARM.yard + masks.cell * 2)) continue; // a yard never bites into a field
    if (settlements.some((s) => Math.hypot(s.center[0] - x, s.center[1] - z) < s.radius + FARM.townReach)) continue;
    const y = yardGround(ground, x, z);
    if (y === null) continue;
    const yaw = Math.atan2(neighbour.sample.z - z, neighbour.sample.x - x);
    const yard = { x, z, yaw };
    const paddock = planPaddock(yard, ground, FARM.paddock.spots[Math.floor(pick * FARM.paddock.spots.length)], roads, fields);
    const pumpAt = toWorld(yard, ...FARM.pump.at);
    const pump = gone < FARM.pump.chance && open(masks, terrain, water, pumpAt[0], pumpAt[1]) ? { x: pumpAt[0], z: pumpAt[1] } : null;
    stampDisc(masks, x, z, FARM.yard, MASK.built, [MASK.field, MASK.meadow]);
    if (paddock) stampBuilt(masks, paddock);
    if (pump) stampDisc(masks, pump.x, pump.z, FARM.pump.radius, MASK.built, [MASK.field, MASK.meadow]);
    farms.push({
      x, y, z, yaw, style: REGION_STYLE[regionMix(x, z, regions, seed)[0].kind].houses, houses: random() < FARM.secondHouseChance ? 2 : 1, silos: silos < FARM.silosChance ? 2 : 1,
      paddock, drive: driveTo(yard, neighbour.sample), pump,
    });
  }
  return farms;
}

/** Metres from (x, z) to the rectangle of `field` (0 inside it). */
function rectDistance({ x, z, width, depth, yaw }, px, pz) {
  const [dx, dz] = [px - x, pz - z];
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return Math.hypot(Math.max(0, Math.abs(dx * c + dz * s) - width / 2), Math.max(0, Math.abs(-dx * s + dz * c) - depth / 2));
}

/** A paddock beside the yard at local `spot` if its corners and centre are open ground and clear of any road. */
function planPaddock(yard, { terrain, masks, water }, spot, roads, fields) {
  const [x, z] = toWorld(yard, spot[0], spot[1]);
  const { width, depth } = FARM.paddock;
  const [c, s] = [Math.cos(yard.yaw), Math.sin(yard.yaw)];
  const corners = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [x + (a * c * width - b * s * depth) / 2, z + (a * s * width + b * c * depth) / 2]);
  // Land use gives way to a paddock, but a crop field does not.
  if (!corners.every(([px, pz]) => open(masks, terrain, water, px, pz, true) && !fields.some((f) => rectDistance(f, px, pz) < masks.cell * 2))) return null;
  const near = roads.nearest(x, z, 1);
  if (near && near.distance < FARM.roadDistance[0] / 2) return null;
  return { x, z, width, depth, yaw: yard.yaw };
}
