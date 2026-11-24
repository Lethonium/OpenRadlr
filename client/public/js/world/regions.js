/**
 * Regions: named stretches of the island with their own character. Hand-placed
 * circles in the map file whose edges blend over about 150 m and wander with
 * about 300 m noise, so no circle shows. Pure functions of the map and seed.
 */
import { fbm } from "./noise.js";

const BLEND = 75; // half the blend band, metres
const WOBBLE_SCALE = 300;

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * @typedef {{kind: string, weight: number}} RegionWeight
 * @typedef {{kind: string, center: number[], radius: number}} Region
 */

/**
 * Every region with weight > 0 at world (x, z), strongest first.
 * @param {number} x
 * @param {number} z
 * @param {Region[] | undefined} regions
 * @param {number} seed
 * @returns {RegionWeight[]}
 */
export function regionAt(x, z, regions, seed) {
  if (!regions?.length) return [];
  const wobble = (fbm(x / WOBBLE_SCALE, z / WOBBLE_SCALE, seed + 0x5e9) - 0.5) * 0.35;
  const found = [];
  for (const region of regions) {
    const distance = Math.hypot(x - region.center[0], z - region.center[1]);
    const shift = wobble * region.radius;
    const weight = 1 - smoothstep(region.radius - BLEND + shift, region.radius + BLEND + shift, distance);
    if (weight > 0) found.push({ kind: region.kind, weight });
  }
  return found.sort((a, b) => b.weight - a.weight);
}

/**
 * Like `regionAt`, but the weights always sum to 1: where the regions cover
 * less than the whole, the rest is calm `meadow`; where they overlap, they
 * are scaled down to share it.
 * @param {number} x
 * @param {number} z
 * @param {Region[] | undefined} regions
 * @param {number} seed
 * @returns {RegionWeight[]}
 */
export function regionMix(x, z, regions, seed) {
  const found = regionAt(x, z, regions, seed);
  const total = found.reduce((sum, r) => sum + r.weight, 0);
  if (total >= 1) return found.map((r) => ({ kind: r.kind, weight: r.weight / total }));
  return [...found, { kind: "meadow", weight: 1 - total }].sort((a, b) => b.weight - a.weight);
}
