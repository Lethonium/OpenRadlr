/**
 * The small 2D helpers a settlement layout needs: vectors in the ground plane (`[x, z]`), polylines, the road
 * nearest a point and the ground under a footprint. Pure.
 */
import { roadHalfWidth } from "../../roads.js";

/** A stable 32-bit hash of a settlement id. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const length2 = (v) => Math.hypot(v[0], v[1]);
export const normalize2 = (v) => {
  const l = length2(v) || 1;
  return [v[0] / l, v[1] / l];
};
export const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (v, k) => [v[0] * k, v[1] * k];
export const perp2 = (v) => [-v[1], v[0]];

/**
 * The nearest road sample to a point, and the road's local frame there.
 * @param {import("../../../route/geometry.js").RouteGeometry[]} roads
 * @returns {{road: object, d: number, x: number, z: number, dist: number, u: number[], v: number[]} | null}
 */
export function nearestRoad(roads, x, z) {
  let best = null;
  for (const road of roads) {
    for (let d = 0; d < road.length; d += 6) {
      const p = road.positionAt(d);
      const dx = p.x - x;
      const dz = -p.y - z;
      const squared = dx * dx + dz * dz;
      if (!best || squared < best.squared) best = { road, d, squared, x: p.x, z: -p.y };
    }
  }
  if (!best) return null;
  const a = best.road.positionAt(best.d);
  const b = best.road.positionAt(Math.min(best.road.length, best.d + 10));
  const u = normalize2([b.x - a.x, -(b.y - a.y)]);
  return { ...best, dist: Math.sqrt(best.squared), u, v: perp2(u) };
}

/** A polyline sampled between two local points. */
export function line(local, a, b, step = 8) {
  const points = [];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const count = Math.max(2, Math.ceil(length / step));
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push(local(a[0] + dx * t, a[1] + dz * t));
  }
  return points;
}

/** The middle `share` of a street's points: the part of a road a village lines. */
export function sliceFrontage(points, share) {
  if (share >= 1 || points.length < 3) return points;
  const first = Math.floor(((1 - share) / 2) * (points.length - 1));
  const last = Math.ceil(((1 + share) / 2) * (points.length - 1)) + 1;
  return points.slice(first, last);
}

/** The dry part of a street: a harbour's cross lane must not run into the sea. */
export function trimToLand(points, terrain) {
  const sea = terrain?.seaLevel;
  if (!Number.isFinite(sea) || points.length < 2) return points;
  const dry = points.map(([x, z]) => terrain.height(x, z) >= sea + 1.2);
  if (dry.every(Boolean)) return points;
  let best = { from: 0, to: -1 };
  let from = -1;
  for (let i = 0; i <= points.length; i += 1) {
    if (i < points.length && dry[i]) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      if (i - 1 - from > best.to - best.from) best = { from, to: i - 1 };
      from = -1;
    }
  }
  return best.to > best.from ? points.slice(best.from, best.to + 1) : [];
}

/** Distance from a point to a polyline, for keeping plots off the streets. */
export function distanceToLine(x, z, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
  }
  return best;
}

/** The slope and height range under a small square footprint. */
export function groundRange(terrain, x, z, size) {
  if (!terrain) return { low: 0, high: 0, slope: 0 };
  const values = [];
  for (const [dx, dz] of [[-size / 2, -size / 2], [size / 2, -size / 2], [-size / 2, size / 2], [size / 2, size / 2], [0, 0]]) values.push(terrain.height(x + dx, z + dz));
  const low = Math.min(...values);
  const high = Math.max(...values);
  return { low, high, slope: (high - low) / size };
}

/**
 * The road surface near a settlement as points with the clearance each needs: half width plus the settlement's
 * pavement. Sampled every 3 m within reach of the town (a crossing road may be any road of the network).
 */
export function roadSamples(roads, center, reach, pavement) {
  const samples = [];
  for (const road of roads) {
    const clear = roadHalfWidth(road.lanes ?? 2) + pavement;
    for (let d = 0; d <= road.length; d += 3) {
      const p = road.positionAt(d);
      const [x, z] = [p.x, -p.y];
      if (Math.hypot(x - center[0], z - center[1]) < reach + clear) samples.push({ x, z, clear });
    }
  }
  return samples;
}
