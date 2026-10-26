/**
 * A shared map's road network (ADR 0010, #26), as served at `/api/map`:
 * the landscape (a height grid and the coast), the places (cafés,
 * junctions) and the roads between them, plus the routes as walks over the
 * roads. The 3D world is built from it: every road once, one terrain.
 */
import { RouteGeometry } from "./geometry.js";

/** Lanes every road is drawn with until roads get types (#27). */
export const NETWORK_LANES = 4;

/** Stable 32-bit hash of a string (FNV-1a), for per-road decoration seeds. */
export function hashSeed(text, seed = 0) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Little-endian 16-bit integers from base64. */
function decodeHeights(base64, count) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length < count * 2) throw new Error("the network's terrain is too short");
  const view = new DataView(bytes.buffer);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Catmull-Rom weights, so the land between grid nodes is smooth, not faceted. */
function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export class RoadNetwork {
  /** @param {object} file a network file (see docs/routes.md) */
  constructor(file) {
    if (!file || typeof file.id !== "string" || !Array.isArray(file.nodes) || !Array.isArray(file.edges)) {
      throw new Error("not a road network");
    }
    this.id = file.id;
    this.name = file.name ?? file.id;
    this.seed = Number(file.seed) >>> 0;

    const t = file.terrain;
    if (!t || !(t.cell > 0) || !(t.columns > 1) || !(t.rows > 1)) throw new Error("the network has no terrain");
    this.grid = { x0: t.x0, y0: t.y0, cell: t.cell, columns: t.columns, rows: t.rows, scale: t.scale ?? 0.1 };
    this.heights = decodeHeights(t.heights, t.columns * t.rows);

    const center = file.coast?.center ?? [t.x0 + ((t.columns - 1) * t.cell) / 2, t.y0 + ((t.rows - 1) * t.cell) / 2];
    this.coast = { center, radius: file.coast?.radius ?? [] };

    this.nodes = new Map(file.nodes.map((n) => [n.id, { id: n.id, kind: n.kind, name: n.name ?? null, x: n.x, y: n.y, elevation: n.elevation }]));
    this.edges = new Map();
    for (const e of file.edges) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) throw new Error(`road ${e.id} joins unknown places`);
      const geometry = new RouteGeometry({
        id: `road:${e.id}`,
        name: e.id,
        loop: false,
        lanes: NETWORK_LANES,
        seed: hashSeed(e.id, this.seed),
        points: e.points,
        zones: e.zones ?? [],
        map: { id: this.id, seed: this.seed },
      });
      // Roads carry exactly their zones: none means none (no seeded defaults).
      geometry.explicitZones = true;
      geometry.edge = { id: e.id, from: e.from, to: e.to, type: e.type ?? "road", markers: e.markers ?? [] };
      this.edges.set(e.id, geometry);
    }
    this.routes = (file.routes ?? []).map((r) => ({ id: r.id, name: r.name, walk: r.walk ?? [] }));
  }

  /** Roads in file order (the order everything shared is built in). */
  roads() {
    return [...this.edges.values()];
  }

  /** Cafés: where routes start and riders meet. */
  cafes() {
    return [...this.nodes.values()].filter((n) => n.kind === "cafe");
  }

  /** Land height (metres above sea level) at route coordinates `x` east, `y` north. */
  heightAt(x, y) {
    const { x0, y0, cell, columns, rows, scale } = this.grid;
    const u = Math.min(columns - 1.000001, Math.max(0, (x - x0) / cell));
    const v = Math.min(rows - 1.000001, Math.max(0, (y - y0) / cell));
    const c = Math.floor(u);
    const r = Math.floor(v);
    const at = (cc, rr) => this.heights[Math.min(rows - 1, Math.max(0, rr)) * columns + Math.min(columns - 1, Math.max(0, cc))];
    const row = (rr) => cubic(at(c - 1, rr), at(c, rr), at(c + 1, rr), at(c + 2, rr), u - c);
    return cubic(row(r - 1), row(r), row(r + 1), row(r + 2), v - r) * scale;
  }

  /**
   * The island in world coordinates (x east, z south), shaped like the
   * client's `islandShape`: its centre and the outermost coast per direction.
   */
  island() {
    const [cx, cy] = this.coast.center;
    const table = this.coast.radius;
    const bins = table.length;
    const radiusAt = (angle) => {
      if (!bins) return 0;
      // World angles turn the other way round (z points south).
      const u = (((-angle / (2 * Math.PI)) * bins) % bins + bins) % bins;
      const i = Math.floor(u);
      return table[i] + (table[(i + 1) % bins] - table[i]) * (u - i);
    };
    return { center: [cx, -cy], radiusAt, cliffAt: () => 0 };
  }

  /**
   * A road as seen leaving `nodeId`: the road itself, or a reversed copy when
   * it ends there (used to place a café on the right side going out).
   */
  roadFrom(nodeId) {
    for (const road of this.edges.values()) {
      if (road.edge.from === nodeId) return road;
    }
    for (const road of this.edges.values()) {
      if (road.edge.to !== nodeId) continue;
      const points = [...road.nodes].reverse().map((n) => [n.x, n.y, n.elevation]);
      return new RouteGeometry({ id: `${road.id}:back`, name: road.name, loop: false, lanes: road.lanes, seed: road.seed, points });
    }
    return null;
  }
}
