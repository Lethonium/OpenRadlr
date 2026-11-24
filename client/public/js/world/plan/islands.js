/**
 * Far-off islands on the horizon, out at sea around the map's island: a few hazy rocky hills, some in small
 * groups. Pure and seeded; the layer builds the humps from this data.
 */
import { seededRandom } from "../noise.js";
import { waterLevel } from "../roads.js";

export const ISLANDS = Object.freeze({ count: 11, distance: 1300, spread: 2400, fallbackCoast: 1500 });

/**
 * @typedef {object} FarIsland
 * @property {number} x
 * @property {number} z
 * @property {number} radius
 * @property {number} height above the sea
 * @property {number} squash depth of the hump's far axis against its radius, 0.55 to 0.95
 * @property {number} turn rotation of the hump
 * @property {boolean} dark the darker of the two palette colours
 * @property {number|null} peakTurn rotation of the rocky top on a tall hill, else null
 */

/**
 * @param {{terrain: {seed?: number, seaLevel?: number, island?: {center: number[], radiusAt: (angle: number) => number}, index: import("../roads.js").RoadIndex}, seed?: number, count?: number, distance?: number}} input
 * @returns {Array<FarIsland & {sea: number}>}
 */
export function planFarIslands({ terrain, seed = terrain.seed ?? 0, count = ISLANDS.count, distance = ISLANDS.distance }) {
  const random = seededRandom(seed ^ 0x3a7);
  const island = terrain.island;
  const [cx, cz] = island?.center ?? terrain.index.center;
  const sea = terrain.seaLevel ?? waterLevel(terrain.index);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + random() * 0.6) / count) * Math.PI * 2;
    const coast = island ? island.radiusAt(angle) : ISLANDS.fallbackCoast;
    const far = coast + distance + random() * ISLANDS.spread;
    const hills = 1 + Math.floor(random() * 3);
    for (let h = 0; h < hills; h += 1) {
      const height = (h === 0 ? 120 : 50) + random() * (h === 0 ? 260 : 110);
      const radius = height * (1.6 + random() * 0.8);
      const a = angle + (random() - 0.5) * 0.08;
      const d = far + radius + random() * 300;
      const dark = random() >= 0.5;
      const squash = 0.55 + random() * 0.4;
      const turn = random() * Math.PI;
      const peakTurn = height > 220 ? random() * Math.PI : null;
      out.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, radius, height, squash, turn, dark, peakTurn, sea });
    }
  }
  return out;
}
