/**
 * Builds the static 3D world for a route: road, verge, lane markings, posts,
 * terrain (an island: fine over the land, coarse out to the horizon), trees,
 * bushes, rocks, grass tufts and flowers, arches, the sea with far-off
 * islands, and clouds.
 * Everything is derived deterministically from the route files (geometry +
 * seeds), so every client sees the same world. Routes on one shared map
 * (ADR 0010) are drawn together: one terrain from the map seed, every road,
 * and the scenery of every route; markers and arches only for the ridden one.
 *
 * World axes: X = route x (east), Y = up, Z = −route y (north is −Z).
 */
import { buildBanners, letterArch } from "./banners.js";
import { ChunkedMesh } from "./chunks.js";
import {
  BRIDGE_HALF_LENGTH,
  Occupancy,
  PAVEMENT,
  RIVER,
  buildBridge,
  buildBikeCafe,
  buildOutdoorGym,
  studioSite,
  buildFarms,
  buildRiverPath,
  buildRiverWater,
  buildRoadside,
  buildSpectators,
  buildVillage,
  buildWindTurbines,
  withRivers,
} from "./features.js";
import { COAST, SEA_LEVEL, coastHeight, islandShape } from "./island.js";
import { MeshBuilder } from "./meshBuilder.js";
import { inStretch, resolveZones } from "./zones.js";
import { add, cellKey, normalize, placement, scale } from "./math.js";
import { fbm, seededRandom, valueNoise } from "./noise.js";
import { resolveBiome, temperate } from "./biomes/index.js";
import { buildWeather } from "./weather.js";

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

/**
 * A height grid of flat-shaded triangles. Where `coarse(x0, z0, x1, z1)` says
 * a block of `block` × `block` cells needs no detail (far from any road), and
 * the land in it lies within `flatness` metres of one quad, it is drawn as
 * that quad instead.
 */
function gridTerrain(mesh, { x0, z0, columns, rows, cell, height, color, skipBelow = -Infinity, coarse = null, block = 3, flatness = 2.5, lazy = false }) {
  // `lazy` (huge islands): a height is only computed where a triangle needs
  // it, and a far block counts as flat without looking inside it.
  const heights = new Float32Array((columns + 1) * (rows + 1));
  if (lazy) heights.fill(NaN);
  else {
    for (let r = 0; r <= rows; r += 1) {
      for (let c = 0; c <= columns; c += 1) heights[r * (columns + 1) + c] = height(x0 + c * cell, z0 + r * cell);
    }
  }
  const h = (c, r) => {
    const i = r * (columns + 1) + c;
    if (lazy && Number.isNaN(heights[i])) heights[i] = height(x0 + c * cell, z0 + r * cell);
    return heights[i];
  };
  const at = (c, r) => [x0 + c * cell, h(c, r), z0 + r * cell];
  const cellTriangles = (a, b, d, e, size) => {
    // Deep sea floor: hidden under the water anyway (the coarse grid sits below it).
    if (Math.max(a[1], b[1], d[1], e[1]) < skipBelow) return;
    for (const tri of [
      [a, b, e],
      [a, e, d],
    ]) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      const steep = (Math.max(...tri.map((p) => p[1])) - Math.min(...tri.map((p) => p[1]))) / size;
      mesh.triangle(tri[0], tri[1], tri[2], color(cx, cz, cy, steep));
    }
  };
  const blocksC = Math.ceil(columns / block);
  const blocksR = Math.ceil(rows / block);
  const plain = new Uint8Array(blocksC * blocksR);
  if (coarse) {
    for (let br = 0; br < blocksR; br += 1) {
      for (let bc = 0; bc < blocksC; bc += 1) {
        const c0 = bc * block;
        const r0 = br * block;
        if (c0 + block > columns || r0 + block > rows) continue;
        if (!coarse(x0 + c0 * cell, z0 + r0 * cell, x0 + (c0 + block) * cell, z0 + (r0 + block) * cell)) continue;
        if (lazy) {
          plain[br * blocksC + bc] = 1;
          continue;
        }
        // Only where one quad follows the land closely (not over cliffs or crests).
        let off = 0;
        for (let r = 0; r <= block && off <= flatness; r += 1) {
          for (let c = 0; c <= block; c += 1) {
            // The block's two triangles, split from (c0, r0) to the opposite corner.
            const [u, v] = [c / block, r / block];
            const [a, b, d, e] = [h(c0, r0), h(c0, r0 + block), h(c0 + block, r0), h(c0 + block, r0 + block)];
            const plane = v >= u ? a + u * (e - b) + v * (b - a) : a + u * (d - a) + v * (e - d);
            off = Math.max(off, Math.abs(h(c0 + c, r0 + r) - plane));
          }
        }
        plain[br * blocksC + bc] = off <= flatness ? 1 : 0;
      }
    }
  }
  // A coarse block's edges are straight: the finer cells next to it share
  // those heights along the seam, so the two meet without a crack.
  const index = (c, r) => r * (columns + 1) + c;
  for (let br = 0; br < blocksR; br += 1) {
    for (let bc = 0; bc < blocksC; bc += 1) {
      if (!plain[br * blocksC + bc]) continue;
      const [c0, r0, c1, r1] = [bc * block, br * block, bc * block + block, br * block + block];
      const [a, b, d, e] = [h(c0, r0), h(c0, r1), h(c1, r0), h(c1, r1)];
      for (let k = 1; k < block; k += 1) {
        const t = k / block;
        heights[index(c0 + k, r0)] = a * (1 - t) + d * t;
        heights[index(c0 + k, r1)] = b * (1 - t) + e * t;
        heights[index(c0, r0 + k)] = a * (1 - t) + b * t;
        heights[index(c1, r0 + k)] = d * (1 - t) + e * t;
      }
    }
  }
  for (let br = 0; br < blocksR; br += 1) {
    for (let bc = 0; bc < blocksC; bc += 1) {
      const c0 = bc * block;
      const r0 = br * block;
      if (plain[br * blocksC + bc]) {
        cellTriangles(at(c0, r0), at(c0, r0 + block), at(c0 + block, r0), at(c0 + block, r0 + block), cell * block);
        continue;
      }
      for (let r = r0; r < Math.min(rows, r0 + block); r += 1) {
        for (let c = c0; c < Math.min(columns, c0 + block); c += 1) cellTriangles(at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r + 1), cell);
      }
    }
  }
}

/**
 * Which parts of the land are far from every road: true for a box whose
 * every point is more than `reach` metres from the nearest road sample.
 * A coarse raster of road samples, grown by `reach`.
 */
function farFromRoads(index, reach, cell = 50) {
  const near = new Set();
  const span = Math.ceil(reach / cell);
  for (let k = 0; k < index.samples.length; k += 4) {
    const s = index.samples[k];
    const c0 = Math.floor(s.x / cell);
    const r0 = Math.floor(s.z / cell);
    for (let r = -span; r <= span; r += 1) {
      for (let c = -span; c <= span; c += 1) {
        if ((Math.abs(c) - 1) ** 2 + (Math.abs(r) - 1) ** 2 <= span * span) near.add(cellKey(c0 + c, r0 + r));
      }
    }
  }
  return (x0, z0, x1, z1) => {
    for (let r = Math.floor(z0 / cell); r <= Math.floor(z1 / cell); r += 1) {
      for (let c = Math.floor(x0 / cell); c <= Math.floor(x1 / cell); c += 1) if (near.has(cellKey(c, r))) return false;
    }
    return true;
  };
}

/** Box (world x/z) around the island's coast, with some sea around it. */
function islandBox(island, sea = 60) {
  const box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (let a = 0; a < 360; a += 2) {
    const angle = (a * Math.PI) / 180;
    const r = island.radiusAt(angle) + COAST.rough + sea;
    const x = island.center[0] + Math.cos(angle) * r;
    const z = island.center[1] + Math.sin(angle) * r;
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x);
    box.z0 = Math.min(box.z0, z);
    box.z1 = Math.max(box.z1, z);
  }
  return box;
}

/**
 * How far apart stacked surfaces must stay so the depth buffer can tell them
 * apart out where they are seen: the coarse grid under the fine one, and the
 * sea-floor plane under the coarse grid (both seen through the sea).
 */
export const TERRAIN_LAYERS = Object.freeze({ sink: 40, floorGap: 20 });

/**
 * Fine terrain over the island plus a coarse ring out to the horizon (land
 * further than `detailReach` from every road in 48 m pieces). Inside
 * the fine grid's box the coarse grid sinks well under the sea floor, so the
 * two never fight; the fine grid leaves out the deep sea floor, where the
 * sunk coarse grid shows through the water instead.
 */
/** Above this many fine-grid nodes an island is "huge" (a 180 km route): built lazily, in big far blocks, with a horizon around all of it. */
export const HUGE_ISLAND_NODES = 1_500_000;

export function buildTerrain(terrain, { margin = 450, cell = 16, horizon = 4200, outerCell = 140, detailReach = 350, into = null, biome = temperate } = {}) {
  const { minX, maxX, minY, maxY } = terrain.bounds;
  const seed = terrain.seed;
  const water = waterLevel(terrain.index);
  const box = terrain.island ? islandBox(terrain.island) : { x0: minX - margin, z0: -maxY - margin, x1: maxX + margin, z1: -minY + margin };
  const bounds = { x0: Math.floor(box.x0 / cell) * cell, z0: Math.floor(box.z0 / cell) * cell, x1: 0, z1: 0 };
  const columns = Math.ceil((box.x1 - bounds.x0) / cell);
  const rows = Math.ceil((box.z1 - bounds.z0) / cell);
  bounds.x1 = bounds.x0 + columns * cell;
  bounds.z1 = bounds.z0 + rows * cell;
  const huge = columns * rows > HUGE_ISLAND_NODES;
  const [cx, cz] = terrain.island?.center ?? terrain.index.center;
  if (huge) horizon = Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 + horizon;
  const riverDistance = (x, z) => terrain.riverDistance?.(x, z) ?? Infinity;
  const color = (x, z, y, steep) => biome.terrainColor({ x, z, height: y, steep, seed, water, riverDistance: riverDistance(x, z), riverHalfWidth: RIVER.halfWidth });

  const fine = into ?? new MeshBuilder();
  const mesh = into ? new MeshBuilder() : fine;
  // Full detail near the roads; far out on the land, the plain parts in bigger pieces.
  const coarse = detailReach > 0 ? farFromRoads(terrain.index, detailReach) : null;
  // Huge islands: blocks of 9 cells (144 m), so the far land costs a few thousand quads, not millions.
  gridTerrain(fine, { x0: bounds.x0, z0: bounds.z0, columns, rows, cell, height: (x, z) => terrain.height(x, z), color, skipBelow: water - 8, coarse, ...(huge ? { block: 9, lazy: true } : {}) });

  const outerColumns = Math.ceil((2 * horizon) / outerCell);
  const inside = (x, z) => x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1;
  let lowest = water - COAST.depth;
  gridTerrain(mesh, {
    x0: cx - horizon,
    z0: cz - horizon,
    columns: outerColumns,
    rows: outerColumns,
    cell: outerCell,
    height: (x, z) => {
      // Its 140 m triangles cut through hills, so inside the box it stays
      // under the deepest sea floor rather than following the land.
      const y = inside(x, z) ? Math.min(terrain.height(x, z), water - COAST.depth) - TERRAIN_LAYERS.sink : terrain.height(x, z);
      lowest = Math.min(lowest, y);
      return y;
    },
    color,
  });
  // A sea floor under everything, so the sea looks the same out to the horizon.
  const floor = lowest - TERRAIN_LAYERS.floorGap;
  const far = Math.max(20000, horizon * 2);
  mesh.quad([cx - far, floor, cz - far], [cx - far, floor, cz + far], [cx + far, floor, cz + far], [cx + far, floor, cz - far], biome.terrainColor({ x: cx, z: cz, height: floor, steep: 0, seed, water, riverHalfWidth: RIVER.halfWidth }));
  return { mesh: mesh.build(), bounds, water, floor, horizon };
}

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

/** A round asphalt pad where roads of a network meet (`node` in route coordinates). */
export function buildJunctionPad(node, into, { lanes = 4, sides = 20, biome = temperate } = {}) {
  const radius = roadHalfWidth(lanes) + 0.3;
  const center = [node.x, node.elevation + JUNCTION_LIFT, -node.y];
  const at = (k) => {
    const a = (k / sides) * 2 * Math.PI;
    return [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius];
  };
  for (let k = 0; k < sides; k += 1) into.triangleFacing(center, at(k), at(k + 1), biome.road.surface, [0, 1, 0]);
}

/** Wraps a target so builders can share the "own a mesh or write into one" pattern. */
const target = (into) => ({ mesh: into ?? new MeshBuilder(), own: !into });

/**
 * Road heights above the route line. Markings sit `marking` above their own
 * asphalt; other roads' markings stay well below the ridden road's asphalt
 * where they cross it, or they shine through at a distance.
 */
export const ROAD_LIFT = Object.freeze({ ridden: 0.04, other: -0.02, marking: 0.015 });

const roadPostModels = new Map();

/**
 * The biome's own roadside marker, if it has one (winter turns the posts into
 * snowmen). Built once per variant: every post reuses the same mesh.
 */
function roadsideModel(biome, km) {
  const build = biome.models?.post;
  if (!build) return null;
  const key = `${biome.id}:${km ? 1 : 0}`;
  let model = roadPostModels.get(key);
  if (!model) {
    model = build(km);
    roadPostModels.set(key, model);
  }
  return model;
}

/**
 * Asphalt, verges, markings and posts along a route. Other roads of the map
 * pass a lower `lift` (so the ridden road wins where they overlap at
 * junctions) and `skip` the stretches already drawn; `clear` keeps posts off
 * other roads. `bankAt` (0..1) flattens the season's ploughed bank near
 * junctions, where raised shoulders would cut across the other roads.
 */
export function buildRoad(route, { step = 4, markingStep = 3, into = null, lift = ROAD_LIFT.ridden, skip = () => false, clear = () => false, detail = true, bankAt = null, biome = temperate } = {}) {
  const halfWidth = roadHalfWidth(route.lanes);
  const { mesh, own } = target(into);
  const random = seededRandom((route.seed >>> 0) ^ 0xa5f);
  const edgeAt = (frame, offset, extra = 0) => add(add(frame.center, scale(frame.right, offset)), [0, lift + extra, 0]);

  const laneEdge = (route.lanes * LANE_WIDTH) / 2;
  // Optional season detail on top of the same road: ploughed banks at the
  // verge, worn ruts along the lanes, snow on the posts. Long routes keep the
  // banks (they read from far away) and drop the close-up detail.
  const bank = biome.road.bank;
  const rut = detail ? biome.road.rut : null;
  const postCap = detail ? biome.road.postCap : null;
  // A ploughed bank fades from a flat verge (0) to full height (1), so the
  // snow can open up where roads meet instead of cutting across them.
  const shoulder = (k) => (bank ? -0.2 + (bank.height + 0.2) * k : -0.2);
  const ploughed = (frame) => (bankAt ? bankAt(frame.center[0], frame.center[2]) : 1);
  const steps = Math.ceil(route.length / step);
  for (let i = 0; i < steps; i += 1) {
    // Slight per-segment variation reads as patched asphalt.
    const v = 0.97 + random() * 0.06;
    if (skip(i * step) && skip(Math.min(route.length, (i + 1) * step))) continue;
    const f0 = roadFrame(route, i * step);
    const f1 = roadFrame(route, Math.min(route.length, (i + 1) * step));
    const asphalt = biome.road.surface.map((c) => c * v);
    mesh.quad(edgeAt(f0, -halfWidth), edgeAt(f0, halfWidth), edgeAt(f1, halfWidth), edgeAt(f1, -halfWidth), asphalt);
    // Gravel verge on both sides, sloping down into the grass. In winter it
    // is a raised snow shoulder closing into a small ploughed bank.
    const bank0 = bank ? ploughed(f0) : 0;
    const bank1 = bank ? ploughed(f1) : 0;
    const drop0 = shoulder(bank0);
    const drop1 = shoulder(bank1);
    for (const side of [-1, 1]) {
      const inner = side * halfWidth;
      const outer = side * (halfWidth + VERGE);
      const pts = side < 0 ? [edgeAt(f0, outer, drop0), edgeAt(f0, inner, -0.03), edgeAt(f1, inner, -0.03), edgeAt(f1, outer, drop1)] : [edgeAt(f0, inner, -0.03), edgeAt(f0, outer, drop0), edgeAt(f1, outer, drop1), edgeAt(f1, inner, -0.03)];
      mesh.quad(...pts, biome.road.verge);
      if (bank && (bank0 > 0 || bank1 > 0)) {
        // Close the shoulder down to the ground so the bank has a face.
        const top0 = edgeAt(f0, outer, drop0);
        const top1 = edgeAt(f1, outer, drop1);
        const down1 = edgeAt(f1, outer, -0.5);
        const down0 = edgeAt(f0, outer, -0.5);
        const facing = scale(f0.right, side);
        mesh.triangleFacing(top0, top1, down1, bank.color, facing);
        mesh.triangleFacing(top0, down1, down0, bank.color, facing);
      }
    }
    // Two darker ruts per lane, worn through the snow.
    if (rut) {
      for (let lane = 0; lane < route.lanes; lane += 1) {
        const offset = -laneEdge + (lane + 0.5) * LANE_WIDTH;
        const at = (f, o) => edgeAt(f, o, 0.005);
        mesh.quad(at(f0, offset - rut.width / 2), at(f0, offset + rut.width / 2), at(f1, offset + rut.width / 2), at(f1, offset - rut.width / 2), rut.color);
      }
    }
  }

  // Edge lines (solid) and lane dividers (dashed, 3 m on / 3 m off).
  const stripe = (offset, width, dashed, color) => {
    for (let d = 0; d < route.length; d += markingStep) {
      if (dashed && Math.floor(d / markingStep) % 2 === 1) continue;
      if (skip(d) && skip(Math.min(route.length, d + markingStep))) continue;
      const f0 = roadFrame(route, d);
      const f1 = roadFrame(route, Math.min(route.length, d + markingStep));
      // Lines stop at a junction instead of running across the other road.
      if (bankAt && (!ploughed(f0) || !ploughed(f1))) continue;
      const at = (f, o) => edgeAt(f, o, ROAD_LIFT.marking);
      mesh.quad(at(f0, offset - width / 2), at(f0, offset + width / 2), at(f1, offset + width / 2), at(f1, offset - width / 2), color);
    }
  };
  stripe(-laneEdge, 0.12, false, biome.road.edge);
  stripe(laneEdge, 0.12, false, biome.road.edge);
  for (let lane = 1; lane < route.lanes; lane += 1) stripe(-laneEdge + lane * LANE_WIDTH, 0.1, true, biome.road.marking);

  // Roadside posts every 50 m, alternating sides; every kilometre a pair with red tops.
  for (let d = 25; d < route.length; d += 50) {
    if (skip(d)) continue;
    const frame = roadFrame(route, d);
    const km = Math.abs((d % 1000) - 0) < 26 || Math.abs((d % 1000) - 1000) < 26;
    const sides = km ? [-1, 1] : [Math.floor(d / 50) % 2 === 0 ? -1 : 1];
    for (const side of sides) {
      const foot = add(frame.center, scale(frame.right, side * (halfWidth + VERGE + 0.3)));
      if (clear(foot[0], foot[2])) continue;
      const marker = detail ? roadsideModel(biome, km) : null;
      if (marker) {
        mesh.append(marker, placement(foot, 0));
        continue;
      }
      mesh.box(add(foot, [0, 0.5, 0]), [0.12, 1.0, 0.12], biome.road.postWhite);
      mesh.box(add(foot, [0, 1.05, 0]), [0.13, 0.12, 0.13], km ? biome.road.postRed : biome.road.postDark);
      if (postCap) mesh.box(add(foot, [0, 1.14, 0]), [0.16, 0.06, 0.16], postCap.color);
    }
  }
  return own ? mesh.build() : mesh;
}

/** Arches at the start/finish line and at climb and sprint segments, with their names; banners counting down climbs and at halfway. */
export function buildArches(route, { biome = temperate } = {}) {
  const colors = biome.arch;
  const mesh = new MeshBuilder();
  const halfWidth = roadHalfWidth(route.lanes) + 0.6;
  const arch = (distance, color, height = 5.2) => {
    const frame = roadFrame(route, distance);
    const along = scale(normalize([frame.forward[0], 0, frame.forward[2]]), -0.4);
    for (const side of [-1, 1]) {
      const foot = add(frame.center, scale(frame.right, side * halfWidth));
      mesh.orientedBox(add(foot, [0, height / 2, 0]), scale(frame.right, 0.4), [0, height, 0], along, colors.post);
    }
    const left = add(frame.center, scale(frame.right, -halfWidth));
    const right = add(frame.center, scale(frame.right, halfWidth));
    const beamCenter = add(scale(add(left, right), 0.5), [0, height, 0]);
    mesh.orientedBox(beamCenter, scale(frame.right, 2 * halfWidth + 0.4), [0, 1.0, 0], along, color);
    // Chequered strip on the start/finish line.
    if (color === colors.start) {
      const squares = 12;
      for (let i = 0; i < squares; i += 1) {
        const t0 = -halfWidth + 0.6 + (i / squares) * (2 * halfWidth - 1.2);
        const t1 = t0 + (2 * halfWidth - 1.2) / squares;
        const shade = colors.chequer[i % 2];
        const p = (t, o) => add(add(add(frame.center, scale(frame.right, t)), scale(normalize([frame.forward[0], 0, frame.forward[2]]), o)), [0, 0.06, 0]);
        mesh.quad(p(t0, -0.4), p(t1, -0.4), p(t1, 0.4), p(t0, 0.4), shade);
      }
    }
  };
  for (const marker of route.markers) {
    const height = marker.type === "start_finish" ? 5.6 : 5.2;
    if (marker.type === "start_finish") arch(marker.distance, colors.start, height);
    else if (marker.type === "climb") arch(marker.distance, colors.climb, height);
    else if (marker.type === "sprint") arch(marker.distance, colors.sprint, height);
    else continue;
    letterArch(mesh, route, marker, { height, halfWidth, depth: 0.4 });
  }
  buildBanners(mesh, route, { biome });
  return mesh.build();
}

/**
 * Trees (firs and leafy), bushes and rocks scattered deterministically:
 * denser near the road, clustered into small woods, never on the road and
 * never in the sea. Shadows come from the renderer's shadow map.
 */
export function buildScenery(
  route,
  terrain,
  bounds,
  { count = 1100, water = -Infinity, into = null, blocked = () => false, forests = [], biome = temperate } = {},
) {
  const random = seededRandom((route.seed >>> 0) ^ 0x5eed);
  const seed = route.seed >>> 0;
  const halfWidth = roadHalfWidth(route.lanes) + VERGE;
  const { mesh, own } = target(into);
  const positions = [];
  let attempts = 0;
  while (positions.length < count && attempts < count * 8) {
    attempts += 1;
    let x;
    let z;
    let inForest = false;
    const mode = random();
    if (forests.length > 0 && mode < 0.25) {
      // Forest stretches: trees close to the road, ignoring the woods noise.
      const stretch = forests[Math.floor(random() * forests.length)];
      const frame = roadFrame(route, stretch.from + random() * (stretch.to - stretch.from));
      const side = random() < 0.5 ? -1 : 1;
      [x, , z] = add(frame.center, scale(frame.right, side * (halfWidth + 5 + Math.pow(random(), 1.3) * 70)));
      inForest = true;
    } else if (mode < 0.65) {
      const frame = roadFrame(route, random() * route.length);
      const side = random() < 0.5 ? -1 : 1;
      const offset = halfWidth + 4 + Math.pow(random(), 1.7) * 170;
      [x, , z] = add(frame.center, scale(frame.right, side * offset));
    } else {
      x = bounds.x0 + random() * (bounds.x1 - bounds.x0);
      z = bounds.z0 + random() * (bounds.z1 - bounds.z0);
    }
    // Woods: keep most trees where a slow noise says "forest".
    const forest = valueNoise(x / 160, z / 160, seed + 99);
    if (!inForest && forest < 0.42 && random() < 0.75) continue;
    if (terrain.distanceToRoad(x, z) < halfWidth + 3 || blocked(x, z)) continue;
    const ground = terrain.height(x, z);
    if (ground < water + 2.5) continue; // no trees in the sea or on the beach
    const y = ground - 0.3;
    positions.push([x, y, z]);

    const kind = inForest ? 0.28 + random() * 0.72 : random();
    biome.flora.tree({ mesh, x, y, z, kind, random });
  }
  return { mesh: own ? mesh.build() : mesh, count: positions.length, positions };
}

/**
 * Grass tufts and wildflowers next to the road, where the camera sees them
 * up close. Three thin blades per tuft; flowers are a stem with a small head.
 */
export function buildGroundDetail(
  route,
  terrain,
  { tufts = 7000, flowers = 900, reach = 28, water = -Infinity, into = null, blocked = () => false, biome = temperate } = {},
) {
  const random = seededRandom((route.seed >>> 0) ^ 0x6a55);
  const halfWidth = roadHalfWidth(route.lanes) + VERGE;
  const { mesh, own } = target(into);
  let placed = 0;
  const spot = () => {
    const frame = roadFrame(route, random() * route.length);
    const side = random() < 0.5 ? -1 : 1;
    const offset = halfWidth + 0.4 + Math.pow(random(), 1.5) * reach;
    const [x, , z] = add(frame.center, scale(frame.right, side * offset));
    // On tight bends a spot beside one segment can land on the next one.
    if (terrain.distanceToRoad(x, z) < halfWidth + 0.2 || blocked(x, z)) return null;
    const y = terrain.height(x, z);
    return y < water + 2.5 ? null : [x, y, z];
  };
  for (let i = 0; i < tufts; i += 1) {
    const p = spot();
    if (!p) continue;
    placed += 1;
    biome.flora.tuft({ mesh, x: p[0], y: p[1], z: p[2], random });
  }
  for (let i = 0; i < flowers; i += 1) {
    const p = spot();
    if (!p) continue;
    placed += 1;
    biome.flora.flower({ mesh, x: p[0], y: p[1], z: p[2], random });
  }
  return { mesh: own ? mesh.build() : mesh, count: placed };
}

/**
 * Far-off islands on the horizon, out at sea around the map's island: a few
 * hazy rocky hills, some in small groups.
 */
export function buildFarIslands(route, terrain, { count = 11, distance = 1300, biome = temperate } = {}) {
  const random = seededRandom((terrain.seed ?? route.seed >>> 0) ^ 0x3a7);
  const mesh = new MeshBuilder();
  const island = terrain.island;
  const [cx, cz] = island?.center ?? terrain.index.center;
  const sea = terrain.seaLevel ?? waterLevel(terrain.index);
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + random() * 0.6) / count) * Math.PI * 2;
    const coast = island ? island.radiusAt(angle) : 1500;
    const far = coast + distance + random() * 2400;
    const hills = 1 + Math.floor(random() * 3);
    for (let h = 0; h < hills; h += 1) {
      const height = (h === 0 ? 120 : 50) + random() * (h === 0 ? 260 : 110);
      const radius = height * (1.6 + random() * 0.8);
      const a = angle + (random() - 0.5) * 0.08;
      const d = far + radius + random() * 300;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const color = random() < 0.5 ? biome.farIsland : biome.farIslandDark;
      // A rounded hump, mostly under water, with a rocky top on the taller ones.
      const depth = height * 0.4;
      mesh.ellipsoid([x, sea - depth, z], [radius, height + depth, radius * (0.55 + random() * 0.4)], color, 5, 9, random() * Math.PI);
      if (height > 220) mesh.cone([x, sea + height * 0.55, z], radius * 0.28, height * 0.62, biome.rock, 6, random() * Math.PI);
    }
  }
  return mesh.build();
}

/** The sea (or any water level): one flat plane; it only shows where the land dips below it. */
export function buildWater(terrain, level, size = 40000, biome = temperate) {
  const mesh = new MeshBuilder();
  const [cx, cz] = terrain.island?.center ?? terrain.index.center;
  const h = size / 2;
  const color = biome.water.color ?? biome.water;
  mesh.quad([cx - h, level, cz - h], [cx - h, level, cz + h], [cx + h, level, cz + h], [cx + h, level, cz - h], color);
  return mesh.build();
}

/** Puffy low-poly clouds high above the route, shaped by the biome's sky. */
export function buildClouds(route, terrain, { count, spread, biome = temperate } = {}) {
  const style = biome.sky?.clouds ?? temperate.sky.clouds;
  const random = seededRandom((terrain.seed ?? route.seed >>> 0) ^ 0xc10d);
  const mesh = new MeshBuilder();
  const [cx, cz] = terrain.index.center;
  const total = count ?? style.count;
  const span = spread ?? style.spread;
  for (let i = 0; i < total; i += 1) {
    const x = cx + (random() - 0.5) * 2 * span;
    const z = cz + (random() - 0.5) * 2 * span;
    const y = terrain.index.meanElevation + style.altitude[0] + random() * style.altitude[1];
    const puffs = style.puffs[0] + Math.floor(random() * style.puffs[1]);
    const size = style.radius[0] + random() * style.radius[1];
    for (let p = 0; p < puffs; p += 1) {
      const offset = [(random() - 0.5) * size * style.offset[0], random() * size * style.offset[1], (random() - 0.5) * size * style.offset[2]];
      const r = size * (style.puffRadius[0] + random() * style.puffRadius[1]);
      mesh.ellipsoid(add([x, y, z], offset), [r, r * style.squash[0], r * style.squash[1]], style.color, style.segments[0], style.segments[1], random() * Math.PI);
    }
  }
  return mesh.build();
}

/**
 * What a camera flying over the map needs to know, as plain data: the
 * island's centre and size, the sea level, and a coarse height grid so it
 * never flies into a hill.
 */
export function worldOverview(terrain, sea, cell = 100) {
  const island = terrain.island;
  const center = island?.center ?? terrain.index.center;
  let radius = 1500;
  if (island) for (let a = 0; a < 360; a += 5) radius = Math.max(radius, island.radiusAt((a * Math.PI) / 180));
  const x0 = Math.floor((center[0] - radius - cell) / cell) * cell;
  const z0 = Math.floor((center[1] - radius - cell) / cell) * cell;
  const columns = Math.ceil((2 * radius + 2 * cell) / cell) + 1;
  const heights = new Float32Array(columns * columns);
  for (let r = 0; r < columns; r += 1) {
    for (let c = 0; c < columns; c += 1) heights[r * columns + c] = Math.max(sea, terrain.height(x0 + c * cell, z0 + r * cell));
  }
  return { center, radius, sea, grid: { x0, z0, cell, columns, rows: columns, heights } };
}

/**
 * Stretches of `route` (by distance) that run on points already drawn for
 * one of `drawn`, in either direction: map routes and network roads share
 * stretches point for point (ADR 0010).
 */
export function sharedStretches(route, drawn) {
  const key = (n) => `${n.x.toFixed(2)},${n.y.toFixed(2)}`;
  const taken = new Set();
  for (const other of drawn) {
    for (let i = 0; i + 1 < other.nodes.length; i += 1) {
      // Either way round: a route may ride a road of the network backwards.
      taken.add(`${key(other.nodes[i])}>${key(other.nodes[i + 1])}`);
      taken.add(`${key(other.nodes[i + 1])}>${key(other.nodes[i])}`);
    }
  }
  const stretches = [];
  for (let i = 0; i + 1 < route.nodes.length; i += 1) {
    if (!taken.has(`${key(route.nodes[i])}>${key(route.nodes[i + 1])}`)) continue;
    const from = route.cumulative[i];
    const to = route.cumulative[i + 1];
    const last = stretches[stretches.length - 1];
    if (last && Math.abs(last.to - from) < 1e-6) last.to = to;
    else stretches.push({ from, to });
  }
  return stretches;
}

const onStretches = (stretches, d) => stretches.some((s) => d >= s.from - 1e-6 && d <= s.to + 1e-6);

/**
 * A route this long (a 180 km course) can't have the valley's density all
 * along it: the world would have millions of triangles. Scenery, ground
 * detail, roads and far terrain get this much thinner instead.
 */
export const LONG_ROUTE_M = 60_000;
const LONG = Object.freeze({ trees: 0.12, ground: 0.1, roadStep: 8, markingStep: 6, railGrade: 6, railStep: 8, detailReach: 120, outerCell: 400 });

/**
 * Builds the whole world for a route and the `others` on its map, or, given
 * the map's road `network` (#26), for the route on that network.
 *
 * Shared things (terrain, rivers, villages, farms, trees) are built for all
 * routes in a fixed order, so the world looks the same whichever route you
 * ride; markers, arches, spectators and signs belong to the ridden route.
 * With a network they are built per road instead, so a road several routes
 * share is decorated once, and every café of the map gets its café.
 *
 * Returns chunked groups (drawn and shadowed only near the camera/rider),
 * always-drawn meshes (horizon, far islands, arches), blended meshes (sea,
 * rivers) and dynamic objects the view animates (turbine rotors, spectators).
 */
export function buildWorld(route, { others = [], network = null, biome = temperate } = {}) {
  biome = resolveBiome(typeof biome === "string" ? biome : biome.id);
  const density = biome.flora.density;
  const roads = network ? network.roads() : null;
  // Everything drawn as a road (the ridden route first), and what the shared
  // things are built along.
  const routes = network ? [route, ...roads] : [route, ...others.filter((o) => o.id !== route.id)];
  const ordered = network ? roads : [...routes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seed = network ? network.seed : mapSeed(route);
  const zonesOf = new Map(routes.map((r) => [r, resolveZones(r)]));
  // Every route of the map keeps its asphalt clear, whichever is ridden, so the world looks the same from all of them.
  const mapRoutes = [route, ...others.filter((o) => o.id !== route.id)];
  const base = network ? networkTerrain(network, roads, { keepClear: mapRoutes }) : terrainModel(ordered, { seed });
  const sea = waterLevel(base.index);
  const rivers = ordered.flatMap((r) => zonesOf.get(r).rivers.map((z) => ({ ...buildRiverPath(r, base, z.at, r.seed >>> 0, sea), route: r })));
  const terrain = rivers.length > 0 ? withRivers(base, rivers, sea - RIVER.mouthDepth) : { ...base, riverDistance: () => Infinity };
  const half = roadHalfWidth(route.lanes) + VERGE;

  const chunks = {
    terrain: new ChunkedMesh(),
    road: new ChunkedMesh(),
    detail: new ChunkedMesh(),
    scenery: new ChunkedMesh(),
    structures: new ChunkedMesh(),
    bright: new ChunkedMesh(),
  };

  const long = route.length > LONG_ROUTE_M;
  const ground = buildTerrain(terrain, { into: chunks.terrain, biome, ...(long ? { detailReach: LONG.detailReach, outerCell: LONG.outerCell } : {}) });

  // Nodes where a network's roads meet, for the junction pads.
  const degree = new Map();
  if (network) for (const road of roads) for (const id of [road.edge.from, road.edge.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  // Ploughed banks flatten out near a fork or corner, so no road's snow
  // shoulder runs across another road's asphalt.
  const junctionPoints = junctionClearings(network);
  const bankAt = (x, z) => junctionBankAt(junctionPoints, x, z);

  // The ridden road on top; the others skip what is already drawn and sit
  // lower where they overlap it at junctions, markings included.
  const shared = new Map();
  // On a network the ridden route runs on roads of the index: those aren't "other" roads to it.
  const ridden = new Set(network ? roads.filter((road) => sharedStretches(road, [route]).length > 0) : []);
  for (const [i, r] of routes.entries()) {
    const stretches = sharedStretches(r, routes.slice(0, i));
    shared.set(r, stretches);
    const other = (s) => s.route !== r && !(i === 0 && ridden.has(s.route));
    const otherRoad = (x, z) => base.index.nearest(x, z, 1, other)?.distance < roadHalfWidth(r.lanes) + VERGE;
    buildRoad(r, { into: chunks.road, biome, ...(long ? { step: LONG.roadStep, markingStep: LONG.markingStep, detail: false } : {}), lift: i === 0 ? ROAD_LIFT.ridden : ROAD_LIFT.other, skip: (d) => onStretches(stretches, d), clear: otherRoad, ...(junctionPoints.length ? { bankAt } : {}) });
  }

  // Where roads of a network meet at an angle, an asphalt pad closes the
  // gap between their square ends (under every road, so markings stay on top).
  if (network) {
    for (const node of network.nodes.values()) {
      if ((degree.get(node.id) ?? 0) >= 2) buildJunctionPad(node, chunks.road, { biome });
    }
  }

  // Places other features must keep clear of.
  const occupancy = new Occupancy();
  const nearRiver = (x, z, margin = 0) => terrain.riverDistance(x, z) < RIVER.halfWidth + RIVER.bank * 0.6 + margin;
  const nearRoad = (x, z, radius) => terrain.distanceToRoad(x, z) < half + radius * 0.8;
  const avoid = (x, z, radius = 0) => nearRiver(x, z, radius) || terrain.height(x, z) < ground.water + 2.5 || nearRoad(x, z, radius);
  const onBridge = (r, d) => rivers.some((river) => river.route === r && Math.abs(r.wrap(d - river.at + r.length / 2) - r.length / 2) < BRIDGE_HALF_LENGTH + 6);

  for (const river of rivers) buildBridge(river.route, terrain, river, chunks.structures, biome);
  for (const r of ordered) {
    for (const village of zonesOf.get(r).villages) {
      buildVillage(r, terrain, village, { structures: chunks.structures, bright: chunks.bright, occupancy, seed: r.seed >>> 0, avoid, biome });
    }
  }
  // The bike café where rides start, before anything else claims the spot
  // (one for all routes that start at the same place). A network has its
  // cafés as places: each gets one, beside the ridden route where it starts.
  const cafeRoads = network
    ? network.cafes().flatMap((cafe) => {
        const start = route.positionAt(0);
        if (Math.hypot(start.x - cafe.x, start.y - cafe.y) < 30) return [{ road: route, cafeId: cafe.id }];
        const road = network.roadFrom(cafe.id);
        return road ? [{ road, cafeId: cafe.id }] : [];
      })
    : ordered.map((road) => ({ road, cafeId: null }));
  const cafes = [];
  const cafeSpots = [];
  const gyms = [];
  let studio = null;
  for (const { road: r, cafeId } of cafeRoads) {
    const start = r.positionAt(0);
    if (cafes.some((c) => Math.hypot(c.x - start.x, c.y - start.y) < 30)) continue;
    cafes.push(start);
    const cafe = buildBikeCafe(r, terrain, { structures: chunks.structures, bright: chunks.bright, occupancy, avoid, biome });
    if (!cafe) continue;
    cafeSpots.push(cafe.position);
    // The outdoor gym next to it, where workout riders train (#77).
    const gym = buildOutdoorGym(r, terrain, { structures: chunks.structures, bright: chunks.bright, occupancy, avoid, biome, cafeId });
    if (gym) gyms.push(gym);
    // The spin studio across the road from the Valley Café only.
    if (cafeId === "valley-cafe") studio = studioSite(r, terrain, { occupancy, avoid });
  }
  // Route files: seven farms each. Network roads: about one per kilometre.
  const farmsOn = (r) => (network ? Math.max(1, Math.round(r.length / 1000)) : undefined);
  for (const r of ordered) buildFarms(r, terrain, { structures: chunks.structures, occupancy, seed: r.seed >>> 0, count: farmsOn(r), lakeLevel: ground.water, avoid, biome });
  const rotors = buildWindTurbines(route, terrain, {
    structures: chunks.structures,
    occupancy,
    seed,
    bounds: ground.bounds,
    lakeLevel: ground.water,
    avoid,
    biome,
  });
  const spectators = buildSpectators(route, terrain, { structures: chunks.structures, seed: route.seed >>> 0, biome, blocked: (x, z) => nearRiver(x, z) || occupancy.blocked(x, z, 1) });
  // The crowd's two poses are biome models like every other shape; the view
  // only alternates them (and adds the hop) while drawing.
  const spectatorMeshes = [biome.people.model(false), biome.people.model(true)];
  for (const r of ordered) {
    const { villages, cliffs } = zonesOf.get(r);
    buildRoadside(r, terrain, {
      cliffs,
      structures: chunks.structures,
      bright: chunks.bright,
      markers: r === route,
      twoWay: Boolean(network),
      biome,
      ...(long ? { railGrade: LONG.railGrade, railStep: LONG.railStep } : {}),
      skip: (d) => (!network && onStretches(shared.get(r), d)) || onBridge(r, d) || inStretch(r, villages, d, 10),
    });
  }
  // On a network the roads have the rails; the ridden route adds its signs.
  if (network) buildRoadside(route, terrain, { structures: chunks.structures, bright: chunks.bright, rails: false, biome });

  // Villages keep their streets clear of trees; nothing grows in rivers or buildings.
  const inVillage = (x, z) => {
    const near = terrain.index.nearest(x, z);
    return near !== null && near.distance < 70 && inStretch(near.sample.route, zonesOf.get(near.sample.route).villages, near.sample.distance, 20);
  };
  const blocked = (x, z) => nearRiver(x, z, -RIVER.bank * 0.4) || occupancy.blocked(x, z, 2) || inVillage(x, z);
  const detailBlocked = (x, z) => nearRiver(x, z, -RIVER.bank * 0.7) || occupancy.blocked(x, z) || (inVillage(x, z) && terrain.distanceToRoad(x, z) < half + PAVEMENT + 1);
  for (const r of ordered) {
    const km = r.length / 1000;
    const margin = 450;
    const { minX, maxX, minY, maxY } = r.bounds;
    const bounds = { x0: minX - margin, z0: -maxY - margin, x1: maxX + margin, z1: -minY + margin };
    buildScenery(r, terrain, bounds, { biome, water: ground.water, into: chunks.scenery, blocked, forests: zonesOf.get(r).forests, count: Math.round(density.trees * km * (long ? LONG.trees : 1)) });
    // Grass and flowers only show close up: thinner along the roads you don't ride.
    const detail = (network && !ridden.has(r) ? density.elsewhere : 1) * (long ? LONG.ground : 1);
    buildGroundDetail(r, terrain, {
      biome,
      water: ground.water,
      into: chunks.detail,
      tufts: Math.round(density.tufts * km * detail),
      flowers: Math.round(density.flowers * km * detail),
      blocked: detailBlocked,
    });
  }

  const rivers3d = new MeshBuilder();
  for (const river of rivers) buildRiverWater(river, rivers3d, biome.river ?? undefined);

  return {
    // The view needs the biome to resolve its sky and lighting at render time.
    biome: biome.id,
    terrain,
    zones: zonesOf.get(route),
    cafes: cafeSpots,
    gyms,
    studio,
    waterLevel: ground.water,
    overview: worldOverview(terrain, ground.water),
    chunks: Object.fromEntries(Object.entries(chunks).map(([name, mesh]) => [name, mesh.build()])),
    meshes: {
      horizon: ground.mesh,
      arches: buildArches(route, { biome }),
      islands: buildFarIslands(route, terrain, { biome }),
    },
    clouds: buildClouds(route, terrain, { biome }),
    weather: buildWeather(terrain, { biome }),
    water: buildWater(terrain, ground.water, Math.max(40000, ground.horizon * 4), biome),
    rivers: rivers3d.build(),
    rotors,
    spectators,
    spectatorMeshes,
  };
}
