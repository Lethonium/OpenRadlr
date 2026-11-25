/**
 * The temperate biome: the farmland valley OpenRadlr has always drawn.
 *
 * A biome only changes what the world *looks like*, never where anything is.
 * It supplies colours, the terrain shading rule and the scenery models; the layout (terrain heights, roads,
 * zones, buildings' places) stays the same in every biome, so riders on the
 * same road share a world even when they see different seasons.
 *
 * Pure data and pure functions: this runs in the world worker and in tests.
 */
import { PALETTE, buildVillageSign, buildWarningSign } from "../structures.js";
import { fbm, valueNoise } from "../../world/noise.js";

export const COLORS = Object.freeze({
  road: [0.25, 0.26, 0.28],
  verge: [0.3, 0.21, 0.12], // earth, linear (the reference's #9a8360 dirt); the sRGB beige read as pale concrete
  marking: [0.93, 0.93, 0.89],
  edge: [0.9, 0.9, 0.86],
  rock: [0.52, 0.51, 0.49],
  postWhite: [0.94, 0.94, 0.92],
  postRed: [0.82, 0.18, 0.16],
  start: [1.0, 0.48, 0.1],
  climb: [0.86, 0.3, 0.3],
  sprint: [0.3, 0.7, 0.95],
  post: [0.92, 0.92, 0.92],
  cloud: [1, 1, 1, 1], // tinted by the time of day
  water: [0.16, 0.42, 0.56],
  river: [0.22, 0.45, 0.6],
});

/** The crowd's shirts, a stable list so the same person keeps the same colour. */
const SHIRTS = Object.freeze([
  Object.freeze([0.86, 0.2, 0.2]),
  Object.freeze([0.2, 0.45, 0.85]),
  Object.freeze([0.98, 0.8, 0.2]),
  Object.freeze([0.95, 0.95, 0.95]),
  Object.freeze([0.25, 0.65, 0.35]),
  Object.freeze([0.95, 0.5, 0.15]),
  Object.freeze([0.55, 0.3, 0.75]),
  Object.freeze([0.15, 0.15, 0.18]),
]);

/** Farmland palette with thresholds on a patch noise: mostly grass, some fields. */
export const FIELDS = [
  { upTo: 0.42, color: [0.36, 0.58, 0.25] }, // meadow
  { upTo: 0.62, color: [0.3, 0.52, 0.23] }, // lush grass
  { upTo: 0.74, color: [0.45, 0.62, 0.28] }, // young crops
  { upTo: 0.84, color: [0.58, 0.63, 0.3] }, // hay
  { upTo: 1.01, color: [0.82, 0.7, 0.36] }, // wheat
];

const SAND = [0.78, 0.71, 0.52];
const SEA_FLOOR = [0.2, 0.36, 0.38];
const RIVER_BED = [0.5, 0.45, 0.34];
const RIVER_MEADOW = [0.34, 0.5, 0.26];
const STEEP = [0.48, 0.46, 0.42];
const HIGH = [0.5, 0.52, 0.42];

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Ground colour at a point. `ctx` carries the noise seed, the sea level and
 * the distance to the nearest river; heights are the terrain's, not the
 * biome's, so seasons only recolour the same land.
 */
function terrainColor({ x, z, height, steep, seed, water, riverDistance = Infinity, riverHalfWidth = 9 }) {
  if (height < water - 0.2) return SAND.map((c, i) => c + (SEA_FLOOR[i] - c) * smoothstep(0, 14, water - height)); // sea floor
  if (height < water + 2.4 && steep < 0.5) return SAND.map((c) => c * (0.95 + 0.1 * valueNoise(x / 9, z / 9, seed + 3))); // beach
  if (riverDistance < riverHalfWidth + 3) return RIVER_BED; // river bed and muddy banks
  if (riverDistance < riverHalfWidth + 9) return RIVER_MEADOW; // lush river meadow
  if (steep > 0.6) return STEEP;
  const patch = valueNoise(x / 85, z / 85, seed + 31);
  const base = FIELDS.find((f) => patch < f.upTo).color;
  const shade = 0.92 + 0.16 * fbm(x / 30, z / 30, seed + 7, 2);
  const high = smoothstep(85, 140, height - water);
  return [0, 1, 2].map((i) => (base[i] * shade) * (1 - high) + HIGH[i] * high);
}

/** Buildings and props: a biome swaps these for its own shapes and skins. */
const models = Object.freeze({
  warning: buildWarningSign,
  villageSign: buildVillageSign,
});

export const temperate = Object.freeze({
  id: "temperate",
  label: "biome.temperate",
  road: Object.freeze({
    surface: COLORS.road,
    verge: COLORS.verge,
    marking: COLORS.marking,
    edge: COLORS.edge,
    postWhite: COLORS.postWhite,
    postRed: COLORS.postRed,
    postDark: [0.2, 0.2, 0.2],
    /** Event barriers: a metal post and alternating stripe colours. */
    barrier: Object.freeze({
      post: PALETTE.metal,
      stripes: Object.freeze([PALETTE.white, Object.freeze([0.2, 0.42, 0.85])]),
    }),
  }),
  arch: Object.freeze({
    post: COLORS.post,
    start: COLORS.start,
    climb: COLORS.climb,
    sprint: COLORS.sprint,
    /** The light and dark squares of the start/finish strip. */
    chequer: Object.freeze([Object.freeze([0.95, 0.95, 0.95]), Object.freeze([0.1, 0.1, 0.1])]),
  }),
  water: Object.freeze({ color: COLORS.water, alpha: 0.82 }),
  river: Object.freeze({ color: COLORS.river, alpha: 0.85 }),
  /** A small three-colour swatch for the season picker. */
  preview: Object.freeze({
    sky: Object.freeze([0.62, 0.78, 0.9]),
    ground: Object.freeze([0.45, 0.6, 0.26]),
    accent: Object.freeze([0.95, 0.85, 0.2]),
  }),
  sky: Object.freeze({
    clouds: Object.freeze({
      color: COLORS.cloud,
      count: 18,
      spread: 3500,
      altitude: Object.freeze([420, 300]),
      puffs: Object.freeze([3, 4]),
      radius: Object.freeze([60, 70]),
      offset: Object.freeze([2.2, 0.3, 1.0]),
      puffRadius: Object.freeze([0.6, 0.5]),
      squash: Object.freeze([0.5, 0.8]),
      segments: Object.freeze([5, 10]),
    }),
  }),
  rock: COLORS.rock,
  sand: SAND,
  /** Colours of the 2D map's symbols: buildings and their outlines (0–1 RGB like the rest). */
  map: Object.freeze({
    house: Object.freeze({
      fill: Object.freeze([0.455, 0.298, 0.22]),
      fillAlpha: 0.46,
      edge: Object.freeze([0.847, 0.78, 0.608]),
      edgeAlpha: 0.85,
      ridge: Object.freeze([0.91, 0.839, 0.675]),
      ridgeAlpha: 0.45,
    }),
    cafe: Object.freeze({
      fill: Object.freeze([0.557, 0.361, 0.243]),
      fillAlpha: 0.52,
      edge: Object.freeze([0.91, 0.839, 0.675]),
      edgeAlpha: 0.95,
      ridge: Object.freeze([0.949, 0.878, 0.714]),
      ridgeAlpha: 0.6,
    }),
  }),
  seaFloor: SEA_FLOOR,
  palette: PALETTE,
  models,
  /** `motion` tells the view how the crowd cheers; the figures are assets/people. */
  people: Object.freeze({ motion: "jump", tint: true, shirts: SHIRTS }),
  terrainColor,
  flora: Object.freeze({
    /** The two greens of the 2D map's tree dots. */
    mapColors: Object.freeze([Object.freeze([0.302, 0.49, 0.227]), Object.freeze([0.376, 0.561, 0.271])]),
  }),
});
