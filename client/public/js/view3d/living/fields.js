/**
 * The Living island's land: what grows where, as plain data.
 *
 * The land splits into blocks turned along the nearest road; a block is rows of
 * straight-edged parcels, each with one crop. Everything here is deterministic
 * from the map seed, reads height and slope from a coarse grid, and runs in
 * the world worker and under `node --test`.
 */
import { fbm } from "../noise.js";
import { RIVER } from "../features.js";

const BLOCK = 650;
/** Land at most this far from a block's seed is searched for; beyond the Voronoi neighbours nothing can be nearer. */
const REACH = BLOCK * 1.3;
const RUN_STEP = 40;
/** How far from a road `grid.roadAt` still tells a distance. */
const ROAD_REACH = 800;

/** Heights above the sea (metres) at which the land changes class. */
const LAND = Object.freeze({ wetSand: 0.7, sand: 2.4, dunes: 5, farm: 55, rough: 95, moor: 280, rockSteep: 0.6, beachSteep: 0.5 });

/** Crops of lowland parcels and their shares. */
const CROPS = Object.freeze([
  ["pasture", 0.3],
  ["meadow", 0.27],
  ["wheat", 0.17],
  ["hay", 0.1],
  ["ploughed", 0.1],
  ["rapeseed", 0.03],
  ["lavender", 0.015],
  ["sunflower", 0.015],
]);
/** How many of a block's parcels grow its main crop, so neighbours often match. */
const BLOCK_CROP_SHARE = 0.55;
const ROUGH_FIELDS = 0.2;
/** Farmland gathers within this of a road; a parcel is farmed when its score beats `FARMED_ABOVE`. */
const FARM_REACH = 500;
const FARMED_ABOVE = 0.55;

/** A number in [0, 1) from a few integers. */
function scramble(a, b, c = 0, d = 0) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519) ^ Math.imul(d, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 7), 2869860233);
  h ^= h >>> 14;
  return (h >>> 0) / 4294967296;
}

/** Distance to the nearest road on the grid's nodes, saturating at `ROAD_REACH`. */
function roadDistances(terrain, box, cell, columns, rows) {
  const out = new Float32Array(columns * rows).fill(ROAD_REACH);
  const span = Math.ceil(ROAD_REACH / cell);
  const { samples } = terrain.index;
  for (let k = 0; k < samples.length; k += 3) {
    const s = samples[k];
    const c0 = Math.round((s.x - box.x0) / cell);
    const r0 = Math.round((s.z - box.z0) / cell);
    for (let r = Math.max(0, r0 - span); r <= Math.min(rows - 1, r0 + span); r += 1) {
      const dz = box.z0 + r * cell - s.z;
      for (let c = Math.max(0, c0 - span); c <= Math.min(columns - 1, c0 + span); c += 1) {
        const dx = box.x0 + c * cell - s.x;
        const squared = dx * dx + dz * dz;
        const i = r * columns + c;
        if (squared < out[i] * out[i]) out[i] = Math.sqrt(squared);
      }
    }
  }
  return out;
}

/** Height, slope and river distance on a coarse grid over `box`, so nothing needs per-pixel terrain lookups. */
export function groundGrid(terrain, box, cell = 32) {
  const columns = Math.ceil((box.x1 - box.x0) / cell) + 1;
  const rows = Math.ceil((box.z1 - box.z0) / cell) + 1;
  const nodes = columns * rows;
  const roads = roadDistances(terrain, box, cell, columns, rows);
  const heights = new Float32Array(nodes);
  const rivers = new Float32Array(nodes);
  const steeps = new Float32Array(nodes);
  for (let r = 0, i = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1, i += 1) {
      const x = box.x0 + c * cell;
      const z = box.z0 + r * cell;
      heights[i] = terrain.height(x, z);
      rivers[i] = Math.min(terrain.riverDistance(x, z), 1000);
    }
  }
  for (let r = 0, i = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1, i += 1) {
      const left = heights[r * columns + Math.max(0, c - 1)];
      const right = heights[r * columns + Math.min(columns - 1, c + 1)];
      const up = heights[Math.max(0, r - 1) * columns + c];
      const down = heights[Math.min(rows - 1, r + 1) * columns + c];
      steeps[i] = Math.hypot(right - left, down - up) / (2 * cell);
    }
  }
  const sample = (values, x, z) => {
    const u = Math.max(0, Math.min(columns - 1.001, (x - box.x0) / cell));
    const v = Math.max(0, Math.min(rows - 1.001, (z - box.z0) / cell));
    const c = Math.floor(u);
    const r = Math.floor(v);
    const fu = u - c;
    const fv = v - r;
    const i = r * columns + c;
    const top = values[i] + (values[i + 1] - values[i]) * fu;
    const bottom = values[i + columns] + (values[i + columns + 1] - values[i + columns]) * fu;
    return top + (bottom - top) * fv;
  };
  return {
    box,
    cell,
    columns,
    rows,
    sample,
    heightAt: (x, z) => sample(heights, x, z),
    steepAt: (x, z) => sample(steeps, x, z),
    riverAt: (x, z) => sample(rivers, x, z),
    /** Distance to the nearest road, up to `ROAD_REACH` metres, however far from a road sample's bucket. */
    roadAt: (x, z) => sample(roads, x, z),
  };
}

/** The tangent angle of the road nearest (x, z), looked for along the whole network. */
function roadAngle(index, x, z) {
  let best = null;
  let bestSquared = Infinity;
  for (let i = 0; i < index.samples.length; i += 6) {
    const s = index.samples[i];
    const squared = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = s;
    }
  }
  if (!best) return 0;
  const here = best.route.positionAt(best.distance);
  const on = best.route.positionAt(best.distance + 10);
  return Math.atan2(-(on.y - here.y), on.x - here.x);
}

class Fields {
  #grid;
  #sea;
  #seed;
  #woodNoise;
  #villages;
  #box;
  #columns;
  #first;
  #blocks = new Map();
  #parcels = new Map();
  #edges = null;
  /** Read at build time: `features.js` and this module import each other through `world.js`. */
  #riverMeadow = RIVER.halfWidth + 9;
  /** The position inside the last parcel `locate` found. */
  localU = 0;
  localV = 0;

  constructor(terrain, grid, { seed, sea, villages }) {
    this.terrain = terrain;
    this.#grid = grid;
    this.#sea = sea;
    this.#seed = seed;
    this.#box = grid.box;
    const { columns, rows, cell, box } = grid;
    this.#woodNoise = new Float32Array(columns * rows);
    this.#villages = new Float32Array(columns * rows);
    for (let r = 0, i = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1, i += 1) {
        const x = box.x0 + c * cell;
        const z = box.z0 + r * cell;
        // Woods wander (a warped noise) and prefer slopes and riverbanks to open flats.
        const warp = (fbm(x / 900, z / 900, seed + 17, 2) - 0.5) * 500;
        const banks = grid.riverAt(x, z) < RIVER.halfWidth + 70 ? 0.06 : 0;
        this.#woodNoise[i] = fbm((x + warp) / 420, (z - warp) / 420, seed + 11) + Math.min(grid.steepAt(x, z), 0.3) * 0.35 + banks;
        this.#villages[i] = villages(x, z) ? 1 : 0;
      }
    }
    this.#first = [Math.floor(box.x0 / BLOCK) - 2, Math.floor(box.z0 / BLOCK) - 2];
    this.#columns = Math.ceil((box.x1 - box.x0) / BLOCK) + 5;
  }

  #block(i, j) {
    const key = (j - this.#first[1]) * this.#columns + (i - this.#first[0]);
    let block = this.#blocks.get(key);
    if (block) return block;
    const seed = this.#seed;
    const x = (i + 0.15 + scramble(i, j, seed, 1) * 0.7) * BLOCK;
    const z = (j + 0.15 + scramble(i, j, seed, 2) * 0.7) * BLOCK;
    const angle = roadAngle(this.terrain.index, x, z);
    // Some blocks have big fields and some small ones, so the land isn't one even grid.
    const size = 0.75 + scramble(i, j, seed, 4) * 0.95;
    block = { i, j, x, z, angle, size, cos: Math.cos(angle), sin: Math.sin(angle), depth: (110 + scramble(i, j, seed, 3) * 60) * size, crop: scramble(i, j, seed, 9) };
    this.#blocks.set(key, block);
    return block;
  }

  /** The block whose seed is nearest (x, z). */
  #blockAt(x, z) {
    const ci = Math.floor(x / BLOCK);
    const cj = Math.floor(z / BLOCK);
    let best = null;
    let bestSquared = Infinity;
    for (let j = cj - 1; j <= cj + 1; j += 1) {
      for (let i = ci - 1; i <= ci + 1; i += 1) {
        const block = this.#block(i, j);
        const squared = (block.x - x) ** 2 + (block.z - z) ** 2;
        if (squared < bestSquared) {
          bestSquared = squared;
          best = block;
        }
      }
    }
    return best;
  }

  #rowOf(block, row) {
    const seed = this.#seed;
    const length = Math.max(80, (80 + scramble(block.i, block.j, row, seed + 5) * 120) * block.size);
    return { length, offset: scramble(block.i, block.j, row, seed + 6) * length };
  }

  /** Farmland gathers along the roads, in clusters that a block's parcels share, and leaves steep ground alone. */
  #farmed(id, center, block) {
    const near = 1 - Math.min(this.#grid.roadAt(center[0], center[1]), FARM_REACH) / FARM_REACH;
    const cluster = (scramble(block.i, block.j, this.#seed, 8) - 0.5) * 0.8;
    const own = (scramble(id, this.#seed, 14) - 0.5) * 0.3;
    return near + cluster + own - Math.min(this.#grid.steepAt(center[0], center[1]), 0.3) > FARMED_ABOVE;
  }

  #cropOf(id, center, block) {
    const roll = scramble(id, this.#seed, 7);
    const height = this.#grid.heightAt(center[0], center[1]) - this.#sea;
    if (height >= LAND.farm) return roll < 0.5 ? "pasture" : "meadow";
    const pick = scramble(id, this.#seed, 15) < BLOCK_CROP_SHARE ? block.crop : roll;
    // A gentle regional bias: pasture here, more wheat there.
    const region = fbm(center[0] / 1700, center[1] / 1700, this.#seed + 29, 2) - 0.5;
    let upTo = 0;
    for (const [crop, share] of CROPS) {
      upTo += share + (crop === "pasture" ? region * 0.18 : crop === "wheat" ? -region * 0.18 : 0);
      if (pick < upTo) return crop;
    }
    return "meadow";
  }

  /** The parcel record at (x, z), ignoring what the land there is; fills `localU` / `localV`. */
  locate(x, z) {
    const block = this.#blockAt(x, z);
    const dx = x - block.x;
    const dz = z - block.z;
    const u = dx * block.cos + dz * block.sin;
    const v = dz * block.cos - dx * block.sin;
    const row = Math.floor(v / block.depth);
    const { length, offset } = this.#rowOf(block, row);
    const along = u + offset;
    const index = Math.floor(along / length);
    this.localU = along - index * length;
    this.localV = v - row * block.depth;
    const id = Math.floor(scramble(block.i, block.j, row, index) * 2 ** 31);
    let parcel = this.#parcels.get(id);
    if (!parcel) {
      const cu = (index + 0.5) * length - offset;
      const cv = (row + 0.5) * block.depth;
      const center = [block.x + cu * block.cos - cv * block.sin, block.z + cu * block.sin + cv * block.cos];
      parcel = { id, crop: this.#cropOf(id, center, block), farmed: this.#farmed(id, center, block), angle: block.angle, width: length, depth: block.depth, center };
      this.#parcels.set(id, parcel);
    }
    return parcel;
  }

  /** What covers the ground at (x, z): one of "sea", "wetSand", "sand", "dunes", "river", "village", "rock", "farm", "rough", "moor", "scree". */
  landAt(x, z) {
    const height = this.#grid.heightAt(x, z) - this.#sea;
    if (height < 0) return "sea";
    const steep = this.#grid.steepAt(x, z);
    if (height < LAND.dunes && steep < LAND.beachSteep) {
      if (height < LAND.wetSand) return "wetSand";
      return height < LAND.sand ? "sand" : "dunes";
    }
    if (this.#grid.riverAt(x, z) < this.#riverMeadow) return "river";
    if (this.#grid.sample(this.#villages, x, z) >= 0.5) return "village";
    if (steep > LAND.rockSteep) return "rock";
    if (height < LAND.farm) return "farm";
    if (height < LAND.rough) return "rough";
    return height < LAND.moor ? "moor" : "scree";
  }

  /** The crop parcel covering (x, z), or null where the land has none. */
  parcelAt(x, z) {
    const land = this.landAt(x, z);
    return this.parcelOn(land, x, z);
  }

  /** The shared parcel record on `land` at (x, z), or null; fills `localU` / `localV`. Allocates nothing, for the painter. */
  parcelRecord(land, x, z) {
    if (land !== "farm" && land !== "village" && land !== "rough") return null;
    const parcel = this.locate(x, z);
    if (land === "rough" && scramble(parcel.id, this.#seed, 13) >= ROUGH_FIELDS) return null;
    if (land === "farm" && !parcel.farmed) return null;
    return parcel;
  }

  /** `parcelAt` for a caller that already knows the land there. */
  parcelOn(land, x, z) {
    const parcel = this.parcelRecord(land, x, z);
    if (!parcel) return null;
    const crop = land === "village" ? "garden" : parcel.crop;
    return { id: land === "village" ? -parcel.id - 1 : parcel.id, crop, angle: parcel.angle, u: this.localU, v: this.localV, width: parcel.width, depth: parcel.depth, center: parcel.center };
  }

  /** How wooded the ground at (x, z) is, 0…1. */
  woodAt(x, z) {
    const land = this.landAt(x, z);
    if (land !== "rough" && land !== "moor" && land !== "farm") return 0;
    if (this.parcelRecord(land, x, z)) return 0;
    return Math.max(0, Math.min(1, (this.#grid.sample(this.#woodNoise, x, z) - 0.58) / 0.12));
  }

  #hasParcel(x, z) {
    const land = this.landAt(x, z);
    return this.parcelRecord(land, x, z) !== null;
  }

  /** Straight runs along the parcel boundaries (cached): `{ a: [x, z], b: [x, z] }`. */
  edges() {
    if (this.#edges) return this.#edges;
    const edges = [];
    const box = this.#box;
    const [i0, j0] = [Math.floor(box.x0 / BLOCK), Math.floor(box.z0 / BLOCK)];
    const [i1, j1] = [Math.floor(box.x1 / BLOCK), Math.floor(box.z1 / BLOCK)];
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const block = this.#block(i, j);
        if (this.#grid.heightAt(block.x, block.z) - this.#sea < -40) continue;
        const toWorld = (u, v) => [block.x + u * block.cos - v * block.sin, block.z + u * block.sin + v * block.cos];
        const run = (u0, v0, u1, v1) => {
          const steps = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / RUN_STEP));
          let start = null;
          let last = null;
          for (let s = 0; s <= steps; s += 1) {
            const p = toWorld(u0 + ((u1 - u0) * s) / steps, v0 + ((v1 - v0) * s) / steps);
            const inside = this.#blockAt(p[0], p[1]) === block && this.#hasParcel(p[0], p[1]);
            if (inside) {
              start ??= p;
              last = p;
            }
            if ((!inside || s === steps) && start && last !== start) {
              edges.push({ a: start, b: last });
            }
            if (!inside) start = last = null;
          }
        };
        const rows = Math.ceil(REACH / block.depth);
        for (let row = -rows; row <= rows; row += 1) {
          const v = row * block.depth;
          const { length, offset } = this.#rowOf(block, row);
          const cuts = Math.ceil(REACH / length);
          // The boundary with the row before it, cut where this row's parcels end.
          for (let c = -cuts; c < cuts; c += 1) run(c * length - offset, v, (c + 1) * length - offset, v);
          // The splits between this row's parcels.
          for (let c = -cuts; c <= cuts; c += 1) run(c * length - offset, v, c * length - offset, v + block.depth);
        }
      }
    }
    this.#edges = edges;
    return edges;
  }
}

/** The land of an island. */
export function buildFields(terrain, grid, options) {
  return new Fields(terrain, grid, options);
}
