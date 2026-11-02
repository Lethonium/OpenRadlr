/**
 * The temperate biome: the farmland valley OpenRadlr has always drawn.
 *
 * A biome only changes what the world *looks like*, never where anything is.
 * It supplies colours, the terrain shading rule, the scenery models and how
 * trees, tufts and flowers are drawn; the layout (terrain heights, roads,
 * zones, buildings' places) stays the same in every biome, so riders on the
 * same road share a world even when they see different seasons.
 *
 * Pure data and pure functions: this runs in the world worker and in tests.
 */
import {
  GYM_SIGN,
  PALETTE,
  buildBarn,
  buildCafe,
  buildChurch,
  buildCow,
  buildHayBale,
  buildHouse,
  buildOutdoorGymModel,
  buildSheep,
  buildSilo,
  buildSpectator,
  buildStreetLamp,
  buildTurbineTower,
  buildVillageSign,
  buildWarningSign,
} from "../structures.js";
import { fbm, valueNoise } from "../noise.js";

export const COLORS = Object.freeze({
  road: [0.25, 0.26, 0.28],
  verge: [0.62, 0.58, 0.48],
  marking: [0.93, 0.93, 0.89],
  edge: [0.9, 0.9, 0.86],
  trunk: [0.38, 0.27, 0.18],
  firs: [
    [0.13, 0.33, 0.2],
    [0.16, 0.37, 0.22],
    [0.11, 0.29, 0.19],
  ],
  leaves: [
    [0.3, 0.52, 0.22],
    [0.38, 0.58, 0.24],
    [0.46, 0.6, 0.2],
    [0.68, 0.55, 0.2],
  ],
  bush: [0.27, 0.45, 0.2],
  rock: [0.52, 0.51, 0.49],
  postWhite: [0.94, 0.94, 0.92],
  postRed: [0.82, 0.18, 0.16],
  start: [1.0, 0.48, 0.1],
  climb: [0.86, 0.3, 0.3],
  sprint: [0.3, 0.7, 0.95],
  post: [0.92, 0.92, 0.92],
  farIsland: [0.4, 0.46, 0.4],
  farIslandDark: [0.45, 0.45, 0.42],
  cloud: [1, 1, 1, 1], // tinted by the time of day
  water: [0.16, 0.42, 0.56],
  river: [0.22, 0.45, 0.6],
  grass: [
    [0.3, 0.5, 0.2],
    [0.38, 0.58, 0.22],
    [0.45, 0.6, 0.26],
  ],
  flowers: [
    [0.95, 0.85, 0.2],
    [0.95, 0.95, 0.95],
    [0.85, 0.3, 0.55],
    [0.55, 0.45, 0.9],
  ],
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

/** One tree, bush or rock at `[x, y, z]`; `kind` is the placement's random draw. */
function plantTree({ mesh, x, y, z, kind, random }) {
  if (kind < 0.1) {
    const size = 0.8 + random() * 2;
    mesh.cone([x, y, z], size, size * 0.8, COLORS.rock, 5, random() * Math.PI);
  } else if (kind < 0.28) {
    const size = 0.9 + random() * 1.2;
    mesh.ellipsoid([x, y + size * 0.55, z], [size, size * 0.75, size], COLORS.bush, 4, 8, random() * Math.PI);
  } else if (kind < 0.62) {
    // Fir: two or three stacked cones.
    const height = 6 + random() * 7;
    const color = COLORS.firs[Math.floor(random() * COLORS.firs.length)];
    mesh.box([x, y + height * 0.12, z], [0.4, height * 0.24, 0.4], COLORS.trunk);
    const tiers = random() < 0.5 ? 2 : 3;
    for (let t = 0; t < tiers; t += 1) {
      const base = y + height * (0.18 + t * 0.22);
      const radius = height * (0.3 - t * 0.07);
      mesh.cone([x, base, z], radius, height * (0.5 - t * 0.08), color, 7, random() * Math.PI);
    }
  } else {
    // Leafy tree: trunk and one or two round crowns.
    const height = 5 + random() * 5;
    const color = COLORS.leaves[Math.floor(random() * COLORS.leaves.length)];
    const crown = height * (0.3 + random() * 0.1);
    mesh.box([x, y + height * 0.3, z], [0.45, height * 0.6, 0.45], COLORS.trunk);
    mesh.ellipsoid([x, y + height * 0.68, z], [crown, crown * 0.85, crown], color, 4, 7, random() * Math.PI);
    if (random() < 0.5) {
      const dx = (random() - 0.5) * crown;
      const dz = (random() - 0.5) * crown;
      mesh.ellipsoid([x + dx, y + height * 0.85, z + dz], [crown * 0.7, crown * 0.6, crown * 0.7], color, 3, 6, random() * Math.PI);
    }
  }
}

/** Three thin blades of grass. */
function plantTuft({ mesh, x, y, z, random }) {
  const color = COLORS.grass[Math.floor(random() * COLORS.grass.length)];
  const height = 0.25 + random() * 0.35;
  const turn = random() * Math.PI;
  for (let blade = 0; blade < 3; blade += 1) {
    const angle = turn + (blade / 3) * Math.PI;
    const dx = Math.cos(angle) * 0.09;
    const dz = Math.sin(angle) * 0.09;
    const lean = [(random() - 0.5) * 0.15, height, (random() - 0.5) * 0.15];
    mesh.triangle([x - dx, y, z - dz], [x + dx, y, z + dz], [x + lean[0], y + lean[1], z + lean[2]], color);
  }
}

/** A stem with a small flower head. */
function plantFlower({ mesh, x, y, z, random }) {
  const height = 0.3 + random() * 0.25;
  const top = [x, y + height, z];
  mesh.triangle([x - 0.015, y, z], [x + 0.015, y, z], top, COLORS.grass[0]);
  const color = COLORS.flowers[Math.floor(random() * COLORS.flowers.length)];
  const r = 0.06 + random() * 0.04;
  mesh.ellipsoid(top, [r, r * 0.6, r], color, 2, 5, random() * Math.PI);
}

/** Buildings and props: a biome swaps these for its own shapes and skins. */
const models = Object.freeze({
  house: buildHouse,
  church: buildChurch,
  barn: buildBarn,
  silo: buildSilo,
  bale: buildHayBale,
  lamp: buildStreetLamp,
  warning: buildWarningSign,
  villageSign: buildVillageSign,
  animal1: () => buildCow(false),
  animal2: () => buildCow(true),
  animal3: buildSheep,
  cafe: buildCafe,
  gym: buildOutdoorGymModel,
  gymSign: GYM_SIGN,
  turbine: buildTurbineTower,
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
  cloud: COLORS.cloud,
  farIsland: COLORS.farIsland,
  farIslandDark: COLORS.farIslandDark,
  rock: COLORS.rock,
  sand: SAND,
  seaFloor: SEA_FLOOR,
  palette: PALETTE,
  models,
  /** `model(pose)` draws the two crowd poses; `motion` tells the view how to play them. */
  people: Object.freeze({ model: buildSpectator, motion: "jump", tint: true, shirts: SHIRTS }),
  terrainColor,
  flora: Object.freeze({
    /** Scenery per kilometre of road, so every route gets the same density. */
    density: Object.freeze({ trees: 270, tufts: 1450, flowers: 190, elsewhere: 0.4 }),
    tree: plantTree,
    tuft: plantTuft,
    flower: plantFlower,
  }),
});
