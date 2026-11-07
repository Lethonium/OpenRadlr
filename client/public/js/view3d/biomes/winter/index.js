/**
 * The winter biome: the same farmland valley under snow. All placements,
 * heights and road geometry are the terrain's; this module only supplies the
 * season's colours, shapes and ground rules.
 */
import { winterModels } from "./buildings.js";
import { plantFlower, plantTree, plantTuft } from "./flora.js";
import { ICE, PINE, SNOW, STONE, TIMBER, WINTER_PALETTE } from "./palette.js";
import { buildPenguin } from "./people.js";
import { terrainColor } from "./terrain.js";

/** Muted winter coats; the crowd and the penguins' scarves take these colours. */
const SHIRTS = Object.freeze([
  Object.freeze([0.72, 0.22, 0.18]),
  Object.freeze([0.2, 0.32, 0.52]),
  Object.freeze([0.86, 0.66, 0.22]),
  Object.freeze([0.9, 0.9, 0.92]),
  Object.freeze([0.24, 0.42, 0.3]),
  Object.freeze([0.82, 0.44, 0.2]),
  Object.freeze([0.45, 0.34, 0.5]),
  Object.freeze([0.18, 0.18, 0.22]),
]);

export const winter = Object.freeze({
  id: "winter",
  label: "biome.winter",
  road: Object.freeze({
    surface: Object.freeze([0.72, 0.74, 0.79]),
    verge: SNOW,
    marking: Object.freeze([0.86, 0.68, 0.28]),
    edge: Object.freeze([0.96, 0.96, 0.95]),
    postWhite: Object.freeze([0.95, 0.96, 0.98]),
    postRed: Object.freeze([0.8, 0.18, 0.16]),
    postDark: Object.freeze([0.2, 0.22, 0.26]),
    /** Snow ploughed to the verge, and the ruts worn along each lane. */
    bank: Object.freeze({ color: SNOW, height: 0.3 }),
    rut: Object.freeze({ color: Object.freeze([0.55, 0.58, 0.64]), width: 0.36 }),
    postCap: Object.freeze({ color: SNOW }),
    /** Frosted event barriers with an icy blue stripe. */
    barrier: Object.freeze({
      post: WINTER_PALETTE.metal,
      stripes: Object.freeze([SNOW, Object.freeze([0.3, 0.47, 0.68])]),
    }),
  }),
  arch: Object.freeze({
    post: Object.freeze([0.9, 0.93, 0.97]),
    start: Object.freeze([1.0, 0.55, 0.15]),
    climb: Object.freeze([0.8, 0.3, 0.35]),
    sprint: Object.freeze([0.35, 0.65, 0.95]),
    chequer: Object.freeze([SNOW, WINTER_PALETTE.dark]),
  }),
  water: Object.freeze({ color: Object.freeze([0.2, 0.31, 0.42]), alpha: 0.82 }),
  /** Opaque ice, with wind-blown snow patches on top (see buildRiverWater). */
  river: Object.freeze({
    color: ICE,
    alpha: 1,
    ice: Object.freeze({ color: SNOW, cover: 0.34, crack: Object.freeze([0.56, 0.68, 0.8]) }),
  }),
  preview: Object.freeze({
    sky: Object.freeze([0.82, 0.86, 0.9]),
    ground: SNOW,
    accent: Object.freeze([0.3, 0.47, 0.68]),
  }),
  weather: Object.freeze({
    kind: "snow",
    count: 900,
    box: Object.freeze([74, 26, 74]),
    fall: Object.freeze([4, 8]),
    drift: Object.freeze([1.1, 0.35]),
    size: Object.freeze([0.012, 0.035]),
    color: Object.freeze([0.98, 0.99, 1, 0.9]),
  }),
  sky: Object.freeze({
    clouds: Object.freeze({
      color: Object.freeze([0.9, 0.92, 0.96, 1]),
      // A lower, broader, flatter ceiling than summer's separate puffs.
      count: 24,
      spread: 3900,
      altitude: Object.freeze([340, 280]),
      puffs: Object.freeze([5, 5]),
      radius: Object.freeze([48, 78]),
      offset: Object.freeze([2.6, 0.16, 1.35]),
      puffRadius: Object.freeze([0.72, 0.5]),
      squash: Object.freeze([0.34, 0.9]),
      segments: Object.freeze([5, 10]),
    }),
  }),
  farIsland: Object.freeze([0.6, 0.65, 0.7]),
  farIslandDark: Object.freeze([0.48, 0.53, 0.58]),
  rock: Object.freeze([0.45, 0.47, 0.5]),
  sand: Object.freeze([0.8, 0.86, 0.92]),
  seaFloor: Object.freeze([0.18, 0.26, 0.32]),
  /** The 2D map under snow: pale ground, dark water and ploughed roads. */
  map: Object.freeze({
    land: SNOW,
    sea: Object.freeze([0.2, 0.31, 0.42]),
    sand: Object.freeze([0.8, 0.86, 0.92]),
    road: Object.freeze([0.72, 0.74, 0.79]),
    contextRoad: Object.freeze([0.55, 0.58, 0.64]),
    marking: Object.freeze([0.86, 0.68, 0.28]),
    edge: Object.freeze([0.96, 0.96, 0.95]),
    house: Object.freeze({
      fill: STONE,
      fillAlpha: 0.5,
      edge: SNOW,
      edgeAlpha: 0.95,
      ridge: ICE,
      ridgeAlpha: 0.55,
    }),
    cafe: Object.freeze({
      fill: TIMBER,
      fillAlpha: 0.58,
      edge: SNOW,
      edgeAlpha: 1,
      ridge: ICE,
      ridgeAlpha: 0.7,
    }),
  }),
  palette: WINTER_PALETTE,
  models: winterModels,
  /** The roadside crowd becomes clapping penguins; the scarf takes the per-person tint. */
  people: Object.freeze({ model: buildPenguin, motion: "clap", tint: true, shirts: SHIRTS }),
  /** Winter air: a pale, cool sky, snow bounce and a shorter haze. */
  light: Object.freeze({
    day: Object.freeze({
      sunColor: Object.freeze([0.93, 0.95, 1.0]),
      zenith: Object.freeze([0.4, 0.52, 0.67]),
      horizon: Object.freeze([0.82, 0.86, 0.9]),
      ground: Object.freeze([0.52, 0.54, 0.57]),
      cloudTint: Object.freeze([0.9, 0.93, 0.97]),
      fog: Object.freeze([260, 3300]),
      shadowStrength: 0.52,
    }),
    golden: Object.freeze({
      sunColor: Object.freeze([1.0, 0.8, 0.64]),
      zenith: Object.freeze([0.36, 0.45, 0.62]),
      horizon: Object.freeze([0.93, 0.81, 0.76]),
      ground: Object.freeze([0.5, 0.47, 0.49]),
      cloudTint: Object.freeze([1.0, 0.88, 0.83]),
      fog: Object.freeze([240, 3100]),
      shadowStrength: 0.6,
    }),
    dusk: Object.freeze({
      sunColor: Object.freeze([0.82, 0.64, 0.72]),
      zenith: Object.freeze([0.26, 0.31, 0.46]),
      horizon: Object.freeze([0.72, 0.67, 0.79]),
      ground: Object.freeze([0.43, 0.43, 0.5]),
      cloudTint: Object.freeze([0.88, 0.8, 0.9]),
      fog: Object.freeze([190, 2700]),
      shadowStrength: 0.45,
    }),
  }),
  terrainColor,
  flora: Object.freeze({
    /** Sparse under the snow: fewer trees than summer, no flowers at all. */
    density: Object.freeze({ trees: 230, tufts: 700, flowers: 0, elsewhere: 0.4 }),
    tree: plantTree,
    tuft: plantTuft,
    flower: plantFlower,
    /** Dark pines and snow-laden branches for the 2D map's tree dots. */
    mapColors: Object.freeze([PINE, ICE]),
  }),
});
