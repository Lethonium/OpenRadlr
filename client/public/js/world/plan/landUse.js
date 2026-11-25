/**
 * Land use over the whole island: rectangular parcels of arable, pasture,
 * orchard, vineyard, scrub, dune and fallow, laid in strips along the grain of
 * the nearest road (or of a noise field away from roads) and drawn per place
 * from `landKindWeights`: the region, the distance to the sea and to a village,
 * the slope and the height. Wild land gets no parcel; the woods take it.
 * Pure and seeded; it stamps the parcels the woods must keep off (all but scrub and dunes) on the masks like a field.
 */
import { LAND_STYLE, landKindWeights, regionEdge } from "../landKinds.js";
import { fbm, seededRandom } from "../noise.js";
import { REGION_STYLE } from "../regionKinds.js";
import { regionMix } from "../regions.js";
import { MASK, maskAt, stampField } from "./masks.js";
import { cornersOf } from "./fields.js";

export const LAND_USE = Object.freeze({
  block: 800, // metres: the land is walked in squares of about this side
  maxBlocks: 4000, // bigger squares on a huge island keep the walk bounded
  maxParcels: 30000,
  grainReach: 600, // a road's tangent sets the grain this far from it
  strip: Object.freeze([110, 300]), // strip depth
  jitter: 0.15,
  testStep: 10,
  minAbove: 1,
  shoreCell: 50, // the sea-distance field's cell; coarser on a huge island
  maxShoreCells: 400_000,
  roadArable: 2.6, // arable is this many times likelier within `roadReach` of a road: the draped fields live there
  roadReach: 260,
  farmedBoost: 1, // a block is farmed with this times its non-wild share (patches fill more than the sprinkled parcels did)
  overlap: 0.2, // a block also takes parcels this share of its side beyond its edge, so the blocks' grains meet without a gap
  stripTurn: 0.14, // radians: each strip's angle strays this much from its block's grain (about 8°)
  widthVary: Object.freeze([0.5, 1.5]), // a parcel's width, as a multiple of the size drawn
  neutralVillage: 800, // metres to a village on a map that has none
});

/**
 * @typedef {object} Parcel
 * @property {string} kind one of `LAND_KINDS`
 * @property {number} x centre
 * @property {number} z
 * @property {number} width along `yaw`
 * @property {number} depth across it
 * @property {number} yaw angle of the width axis: (cos yaw, sin yaw) in world x/z
 * @property {Float32Array} corners x, y, z of the four corners (-w -d, +w -d, +w +d, -w +d), terrain heights
 * @property {string} region kind of the strongest region at the parcel
 * @property {string|null} crop a plant id of the region's crops for the season (arable only)
 * @property {"wall"|"hedge"|"none"} edge
 * @property {number} tint per-parcel shade, -1 to 1
 */

/** Parcels the woods may plant over: scrub and dunes are wooded land; orchards and vineyards get rows of their own. */
const OPEN_TO_TREES = new Set(["scrub", "dune"]);

const lerp = ([a, b], t) => a + (b - a) * t;
const pickKind = (weights, roll) => {
  let rest = roll;
  for (const kind of Object.keys(weights)) {
    rest -= weights[kind];
    if (rest < 0) return kind;
  }
  return "wild";
};

/** Metres to the sea from each cell of a coarse grid: a two-pass chamfer distance from the cells below `water`. */
function shoreField({ terrain, water, bounds }) {
  const area = (bounds.x1 - bounds.x0) * (bounds.z1 - bounds.z0);
  const cell = Math.max(LAND_USE.shoreCell, Math.ceil(Math.sqrt(area / LAND_USE.maxShoreCells)));
  const columns = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell));
  const rows = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cell));
  const dist = new Float32Array(columns * rows).fill(Infinity);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      if (terrain.height(bounds.x0 + (i + 0.5) * cell, bounds.z0 + (j + 0.5) * cell) < water) dist[j * columns + i] = 0;
    }
  }
  const D = Math.SQRT2;
  const relax = (index, from, step) => {
    if (dist[from] + step < dist[index]) dist[index] = dist[from] + step;
  };
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const k = j * columns + i;
      if (i > 0) relax(k, k - 1, 1);
      if (j > 0) {
        relax(k, k - columns, 1);
        if (i > 0) relax(k, k - columns - 1, D);
        if (i < columns - 1) relax(k, k - columns + 1, D);
      }
    }
  }
  for (let j = rows - 1; j >= 0; j -= 1) {
    for (let i = columns - 1; i >= 0; i -= 1) {
      const k = j * columns + i;
      if (i < columns - 1) relax(k, k + 1, 1);
      if (j < rows - 1) {
        relax(k, k + columns, 1);
        if (i < columns - 1) relax(k, k + columns + 1, D);
        if (i > 0) relax(k, k + columns - 1, D);
      }
    }
  }
  return (x, z) => {
    const i = Math.min(columns - 1, Math.max(0, Math.floor((x - bounds.x0) / cell)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor((z - bounds.z0) / cell)));
    return dist[j * columns + i] * cell;
  };
}

/** Direction of the nearest road within reach as an angle, else null. */
function roadGrain(roads, x, z) {
  const near = roads.nearest(x, z, Math.ceil(LAND_USE.grainReach / (roads.cell ?? 60)));
  const route = near?.sample.route;
  if (!near || near.distance > LAND_USE.grainReach || typeof route?.positionAt !== "function") return null;
  const d = near.sample.distance;
  const a = route.positionAt(Math.max(0, d - 4));
  const b = route.positionAt(d + 4);
  return Math.atan2(-(b.y - a.y), b.x - a.x);
}

/**
 * Dry and free at the corners, the centre and a grid across the parcel. Where the mask says "field" within a cell of
 * the parcel's edge it is only the neighbour's cell stamp, so that is let through.
 */
function clear(parcel, corners, { masks, taken, water }) {
  for (let k = 0; k < 4; k += 1) if (corners[k * 3 + 1] < water + LAND_USE.minAbove) return false;
  const [c, s] = [Math.cos(parcel.yaw), Math.sin(parcel.yaw)];
  const [w, d] = [parcel.width / 2, parcel.depth / 2];
  const free = (u, v) => {
    const [x, z] = [parcel.x + u * c - v * s, parcel.z + u * s + v * c];
    const m = maskAt(taken, x, z);
    return (m === MASK.free || (m === MASK.field && (Math.abs(u) > w - masks.cell || Math.abs(v) > d - masks.cell))) && [MASK.free, MASK.field, MASK.meadow].includes(maskAt(masks, x, z));
  };
  for (let u = -w; u <= w + 0.01; u += LAND_USE.testStep) {
    for (let v = -d; v <= d + 0.01; v += LAND_USE.testStep) if (!free(u, v)) return false;
  }
  for (const [u, v] of [[w, d], [-w, d], [w, -d], [-w, -d], [0, 0], [w, 0], [-w, 0], [0, d], [0, -d]]) if (!free(u, v)) return false;
  return true;
}

/** The parcel, then smaller shapes of it: 0.7 and 0.5 scale, each half along the width, each half along the depth, then trimmed from either end. */
function* fits(parcel) {
  yield parcel;
  const { x, z, width, depth, yaw } = parcel;
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  for (const f of [0.7, 0.5]) yield { ...parcel, width: width * f, depth: depth * f };
  for (const side of [-1, 1]) yield { ...parcel, x: x + (side * width * c) / 4, z: z + (side * width * s) / 4, width: width / 2 };
  for (const side of [-1, 1]) yield { ...parcel, x: x - (side * depth * s) / 4, z: z + (side * depth * c) / 4, depth: depth / 2 };
  for (const f of [0.75, 0.55, 0.4]) {
    const [dw, dd] = [(width * (1 - f)) / 2, (depth * (1 - f)) / 2];
    for (const side of [-1, 1]) yield { ...parcel, x: x + side * dw * c, z: z + side * dw * s, width: width * f };
    for (const side of [-1, 1]) yield { ...parcel, x: x - side * dd * s, z: z + side * dd * c, depth: depth * f };
  }
}

/**
 * Plans the parcels and marks them on `masks` (the one place the plan mutates).
 * @param {{terrain: object, roads: import("../roads.js").RoadIndex, regions?: object[], settlements?: Array<{center: number[], radius?: number}>, seed: number, season: string, masks: import("./masks.js").Masks, water: number, bounds: {x0: number, z0: number, x1: number, z1: number}}} input
 * @returns {{parcels: Parcel[]}}
 */
export function planLandUse({ terrain, roads, regions = [], settlements = [], seed, season, masks, water, bounds }) {
  const random = seededRandom(seed ^ 0x1a4d05e);
  const shore = shoreField({ terrain, water, bounds });
  const gap = masks.cell;
  const taken = { ...masks, data: new Uint8Array(masks.data.length) }; // every parcel; `masks` only has the ones the woods must keep off
  const parcels = [];
  const area = (bounds.x1 - bounds.x0) * (bounds.z1 - bounds.z0);
  const block = Math.max(LAND_USE.block, Math.sqrt(area / LAND_USE.maxBlocks));
  const reach = block * 0.72;
  const overlap = block * LAND_USE.overlap;

  const villageDistance = (x, z) => {
    if (!settlements.length) return LAND_USE.neutralVillage;
    let best = Infinity;
    for (const s of settlements) best = Math.min(best, Math.hypot(s.center[0] - x, s.center[1] - z) - (s.radius ?? 0));
    return Math.max(0, best);
  };

  const slopeAt = (x, z) => {
    const run = 12;
    return Math.hypot(terrain.height(x + run, z) - terrain.height(x - run, z), terrain.height(x, z + run) - terrain.height(x, z - run)) / (2 * run);
  };
  const weightsAt = (x, z, mix) => landKindWeights({ mix, shore: shore(x, z), slope: slopeAt(x, z), height: terrain.height(x, z) - water, village: villageDistance(x, z) });

  for (let bz = bounds.z0; bz < bounds.z1 && parcels.length < LAND_USE.maxParcels; bz += block) {
    for (let bx = bounds.x0; bx < bounds.x1 && parcels.length < LAND_USE.maxParcels; bx += block) {
      const [cx, cz] = [bx + block / 2, bz + block / 2];
      const angle = roadGrain(roads, cx, cz) ?? fbm(cx / 2500, cz / 2500, seed + 0x6a1) * Math.PI;
      // Land is farmed or wild a block at a time, so the parcels of a farmed block touch and make a patchwork.
      const farmed = random() < LAND_USE.farmedBoost * (1 - weightsAt(cx, cz, regionMix(cx, cz, regions, seed)).wild);
      for (let v = -reach; v < reach; ) {
        const stripDepth = lerp(LAND_USE.strip, random());
        const stripAngle = angle + (random() * 2 - 1) * LAND_USE.stripTurn;
        const [c, s] = [Math.cos(stripAngle), Math.sin(stripAngle)];
        if (!farmed) {
          v += stripDepth;
          continue;
        }
        const vMid = v + stripDepth / 2;
        v += stripDepth;
        for (let u = -reach; u < reach; ) {
          const [rKind, rWidth, rJu, rJv, rCrop, rTint, rVary] = [random(), random(), random(), random(), random(), random(), random()];
          const guess = { x: cx + (u + 80) * c - vMid * s, z: cz + (u + 80) * s + vMid * c };
          const inGuess = guess.x >= bx - overlap && guess.x < bx + block + overlap && guess.z >= bz - overlap && guess.z < bz + block + overlap;
          let kind = "wild";
          let mix = null;
          if (inGuess) {
            mix = regionMix(guess.x, guess.z, regions, seed);
            const weights = weightsAt(guess.x, guess.z, mix);
            // the block is farmed: the wild share is dropped and the rest renormalised
            const farm = 1 - weights.wild;
            weights.wild = 0;
            for (const k of Object.keys(weights)) weights[k] = farm > 0 ? weights[k] / farm : 0;
            const near = roads.nearest(guess.x, guess.z, Math.ceil(LAND_USE.roadReach / (roads.cell ?? 60)));
            if (weights.arable > 0 && near && near.distance <= LAND_USE.roadReach) {
              const arable = Math.min(weights.arable * LAND_USE.roadArable, 1);
              const rest = 1 - weights.arable;
              for (const k of Object.keys(weights)) weights[k] *= rest > 0 ? (1 - arable) / rest : 0;
              weights.arable = arable;
            }
            kind = pickKind(weights, rKind);
          }
          const style = LAND_STYLE[kind];
          const sizeW = style ? lerp(style.size, rWidth) * lerp(LAND_USE.widthVary, rVary) : 160;
          const x = cx + (u + sizeW / 2) * c - vMid * s + (rJu - 0.5) * 2 * LAND_USE.jitter * sizeW * c - (rJv - 0.5) * 2 * LAND_USE.jitter * stripDepth * s;
          const z = cz + (u + sizeW / 2) * s + vMid * c + (rJu - 0.5) * 2 * LAND_USE.jitter * sizeW * s + (rJv - 0.5) * 2 * LAND_USE.jitter * stripDepth * c;
          u += sizeW;
          if (!style) continue;
          const width = sizeW - gap;
          const depth = stripDepth - gap;
          const [minWidth, minDepth] = [style.size[0] * 0.4, style.size[0] * 0.6];
          let parcel = null;
          let corners = null;
          for (const shape of fits({ x, z, width, depth, yaw: stripAngle })) {
            if (shape.width < minWidth || shape.depth < minDepth) continue;
            const shapeCorners = cornersOf(shape, terrain);
            if (clear(shape, shapeCorners, { masks, taken, water })) {
              parcel = shape;
              corners = shapeCorners;
              break;
            }
          }
          if (!parcel) continue;
          const centre = terrain.height(parcel.x, parcel.z);
          const half = Math.hypot(parcel.width, parcel.depth) / 2;
          let steepest = 0;
          for (let k = 0; k < 4; k += 1) steepest = Math.max(steepest, Math.abs(corners[k * 3 + 1] - centre) / half);
          const at = landKindWeights({ mix: regionMix(parcel.x, parcel.z, regions, seed), shore: shore(parcel.x, parcel.z), slope: steepest, height: centre - water, village: villageDistance(parcel.x, parcel.z) });
          if (at[kind] <= 0) continue;
          const [top] = mix;
          const crops = REGION_STYLE[top.kind].crops[season];
          parcels.push({
            kind, ...parcel, corners, region: top.kind,
            crop: kind === "arable" ? crops[Math.floor(rCrop * crops.length)] : null,
            edge: style.edge === "none" ? "none" : regionEdge(top.kind),
            tint: rTint * 2 - 1,
          });
          stampField(taken, parcel);
          if (!OPEN_TO_TREES.has(kind)) stampField(masks, parcel, kind === "pasture" || kind === "fallow" ? MASK.meadow : MASK.field);
          if (parcels.length >= LAND_USE.maxParcels) break;
        }
      }
    }
  }
  return { parcels };
}


/** Floats per edge segment: x, y, z of its middle, yaw, horizontal length, pitch (rise over run, as an angle). */
export const EDGE_STRIDE = 6;
/** Longest edge segment (m): longer sides are cut so the edge follows the ground. */
export const MAX_SEGMENT = 12;
/** Neighbouring parcels leave one mask cell (~4 m) between them: sides this close (m) and parallel within `SHARED_ANGLE` are one side. */
const SHARED_DISTANCE = 6;
const SHARED_ANGLE = (5 * Math.PI) / 180;
/** Side of the cells the kept sides are looked up by (m), above any side a parcel has. */
const SIDE_CELL = 160;

/**
 * Every side of the parcels with an edge, neighbours' shared sides once. A side is shared when it is parallel
 * to a side kept before within 5 degrees, its middle lies within 6 m (the 4 m gap plus 2 m) of that side's line,
 * and at least half of it lies alongside that side; the later one is dropped.
 * @param {Array<{corners: Float32Array, edge: "wall"|"hedge"|"none"}>} parcels
 * @returns {{wall: Float32Array, hedge: Float32Array}} `EDGE_STRIDE` floats per segment of at most `MAX_SEGMENT`
 */
export function parcelEdges(parcels) {
  const kept = new Map();
  const lists = { wall: [], hedge: [] };
  parcels.forEach((parcel, index) => {
    if (parcel.edge !== "wall" && parcel.edge !== "hedge") return;
    const c = parcel.corners;
    for (let side = 0; side < 4; side += 1) {
      const [a, b] = [side * 3, ((side + 1) % 4) * 3];
      const [dx, dz] = [c[b] - c[a], c[b + 2] - c[a + 2]];
      const length = Math.hypot(dx, dz);
      if (length < 0.5) continue;
      const [ux, uz] = [dx / length, dz / length];
      const [mx, mz] = [(c[a] + c[b]) / 2, (c[a + 2] + c[b + 2]) / 2];
      const [cx, cz] = [Math.floor(mx / SIDE_CELL), Math.floor(mz / SIDE_CELL)];
      let shared = false;
      for (let i = -1; i <= 1 && !shared; i += 1) {
        for (let j = -1; j <= 1 && !shared; j += 1) {
          for (const other of kept.get(`${cx + i},${cz + j}`) ?? []) {
            if (other.index === index) continue;
            const cross = Math.abs(ux * other.uz - uz * other.ux);
            if (Math.asin(Math.min(1, cross)) > SHARED_ANGLE) continue;
            if (Math.abs((mx - other.mx) * -other.uz + (mz - other.mz) * other.ux) > SHARED_DISTANCE) continue;
            // This side's span along the other's direction, against the other's own span.
            const along = (mx - other.mx) * other.ux + (mz - other.mz) * other.uz;
            const half = (length / 2) * Math.abs(ux * other.ux + uz * other.uz);
            const overlap = Math.min(along + half, other.length / 2) - Math.max(along - half, -other.length / 2);
            if (overlap >= length / 2) shared = true;
          }
        }
      }
      if (shared) continue;
      const key = `${cx},${cz}`;
      if (!kept.has(key)) kept.set(key, []);
      kept.get(key).push({ index, ux, uz, mx, mz, length });
      const count = Math.ceil(length / MAX_SEGMENT);
      const step = length / count;
      const yaw = Math.atan2(dz, dx);
      for (let n = 0; n < count; n += 1) {
        const [t0, t1] = [n / count, (n + 1) / count];
        const [y0, y1] = [c[a + 1] + (c[b + 1] - c[a + 1]) * t0, c[a + 1] + (c[b + 1] - c[a + 1]) * t1];
        const t = (t0 + t1) / 2;
        lists[parcel.edge].push(c[a] + dx * t, (y0 + y1) / 2, c[a + 2] + dz * t, yaw, step, Math.atan2(y1 - y0, step));
      }
    }
  });
  return { wall: Float32Array.from(lists.wall), hedge: Float32Array.from(lists.hedge) };
}
