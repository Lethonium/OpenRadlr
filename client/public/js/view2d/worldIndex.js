/**
 * Everything the 2D views draw, indexed by position: the world scene's plan (trees, rows, scrub,
 * roadside, edges, houses, lamps, farms, landmarks), its cafés, crowd and arches, and the herds,
 * in buckets of 48 m. Coordinates are world x/z (z = -route y).
 */
import { EDGE_STRIDE } from "../world/plan/landUse.js";

const BUCKET = 48;
const TAU = Math.PI * 2;

/**
 * @typedef {{layer: string, id?: string, x: number, y: number, z: number, yaw?: number, s?: number,
 *   len?: number, w?: number, d?: number, facing?: number[], seed?: number, shirt?: number[], phase?: number, arms?: boolean}} Item
 */

const cell = (i, j) => `${i},${j}`;

/** @returns {{query(x0: number, z0: number, x1: number, z1: number, out?: Item[]): Item[]}} */
export function indexWorld(scene) {
  const cells = new Map();
  const add = (item) => {
    const key = cell(Math.floor(item.x / BUCKET), Math.floor(item.z / BUCKET));
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(item);
  };
  const plan = scene.plan;
  const addPoints = (group, layer) => {
    for (const [id, data] of Object.entries(group)) {
      for (let k = 0; k < data.length; k += 5) add({ layer, id, x: data[k], y: data[k + 1], z: data[k + 2], yaw: data[k + 3], s: data[k + 4] });
    }
  };
  addPoints(plan.trees, "tree");
  addPoints(plan.landRows, "row");
  addPoints(plan.scrub, "scrub");
  addPoints(plan.roadside, "roadside");
  for (const [id, data] of Object.entries(plan.landEdges)) {
    for (let k = 0; k < data.length; k += EDGE_STRIDE) add({ layer: "edge", id, x: data[k], y: data[k + 1], z: data[k + 2], yaw: data[k + 3], len: data[k + 4] });
  }
  for (const s of plan.settlements) {
    s.plots.forEach((p, i) => add({ layer: "house", id: s.houses, x: p.x, z: p.z, y: s.ground[i], yaw: p.yaw, w: p.width, d: p.depth, facing: p.facing, seed: i }));
    for (const l of s.lamps) add({ layer: "lamp", x: l.x, y: 0, z: l.z });
  }
  for (const f of plan.farms) add({ layer: "farm", id: f.style, x: f.x, y: f.y, z: f.z, yaw: f.yaw });
  for (const l of plan.landmarks) for (const m of l.members) add({ layer: "landmark", id: l.kind, x: m.x, y: m.y, z: m.z, yaw: m.yaw });
  for (const t of plan.turbines) add({ layer: "landmark", id: "turbine", x: t.x, y: t.y, z: t.z, yaw: t.yaw });
  for (const c of scene.cafeSites ?? []) add({ layer: "cafe", id: c.style, x: c.position[0], y: c.position[1], z: c.position[2], yaw: c.yaw });
  for (const p of scene.crowd?.people ?? []) add({ layer: "person", x: p.position[0], y: p.position[1], z: p.position[2], yaw: p.yaw, shirt: p.shirt, phase: p.phase, arms: p.armsUp });
  for (const a of scene.arches ?? []) add({ layer: "arch", id: "arch", x: a.position[0], y: a.position[1], z: a.position[2], yaw: a.yaw, w: a.halfWidth * 2 });
  const flamme = scene.furniture?.flammeRouge;
  if (flamme) add({ layer: "arch", id: "flammeRouge", x: flamme.position[0], y: flamme.position[1], z: flamme.position[2], yaw: flamme.yaw, w: flamme.halfWidth * 2 });
  for (const h of plan.fauna.herds) {
    for (let n = 0; n < h.count; n += 1) {
      const a = (n / h.count) * TAU + h.seed;
      const r = h.radius * 0.6 * ((n % 3) / 3 + 0.4);
      add({ layer: "animal", id: h.kind, x: h.x + Math.cos(a) * r, y: 0, z: h.z + Math.sin(a) * r, yaw: a });
    }
  }
  return {
    /** The items in the box, in bucket order, appended to `out`. */
    query(x0, z0, x1, z1, out = []) {
      for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i += 1) {
        for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j += 1) {
          const list = cells.get(cell(i, j));
          if (list) for (const item of list) out.push(item);
        }
      }
      return out;
    },
  };
}
