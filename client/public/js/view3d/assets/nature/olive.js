/**
 * The olive tree of the dry coast: a short twisted trunk and silver leaves, green all year. New in this renderer (no reference file).
 */
import { crownTree } from "./crown.js";
import { deepFreeze } from "./geom.js";

const same = (colours) => ({ spring: colours, summer: colours, autumn: colours, winter: colours });

const OLIVE = {
  seed: 31,
  clusters: [{ x: 0, y: 2.7, z: 0, r: 1.5 }, { x: 0.95, y: 2.2, z: 0.4, r: 1.1 }, { x: -0.85, y: 2.3, z: -0.4, r: 1.1 }, { x: 0.2, y: 3.3, z: -0.2, r: 0.9 }, { x: -0.2, y: 2.4, z: 0.9, r: 0.85 }],
  trunkHeight: 1.7,
  trunkRadius: [0.17, 0.36],
  bark: "#6d5f4c",
  branches: [[[0.05, 1.2, 0], [0.8, 2.3, 0.3], 0.13], [[-0.05, 1.3, 0], [-0.7, 2.4, -0.3], 0.12], [[0, 1.4, 0], [0.1, 2.9, 0.2], 0.11]],
  card: [0.7, 1.1],
  density: 20,
  up: 0.4,
  slender: 0.3,
  evergreen: true,
  palette: same(["#8c9a6a", "#7c8c5f", "#98a574"]),
  description: "Gnarled olive with a short twisted trunk and silver-green leaves, green all year.", // i18n-ok
};

export const olive = crownTree({ id: "olive", name: "Olive" }, deepFreeze(OLIVE)); // i18n-ok
