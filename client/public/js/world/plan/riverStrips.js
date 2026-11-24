/**
 * Rivers as ribbons, pure: one strip along each river's water surface, a
 * disc for every pond, and (frozen rivers) the snow patches and cracks lying
 * on the ice. The path and the surface heights come from `buildRiverPath`;
 * the water shader that flows over the ribbon is in view3d/scene/riverLayer.js.
 */
import { RIVER } from "../rivers.js";
import { seededRandom } from "../noise.js";
import { createStrips } from "./strips.js";

/** Ribbon half width: the river plus a margin for its banks. */
export const RIBBON_HALF = RIVER.halfWidth + 1.5;
/** How far the ribbon floats over the surface height (against z-fighting with the carved bed). */
export const RIBBON_LIFT = 0.05;
/** Texture metres per unit of v. */
const FLOW_TILE = 10;
/** Ice patch kinds. */
export const ICE_KIND = Object.freeze({ snow: 0, crack: 1 });
const POND_SIDES = 16;

/**
 * @typedef {object} RiverStrips
 * @property {Float32Array} positions
 * @property {Float32Array} uvs u across 0..1, v the distance along the flow in tiles (grows downhill)
 * @property {Float32Array} flow 0..1 how steeply the water falls here (rapids)
 * @property {Uint32Array} indices
 * @property {import("./strips.js").Strips} ice
 */

/**
 * @param {{at?: number, points: {x: number, z: number, surface: number}[], ponds: {x: number, z: number, surface: number, radius: number}[]}[]} rivers
 * @param {{ice?: {cover: number} | null} | null} [style] frozen rivers get patches
 * @returns {RiverStrips}
 */
export function riverStrips(rivers, style = null) {
  const positions = [];
  const uvs = [];
  const flow = [];
  const indices = [];
  const vertex = (x, y, z, u, v, steep) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    flow.push(steep);
    return positions.length / 3 - 1;
  };
  for (const river of rivers) {
    const { points } = river;
    const downhill = points.length < 2 || points[0].surface >= points[points.length - 1].surface ? 1 : -1;
    let along = 0;
    points.forEach((p, i) => {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const side = [(-(b.z - a.z) / length) * RIBBON_HALF, ((b.x - a.x) / length) * RIBBON_HALF];
      if (i > 0) along += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
      const y = p.surface + RIBBON_LIFT;
      // Steepness from the fall over the neighbouring samples.
      const fall = (a.surface - b.surface) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
      const steep = Math.min(1, Math.max(0, (Math.abs(fall) * 4 - 0.35) * 1.6));
      const v = (downhill > 0 ? along : -along) / FLOW_TILE;
      const left = vertex(p.x - side[0], y, p.z - side[1], 0, v, steep);
      vertex(p.x + side[0], y, p.z + side[1], 1, v, steep);
      if (i > 0) indices.push(left - 2, left, left - 1, left - 1, left, left + 1);
    });
    for (const pond of river.ponds ?? []) {
      const centre = vertex(pond.x, pond.surface + RIBBON_LIFT, pond.z, 0.5, 0.5, 0);
      for (let k = 0; k <= POND_SIDES; k += 1) {
        const angle = (k / POND_SIDES) * Math.PI * 2;
        const r = pond.radius + 2;
        const x = pond.x + Math.cos(angle) * r;
        const z = pond.z + Math.sin(angle) * r;
        vertex(x, pond.surface + RIBBON_LIFT, z, 0.5 + 0.5 * Math.cos(angle), (x + z) / FLOW_TILE, 0);
        if (k > 0) indices.push(centre, centre + k + 1, centre + k);
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
    flow: Float32Array.from(flow),
    indices: Uint32Array.from(indices),
    ice: style?.ice ? iceStrips(rivers, style.ice) : createStrips().build(),
  };
}

/** Snow patches and cracks lying on top of frozen rivers and their ponds. */
function iceStrips(rivers, ice) {
  const strips = createStrips();
  for (const river of rivers) {
    const random = seededRandom((Math.round((river.at ?? 0) * 1000) ^ 0x1ce) >>> 0);
    const { points } = river;
    for (let i = 0; i + 1 < points.length; i += 1) {
      if (random() >= ice.cover) continue;
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1) continue;
      const side = [-dz / length, dx / length];
      const half = RIVER.halfWidth * (0.35 + random() * 0.35);
      const offset = (random() - 0.5) * 2 * Math.max(0, RIBBON_HALF - half - 0.5);
      const t0 = 0.1 + random() * 0.15;
      const t1 = 0.68 + random() * 0.22;
      const at = (t, lateral) => [a.x + dx * t + side[0] * (offset + lateral), a.surface + (b.surface - a.surface) * t + 0.04, a.z + dz * t + side[1] * (offset + lateral)];
      const uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
      strips.quad([at(t0, -half), at(t1, -half), at(t1, half), at(t0, half)], { kind: ICE_KIND.snow, uv });
      if (ice.crack && random() < 0.45) {
        const c0 = at(t0 + (t1 - t0) * 0.15, -half * 0.35);
        const c1 = at(t1 - (t1 - t0) * 0.15, half * 0.25);
        const w = 0.08;
        const lift = (p) => [p[0], p[1] + 0.01, p[2]];
        strips.quad([lift([c0[0] - side[0] * w, c0[1], c0[2] - side[1] * w]), lift([c0[0] + side[0] * w, c0[1], c0[2] + side[1] * w]), lift([c1[0] + side[0] * w, c1[1], c1[2] + side[1] * w]), lift([c1[0] - side[0] * w, c1[1], c1[2] - side[1] * w])], { kind: ICE_KIND.crack, uv });
      }
    }
  }
  return strips.build();
}
