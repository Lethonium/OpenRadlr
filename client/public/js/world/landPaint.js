/**
 * The land use as one picture of the ground: an RGBA texture over the island's box, a texel per few metres, that
 * the terrain shader blends over the vertex colour. Pure; the bytes are sRGB, alpha says where a parcel is.
 */
import { SNOW } from "./groundGrid.js";
import { CROP_PAINT, LAND_STYLE } from "./landKinds.js";
import { SEASON_LOOK } from "./seasons.js";

/** Most texels per side. */
export const MAX_PAINT_TEXELS = 2048;
/** Smallest texel, metres. */
export const MIN_PAINT_CELL = 4;
/** How far a parcel's tint shifts its colour (a fraction). */
const TINT = 0.08;

/**
 * @typedef {object} LandPaint
 * @property {number} x0 world x of the first column's left edge
 * @property {number} z0 world z of the first row's top edge
 * @property {number} cell metres per texel
 * @property {number} columns
 * @property {number} rows
 * @property {Uint8Array} rgba row by row, sRGB colour and coverage (0 where no parcel is)
 */

/** Most coverage a parcel's paint reaches: the ground's own shading and mottling show through the rest. */
const MAX_COVER = 0.85;
/** How far snow whitens a parcel's paint (times the season's snow cover). */
const SNOW_BLEND = 0.85;
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const SNOW_SRGB = SNOW.map(toSrgb);

const byte = (c) => Math.min(255, Math.max(0, Math.round(c * 255)));

/**
 * Paints `parcels` into a texture over `bounds`. Each parcel gets its kind's colour for the season (arable: its
 * crop's), shaded by its tint, with a texel-wide soft edge.
 * @param {Array<{kind: string, x: number, z: number, width: number, depth: number, yaw: number, crop?: string|null, tint: number}>} parcels
 * @param {{bounds: {x0: number, z0: number, x1: number, z1: number}, season: string}} options
 * @returns {LandPaint}
 */
export function paintLandUse(parcels, { bounds, season }) {
  const cell = Math.max(MIN_PAINT_CELL, Math.ceil(Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / MAX_PAINT_TEXELS));
  const columns = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell));
  const rows = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cell));
  const rgba = new Uint8Array(columns * rows * 4);
  const [x0, z0] = [bounds.x0, bounds.z0];
  const snow = (SEASON_LOOK[season] ?? SEASON_LOOK.summer).snowCover * SNOW_BLEND;
  for (const parcel of parcels) {
    const style = LAND_STYLE[parcel.kind];
    const base = parcel.kind === "arable" ? CROP_PAINT[parcel.crop] : (style?.paint[season] ?? style?.paint.summer);
    if (!base) continue;
    const shade = 1 + TINT * parcel.tint;
    const colour = base.map((c, ch) => byte((c * shade) * (1 - snow) + SNOW_SRGB[ch] * snow));
    const [c, s] = [Math.cos(parcel.yaw), Math.sin(parcel.yaw)];
    const reach = Math.hypot(parcel.width, parcel.depth) / 2 + cell;
    const i0 = Math.max(0, Math.floor((parcel.x - reach - x0) / cell));
    const i1 = Math.min(columns - 1, Math.floor((parcel.x + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((parcel.z - reach - z0) / cell));
    const j1 = Math.min(rows - 1, Math.floor((parcel.z + reach - z0) / cell));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const dx = x0 + (i + 0.5) * cell - parcel.x;
        const dz = z0 + (j + 0.5) * cell - parcel.z;
        const inside = Math.min(parcel.width / 2 - Math.abs(dx * c + dz * s), parcel.depth / 2 - Math.abs(-dx * s + dz * c));
        const cover = Math.min(1, Math.max(0, 0.5 + inside / cell));
        if (cover <= 0) continue;
        const k = (j * columns + i) * 4;
        const old = rgba[k + 3] / 255;
        const into = old > 0 ? cover : 1;
        for (let ch = 0; ch < 3; ch += 1) rgba[k + ch] = old > 0 ? Math.round(rgba[k + ch] + (colour[ch] - rgba[k + ch]) * into) : colour[ch];
        rgba[k + 3] = Math.max(rgba[k + 3], Math.round(cover * MAX_COVER * 255));
      }
    }
  }
  bleed(rgba, columns, rows);
  return { x0, z0, cell, columns, rows, rgba };
}

/** Uncovered texels next to a painted one take its colour (alpha stays 0), so linear filtering has no black fringe. */
function bleed(rgba, columns, rows) {
  const out = rgba.slice();
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const k = (j * columns + i) * 4;
      if (rgba[k + 3] > 0) continue;
      let best = -1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [ni, nj] = [i + di, j + dj];
        if (ni < 0 || nj < 0 || ni >= columns || nj >= rows) continue;
        const n = (nj * columns + ni) * 4;
        if (rgba[n + 3] > (best < 0 ? 0 : rgba[best + 3])) best = n;
      }
      if (best >= 0) out.set(rgba.subarray(best, best + 3), k);
    }
  }
  rgba.set(out);
}
