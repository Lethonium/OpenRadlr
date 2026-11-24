/**
 * The road and the land under it, pure and free of any drawing: lane widths,
 * the road frame and rider position, nearest-road lookups, the terrain
 * height functions (procedural and from a road network), the water level and
 * the junction clearings. Runs in the world worker and on the main thread.
 */
import { SEA_LEVEL, coastHeight, islandShape } from "./island.js";
import { fbm } from "./noise.js";
import { add, cellKey, normalize, scale } from "./vec.js";

export const LANE_WIDTH = 1.4;
export const SHOULDER = 0.9;
export const VERGE = 1.1;

export const roadHalfWidth = (lanes) => (lanes * LANE_WIDTH) / 2 + SHOULDER;

/**
 * Position and orientation of the road at a distance.
 * @returns {{center: number[], forward: number[], right: number[], grade: number}}
 */
export function roadFrame(route, distance) {
  const toWorld = (d) => {
    const { x, y } = route.positionAt(d);
    return [x, route.elevationAt(d), -y];
  };
  const center = toWorld(distance);
  // Past the ends of a route that isn't a loop both would land on the end: take the direction from inside.
  const along = route.loop === false ? Math.min(route.length - 2, Math.max(2, distance)) : distance;
  const ahead = toWorld(along + 2);
  const behind = toWorld(along - 2);
  const flat = normalize([ahead[0] - behind[0], 0, ahead[2] - behind[2]]);
  const right = [-flat[2], 0, flat[0]];
  const forward = normalize([ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]]);
  return { center, forward, right, grade: route.gradeAt(distance) };
}

/** World position of a rider: lane 0 is the leftmost lane in riding direction. */
export function riderPosition(route, distance, lane) {
  const frame = roadFrame(route, distance);
  const offset = (lane - (route.lanes - 1) / 2) * LANE_WIDTH;
  return { ...frame, position: add(frame.center, scale(frame.right, offset)) };
}

/** Dense samples along one or more roads, bucketed for fast nearest-point lookups. */
export class RoadIndex {
  constructor(routes, { step = 6, cell = 60 } = {}) {
    this.cell = cell;
    this.buckets = new Map();
    this.samples = [];
    for (const route of Array.isArray(routes) ? routes : [routes]) {
      for (let d = 0; d < route.length; d += step) {
        const { x, y } = route.positionAt(d);
        const sample = { x, z: -y, elevation: route.elevationAt(d), distance: d, route };
        this.samples.push(sample);
        const key = this.#key(sample.x, sample.z);
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(sample);
      }
    }
    this.meanElevation = this.samples.reduce((sum, s) => sum + s.elevation, 0) / this.samples.length;
    this.minElevation = Math.min(...this.samples.map((s) => s.elevation));
    this.center = [
      this.samples.reduce((sum, s) => sum + s.x, 0) / this.samples.length,
      this.samples.reduce((sum, s) => sum + s.z, 0) / this.samples.length,
    ];
  }

  #key(x, z) {
    return cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell));
  }

  /** Exact distance to the nearest road sample, however far (slower; for rare queries). */
  farDistance(x, z) {
    let best = Infinity;
    for (const s of this.samples) best = Math.min(best, Math.hypot(s.x - x, s.z - z));
    return best;
  }

  /**
   * Nearest road sample within `rings` cells, or null when the road is far
   * away. `accept` limits the search to some samples (e.g. other roads).
   */
  nearest(x, z, rings = 2, accept = null) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = null;
    let bestSquared = Infinity;
    for (let i = -rings; i <= rings; i += 1) {
      for (let j = -rings; j <= rings; j += 1) {
        const bucket = this.buckets.get(cellKey(cx + i, cz + j));
        if (!bucket) continue;
        for (const s of bucket) {
          const dx = s.x - x;
          const dz = s.z - z;
          const squared = dx * dx + dz * dz;
          if (squared < bestSquared && (!accept || accept(s))) {
            bestSquared = squared;
            best = s;
          }
        }
      }
    }
    return best ? { sample: best, distance: Math.sqrt(bestSquared) } : null;
  }
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The seed for everything shared by a map's routes (terrain, turbines, sky). */
export const mapSeed = (route) => (route.map?.seed ?? route.seed) >>> 0;

/** Bounding box (route coordinates) around all `routes`. */
export function mapBounds(routes) {
  return {
    minX: Math.min(...routes.map((r) => r.bounds.minX)),
    maxX: Math.max(...routes.map((r) => r.bounds.maxX)),
    minY: Math.min(...routes.map((r) => r.bounds.minY)),
    maxY: Math.max(...routes.map((r) => r.bounds.maxY)),
  };
}

const FIELD = Object.freeze({ cell: 25, reach: 900, stride: 3, uplift: 20 });

/**
 * Smooth elevation of the land between roads, on a coarse grid: an inverse
 * distance weighting of every road nearby (so two roads at different heights
 * get a slope between them instead of a step), rising gently away from the
 * roads (they follow valleys and passes) and settling to a common level far
 * out. Also keeps the distance to the nearest road for the hills' amplitude.
 */
class ElevationField {
  constructor(index) {
    const { cell, reach, stride, uplift } = FIELD;
    this.far = index.meanElevation + uplift;
    const xs = index.samples.map((s) => s.x);
    const zs = index.samples.map((s) => s.z);
    this.x0 = Math.floor((Math.min(...xs) - reach) / cell) * cell;
    this.z0 = Math.floor((Math.min(...zs) - reach) / cell) * cell;
    this.columns = Math.ceil((Math.max(...xs) + reach - this.x0) / cell) + 1;
    this.rows = Math.ceil((Math.max(...zs) + reach - this.z0) / cell) + 1;
    const nodes = this.columns * this.rows;
    const weight = new Float64Array(nodes);
    const weighted = new Float64Array(nodes);
    // Distances saturate at `reach`: beyond it nothing depends on them any more.
    const nearest = new Float32Array(nodes).fill(reach);
    const span = Math.ceil(reach / cell);
    for (let k = 0; k < index.samples.length; k += stride) {
      const s = index.samples[k];
      const c0 = Math.round((s.x - this.x0) / cell);
      const r0 = Math.round((s.z - this.z0) / cell);
      for (let r = Math.max(0, r0 - span); r <= Math.min(this.rows - 1, r0 + span); r += 1) {
        const dz = this.z0 + r * cell - s.z;
        for (let c = Math.max(0, c0 - span); c <= Math.min(this.columns - 1, c0 + span); c += 1) {
          const dx = this.x0 + c * cell - s.x;
          const d2 = dx * dx + dz * dz;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          const w = (1 - smoothstep(reach * 0.6, reach, d)) / (d2 + 100) ** 2;
          const i = r * this.columns + c;
          weight[i] += w;
          weighted[i] += w * s.elevation;
          if (d < nearest[i]) nearest[i] = d;
        }
      }
    }
    this.base = new Float32Array(nodes);
    this.distance = nearest;
    for (let i = 0; i < nodes; i += 1) {
      const d = nearest[i];
      const local = weight[i] > 0 ? weighted[i] / weight[i] + uplift * smoothstep(60, 550, d) : this.far;
      this.base[i] = local + (this.far - local) * smoothstep(reach * 0.5, reach * 0.95, d);
    }
  }

  /** Land level and distance to the nearest road, bilinear between grid nodes. */
  at(x, z) {
    const u = (x - this.x0) / FIELD.cell;
    const v = (z - this.z0) / FIELD.cell;
    const c = Math.floor(u);
    const r = Math.floor(v);
    if (c < 0 || r < 0 || c + 1 >= this.columns || r + 1 >= this.rows) return { base: this.far, distance: FIELD.reach };
    const fu = u - c;
    const fv = v - r;
    const i = r * this.columns + c;
    const mix = (grid) => {
      const top = grid[i] + (grid[i + 1] - grid[i]) * fu;
      const bottom = grid[i + this.columns] + (grid[i + this.columns + 1] - grid[i + this.columns]) * fu;
      return top + (bottom - top) * fv;
    };
    return { base: mix(this.base), distance: mix(this.distance) };
  }
}

/**
 * Terrain height function: follows every road closely (slightly below it)
 * and rolls into seeded hills and dips further away. `routes` is one route or
 * all routes of a map; `seed` defaults to the first route's map seed.
 */
export function terrainModel(routes, { seed } = {}) {
  const list = Array.isArray(routes) ? routes : [routes];
  const index = new RoadIndex(list);
  const field = new ElevationField(index);
  const noiseSeed = seed ?? mapSeed(list[0]);
  const island = islandShape(index.samples, noiseSeed);
  const sea = waterLevel(index);
  return {
    index,
    seed: noiseSeed,
    bounds: mapBounds(list),
    island,
    seaLevel: sea,
    height(x, z) {
      const land = field.at(x, z);
      const hills = (fbm(x / 240, z / 240, noiseSeed) - 0.47) * (6 + 95 * smoothstep(20, 500, land.distance));
      const cliff = island.cliffAt(Math.atan2(z - island.center[1], x - island.center[0]));
      const natural = coastHeight(land.base + hills, island.inland(x, z), cliff, sea);
      const near = index.nearest(x, z);
      if (!near) return natural;
      const halfWidth = roadHalfWidth(near.sample.route.lanes) + VERGE;
      const bed = near.sample.elevation - 0.35;
      return bed + (natural - bed) * smoothstep(halfWidth + 1.5, halfWidth + 40, near.distance);
    },
    distanceToRoad(x, z) {
      return index.nearest(x, z)?.distance ?? 10_000;
    },
  };
}

/**
 * Terrain of a road network (#26): the landscape comes with the network
 * (terrain first), with a little seeded detail on the land, and blends to
 * the road bed next to every road, like `terrainModel`. `keepClear`: routes
 * that count as road for what may stand where (`distanceToRoad`), not for the
 * ground's height — a route rounds a sharp corner at a place up to about 8 m
 * off the network's roads, and that asphalt is drawn too.
 */
export function networkTerrain(network, roads = network.roads(), { keepClear = [] } = {}) {
  const index = new RoadIndex(roads);
  const clear = keepClear.length > 0 ? new RoadIndex(keepClear) : null;
  const seed = network.seed;
  return {
    index,
    seed,
    bounds: mapBounds(roads),
    island: network.island(),
    seaLevel: SEA_LEVEL,
    height(x, z) {
      const land = network.heightAt(x, -z);
      const natural = land + (fbm(x / 95, z / 95, seed + 7, 3) - 0.5) * 6 * smoothstep(2, 14, land);
      const near = index.nearest(x, z);
      if (!near) return natural;
      const halfWidth = roadHalfWidth(near.sample.route.lanes) + VERGE;
      const bed = near.sample.elevation - 0.35;
      return bed + (natural - bed) * smoothstep(halfWidth + 1.5, halfWidth + 40, near.distance);
    },
    distanceToRoad(x, z) {
      const road = index.nearest(x, z)?.distance ?? 10_000;
      return clear ? Math.min(road, clear.nearest(x, z)?.distance ?? 10_000) : road;
    },
  };
}

/** Sea level: route elevations are above the sea; a road lower than that still stays dry. */
export const waterLevel = (index) => Math.min(SEA_LEVEL, index.minElevation - 6);

/** Junction pads sit below every road's asphalt (other roads: -0.02) and above the road bed (-0.35). */
export const JUNCTION_LIFT = -0.07;

/**
 * How far from a junction the ploughed banks flatten out, and over what
 * distance they fade back in. Without this, each road's raised snow shoulder
 * runs straight across the other roads' asphalt where they meet.
 */
export const JUNCTION_BANK_CLEAR = 6.5;
export const JUNCTION_BANK_FADE = 4;

/**
 * The world points where a network's roads meet at a fork or corner, so their
 * ploughed banks have to open up. A straight-through node keeps its bank: the
 * shoulders of both roads line up there.
 * @returns {Array<[number, number]>} world x/z pairs
 */
export function junctionClearings(network) {
  if (!network) return [];
  const incident = new Map();
  for (const road of network.roads()) {
    const nodes = road.nodes;
    const ends = [
      [road.edge.from, nodes[0], nodes[1]],
      [road.edge.to, nodes[nodes.length - 1], nodes[nodes.length - 2]],
    ];
    for (const [id, at, next] of ends) {
      const dirs = incident.get(id) ?? [];
      dirs.push([next.x - at.x, next.y - at.y]);
      incident.set(id, dirs);
    }
  }
  const points = [];
  for (const node of network.nodes.values()) {
    const dirs = incident.get(node.id) ?? [];
    if (dirs.length < 2) continue;
    let open = dirs.length >= 3;
    if (dirs.length === 2) {
      const [ax, ay] = dirs[0];
      const [bx, by] = dirs[1];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      open = (ax * bx + ay * by) / (la * lb) > -0.9; // sharper than ~154°
    }
    if (open) points.push([node.x, -node.y]);
  }
  return points;
}

/** 0 on a junction's flat apron, rising to 1 where the ploughed bank resumes. */
export function junctionBankAt(points, x, z) {
  let nearest = Infinity;
  for (const [px, pz] of points) nearest = Math.min(nearest, Math.hypot(x - px, z - pz));
  return Math.min(1, Math.max(0, (nearest - JUNCTION_BANK_CLEAR) / JUNCTION_BANK_FADE));
}

/**
 * Road heights above the route line. Markings sit `marking` above their own
 * asphalt; other roads' markings stay well below the ridden road's asphalt
 * where they cross it, or they shine through at a distance.
 */
export const ROAD_LIFT = Object.freeze({ ridden: 0.04, other: -0.02, marking: 0.015 });
