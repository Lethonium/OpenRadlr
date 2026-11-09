/**
 * The Living tier: an inhabited island on top of plain 3D, built with the
 * world and carried to the view as plain data.
 */

import { RIVER } from "../features.js";
import { seededRandom } from "../noise.js";
import { VERGE, roadHalfWidth } from "../world.js";
import { buildFences, buildHedges, buildOrchards, buildProps, buildWoods, treeBlocked } from "./dressing.js";
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
/** Nothing stands within this of a fork, so riders see the other road. */
const JUNCTION_SIGHT = 26;

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
export function planLiving({ terrain, biome, network, box, zonesOf, ordered, water, seed, junctions = [] }) {
  if (!livingEligible({ biome, network, box })) return null;
  const grid = groundGrid(terrain, box);
  const fields = buildFields(terrain, grid, { seed, sea: water, villages: villageLookup(ordered, zonesOf) });
  return { biome, box, grid, fields, terrain, zonesOf, ordered, water, seed, junctions, treeBlocked: (x, z) => treeBlocked(fields, x, z) };
}

/** Everything that places things on the land needs this. */
function livingContext(plan, { mesh, occupancy }) {
  const { terrain, junctions, grid, fields, biome, zonesOf, ordered, water, box, seed } = plan;
  const keepClear = (x, z, radius = 0) => {
    const near = terrain.index.nearest(x, z);
    if (near && near.distance < roadHalfWidth(near.sample.route.lanes) + VERGE + radius + 1) return true;
    if (terrain.riverDistance(x, z) < RIVER.halfWidth + RIVER.bank * 0.6 + radius) return true;
    if (occupancy.blocked(x, z, radius)) return true;
    return junctions.some(([px, pz]) => Math.hypot(px - x, pz - z) < JUNCTION_SIGHT + radius);
  };
  return { mesh, fields, grid, terrain, occupancy, keepClear, random: seededRandom(seed ^ 0x11fe), biome, zonesOf, ordered, water, box, seed };
}

/** Dresses the land and paints the ground map, once the world's buildings stand. */
export function finishLiving(plan, placed) {
  const { biome, box, grid, fields } = plan;
  const ctx = livingContext(plan, placed);
  const { budgets } = biome.living;
  buildWoods(ctx, budgets.woods);
  buildHedges(ctx, budgets.hedges);
  buildOrchards(ctx, budgets.orchards);
  buildFences(ctx, budgets.fences);
  buildProps(ctx, budgets.props);
  return { groundMap: paintGroundMap({ fields, grid, box, crops: biome.living.crops }), movers: [], models: {} };
}
