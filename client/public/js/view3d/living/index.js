/**
 * The Living tier: an inhabited island on top of plain 3D, built with the
 * world and carried to the view as plain data.
 */

import { buildFields, groundGrid } from "./fields.js";
import { paintGroundMap } from "./groundMap.js";

/** One 2048² ground map stays finer than 8 m per pixel only up to this box. */
export const LIVING_MAX_BOX_M = 16000;

/** Living needs a biome that has a look for it, a road network and an island that fits one map. */
export function livingEligible({ biome, network, box }) {
  if (!biome?.living || !network) return false;
  return box.x1 - box.x0 <= LIVING_MAX_BOX_M && box.z1 - box.z0 <= LIVING_MAX_BOX_M;
}

/** Grid cell (metres) of the village lookup, and how far around a village street its gardens reach. */
const VILLAGE_CELL = 64;
const VILLAGE_REACH = 120;

/** Whether a point is in or beside any village of the map. */
function villageLookup(ordered, zonesOf) {
  const cells = new Set();
  const key = (i, j) => i * 100003 + j;
  const span = Math.ceil(VILLAGE_REACH / VILLAGE_CELL);
  for (const road of ordered) {
    for (const village of zonesOf.get(road).villages) {
      for (let d = village.from; d <= village.to; d += VILLAGE_CELL / 2) {
        const { x, y } = road.positionAt(d);
        const ci = Math.floor(x / VILLAGE_CELL);
        const cj = Math.floor(-y / VILLAGE_CELL);
        for (let j = -span; j <= span; j += 1) for (let i = -span; i <= span; i += 1) cells.add(key(ci + i, cj + j));
      }
    }
  }
  return (x, z) => cells.has(key(Math.floor(x / VILLAGE_CELL), Math.floor(z / VILLAGE_CELL)));
}

/**
 * Lays out the island's land, before anything is placed on it. Null when
 * Living does not apply here, and the world then builds as plain 3D.
 */
export function planLiving({ terrain, biome, network, box, zonesOf, ordered, water, seed }) {
  if (!livingEligible({ biome, network, box })) return null;
  const grid = groundGrid(terrain, box);
  const fields = buildFields(terrain, grid, { seed, sea: water, villages: villageLookup(ordered, zonesOf) });
  return { biome, box, grid, fields };
}

/** Paints the ground map, once everything that adds to it is known. */
export function finishLiving(plan) {
  const { biome, box, grid, fields } = plan;
  return { groundMap: paintGroundMap({ fields, grid, box, crops: biome.living.crops }), movers: [], models: {} };
}
