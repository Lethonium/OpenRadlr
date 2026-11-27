/**
 * House plots: both sides of every street, walked at a house's width plus a gap. A plot that lands on another
 * street, the square, a crossing road, a river or the water is left out; the block simply has a garden there.
 * Random numbers are drawn frontage by frontage, slot by slot, whether or not the plot fits.
 */
import { RIVER } from "../../rivers.js";
import { RIVER_MARGIN } from "../masks.js";
import { add2, distanceToLine, groundRange, length2, normalize2, perp2, scale2, sliceFrontage, sub2 } from "./lines.js";

const RIVER_CLEAR = RIVER.halfWidth + RIVER_MARGIN + 12; // past the river mask's reach (sample step and cell)
const CELL = 2; // metres of the local grid that keeps two frontages' footprints apart

/** True when (x, z) lies on or near the square (local frame), `margin` metres out. */
function inSquare(ctx, square, x, z, margin = 2) {
  if (!square) return false;
  const p = ctx.toLocal(x, z);
  return p[0] > square.a0 - margin && p[0] < square.a1 + margin && p[1] > square.b0 - margin && p[1] < square.b1 + margin;
}

/**
 * Any road of the network, not just this layout's streets: a road that crosses the town must not run into a
 * house. The rectangle is the plot's own footprint, so a plot next to the road is judged by its near edge.
 */
function onRoad(surface, x, z, facing, width, depth) {
  const along = perp2(facing);
  const reach = Math.hypot(width, depth) / 2;
  for (const s of surface) {
    const dx = s.x - x;
    const dz = s.z - z;
    if (Math.abs(dx) > reach + s.clear || Math.abs(dz) > reach + s.clear) continue;
    const a = Math.max(Math.abs(dx * along[0] + dz * along[1]) - width / 2, 0);
    const b = Math.max(Math.abs(dx * facing[0] + dz * facing[1]) - depth / 2, 0);
    if (Math.hypot(a, b) < s.clear) return true;
  }
  return false;
}

/**
 * @param {import("./streets.js").Frame} ctx
 * @param {{streets: object[], square: object|null, surface: {x: number, z: number, clear: number}[]}} layout
 * @param {() => number} random
 * @returns {object[]} `{x, z, yaw, facing, width, depth, front, street, side}`
 */
export function layoutPlots(ctx, { streets, square, surface }, random) {
  const { style, terrain, toLocal, clearings = [] } = ctx;
  const plots = [];
  const occupied = new Set();
  const nearStreet = (x, z, margin) => streets.some((street) => distanceToLine(x, z, street.points) < street.width / 2 + margin);
  const footprint = (x, z, facing, width, depth) => {
    const along = perp2(facing);
    const corners = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([a, b]) =>
      toLocal(x + along[0] * a + facing[0] * b, z + along[1] * a + facing[1] * b));
    const xs = corners.map((p) => p[0]);
    const zs = corners.map((p) => p[1]);
    return { a0: Math.floor(Math.min(...xs) / CELL), a1: Math.floor(Math.max(...xs) / CELL), b0: Math.floor(Math.min(...zs) / CELL), b1: Math.floor(Math.max(...zs) / CELL) };
  };
  const eachCell = (box, visit) => {
    for (let a = box.a0; a <= box.a1; a += 1) for (let b = box.b0; b <= box.b1; b += 1) if (visit(`${a},${b}`) === false) return false;
    return true;
  };
  // A plot's corners reach hypot(width, depth) / 2 from its centre: none may come within a clearing's radius.
  const clear = (x, z, width, depth) => !clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius + Math.hypot(width, depth) / 2);
  const sea = terrain?.seaLevel ?? -Infinity;
  const dry = (x, z, width, depth, ground) => {
    if (terrain && ground.low < sea + 2) return false;
    const river = terrain?.riverDistance?.(x, z);
    return !(river !== undefined && river < RIVER_CLEAR + Math.hypot(width, depth) / 2);
  };

  const placeAlong = (street, side) => {
    const points = street.points;
    if (points.length < 2) return;
    let carry = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const segment = sub2(points[i], a);
      const length = length2(segment);
      if (length < 0.01) continue;
      const dir = normalize2(segment);
      const normal = perp2(dir);
      let at = carry;
      while (at < length) {
        const slot = style.plotWidth[0] + random() * (style.plotWidth[1] - style.plotWidth[0]);
        const depth = style.plotDepth[0] + random() * (style.plotDepth[1] - style.plotDepth[0]);
        const width = Math.min(slot, length - at);
        if (width < 5) break;
        const station = add2(a, scale2(dir, at + width / 2));
        const front = street.width / 2 + style.pavement + style.garden;
        const [x, z] = add2(station, scale2(normal, side * (front + depth / 2)));
        const facing = scale2(normal, -side);
        const ground = groundRange(terrain, x, z, Math.max(width, depth));
        const box = footprint(x, z, facing, width, depth);
        const fits = dry(x, z, width, depth, ground) && clear(x, z, width, depth) && !nearStreet(x, z, 1.4) && !inSquare(ctx, square, x, z)
          && !onRoad(surface, x, z, facing, width, depth) && eachCell(box, (key) => !occupied.has(key))
          && (ground.slope < (style.maxSlope ?? 0.35) || !terrain);
        if (fits) {
          eachCell(box, (key) => { occupied.add(key); });
          plots.push({ x, z, yaw: Math.atan2(-facing[0], -facing[1]), facing, width, depth, front, street: street.id, side });
        }
        at += width + style.gap[0] + random() * (style.gap[1] - style.gap[0]);
      }
      carry = at - length;
    }
  };
  for (const street of streets) {
    if (street.houses === false) continue;
    if (!style.mainHouses && street.existing) continue;
    // A village's main road only carries houses around its centre, so it reads as a cluster, not a strip.
    const frontage = street.frontage !== undefined && street.frontage < 1 ? { ...street, points: sliceFrontage(street.points, street.frontage) } : street;
    placeAlong(frontage, 1);
    placeAlong(frontage, -1);
  }
  return plots;
}
