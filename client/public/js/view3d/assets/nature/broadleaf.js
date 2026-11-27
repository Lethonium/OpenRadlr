/**
 * The leafy trees: round broadleaf, the columnar roadside poplar, birch and
 * the dark Mediterranean cypress. Restyled from the reference's
 * `tree-broadleaf.js`; the shapes became frozen tables, the palettes are per
 * season and the winter crowns are bare twigs.
 */
import { crownTree } from "./crown.js";
import { deepFreeze } from "../geom.js";

const LEAVES = {
  spring: ["#5a8f38", "#4d8233", "#6a9b40", "#447a2e", "#76a446"],
  summer: ["#5f8a34", "#6d943a", "#557f30"],
  autumn: ["#d07a2c", "#b8482a", "#e0aa3c", "#c48a32", "#a85a2a", "#d99436"],
  winter: null,
};

const column = (ys, radius) => ys.map((y, i) => ({ x: Math.sin(i * 2.1) * 0.25, y, z: Math.cos(i * 1.7) * 0.25, r: radius(i) }));

const ROUND = {
  seed: 21,
  clusters: [{ x: 0, y: 4.5, z: 0, r: 2.0 }, { x: 1.1, y: 3.9, z: 0.5, r: 1.5 }, { x: -1.0, y: 4.0, z: -0.45, r: 1.45 }, { x: 0.2, y: 5.7, z: -0.2, r: 1.3 }, { x: -0.35, y: 4.3, z: 1.15, r: 1.25 }, { x: 0.6, y: 4.8, z: -1.0, r: 1.1 }],
  trunkHeight: 3.4,
  trunkRadius: [0.2, 0.38],
  bark: "#5e4330",
  branches: [[[0, 2.6, 0], [0.9, 3.8, 0.4], 0.11], [[0, 2.9, 0], [-0.8, 3.9, -0.4], 0.1], [[0, 3.2, 0], [-0.2, 4.4, 0.9], 0.09], [[0, 3.3, 0], [0.5, 4.6, -0.8], 0.08]],
  card: [1.3, 2.0],
  density: 13,
  up: 0.5,
  palette: LEAVES,
  description: "Round leafy tree: trunk and branches, inner canopy, leaf cards. Green in spring and summer, turns in autumn, bare in winter.", // i18n-ok
};

const POPLAR = {
  seed: 22,
  clusters: column([3.6, 5.2, 6.8, 8.4, 10.0, 11.4, 12.6], (i) => 1.25 - Math.abs(i - 2.5) * 0.12),
  trunkHeight: 11,
  trunkRadius: [0.1, 0.28],
  bark: "#6b6052",
  card: [1.0, 1.5],
  density: 15,
  up: 0.25,
  palette: LEAVES,
  description: "Tall columnar tree for avenues and field edges.", // i18n-ok
};

const BIRCH = {
  seed: 23,
  clusters: [{ x: 0, y: 5.6, z: 0, r: 1.5 }, { x: 0.8, y: 4.8, z: 0.3, r: 1.1 }, { x: -0.7, y: 5.0, z: -0.3, r: 1.1 }, { x: 0.1, y: 6.8, z: 0.1, r: 0.9 }],
  trunkHeight: 6.4,
  trunkRadius: [0.1, 0.17],
  bark: "#e9e5dc",
  birch: true,
  card: [0.9, 1.4],
  density: 12,
  up: 0.25,
  palette: { spring: ["#8ab352", "#7ea84a", "#97bd5c"], summer: ["#78a64a", "#6c9a42", "#85b055"], autumn: ["#e2b23c", "#d9a030", "#c99a36"], winter: null },
  description: "Slim white-barked tree with light leaves, golden in autumn.", // i18n-ok
};

const CYPRESS = {
  seed: 24,
  clusters: [2.2, 3.4, 4.6, 5.8, 7.0, 8.1, 9.0].map((y, i) => ({ x: 0, y, z: 0, r: 0.95 - i * 0.09 })),
  trunkHeight: 2.5,
  trunkRadius: [0.08, 0.16],
  bark: "#4e3c2c",
  card: [0.7, 1.1],
  density: 22,
  up: 0.25,
  evergreen: true,
  palette: { spring: ["#2f4a2a", "#34512e", "#2a4326"], summer: ["#2f4a2a", "#34512e", "#2a4326"], autumn: ["#2f4a2a", "#34512e", "#2a4326"], winter: ["#2f4a2a", "#34512e", "#2a4326"] },
  description: "Dark Mediterranean column that stays green all year.", // i18n-ok
};

export const broadleaf = crownTree({ id: "broadleaf", name: "Broadleaf tree" }, deepFreeze(ROUND)); // i18n-ok
export const poplar = crownTree({ id: "poplar", name: "Poplar" }, deepFreeze(POPLAR)); // i18n-ok
export const birch = crownTree({ id: "birch", name: "Birch" }, deepFreeze(BIRCH)); // i18n-ok
export const cypress = crownTree({ id: "cypress", name: "Cypress" }, deepFreeze(CYPRESS)); // i18n-ok
