/**
 * The almond tree: pink blossom in spring, green in summer, bare in winter. New in this renderer (no reference file).
 */
import { crownTree } from "./crown.js";
import { deepFreeze } from "../geom.js";

const ALMOND = {
  seed: 33,
  clusters: [{ x: 0, y: 3.4, z: 0, r: 1.6 }, { x: 1.0, y: 2.9, z: 0.4, r: 1.15 }, { x: -0.9, y: 3.0, z: -0.4, r: 1.1 }, { x: 0.2, y: 4.2, z: -0.1, r: 0.95 }],
  trunkHeight: 2.4,
  trunkRadius: [0.12, 0.26],
  bark: "#5a4636",
  branches: [[[0, 1.9, 0], [0.8, 3.0, 0.3], 0.09], [[0, 2.1, 0], [-0.7, 3.1, -0.3], 0.08], [[0, 2.2, 0], [0.1, 3.7, 0.1], 0.08]],
  card: [0.8, 1.3],
  density: 16,
  up: 0.4,
  palette: { spring: ["#f6d3dd", "#f0bccb", "#fbe3ea", "#f3c6d4"], summer: ["#7f9a4a", "#8aa352", "#729040"], autumn: ["#b3a14c", "#c4a23f", "#9c9040"], winter: null },
  description: "Almond tree that blossoms pink in spring, green in summer, bare in winter.", // i18n-ok
};

export const almond = crownTree({ id: "almond", name: "Almond" }, deepFreeze(ALMOND)); // i18n-ok
