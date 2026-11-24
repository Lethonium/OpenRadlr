/**
 * The plan of the island's plants: trees per region, crop fields, the verge,
 * and the masks they were placed against. A pure, seeded function of the
 * terrain, roads, rivers, regions, season and detail level; it runs in the
 * world worker and returns typed arrays that transfer without copying.
 */
import { waterLevel } from "../roads.js";
import { planFields } from "./fields.js";
import { planLandmarks } from "./landmarks.js";
import { buildMasks } from "./masks.js";
import { planRoadside } from "./roadside.js";
import { planSettlements } from "./settlements/plan.js";
import { planWoods } from "./woods.js";

/** Most trees and roadside items per detail level (the quality levels' names). */
export const PLAN_BUDGET = Object.freeze({
  low: Object.freeze({ trees: 6000, roadside: 4000 }),
  medium: Object.freeze({ trees: 14000, roadside: 9000 }),
  high: Object.freeze({ trees: 26000, roadside: 16000 }),
  ultra: Object.freeze({ trees: 40000, roadside: 24000 }),
});

/**
 * @typedef {object} WorldPlan
 * @property {Record<string, Float32Array>} trees per plant id: x, y, z, yaw, scale for each tree (`forests` are points along the route's forest stretches, wooded densely)
 * @property {import("./fields.js").Field[]} fields
 * @property {Record<string, Float32Array>} roadside per plant or prop id, like `trees`
 * @property {ReturnType<typeof planSettlements>} settlements towns, villages and harbours: plots, streets, props
 * @property {import("./landmarks.js").Landmark[]} landmarks
 * @property {import("./masks.js").Masks} masks 0 free, 1 road, 2 river, 3 field, 4 verge, 5 built
 */

/**
 * @param {{terrain: object, roads: import("../roads.js").RoadIndex, rivers: object[], regions?: object[], forests?: {x: number, z: number}[], settlements?: object[], landmarks?: object[], routes?: object[], seed: number, season: string, detail?: "low"|"medium"|"high"|"ultra", bounds: {x0: number, z0: number, x1: number, z1: number}}} input
 * @returns {WorldPlan}
 */
export function planWorld({ terrain, roads, rivers, regions = [], forests = [], settlements = [], landmarks = [], routes = [], seed, season, detail = "high", bounds }) {
  const budget = PLAN_BUDGET[detail];
  if (!budget) throw new Error(`Unknown detail level "${detail}"`);
  const water = waterLevel(roads);
  const masks = buildMasks({ roads, rivers, bounds });
  const villages = planSettlements({ settlements, routes, terrain, roads, regions, seed, masks, water });
  const places = planLandmarks({ landmarks, terrain, roads, seed, masks, water });
  const fields = planFields({ terrain, roads, regions, seed, season, masks, water });
  const trees = planWoods({ terrain, roads, regions, forests, seed, bounds, masks, water, budget: budget.trees });
  const roadside = planRoadside({ terrain, roads, regions, seed, masks, water, budget: budget.roadside });
  return { trees, fields, roadside, settlements: villages, landmarks: places, masks };
}
