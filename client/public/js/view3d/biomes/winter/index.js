/**
 * The winter biome: the same farmland valley under snow. All placements,
 * heights and road geometry are the terrain's; this module only supplies the
 * season's colours, shapes and ground rules.
 */
import { winterModels } from "./buildings.js";
import { plantFlower, plantTree, plantTuft } from "./flora.js";
import { ICE, SNOW, WINTER_PALETTE } from "./palette.js";
import { buildPenguin } from "./people.js";
import { terrainColor } from "./terrain.js";

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
  }),
  arch: Object.freeze({
    post: Object.freeze([0.9, 0.93, 0.97]),
    start: Object.freeze([1.0, 0.55, 0.15]),
    climb: Object.freeze([0.8, 0.3, 0.35]),
    sprint: Object.freeze([0.35, 0.65, 0.95]),
  }),
  water: Object.freeze([0.2, 0.31, 0.42]),
  river: ICE,
  cloud: Object.freeze([0.9, 0.92, 0.96, 1]),
  farIsland: Object.freeze([0.6, 0.65, 0.7]),
  farIslandDark: Object.freeze([0.48, 0.53, 0.58]),
  rock: Object.freeze([0.45, 0.47, 0.5]),
  sand: Object.freeze([0.8, 0.86, 0.92]),
  seaFloor: Object.freeze([0.18, 0.26, 0.32]),
  palette: WINTER_PALETTE,
  models: winterModels,
  /** The roadside crowd becomes clapping penguins; the scarf takes the per-person tint. */
  people: Object.freeze({ model: buildPenguin, motion: "clap", tint: true }),
  terrainColor,
  flora: Object.freeze({
    /** Sparse under the snow: fewer trees than summer, no flowers at all. */
    density: Object.freeze({ trees: 230, tufts: 700, flowers: 0, elsewhere: 0.4 }),
    tree: plantTree,
    tuft: plantTuft,
    flower: plantFlower,
  }),
});
