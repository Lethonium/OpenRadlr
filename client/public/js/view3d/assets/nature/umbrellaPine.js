/**
 * The stone pine of the Mediterranean coast: a long bare trunk under a flat green dome. New in this renderer (no reference file).
 */
import { crownTree } from "./crown.js";
import { deepFreeze } from "./geom.js";

const same = (colours) => ({ spring: colours, summer: colours, autumn: colours, winter: colours });

const UMBRELLA_PINE = {
  seed: 32,
  clusters: [{ x: 0.3, y: 8.2, z: 0, r: 2.6 }, { x: 2.3, y: 7.6, z: 0.6, r: 1.8 }, { x: -2.1, y: 7.7, z: -0.7, r: 1.8 }, { x: 0.4, y: 7.5, z: 2.3, r: 1.7 }, { x: -0.5, y: 7.7, z: -2.2, r: 1.7 }],
  trunkHeight: 7,
  trunkRadius: [0.2, 0.4],
  bark: "#7a5a3c",
  branches: [[[0, 5.5, 0], [2.1, 7.4, 0.5], 0.12], [[0, 5.8, 0], [-1.9, 7.5, -0.6], 0.12], [[0, 6.0, 0], [0.3, 7.5, 2.0], 0.1]],
  card: [1.2, 1.8],
  density: 10,
  up: 0.6,
  squash: 0.45,
  slender: 0.45,
  evergreen: true,
  palette: same(["#3d5a2e", "#46662f", "#35522a"]),
  description: "Mediterranean stone pine: a long bare trunk and a flat green dome.", // i18n-ok
};

export const umbrellaPine = crownTree({ id: "umbrellaPine", name: "Umbrella pine" }, deepFreeze(UMBRELLA_PINE)); // i18n-ok
