/**
 * Plans every settlement of the world: the map's hand-placed towns plus a village for each route-file village
 * zone that no map town covers. Each is laid out by `layoutSettlement`, given its region's house style and the
 * lowest ground under each house, and stamped on the built mask so woods, fields and verges keep off it.
 */
import { REGION_STYLE } from "../../regionKinds.js";
import { regionMix } from "../../regions.js";
import { resolveZones } from "../../zones.js";
import { stampBuilt } from "../masks.js";
import { layoutSettlement } from "./index.js";

const ZONE_REACH = 50; // metres a zone village reaches past its stretch

/**
 * @typedef {object} SettlementSpec
 * @property {string} id
 * @property {string} kind
 * @property {number[]} center world `[x, z]`
 * @property {number} radius
 * @property {number} seed
 */

/** The zone villages of `routes` as settlement specs, minus those whose centre lies in a map settlement. */
function zoneVillages(routes, settlements, seed) {
  const specs = [];
  for (const route of routes) {
    resolveZones(route).villages.forEach(({ from, to }, n) => {
      const p = route.positionAt((from + to) / 2);
      const center = [p.x, -p.y];
      if (settlements.some((s) => Math.hypot(center[0] - s.center[0], center[1] - s.center[1]) < s.radius)) return;
      specs.push({ id: `${route.id}:village:${n}`, kind: "village", center, radius: (to - from) / 2 + ZONE_REACH, seed });
    });
  }
  return specs;
}

/** The lowest terrain height under a plot's footprint (corners and centre). */
function lowestGround(terrain, plot) {
  const along = [-plot.facing[1], plot.facing[0]];
  let low = terrain.height(plot.x, plot.z);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    low = Math.min(low, terrain.height(plot.x + (along[0] * a * plot.width + plot.facing[0] * b * plot.depth) / 2, plot.z + (along[1] * a * plot.width + plot.facing[1] * b * plot.depth) / 2));
  }
  return low;
}

/** Marks a layout's plots, streets, square, quay and the big props as built. */
function stampSettlement(masks, layout) {
  for (const p of layout.plots) stampBuilt(masks, { x: p.x, z: p.z, width: p.width, depth: p.depth, yaw: Math.atan2(p.facing[0], -p.facing[1]) });
  for (const street of layout.streets) {
    if (street.existing) continue;
    for (let i = 1; i < street.points.length; i += 1) {
      const [a, b] = [street.points[i - 1], street.points[i]];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      stampBuilt(masks, { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, width: length + 1, depth: street.width + 2 * layout.pavement, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    }
  }
  const { square, quay } = layout;
  if (square) stampBuilt(masks, { x: square.center[0], z: square.center[1], width: square.width, depth: square.depth, yaw: Math.atan2(layout.frame.u[1], layout.frame.u[0]) });
  if (quay) stampBuilt(masks, { x: quay.x, z: quay.z, width: quay.length, depth: quay.width * 2, yaw: Math.atan2(quay.sea[0], -quay.sea[1]) });
  for (const prop of layout.props) if (prop.role === "church" || prop.role === "windmills") stampBuilt(masks, { x: prop.x, z: prop.z, width: prop.radius * 2, depth: prop.radius * 2, yaw: 0 });
}

/**
 * Plans the settlements and marks them on `masks` (the plan's one mutation).
 * @param {{settlements: SettlementSpec[], routes: object[], terrain: object, roads: import("../../roads.js").RoadIndex, regions: object[], seed: number, masks: import("../masks.js").Masks, water: number}} input
 * @returns {Array<ReturnType<typeof layoutSettlement> & {houses: string, ground: Float32Array}>}
 */
export function planSettlements({ settlements, routes, terrain, roads, regions, seed, masks, water }) {
  const ground = { height: (x, z) => terrain.height(x, z), seaLevel: water, riverDistance: terrain.riverDistance && ((x, z) => terrain.riverDistance(x, z)) };
  const network = [...new Set(roads.samples.map((s) => s.route))];
  return [...settlements, ...zoneVillages(routes, settlements, seed)].map((spec) => {
    const layout = layoutSettlement({ ...spec, terrain: ground, roads: network });
    const kind = regionMix(spec.center[0], spec.center[1], regions, seed)[0].kind;
    stampSettlement(masks, layout);
    return { ...layout, houses: REGION_STYLE[kind].houses, ground: Float32Array.from(layout.plots, (p) => lowestGround(terrain, p)) };
  });
}
