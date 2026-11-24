/**
 * The ground as a regular grid of heights, normals and colours: what the world
 * worker computes and the main thread turns into terrain tiles. Pure; the
 * terrain is passed in, nothing here knows about drawing.
 */
import { fbm } from "./noise.js";
import { SEASON_LOOK } from "./seasons.js";

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

/** Metres from a road's centre that count as its soil verge. */
export const VERGE_REACH = 11;
/** Gradient (rise over run) above which the ground is bare rock. */
export const ROCK_SLOPE = 0.6;
/** Metres above the sea that are beach. */
export const BEACH_HEIGHT = 3;
/** Metres from a river's centre that are its bed. */
const RIVER_BED = 12;
const SNOW = Object.freeze([0.93, 0.95, 0.98]);

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (rgb) => rgb.map(toLinear);
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Colour of one spot of ground, linear RGB.
 * @param {{height: number, slope: number, roadDistance: number, riverDistance: number, noise: number}} spot noise in 0..1
 * @param {import("./seasons.js").SeasonLook} look
 * @param {number} water sea level
 * @returns {Rgb}
 */
export function groundColor({ height, slope, roadDistance, riverDistance, noise }, look, water) {
  let colour = mix(linear(look.grass), linear(look.grassDry), smoothstep(0.5, 0.7, noise));
  if (height < water + BEACH_HEIGHT) colour = linear(look.sand);
  if (roadDistance < VERGE_REACH) colour = linear(look.soil);
  if (riverDistance < RIVER_BED) colour = linear(look.soil).map((c) => c * 0.7);
  const steep = slope > ROCK_SLOPE;
  if (steep) colour = linear(look.rock);
  if (!steep && look.snowCover > 0 && height - water >= look.snowLine) colour = mix(colour, SNOW, look.snowCover);
  return /** @type {Rgb} */ (colour);
}

/**
 * Heights, normals and colours of `terrain` over `bounds`, one vertex per `cell` metres.
 * @param {{height: (x: number, z: number) => number, distanceToRoad: (x: number, z: number) => number, riverDistance?: (x: number, z: number) => number}} terrain
 * @param {{bounds: {x0: number, z0: number, x1: number, z1: number}, cell: number, water: number, season: import("./seasons.js").Season, seed: number}} options
 * @returns {GroundGrid}
 */
export function groundGrid(terrain, { bounds, cell, water, season, seed }) {
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
      colors.set(groundColor({ height: heights[k], slope: Math.hypot(dx, dz), roadDistance: terrain.distanceToRoad(x, z), riverDistance: terrain.riverDistance?.(x, z) ?? Infinity, noise }, look, water), k * 3);
    }
  }
  return { x0: bounds.x0, z0: bounds.z0, cell, columns, rows, heights, normals, colors, water };
}
