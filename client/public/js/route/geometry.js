/**
 * Client-side view of a route file. Mirrors the server's route maths so
 * that rider distances from the server map to the same place on screen.
 * Every route is a loop: a closing segment back to the start is added if needed.
 * A road of a network (`loop: false`) is open instead: it keeps both ends, and
 * distances clamp to them rather than wrapping round.
 */
import { WORLD_ORIGIN } from "./geo.js";

/** Metres a grade is measured over (the server's GRADE_WINDOW_M). */
export const GRADE_WINDOW_M = 50;

export class RouteGeometry {
  /** @param {{id: string, name: string, lanes: number, seed: number, points: number[][], markers?: object[], map?: {id: string, seed: number}}} file */
  constructor(file) {
    if (!Array.isArray(file.points) || file.points.length < 2) {
      throw new Error("a route needs at least two points");
    }
    this.id = file.id;
    this.name = file.name;
    this.lanes = file.lanes;
    this.seed = file.seed;
    this.markers = file.markers ?? [];
    this.zones = Array.isArray(file.zones) ? file.zones : [];
    // Routes with the same map id share one world (ADR 0010).
    const map = file.map;
    this.map = map && typeof map.id === "string" && Number.isFinite(map.seed) ? { id: map.id, seed: map.seed } : null;

    // Where the route's (0, 0) sits on the globe, for exports. Malformed values fall back to the world origin.
    const geo = file.geo;
    const valid = geo && typeof geo === "object" && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && Math.abs(geo.lat) <= 90 && Math.abs(geo.lon) <= 180;
    this.geo = valid ? { lat: geo.lat, lon: geo.lon } : WORLD_ORIGIN;

    this.loop = file.loop !== false;
    const nodes = file.points.map(([x, y, elevation]) => ({ x, y, elevation }));
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (this.loop && Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) nodes.push({ ...first });
    this.nodes = nodes;

    this.cumulative = [0];
    for (let i = 1; i < nodes.length; i += 1) {
      const a = nodes[i - 1];
      const b = nodes[i];
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
    if (!(this.length > 0)) throw new Error("a route must have a positive length");

    const elevations = nodes.map((n) => n.elevation);
    this.minElevation = Math.min(...elevations);
    this.maxElevation = Math.max(...elevations);
    this.bounds = {
      minX: Math.min(...nodes.map((n) => n.x)),
      maxX: Math.max(...nodes.map((n) => n.x)),
      minY: Math.min(...nodes.map((n) => n.y)),
      maxY: Math.max(...nodes.map((n) => n.y)),
    };
  }

  wrap(distance) {
    if (!this.loop) return Math.min(this.length, Math.max(0, distance));
    const d = ((distance % this.length) + this.length) % this.length;
    return d >= this.length ? 0 : d;
  }

  /** Signed shortest distance from `from` to `to` along the loop (positive = ahead). */
  signedGap(from, to) {
    if (!this.loop) return to - from;
    let gap = this.wrap(to - from);
    if (gap > this.length / 2) gap -= this.length;
    return gap;
  }

  #locate(distance) {
    const d = this.wrap(distance);
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = this.cumulative[lo + 1] - this.cumulative[lo];
    const t = span > 0 ? (d - this.cumulative[lo]) / span : 0;
    return { index: lo, t: Math.min(1, Math.max(0, t)) };
  }

  elevationAt(distance) {
    const { index, t } = this.#locate(distance);
    const a = this.nodes[index].elevation;
    const b = this.nodes[index + 1].elevation;
    return a + (b - a) * t;
  }

  /** Grade in percent over GRADE_WINDOW_M around `distance`, as the server measures it. */
  gradeAt(distance) {
    let a = distance - GRADE_WINDOW_M / 2;
    let b = distance + GRADE_WINDOW_M / 2;
    if (!this.loop) [a, b] = [Math.max(0, a), Math.min(this.length, b)];
    else if (b - a > this.length) [a, b] = [distance - this.length / 2, distance + this.length / 2];
    return b > a ? ((this.elevationAt(b) - this.elevationAt(a)) / (b - a)) * 100 : 0;
  }

  positionAt(distance) {
    const { index, t } = this.#locate(distance);
    const a = this.nodes[index];
    const b = this.nodes[index + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}
