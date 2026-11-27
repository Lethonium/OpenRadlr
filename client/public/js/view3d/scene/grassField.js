/**
 * Where grass grows, and the ground sampled as textures for the grass rings.
 * Pure data in, typed arrays out (no DOM), so node can build every layer.
 * Grass keeps off roads, rivers and the inside of fields (the plan's masks), beaches and
 * cliffs; elsewhere the blades take the ground's own colour.
 */
import { BEACH_HEIGHT, ROCK_SLOPE } from "../../world/groundGrid.js";
import { MASK, insideField, maskAt } from "../../world/plan/masks.js";

/** `normal.y` of a slope that is bare rock: below it nothing grows. */
const ROCK_NORMAL = 1 / Math.hypot(ROCK_SLOPE, 1);

const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Height of a grid at any world point: the terrain's own triangles, clamped
 * at the grid's edge.
 * @param {import("../../world/groundGrid.js").GroundGrid} grid
 * @returns {(x: number, z: number) => number}
 */
export function heightSampler(grid) {
  const { x0, z0, cell, columns, rows, heights } = grid;
  return (x, z) => {
    const gx = Math.min(columns - 1.000001, Math.max(0, (x - x0) / cell));
    const gz = Math.min(rows - 1.000001, Math.max(0, (z - z0) / cell));
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = heights[j * columns + i];
    const d = heights[j * columns + i + 1];
    const b = heights[(j + 1) * columns + i];
    const c = heights[(j + 1) * columns + i + 1];
    return fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  };
}

/**
 * How much grass each vertex of a grid carries, 0..1.
 * @param {import("../../world/groundGrid.js").GroundGrid} grid
 * @param {import("../../world/plan/masks.js").Masks} [masks] free where missing
 * @returns {Float32Array} one per vertex
 */
export function grassWeights(grid, masks) {
  const { x0, z0, cell, columns, rows, heights, normals, water } = grid;
  const weights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const k = j * columns + i;
      if (masks) {
        const mask = maskAt(masks, x0 + i * cell, z0 + j * cell);
        const rim = mask === MASK.field && !insideField(masks, x0 + i * cell, z0 + j * cell);
        if (mask !== MASK.free && mask !== MASK.verge && mask !== MASK.meadow && !rim) continue;
      }
      weights[k] = smooth(BEACH_HEIGHT, BEACH_HEIGHT + 2, heights[k] - water) * smooth(ROCK_NORMAL, ROCK_NORMAL + 0.04, normals[k * 3 + 1]);
    }
  }
  return weights;
}

/** Most texels per side of the grass textures. */
export const MAX_GROUND_TEXELS = 1024;

/**
 * The near grid resampled onto a square centred on the origin (what the grass
 * shader samples): ground height, and ground colour with the grass weight.
 * @param {import("../../world/groundGrid.js").GroundGrid} near
 * @param {Float32Array} weights `grassWeights(near, masks)`
 * @returns {{world: number, res: number, heights: Float32Array, colors: Float32Array}} colors are RGBA, 4 per texel
 */
export function bakeGroundTextures(near, weights) {
  const { x0, z0, cell, columns, rows } = near;
  const half = Math.max(Math.abs(x0), Math.abs(z0), Math.abs(x0 + (columns - 1) * cell), Math.abs(z0 + (rows - 1) * cell));
  const world = Math.max(2 * cell, 2 * Math.ceil(half / cell) * cell);
  const res = Math.min(MAX_GROUND_TEXELS, Math.round(world / cell) + 1);
  const step = world / (res - 1);
  const at = heightSampler(near);
  const heights = new Float32Array(res * res);
  const colors = new Float32Array(res * res * 4);
  for (let j = 0; j < res; j += 1) {
    for (let i = 0; i < res; i += 1) {
      const x = -world / 2 + i * step;
      const z = -world / 2 + j * step;
      const t = j * res + i;
      heights[t] = at(x, z);
      const vi = Math.round((x - x0) / cell);
      const vj = Math.round((z - z0) / cell);
      if (vi < 0 || vj < 0 || vi >= columns || vj >= rows) continue;
      const k = vj * columns + vi;
      colors.set(near.colors.subarray(k * 3, k * 3 + 3), t * 4);
      colors[t * 4 + 3] = weights[k];
    }
  }
  return { world, res, heights, colors };
}

/** Most texels per side of the grass clearance texture (WebGL 2 promises 2048; nearly every GPU has 4096). */
export const MAX_CLEAR_TEXELS = 4096;

/** Mask values grass never grows on, whatever the coarse weights say. */
const NO_GRASS = new Set([MASK.road, MASK.river, MASK.built]);

/**
 * Where blade roots may stand, at the plan mask's resolution (4 m cells, which
 * cover the asphalt with its verge): 255 where grass may grow, 0 on roads,
 * rivers and built ground. The near grid's weights are 16 m apart and would
 * let blades onto a road that runs between two vertices. A mask wider than
 * `maxTexels` is shrunk by whole blocks, a block cleared if any cell in it is.
 * @param {import("../../world/plan/masks.js").Masks} masks
 * @param {number} [maxTexels]
 * @returns {{x0: number, z0: number, width: number, depth: number, columns: number, rows: number, data: Uint8Array}}
 */
export function bakeGrassClear(masks, maxTexels = MAX_CLEAR_TEXELS) {
  const block = Math.max(1, Math.ceil(Math.max(masks.columns, masks.rows) / maxTexels));
  const columns = Math.ceil(masks.columns / block);
  const rows = Math.ceil(masks.rows / block);
  const data = new Uint8Array(columns * rows).fill(255);
  for (let j = 0; j < masks.rows; j += 1) {
    for (let i = 0; i < masks.columns; i += 1) {
      if (NO_GRASS.has(masks.data[j * masks.columns + i])) data[Math.floor(j / block) * columns + Math.floor(i / block)] = 0;
    }
  }
  const size = masks.cell * block;
  return { x0: masks.x0, z0: masks.z0, width: columns * size, depth: rows * size, columns, rows, data };
}

/**
 * The clearance at a world point, 0 or 1, as the grass shader reads it
 * (nearest texel, clamped at the edge).
 * @param {ReturnType<typeof bakeGrassClear>} clear
 */
export function grassClearAt(clear, x, z) {
  const i = Math.min(clear.columns - 1, Math.max(0, Math.floor(((x - clear.x0) / clear.width) * clear.columns)));
  const j = Math.min(clear.rows - 1, Math.max(0, Math.floor(((z - clear.z0) / clear.depth) * clear.rows)));
  return clear.data[j * clear.columns + i] / 255;
}
