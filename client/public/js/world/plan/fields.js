/**
 * Crop fields: rotated rectangles beside the roads, more of them where the
 * region is farmland. A field keeps clear of every road and river and of the
 * fields before it, and lies on ground that is flat enough to plough.
 */
import { seededRandom } from "../noise.js";
import { REGION_STYLE } from "../regionKinds.js";
import { regionMix } from "../regions.js";
import { VERGE, roadHalfWidth } from "../roads.js";
import { MASK, maskAt, stampField } from "./masks.js";

export const FIELDS = Object.freeze({
  stride: 18, // road samples between two candidates (about 110 m)
  boost: 2.2, // candidates are denser than the region's farmed share: many fall through
  width: Object.freeze([70, 150]), // along the road
  depth: Object.freeze([40, 90]), // away from it
  gap: 5, // metres between the verge and the field, plus a mask cell
  testStep: 10,
  maxSlope: 0.12,
  minAbove: 3,
});

/**
 * @typedef {object} Field
 * @property {number} x centre
 * @property {number} z
 * @property {number} width along `yaw`
 * @property {number} depth across it
 * @property {number} yaw angle of the width axis: (cos yaw, sin yaw) in world x/z
 * @property {string} crop a plant id of the region's crops for the season
 * @property {Float32Array} corners x, y, z of the four corners (-w -d, +w -d, +w +d, -w +d), terrain heights
 */

const lerp = ([a, b], t) => a + (b - a) * t;

/**
 * Plans the fields and marks them on `masks` (the one place the plan mutates).
 * @param {{terrain: object, roads: import("../roads.js").RoadIndex, regions: object[], seed: number, season: string, masks: import("./masks.js").Masks, water: number}} input
 * @returns {Field[]}
 */
export function planFields({ terrain, roads, regions, seed, season, masks, water }) {
  const random = seededRandom(seed ^ 0xf1e1d);
  const fields = [];
  const { samples } = roads;
  let run = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    run = i > 0 && samples[i - 1].route === sample.route ? run + 1 : 0;
    if (run % FIELDS.stride !== 0) continue;
    const next = samples[i + 1]?.route === sample.route ? samples[i + 1] : samples[i - 1];
    if (!next) continue;
    const length = Math.hypot(next.x - sample.x, next.z - sample.z) || 1;
    const direction = next === samples[i + 1] ? 1 : -1;
    const tangent = [((next.x - sample.x) / length) * direction, ((next.z - sample.z) / length) * direction];
    const mix = regionMix(sample.x, sample.z, regions, seed);
    const share = Math.min(0.95, mix.reduce((sum, m) => sum + m.weight * REGION_STYLE[m.kind].fieldShare, 0) * FIELDS.boost);
    for (const side of [1, -1]) {
      const [accept, w, d, gap, pick] = [random(), random(), random(), random(), random()];
      if (accept >= share) continue;
      const width = lerp(FIELDS.width, w);
      const depth = lerp(FIELDS.depth, d);
      const offset = roadHalfWidth(sample.route.lanes) + VERGE + FIELDS.gap + masks.cell + gap * 8 + depth / 2;
      const x = sample.x - tangent[1] * side * offset;
      const z = sample.z + tangent[0] * side * offset;
      const field = { x, z, width, depth, yaw: Math.atan2(tangent[1], tangent[0]) };
      const corners = cornersOf(field, terrain);
      if (!suits(field, corners, { terrain, roads, masks, water })) continue;
      const [top] = mix;
      const crops = REGION_STYLE[top.kind].crops[season];
      fields.push({ ...field, crop: crops[Math.floor(pick * crops.length)], corners });
      stampField(masks, field);
    }
  }
  return fields;
}

function cornersOf({ x, z, width, depth, yaw }, terrain) {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const corners = new Float32Array(12);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => {
    const px = x + (u * width * c) / 2 - (v * depth * s) / 2;
    const pz = z + (u * width * s) / 2 + (v * depth * c) / 2;
    corners.set([px, terrain.height(px, pz), pz], k * 3);
  });
  return corners;
}

/** Flat enough, dry, and clear of roads, rivers and other fields at every test point. */
function suits(field, corners, { terrain, roads, masks, water }) {
  const centre = terrain.height(field.x, field.z);
  const half = Math.hypot(field.width, field.depth) / 2;
  for (let k = 0; k < 4; k += 1) {
    const y = corners[k * 3 + 1];
    if (y < water + FIELDS.minAbove || Math.abs(y - centre) / half > FIELDS.maxSlope) return false;
  }
  if (centre < water + FIELDS.minAbove) return false;
  const [c, s] = [Math.cos(field.yaw), Math.sin(field.yaw)];
  for (let u = -field.width / 2; u <= field.width / 2 + 0.01; u += FIELDS.testStep) {
    for (let v = -field.depth / 2; v <= field.depth / 2 + 0.01; v += FIELDS.testStep) {
      const x = field.x + u * c - v * s;
      const z = field.z + u * s + v * c;
      if (maskAt(masks, x, z) !== MASK.free) return false;
      const near = roads.nearest(x, z, 2);
      if (near && near.distance < roadHalfWidth(near.sample.route.lanes) + VERGE + 2) return false;
    }
  }
  return true;
}
