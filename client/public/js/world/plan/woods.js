/**
 * Trees per region: a block grid over the island (one hectare per block), each
 * block holding as many trees as its regions' density asks for, thinned by
 * the budget and by the distance from the roads so the trees go where riders
 * look. Pure and seeded; the same input gives the same trees.
 */
import { seededRandom } from "../noise.js";
import { REGION_STYLE } from "../regionKinds.js";
import { regionMix } from "../regions.js";
import { clearAt } from "./masks.js";

export const WOODS = Object.freeze({
  block: 100,
  farFrom: 1500, // beyond this distance from a road, trees thin out
  farShare: 0.5,
  farmTrees: 1, // the farmed share of the land carries no woods: density applies to the rest
  minAbove: 2.5, // no trees in the sea or on the beach
});
/** [min, max] scale per plant; the others use `DEFAULT_SIZE`. */
const SIZE = Object.freeze({ bush: Object.freeze([0.6, 1.1]), rock: Object.freeze([0.5, 1.6]), lavender: Object.freeze([0.8, 1.2]) });
const DEFAULT_SIZE = Object.freeze([0.8, 1.3]);

/** Chamfer distance, in metres, from each block to the nearest block with a road sample in it. */
function roadDistances(roads, grid) {
  const { columns, rows, x0, z0, block } = grid;
  const far = 1e9;
  const data = new Float32Array(columns * rows).fill(far);
  for (const s of roads.samples) {
    const i = Math.floor((s.x - x0) / block);
    const j = Math.floor((s.z - z0) / block);
    if (i >= 0 && j >= 0 && i < columns && j < rows) data[j * columns + i] = 0;
  }
  const relax = (i, j, di, dj, cost) => {
    const [a, b] = [i + di, j + dj];
    if (a < 0 || b < 0 || a >= columns || b >= rows) return;
    data[j * columns + i] = Math.min(data[j * columns + i], data[b * columns + a] + cost * block);
  };
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) for (const [di, dj, cost] of [[-1, 0, 1], [0, -1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2]]) relax(i, j, di, dj, cost);
  }
  for (let j = rows - 1; j >= 0; j -= 1) {
    for (let i = columns - 1; i >= 0; i -= 1) for (const [di, dj, cost] of [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]]) relax(i, j, di, dj, cost);
  }
  return data;
}

const pickFrom = (shares, u) => {
  let sum = 0;
  let last = null;
  for (const [id, share] of shares) {
    sum += share;
    last = id;
    if (u < sum) return id;
  }
  return last;
};

/** Trees per hectare of each kind at one spot: its density, less the farmed land. */
function densities(mix) {
  return mix.map(({ kind, weight }) => {
    const style = REGION_STYLE[kind];
    return [kind, weight * style.trees.density * (1 - style.fieldShare * WOODS.farmTrees)];
  });
}

/**
 * @param {{terrain: object, roads: import("../roads.js").RoadIndex, regions: object[], seed: number, bounds: {x0: number, z0: number, x1: number, z1: number}, masks: import("./masks.js").Masks, water: number, budget: number}} input
 * @returns {Record<string, Float32Array>} per plant id: x, y, z, yaw, scale for each tree
 */
export function planWoods({ terrain, roads, regions, seed, bounds, masks, water, budget }) {
  const block = WOODS.block;
  const grid = { block, x0: Math.floor(bounds.x0 / block) * block, z0: Math.floor(bounds.z0 / block) * block };
  grid.columns = Math.ceil((bounds.x1 - grid.x0) / block);
  grid.rows = Math.ceil((bounds.z1 - grid.z0) / block);
  const distances = roadDistances(roads, grid);
  const hectares = (block * block) / 10_000;

  const mixes = new Array(grid.columns * grid.rows).fill(null);
  const expected = new Float32Array(grid.columns * grid.rows);
  let total = 0;
  for (let j = 0; j < grid.rows; j += 1) {
    for (let i = 0; i < grid.columns; i += 1) {
      const [x, z] = [grid.x0 + (i + 0.5) * block, grid.z0 + (j + 0.5) * block];
      if (terrain.height(x, z) < water + WOODS.minAbove) continue;
      const k = j * grid.columns + i;
      mixes[k] = densities(regionMix(x, z, regions, seed));
      const near = distances[k] <= WOODS.farFrom ? 1 : WOODS.farShare;
      expected[k] = mixes[k].reduce((sum, [, d]) => sum + d, 0) * hectares * near;
      total += expected[k];
    }
  }
  const scale = total > budget ? budget / total : 1;

  const lists = {};
  let placed = 0;
  for (let j = 0; j < grid.rows && placed < budget; j += 1) {
    for (let i = 0; i < grid.columns && placed < budget; i += 1) {
      const k = j * grid.columns + i;
      if (!mixes[k]) continue;
      const random = seededRandom((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ seed) >>> 0);
      const n = Math.floor(expected[k] * scale + random());
      const side = Math.max(1, Math.ceil(Math.sqrt(n)));
      const kindShares = mixes[k].map(([kind, d]) => [kind, d / mixes[k].reduce((sum, [, e]) => sum + e, 0)]);
      for (let t = 0; t < n && placed < budget; t += 1) {
        const [cell, ux, uz, uKind, uPlant, uYaw, uSize] = [random(), random(), random(), random(), random(), random(), random()];
        const slot = Math.min(side * side - 1, Math.floor(((t + cell) / n) * side * side));
        const x = grid.x0 + (i + ((slot % side) + ux) / side) * block;
        const z = grid.z0 + (j + (Math.floor(slot / side) + uz) / side) * block;
        if (!clearAt(masks, x, z)) continue;
        const y = terrain.height(x, z);
        if (y < water + WOODS.minAbove) continue;
        const kind = pickFrom(kindShares, uKind);
        const plant = pickFrom(Object.entries(REGION_STYLE[kind].trees.mix), uPlant);
        const [low, high] = SIZE[plant] ?? DEFAULT_SIZE;
        (lists[plant] ??= []).push(x, y, z, uYaw * Math.PI * 2, low + (high - low) * uSize);
        placed += 1;
      }
    }
  }
  return Object.fromEntries(Object.keys(lists).sort().map((id) => [id, Float32Array.from(lists[id])]));
}
