/**
 * Winter's ground: snow over the same land. Heights, rivers and shorelines
 * are the terrain's, never the biome's — only the colour rules differ.
 */
import { fbm, valueNoise } from "../../noise.js";
import { mix } from "../helpers.js";

const SNOW = [0.93, 0.95, 0.99];
const SNOW_SHADE = [0.8, 0.85, 0.92];
const SNOW_HIGH = [0.98, 0.99, 1.0];
const ICE = [0.76, 0.86, 0.93];
const ICE_SHORE = [0.82, 0.89, 0.95];
const ROCK = [0.44, 0.45, 0.48];
const ROCK_DARK = [0.33, 0.34, 0.37];
const SEA_FLOOR = [0.17, 0.24, 0.3];
const ICE_FLOOR = [0.55, 0.68, 0.78];

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Ground colour at a point. Snow on the flats, ice at the water's edge and on
 * the frozen river, bare rock where the ground is too steep to hold it.
 */
export function terrainColor({ x, z, height, steep, seed, water, riverDistance = Infinity, riverHalfWidth = 9 }) {
  if (height < water - 0.2) {
    return mix(ICE_FLOOR, SEA_FLOOR, smoothstep(0, 14, water - height)); // lake and sea floor
  }
  if (height < water + 2.4 && steep < 0.5) {
    const t = 0.85 + 0.15 * valueNoise(x / 9, z / 9, seed + 3);
    return ICE_SHORE.map((c) => c * t); // frozen shoreline
  }
  if (riverDistance < riverHalfWidth + 3) return ICE; // the river is frozen over
  if (riverDistance < riverHalfWidth + 9) {
    const t = 0.96 + 0.04 * valueNoise(x / 11, z / 11, seed + 5);
    return SNOW.map((c) => c * t); // snow on the river meadow
  }
  if (steep > 0.55) {
    const rock = mix(ROCK, ROCK_DARK, valueNoise(x / 12, z / 12, seed + 11));
    return mix(SNOW_SHADE, rock, smoothstep(0.55, 0.92, steep)); // rock shows through
  }
  const patch = valueNoise(x / 85, z / 85, seed + 31);
  const drift = fbm(x / 26, z / 26, seed + 7, 2);
  const base = mix(SNOW_SHADE, SNOW, 0.55 + patch * 0.45);
  const shade = 0.96 + 0.07 * drift;
  const high = smoothstep(85, 140, height - water);
  return [0, 1, 2].map((i) => base[i] * shade * (1 - high) + SNOW_HIGH[i] * high);
}
