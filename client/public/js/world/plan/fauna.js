/**
 * Fauna: where the island's animals live. Herds in paddocks and meadows, hens and pigs in farm yards, wild deer,
 * rabbits and foxes along the woods' edge, flocks of birds over land, butterflies on the verge and dolphins off
 * the coast. A pure, seeded function; it plans positions and counts only, the models come from the creature
 * assets (`kind` is a `CREATURES` key).
 */
import { seededRandom } from "../noise.js";
import { regionMix } from "../regions.js";
import { MASK, maskAt } from "./masks.js";

/** Most of each group per detail level. Herds are instanced, so a count of them is cheap; medium and up cover every farm's herds. */
export const FAUNA_BUDGET = Object.freeze({
  low: Object.freeze({ herds: 8, wild: 20, flocks: 3, butterflies: 0, dolphins: 2 }),
  medium: Object.freeze({ herds: 60, wild: 50, flocks: 6, butterflies: 40, dolphins: 4 }),
  high: Object.freeze({ herds: 100, wild: 90, flocks: 10, butterflies: 80, dolphins: 6 }),
  ultra: Object.freeze({ herds: 140, wild: 140, flocks: 14, butterflies: 140, dolphins: 8 }),
});

export const FAUNA = Object.freeze({
  herdSize: Object.freeze({ cow: 6, sheep: 9, horse: 4 }),
  paddockKinds: Object.freeze(["cow", "sheep", "horse"]),
  chickens: Object.freeze([6, 9]),
  pigs: Object.freeze([3, 4]),
  yardSpots: Object.freeze({ chicken: Object.freeze([14, 10]), pig: Object.freeze([-14, 10]) }), // yard-local u, v
  yardRadius: 5,
  meadowRoad: Object.freeze([30, 150]), // sheep herds' distance from a road
  meadowRadius: 14,
  meadowKinds: Object.freeze(["meadow", "farmBelt"]),
  woodEdge: 20, // wild animals stand within this of a tree
  wildRoadClear: 40, // deer and foxes keep this far from a road
  wildKinds: Object.freeze(["deer", "rabbit", "fox"]),
  shy: Object.freeze(["deer", "fox"]),
  flock: Object.freeze({ altitude: Object.freeze([40, 90]), radius: Object.freeze([20, 45]), count: Object.freeze([5, 9]) }),
  aboveWater: 2,
  seaDepth: 3, // dolphins swim in water this far below the surface line
  coast: Object.freeze({ min: 80, max: 400, roadReach: 600, step: 40 }),
  attempts: 40, // tries per animal before giving up
});

/**
 * @typedef {object} Fauna
 * @property {{kind: string, x: number, z: number, radius: number, count: number, seed: number}[]} herds
 * @property {{kind: string, x: number, z: number, yaw: number, seed: number}[]} wild
 * @property {{x: number, z: number, altitude: number, radius: number, count: number, seed: number}[]} flocks
 * @property {{x: number, z: number, seed: number}[]} butterflies
 * @property {{x: number, z: number, seed: number}[]} dolphins
 */

const between = (random, [low, high]) => low + random() * (high - low);
const whole = (random, [low, high]) => low + Math.floor(random() * (high - low + 1));
const pick = (random, list) => list[Math.floor(random() * list.length)];
const toWorld = (farm, u, v) => [farm.x + Math.cos(farm.yaw) * u - Math.sin(farm.yaw) * v, farm.z + Math.sin(farm.yaw) * u + Math.cos(farm.yaw) * v];

/** The plan's trees as one list of [x, z] points. */
function treePoints(trees) {
  const points = [];
  for (const [id, array] of Object.entries(trees ?? {})) {
    if (id === "forests") continue;
    for (let i = 0; i + 4 < array.length; i += 5) points.push([array[i], array[i + 2]]);
  }
  return points;
}

/** Plans the fauna on top of the plan's farms, trees and masks. */
export function planFauna({ farms = [], trees, terrain, roads, regions = [], seed, season, masks, water, detail = "high" }) {
  const budget = FAUNA_BUDGET[detail];
  if (!budget) throw new Error(`Unknown detail level "${detail}"`);
  const random = seededRandom(seed ^ 0xfa07a);
  const next = () => (random() * 0x7fffffff) | 0;
  const dry = (x, z) => terrain.height(x, z) >= water + FAUNA.aboveWater;
  const free = (x, z) => maskAt(masks, x, z) === MASK.free && dry(x, z);
  const roadDistance = (x, z) => roads.nearest(x, z, 2)?.distance ?? Infinity;

  const herds = [];
  const addHerd = (kind, x, z, radius, count) => {
    if (herds.length < budget.herds) herds.push({ kind, x, z, radius, count, seed: next() });
  };
  // In priority order, so the budget cuts from the end: paddock herds, chickens, pigs, then meadow herds.
  for (const farm of farms) {
    if (!farm.paddock) continue;
    const kind = pick(random, FAUNA.paddockKinds);
    addHerd(kind, farm.paddock.x, farm.paddock.z, Math.min(farm.paddock.width, farm.paddock.depth) / 2 - 4, FAUNA.herdSize[kind]);
  }
  for (const farm of farms) addHerd("chicken", ...toWorld(farm, ...FAUNA.yardSpots.chicken), FAUNA.yardRadius, whole(random, FAUNA.chickens));
  for (const farm of farms) {
    const pigs = whole(random, FAUNA.pigs);
    if (season !== "winter") addHerd("pig", ...toWorld(farm, ...FAUNA.yardSpots.pig), FAUNA.yardRadius, pigs);
  }
  const sheepTarget = Math.max(2, Math.floor(budget.herds / 3));
  for (let made = 0, tries = 0; made < sheepTarget && tries < sheepTarget * FAUNA.attempts && herds.length < budget.herds; tries += 1) {
    const s = roads.samples[Math.floor(random() * roads.samples.length)];
    const [angle, away] = [random() * Math.PI * 2, between(random, FAUNA.meadowRoad)];
    const [x, z] = [s.x + Math.cos(angle) * away, s.z + Math.sin(angle) * away];
    const open = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => free(x + a * FAUNA.meadowRadius, z + b * FAUNA.meadowRadius));
    if (!open || roadDistance(x, z) < FAUNA.meadowRoad[0] || !FAUNA.meadowKinds.includes(regionMix(x, z, regions, seed)[0].kind)) continue;
    addHerd("sheep", x, z, FAUNA.meadowRadius, FAUNA.herdSize.sheep);
    made += 1;
  }

  const wild = [];
  const woods = treePoints(trees);
  for (let tries = 0; woods.length && wild.length < budget.wild && tries < budget.wild * FAUNA.attempts; tries += 1) {
    const [tx, tz] = woods[Math.floor(random() * woods.length)];
    const [angle, away, kind] = [random() * Math.PI * 2, 4 + random() * (FAUNA.woodEdge - 4), pick(random, FAUNA.wildKinds)];
    const [x, z] = [tx + Math.cos(angle) * away, tz + Math.sin(angle) * away];
    if (!free(x, z) || (FAUNA.shy.includes(kind) && roadDistance(x, z) < FAUNA.wildRoadClear)) continue;
    wild.push({ kind, x, z, yaw: random() * Math.PI * 2, seed: next() });
  }

  const flocks = [];
  for (let tries = 0; roads.samples.length && flocks.length < budget.flocks && tries < budget.flocks * FAUNA.attempts; tries += 1) {
    const s = roads.samples[Math.floor(random() * roads.samples.length)];
    const [angle, away] = [random() * Math.PI * 2, 50 + random() * 400];
    const [x, z] = [s.x + Math.cos(angle) * away, s.z + Math.sin(angle) * away];
    if (!dry(x, z) || [MASK.river, MASK.road].includes(maskAt(masks, x, z))) continue;
    flocks.push({ x, z, altitude: between(random, FAUNA.flock.altitude), radius: between(random, FAUNA.flock.radius), count: whole(random, FAUNA.flock.count), seed: next() });
  }

  const butterflies = [];
  const warm = season === "spring" || season === "summer";
  for (let tries = 0; warm && roads.samples.length && butterflies.length < budget.butterflies && tries < budget.butterflies * FAUNA.attempts; tries += 1) {
    const s = roads.samples[Math.floor(random() * roads.samples.length)];
    const [angle, away] = [random() * Math.PI * 2, 2 + random() * 12];
    const [x, z] = [s.x + Math.cos(angle) * away, s.z + Math.sin(angle) * away];
    if (maskAt(masks, x, z) === MASK.verge && dry(x, z)) butterflies.push({ x, z, seed: next() });
  }

  return { herds, wild, flocks, butterflies, dolphins: planDolphins({ terrain, roads, water, random, next, budget: budget.dolphins }) };
}

/** The nearest dry land within `FAUNA.coast.max` of (x, z), marching eight directions: `{distance, x, z}`; null if none. */
function coastDistance(terrain, water, x, z) {
  for (let r = FAUNA.coast.step; r <= FAUNA.coast.max; r += FAUNA.coast.step) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      if (terrain.height(x + Math.cos(a) * r, z + Math.sin(a) * r) >= water) return { distance: r, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
    }
  }
  return null;
}

/** Dolphins in deep water 80-400 m off a coast that a road passes within 600 m. */
function planDolphins({ terrain, roads, water, random, next, budget }) {
  const dolphins = [];
  for (let tries = 0; roads.samples.length && dolphins.length < budget && tries < budget * FAUNA.attempts * 4; tries += 1) {
    const s = roads.samples[Math.floor(random() * roads.samples.length)];
    const [angle, away] = [random() * Math.PI * 2, 100 + random() * (FAUNA.coast.roadReach + FAUNA.coast.max - 100)];
    const [x, z] = [s.x + Math.cos(angle) * away, s.z + Math.sin(angle) * away];
    if (terrain.height(x, z) > water - FAUNA.seaDepth) continue;
    const coast = coastDistance(terrain, water, x, z);
    if (!coast || coast.distance < FAUNA.coast.min) continue;
    const road = roads.nearest(coast.x, coast.z, Math.ceil(FAUNA.coast.roadReach / roads.cell));
    if (!road || road.distance > FAUNA.coast.roadReach) continue;
    dolphins.push({ x, z, seed: next() });
  }
  return dolphins;
}
