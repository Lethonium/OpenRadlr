/**
 * The ground as a regular grid of heights, normals and colours: what the world
 * worker computes and the main thread turns into terrain tiles. Pure; the
 * terrain is passed in, nothing here knows about drawing.
 */
import { fbm } from "./noise.js";
import { SEASON_LOOK } from "./seasons.js";
import { REGION_STYLE } from "./regionKinds.js";
import { regionMix } from "./regions.js";

/** @typedef {[number, number, number]} Rgb */
/**
 * @typedef {object} GroundGrid
 * @property {number} x0 world x of the first column
 * @property {number} z0 world z of the first row
 * @property {number} cell metres between neighbouring vertices
 * @property {number} columns vertices per row
 * @property {number} rows vertices per column
 * @property {Float32Array} heights one per vertex, row by row
 * @property {Float32Array} normals three per vertex
 * @property {Float32Array} colors three per vertex, linear RGB
 * @property {number} water sea level
 */

/** Metres from a road's centre that are bare soil, and the further metres over which the soil fades into grass. */
export const VERGE_REACH = 4;
const VERGE_FADE = 1.5;
/** Gradient (rise over run) above which the ground starts to turn to rock. */
export const ROCK_SLOPE = 0.6;
/** Gradient from which the ground is wholly rock; between the two it fades from grass, so a hillside has no grey-brown smudge. */
const ROCK_FULL = 1;
/** Metres above the sea that are beach. */
export const BEACH_HEIGHT = 3;
/** Metres from a river's centre that are its bed. */
const RIVER_BED = 12;
const SNOW = Object.freeze([0.93, 0.95, 0.98]);

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (rgb) => rgb.map(toLinear);
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const times = (a, b) => a.map((c, i) => c * b[i]);
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Colour of one spot of ground, linear RGB.
 * @param {{height: number, slope: number, roadDistance: number, riverDistance: number, noise: number, fine?: number, tint?: number[]}} spot noise in 0..1; `fine` is the small-scale mottling (0..1, 0.5 neutral) shading the grass ±6 %; `tint` multiplies the grass (the region's)
 * @param {import("./seasons.js").SeasonLook} look
 * @param {number} water sea level
 * @returns {Rgb}
 */
export function groundColor({ height, slope, roadDistance, riverDistance, noise, fine = 0.5, tint }, look, water) {
  let colour = mix(linear(look.grass), linear(look.grassDry), smoothstep(0.62, 0.85, noise));
  if (tint) colour = times(colour, tint);
  colour = colour.map((c) => c * (1 + (fine - 0.5) * 0.12));
  if (height < water + BEACH_HEIGHT) colour = linear(look.sand);
  if (roadDistance < VERGE_REACH + VERGE_FADE) colour = mix(linear(look.soil), colour, smoothstep(VERGE_REACH, VERGE_REACH + VERGE_FADE, roadDistance));
  if (riverDistance < RIVER_BED) colour = linear(look.soil).map((c) => c * 0.7);
  const bare = smoothstep(ROCK_SLOPE, ROCK_FULL, slope);
  const steep = bare > 0.5;
  if (bare > 0) colour = mix(colour, linear(look.rock), bare);
  if (!steep && look.snowCover > 0 && height - water >= look.snowLine) colour = mix(colour, SNOW, look.snowCover);
  return /** @type {Rgb} */ (colour);
}

/**
 * Heights, normals and colours of `terrain` over `bounds`, one vertex per `cell` metres.
 * @param {{height: (x: number, z: number) => number, distanceToRoad: (x: number, z: number) => number, riverDistance?: (x: number, z: number) => number}} terrain
 * @param {{bounds: {x0: number, z0: number, x1: number, z1: number}, cell: number, water: number, season: import("./seasons.js").Season, seed: number, regions?: object[]}} options `regions` tint the grass (none given: untinted)
 * @returns {GroundGrid}
 */
export function groundGrid(terrain, { bounds, cell, water, season, seed, regions }) {
  const look = SEASON_LOOK[season] ?? SEASON_LOOK.summer;
  const columns = Math.round((bounds.x1 - bounds.x0) / cell) + 1;
  const rows = Math.round((bounds.z1 - bounds.z0) / cell) + 1;
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) heights[j * columns + i] = terrain.height(bounds.x0 + i * cell, bounds.z0 + j * cell);
  }
  const normals = new Float32Array(columns * rows * 3);
  const colors = new Float32Array(columns * rows * 3);
  const at = (i, j) => heights[Math.min(rows - 1, Math.max(0, j)) * columns + Math.min(columns - 1, Math.max(0, i))];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const k = j * columns + i;
      const dx = (at(i + 1, j) - at(i - 1, j)) / (cell * (Math.min(columns - 1, i + 1) - Math.max(0, i - 1)) || 1);
      const dz = (at(i, j + 1) - at(i, j - 1)) / (cell * (Math.min(rows - 1, j + 1) - Math.max(0, j - 1)) || 1);
      const length = Math.hypot(dx, 1, dz);
      normals.set([-dx / length + 0, 1 / length, -dz / length + 0], k * 3);
      const x = bounds.x0 + i * cell;
      const z = bounds.z0 + j * cell;
      const noise = fbm(x / 60, z / 60, seed);
      const tint = regions ? regionTint(x, z, regions, seed, season) : undefined;
      const fine = fbm(x / 25, z / 25, seed ^ 0x6d0771e);
      colors.set(groundColor({ height: heights[k], slope: Math.hypot(dx, dz), roadDistance: terrain.distanceToRoad(x, z), riverDistance: terrain.riverDistance?.(x, z) ?? Infinity, noise, fine, tint }, look, water), k * 3);
    }
  }
  return { x0: bounds.x0, z0: bounds.z0, cell, columns, rows, heights, normals, colors, water };
}

/** The grass tint at (x, z): the region styles' season tints, weighted by `regionMix`. */
function regionTint(x, z, regions, seed, season) {
  const tint = [0, 0, 0];
  for (const { kind, weight } of regionMix(x, z, regions, seed)) {
    const rgb = REGION_STYLE[kind].ground[season] ?? REGION_STYLE[kind].ground.summer;
    for (let c = 0; c < 3; c += 1) tint[c] += rgb[c] * weight;
  }
  return tint;
}
