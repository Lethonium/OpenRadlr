/**
 * Land use over the whole island: rectangular parcels of arable, pasture,
 * orchard, vineyard, scrub, dune and fallow, laid in strips along the grain of
 * the nearest road (or of a noise field away from roads) and drawn per place
 * from `landKindWeights`: the region, the distance to the sea and to a village,
 * the slope and the height. Wild land gets no parcel; the woods take it.
 * Pure and seeded; it stamps every parcel on the masks like a field.
 */
import { LAND_STYLE, landKindWeights, regionEdge } from "../landKinds.js";
import { fbm, seededRandom } from "../noise.js";
import { REGION_STYLE } from "../regionKinds.js";
import { regionMix } from "../regions.js";
import { MASK, maskAt, stampField } from "./masks.js";
import { cornersOf } from "./fields.js";

export const LAND_USE = Object.freeze({
  block: 400, // metres: the land is walked in squares of about this side
  maxBlocks: 4000, // bigger squares on a huge island keep the walk bounded
  maxParcels: 30000,
  grainReach: 600, // a road's tangent sets the grain this far from it
  strip: Object.freeze([70, 300]), // strip depth
  jitter: 0.15,
  testStep: 10,
  minAbove: 1,
  shoreCell: 50, // the sea-distance field's cell; coarser on a huge island
  maxShoreCells: 400_000,
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
 * @property {string|null} crop a plant id of the region's crops for the season (arable only)
 * @property {"wall"|"hedge"|"none"} edge
 * @property {number} tint per-parcel shade, -1 to 1
 */

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

/** Flat enough, dry and free at the corners, the centre and a grid across the parcel. */
function clear(parcel, corners, { masks, water }) {
  for (let k = 0; k < 4; k += 1) if (corners[k * 3 + 1] < water + LAND_USE.minAbove) return false;
  const [c, s] = [Math.cos(parcel.yaw), Math.sin(parcel.yaw)];
  const [w, d] = [parcel.width / 2, parcel.depth / 2];
  for (let u = -w; u <= w + 0.01; u += LAND_USE.testStep) {
    for (let v = -d; v <= d + 0.01; v += LAND_USE.testStep) {
      if (maskAt(masks, parcel.x + u * c - v * s, parcel.z + u * s + v * c) !== MASK.free) return false;
    }
  }
  for (const [u, v] of [[w, d], [-w, d], [w, -d], [-w, -d]]) {
    if (maskAt(masks, parcel.x + u * c - v * s, parcel.z + u * s + v * c) !== MASK.free) return false;
  }
  return true;
}

/**
 * Plans the parcels and marks them on `masks` (the one place the plan mutates).
 * @param {{terrain: object, roads: import("../roads.js").RoadIndex, regions?: object[], settlements?: Array<{center: number[], radius?: number}>, seed: number, season: string, masks: import("./masks.js").Masks, water: number, bounds: {x0: number, z0: number, x1: number, z1: number}}} input
 * @returns {{parcels: Parcel[]}}
 */
export function planLandUse({ terrain, roads, regions = [], settlements = [], seed, season, masks, water, bounds }) {
  const random = seededRandom(seed ^ 0x1a4d05e);
  const shore = shoreField({ terrain, water, bounds });
  const gap = masks.cell * 2;
  const parcels = [];
  const area = (bounds.x1 - bounds.x0) * (bounds.z1 - bounds.z0);
  const block = Math.max(LAND_USE.block, Math.sqrt(area / LAND_USE.maxBlocks));
  const reach = block * 0.72;

  const villageDistance = (x, z) => {
    if (!settlements.length) return LAND_USE.neutralVillage;
    let best = Infinity;
    for (const s of settlements) best = Math.min(best, Math.hypot(s.center[0] - x, s.center[1] - z) - (s.radius ?? 0));
    return Math.max(0, best);
  };

  for (let bz = bounds.z0; bz < bounds.z1 && parcels.length < LAND_USE.maxParcels; bz += block) {
    for (let bx = bounds.x0; bx < bounds.x1 && parcels.length < LAND_USE.maxParcels; bx += block) {
      const [cx, cz] = [bx + block / 2, bz + block / 2];
      const angle = roadGrain(roads, cx, cz) ?? fbm(cx / 2500, cz / 2500, seed + 0x6a1) * Math.PI;
      const [c, s] = [Math.cos(angle), Math.sin(angle)];
      for (let v = -reach; v < reach; ) {
        const stripDepth = lerp(LAND_USE.strip, random());
        const vMid = v + stripDepth / 2;
        v += stripDepth;
        for (let u = -reach; u < reach; ) {
          const [rKind, rWidth, rJu, rJv, rCrop, rTint] = [random(), random(), random(), random(), random(), random()];
          const guess = { x: cx + (u + 80) * c - vMid * s, z: cz + (u + 80) * s + vMid * c };
          const inGuess = guess.x >= bx && guess.x < bx + block && guess.z >= bz && guess.z < bz + block;
          let kind = "wild";
          let mix = null;
          if (inGuess) {
            mix = regionMix(guess.x, guess.z, regions, seed);
            const h = terrain.height(guess.x, guess.z);
            const run = 12;
            const slope = Math.hypot(terrain.height(guess.x + run, guess.z) - terrain.height(guess.x - run, guess.z), terrain.height(guess.x, guess.z + run) - terrain.height(guess.x, guess.z - run)) / (2 * run);
            kind = pickKind(landKindWeights({ mix, shore: shore(guess.x, guess.z), slope, height: h - water, village: villageDistance(guess.x, guess.z) }), rKind);
          }
          const style = LAND_STYLE[kind];
          const sizeW = style ? lerp(style.size, rWidth) : 160;
          const x = cx + (u + sizeW / 2) * c - vMid * s + (rJu - 0.5) * 2 * LAND_USE.jitter * sizeW * c - (rJv - 0.5) * 2 * LAND_USE.jitter * stripDepth * s;
          const z = cz + (u + sizeW / 2) * s + vMid * c + (rJu - 0.5) * 2 * LAND_USE.jitter * sizeW * s + (rJv - 0.5) * 2 * LAND_USE.jitter * stripDepth * c;
          u += sizeW;
          if (!style) continue;
          const width = sizeW - gap;
          const depth = Math.min(style.size[1], Math.max(style.size[0], stripDepth)) - gap;
          const parcel = { x, z, width, depth, yaw: angle };
          const corners = cornersOf(parcel, terrain);
          if (!clear(parcel, corners, { masks, water })) continue;
          const centre = terrain.height(x, z);
          const half = Math.hypot(width, depth) / 2;
          let steepest = 0;
          for (let k = 0; k < 4; k += 1) steepest = Math.max(steepest, Math.abs(corners[k * 3 + 1] - centre) / half);
          const at = landKindWeights({ mix: regionMix(x, z, regions, seed), shore: shore(x, z), slope: steepest, height: centre - water, village: villageDistance(x, z) });
          if (at[kind] <= 0) continue;
          const [top] = mix;
          const crops = REGION_STYLE[top.kind].crops[season];
          parcels.push({
            kind, ...parcel, corners,
            crop: kind === "arable" ? crops[Math.floor(rCrop * crops.length)] : null,
            edge: style.edge === "none" ? "none" : regionEdge(top.kind),
            tint: rTint * 2 - 1,
          });
          stampField(masks, parcel);
          if (parcels.length >= LAND_USE.maxParcels) break;
        }
      }
    }
  }
  return { parcels };
}

