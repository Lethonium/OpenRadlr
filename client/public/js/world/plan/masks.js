/**
 * What stands where on the ground: a coarse grid of byte flags over the island
 * that says where a road, a river or a field already is. Every placement rule
 * asks it, so nothing grows on asphalt, in water or twice on the same spot.
 * Pure; the grid is plain typed-array data the worker hands to the main thread.
 */
import { RIVER } from "../rivers.js";
import { VERGE, roadHalfWidth } from "../roads.js";

/**
 * Values in `masks.data`. A road or river outranks a field. `verge` is the strip beside a road
 * (past its asphalt and verge, within `ROAD_MARGIN`): clear of trees and fields, but grass grows there.
 */
export const MASK = Object.freeze({ free: 0, road: 1, river: 2, field: 3, verge: 4 });
/** Metres past the verge that stay clear of trees: canopy and the gap between road samples. */
export const ROAD_MARGIN = 4.5;
/** Metres past a river's water that stay clear: its bank. */
export const RIVER_MARGIN = 6;
/** Most cells a mask may have; a huge island gets coarser cells instead. */
export const MAX_CELLS = 6_000_000;
const RIVER_SAMPLE_STEP = 8; // half the path step: gaps between samples never open

/**
 * @typedef {object} Masks
 * @property {number} cell metres per cell
 * @property {number} x0 world x of the first column's left edge
 * @property {number} z0 world z of the first row's top edge
 * @property {number} columns
 * @property {number} rows
 * @property {Uint8Array} data row by row, one `MASK` value per cell
 */

/** Marks every free cell a disc of radius `r` at (x, z) touches. */
function stamp(masks, x, z, r, value) {
  const { cell, x0, z0, columns, rows, data } = masks;
  const i0 = Math.max(0, Math.floor((x - r - x0) / cell));
  const i1 = Math.min(columns - 1, Math.floor((x + r - x0) / cell));
  const j0 = Math.max(0, Math.floor((z - r - z0) / cell));
  const j1 = Math.min(rows - 1, Math.floor((z + r - z0) / cell));
  for (let j = j0; j <= j1; j += 1) {
    const dz = Math.max(z0 + j * cell - z, 0, z - (z0 + (j + 1) * cell));
    for (let i = i0; i <= i1; i += 1) {
      const dx = Math.max(x0 + i * cell - x, 0, x - (x0 + (i + 1) * cell));
      if (dx * dx + dz * dz < r * r && data[j * columns + i] === MASK.free) data[j * columns + i] = value;
    }
  }
}

/**
 * Road and river masks over `bounds`. The cells grow beyond `cell` when the
 * box would need more than `maxCells`.
 * @param {{roads: import("../roads.js").RoadIndex, rivers: Array<{points: Array<{x: number, z: number}>, ponds: Array<{x: number, z: number, radius: number}>}>, bounds: {x0: number, z0: number, x1: number, z1: number}, cell?: number, maxCells?: number}} input
 * @returns {Masks}
 */
export function buildMasks({ roads, rivers, bounds, cell = 4, maxCells = MAX_CELLS }) {
  const area = (bounds.x1 - bounds.x0) * (bounds.z1 - bounds.z0);
  const size = Math.max(cell, Math.ceil(Math.sqrt(area / maxCells)));
  const columns = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / size));
  const rows = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / size));
  const masks = { cell: size, x0: bounds.x0, z0: bounds.z0, columns, rows, data: new Uint8Array(columns * rows) };
  const reach = RIVER.halfWidth + RIVER_MARGIN + RIVER_SAMPLE_STEP;
  for (const river of rivers) {
    for (const p of river.points) stamp(masks, p.x, p.z, reach, MASK.river);
    for (const pond of river.ponds) {
      for (const radius of [0, 12, 24]) {
        const around = radius === 0 ? 1 : 12;
        for (let a = 0; a < around; a += 1) {
          const angle = (a / around) * Math.PI * 2;
          stamp(masks, pond.x + Math.cos(angle) * radius, pond.z + Math.sin(angle) * radius, reach, MASK.river);
        }
      }
    }
  }
  for (const s of roads.samples) stamp(masks, s.x, s.z, roadHalfWidth(s.route.lanes) + VERGE + 0.5, MASK.road);
  for (const s of roads.samples) stamp(masks, s.x, s.z, roadHalfWidth(s.route.lanes) + VERGE + ROAD_MARGIN, MASK.verge);
  return masks;
}

/** The mask value at world (x, z); outside the box counts as a road (blocked). */
export function maskAt(masks, x, z) {
  const i = Math.floor((x - masks.x0) / masks.cell);
  const j = Math.floor((z - masks.z0) / masks.cell);
  if (i < 0 || j < 0 || i >= masks.columns || j >= masks.rows) return MASK.road;
  return masks.data[j * masks.columns + i];
}

/** True where nothing stands: no road, verge strip, river or field, and inside the box. */
export const clearAt = (masks, x, z) => maskAt(masks, x, z) === MASK.free;

/** Marks the rectangle (centre, size, `yaw` of its width axis) as field wherever the cells are free. */
export function stampField(masks, { x, z, width, depth, yaw }) {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const reach = Math.hypot(width, depth) / 2 + masks.cell;
  const i0 = Math.max(0, Math.floor((x - reach - masks.x0) / masks.cell));
  const i1 = Math.min(masks.columns - 1, Math.floor((x + reach - masks.x0) / masks.cell));
  const j0 = Math.max(0, Math.floor((z - reach - masks.z0) / masks.cell));
  const j1 = Math.min(masks.rows - 1, Math.floor((z + reach - masks.z0) / masks.cell));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const dx = masks.x0 + (i + 0.5) * masks.cell - x;
      const dz = masks.z0 + (j + 0.5) * masks.cell - z;
      const along = dx * c + dz * s;
      const across = -dx * s + dz * c;
      const index = j * masks.columns + i;
      if (Math.abs(along) <= width / 2 + masks.cell / 2 && Math.abs(across) <= depth / 2 + masks.cell / 2 && masks.data[index] === MASK.free) masks.data[index] = MASK.field;
    }
  }
}
