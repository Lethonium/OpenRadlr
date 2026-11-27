/**
 * The road as quads, pure: asphalt, gravel (or snow) verges, a ploughed bank
 * with its ruts, edge lines and dashed lane dividers, and the round pads
 * where roads of a network meet. The same samples, widths, heights and
 * clear/skip rules the road was always drawn with; only the drawing changed
 * (a layer turns the quads into meshes, see view3d/scene/roadLayer.js).
 */
import { JUNCTION_LIFT, LANE_WIDTH, ROAD_LIFT, VERGE, roadFrame, roadHalfWidth } from "../roads.js";
import { seededRandom } from "../noise.js";
import { add, scale } from "../vec.js";
import { createStrips, mergeStrips } from "./strips.js";

/** What a quad is, for colouring and for the draw order. */
export const ROAD_KIND = Object.freeze({ asphalt: 0, verge: 1, marking: 2, bank: 3, rut: 4, edge: 5, pavement: 6 });
/** Metres of road per texture tile. */
export const TILE = 12;

const tile = (along, across) => [along / TILE, across / TILE];

/**
 * One road's quads. `skip(d)` leaves out stretches another road already
 * drew; `bankAt(x, z)` (0..1) flattens a season's ploughed bank near
 * junctions, where lines also stop; `bank` ({height}) raises snow shoulders
 * and `rut` ({width}) wears two ruts per lane.
 * @param {import("../../route/geometry.js").RouteGeometry} route
 * @param {{step?: number, markingStep?: number, lift?: number, skip?: (d: number) => boolean,
 *   bankAt?: ((x: number, z: number) => number) | null, bank?: {height: number} | null, rut?: {width: number} | null}} [options]
 * @returns {import("./strips.js").Strips}
 */
export function roadStrips(route, { step = 4, markingStep = 3, lift = ROAD_LIFT.ridden, skip = () => false, bankAt = null, bank = null, rut = null } = {}) {
  const strips = createStrips();
  const half = roadHalfWidth(route.lanes);
  const laneEdge = (route.lanes * LANE_WIDTH) / 2;
  const random = seededRandom((route.seed >>> 0) ^ 0xa5f);
  const edgeAt = (frame, offset, extra = 0) => add(add(frame.center, scale(frame.right, offset)), [0, lift + extra, 0]);
  const shoulder = (k) => (bank ? -0.2 + (bank.height + 0.2) * k : -0.2);
  const ploughed = (frame) => (bankAt ? bankAt(frame.center[0], frame.center[2]) : 1);

  const count = Math.ceil(route.length / step);
  for (let i = 0; i < count; i += 1) {
    // Slight per-segment variation reads as patched asphalt.
    const shade = 0.97 + random() * 0.06;
    const [d0, d1] = [i * step, Math.min(route.length, (i + 1) * step)];
    if (skip(d0) && skip(d1)) continue;
    const f0 = roadFrame(route, d0);
    const f1 = roadFrame(route, d1);
    strips.quad([edgeAt(f0, -half), edgeAt(f0, half), edgeAt(f1, half), edgeAt(f1, -half)], {
      kind: ROAD_KIND.asphalt,
      shade,
      uv: [tile(d0, -half), tile(d0, half), tile(d1, half), tile(d1, -half)],
    });
    // Gravel verge on both sides, sloping into the grass; in winter a raised snow shoulder closing into a ploughed bank.
    const bank0 = bank ? ploughed(f0) : 0;
    const bank1 = bank ? ploughed(f1) : 0;
    const drop0 = shoulder(bank0);
    const drop1 = shoulder(bank1);
    for (const side of [-1, 1]) {
      const inner = side * half;
      const outer = side * (half + VERGE);
      const corners = [edgeAt(f0, inner, -0.03), edgeAt(f0, outer, drop0), edgeAt(f1, outer, drop1), edgeAt(f1, inner, -0.03)];
      strips.quad(corners, { kind: ROAD_KIND.verge, uv: [tile(d0, inner), tile(d0, outer), tile(d1, outer), tile(d1, inner)] });
      if (bank && (bank0 > 0 || bank1 > 0)) {
        // Close the shoulder down to the ground so the bank has a face.
        strips.quad([edgeAt(f0, outer, drop0), edgeAt(f1, outer, drop1), edgeAt(f1, outer, -0.5), edgeAt(f0, outer, -0.5)], {
          kind: ROAD_KIND.bank,
          uv: [tile(d0, 0), tile(d1, 0), tile(d1, 1), tile(d0, 1)],
          facing: scale(f0.right, side),
        });
      }
    }
    // Two darker ruts per lane, worn through the snow.
    if (rut) {
      for (let lane = 0; lane < route.lanes; lane += 1) {
        const offset = -laneEdge + (lane + 0.5) * LANE_WIDTH;
        const at = (f, o) => edgeAt(f, o, 0.005);
        strips.quad([at(f0, offset - rut.width / 2), at(f0, offset + rut.width / 2), at(f1, offset + rut.width / 2), at(f1, offset - rut.width / 2)], {
          kind: ROAD_KIND.rut,
          uv: [tile(d0, 0), tile(d0, 1), tile(d1, 1), tile(d1, 0)],
        });
      }
    }
  }

  // Edge lines (solid) and lane dividers (dashed, one step on, one off).
  const stripe = (offset, width, dashed, kind) => {
    for (let d = 0; d < route.length; d += markingStep) {
      if (dashed && Math.floor(d / markingStep) % 2 === 1) continue;
      const end = Math.min(route.length, d + markingStep);
      if (skip(d) && skip(end)) continue;
      const f0 = roadFrame(route, d);
      const f1 = roadFrame(route, end);
      // Lines stop at a junction instead of running across the other road.
      if (bankAt && (!ploughed(f0) || !ploughed(f1))) continue;
      const at = (f, o) => edgeAt(f, o, ROAD_LIFT.marking);
      strips.quad([at(f0, offset - width / 2), at(f0, offset + width / 2), at(f1, offset + width / 2), at(f1, offset - width / 2)], {
        kind,
        uv: [tile(d, 0), tile(d, 1), tile(end, 1), tile(end, 0)],
      });
    }
  };
  stripe(-laneEdge, 0.12, false, ROAD_KIND.edge);
  stripe(laneEdge, 0.12, false, ROAD_KIND.edge);
  for (let lane = 1; lane < route.lanes; lane += 1) stripe(-laneEdge + lane * LANE_WIDTH, 0.1, true, ROAD_KIND.marking);
  return strips.build();
}

/**
 * A round asphalt pad at every node of `network` where two or more roads
 * meet, under the roads (they keep their markings on top).
 * @param {import("../../route/network.js").RoadNetwork} network
 * @param {{lanes?: number, sides?: number}} [options]
 * @returns {import("./strips.js").Strips}
 */
export function junctionPads(network, { lanes = 4, sides = 20 } = {}) {
  const degree = new Map();
  for (const road of network.roads()) for (const id of [road.edge.from, road.edge.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const radius = roadHalfWidth(lanes) + 0.3;
  const pads = [];
  for (const node of network.nodes.values()) {
    if ((degree.get(node.id) ?? 0) < 2) continue;
    const strips = createStrips();
    const center = [node.x, node.elevation + JUNCTION_LIFT, -node.y];
    const at = (k) => {
      const a = (k / sides) * 2 * Math.PI;
      return [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius];
    };
    const uv = (p) => tile(p[0], p[2]);
    // Two sectors per quad: centre, rim, rim, rim (convex).
    for (let k = 0; k < sides; k += 2) {
      const corners = [center, at(k), at(k + 1), at(k + 2)];
      strips.quad(corners, { kind: ROAD_KIND.asphalt, uv: corners.map(uv) });
    }
    pads.push(strips.build());
  }
  return mergeStrips(pads);
}
