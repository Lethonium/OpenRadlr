/**
 * The verge: clumps of bushes and trees close to the road, and props (fences,
 * bales, cairns) every so many metres, in the style of the region the road
 * runs through. Placed from the road samples outward, so the close-up view is
 * full without paying for it across the whole island.
 */
import { seededRandom } from "../noise.js";
import { REGION_STYLE } from "../regionKinds.js";
import { regionMix } from "../regions.js";
import { RIVER } from "../rivers.js";
import { VERGE, roadHalfWidth } from "../roads.js";
import { MASK, maskAt } from "./masks.js";

export const ROADSIDE = Object.freeze({
  gap: 4.5, // metres from the verge's edge to the nearest clump
  spread: 14, // clumps lie between `gap` and `gap + spread`, most of them near
  propGap: 5.5,
  propShare: 0.25, // at most this share of the budget goes to props
  riverClear: RIVER.halfWidth + 6,
  minAbove: 2.5,
});
const SIZE = Object.freeze({ bush: Object.freeze([0.6, 1.1]), lavender: Object.freeze([0.8, 1.2]), rock: Object.freeze([0.5, 1.4]) });
const DEFAULT_SIZE = Object.freeze([0.7, 1.2]);

const pickFrom = (entries, u) => {
  let sum = 0;
  let last = null;
  for (const [id, share] of entries) {
    sum += share;
    last = id;
    if (u < sum) return id;
  }
  return last;
};

/** Where each sample points (its tangent) and how far it is from the next one. */
function frames(samples) {
  return samples.map((s, i) => {
    const forward = samples[i + 1]?.route === s.route;
    const other = forward ? samples[i + 1] : samples[i - 1];
    if (!other || other.route !== s.route) return { tangent: [1, 0], spacing: 6 };
    const length = Math.hypot(other.x - s.x, other.z - s.z) || 1;
    const sign = forward ? 1 : -1;
    return { tangent: [((other.x - s.x) / length) * sign, ((other.z - s.z) / length) * sign], spacing: Math.max(1, Math.abs(other.distance - s.distance)) };
  });
}

/** A prop falls on this sample when it crosses a multiple of `every` metres. */
const propIndex = (s, spacing, every) => (Math.floor((s.distance + spacing) / every) > Math.floor(s.distance / every) ? Math.floor(s.distance / every) : -1);

/**
 * @param {{terrain: object, roads: import("../roads.js").RoadIndex, regions: object[], seed: number, masks: import("./masks.js").Masks, water: number, budget: number}} input
 * @returns {Record<string, Float32Array>} per plant or prop id: x, y, z, yaw, scale for each item; the yaw is the world angle of the item's own x axis
 */
export function planRoadside({ terrain, roads, regions, seed, masks, water, budget }) {
  const { samples } = roads;
  const around = frames(samples);
  const mixes = samples.map((s) => regionMix(s.x, s.z, regions, seed));
  let clumps = 0;
  let props = 0;
  samples.forEach((s, i) => {
    clumps += 2 * around[i].spacing * mixes[i].reduce((sum, m) => sum + m.weight * REGION_STYLE[m.kind].verge.perMetre, 0);
    if (propIndex(s, around[i].spacing, REGION_STYLE[mixes[i][0].kind].props.every) >= 0) props += 1;
  });
  const propScale = Math.min(1, (budget * ROADSIDE.propShare) / Math.max(1, props));
  const clumpScale = Math.min(1, (budget - props * propScale) / Math.max(1, clumps));

  const random = seededRandom(seed ^ 0x5eed51de);
  const lists = {};
  let placed = 0;
  const put = (id, s, { tangent }, side, off, uYaw, uSize, along, parallel) => {
    const x = s.x + tangent[0] * along - tangent[1] * side * off;
    const z = s.z + tangent[1] * along + tangent[0] * side * off;
    if (maskAt(masks, x, z) === MASK.field || maskAt(masks, x, z) === MASK.river) return;
    const near = roads.nearest(x, z, 2);
    if (near && near.distance < roadHalfWidth(near.sample.route.lanes) + VERGE + 1.5) return;
    if ((terrain.riverDistance?.(x, z) ?? Infinity) < ROADSIDE.riverClear) return;
    const y = terrain.height(x, z);
    if (y < water + ROADSIDE.minAbove || placed >= budget) return;
    const [low, high] = SIZE[id] ?? DEFAULT_SIZE;
    (lists[id] ??= []).push(x, y, z, parallel ? Math.atan2(tangent[1], tangent[0]) : uYaw * Math.PI * 2, low + (high - low) * uSize);
    placed += 1;
  };

  samples.forEach((s, i) => {
    const frame = around[i];
    const half = roadHalfWidth(s.route.lanes) + VERGE;
    const mix = mixes[i];
    const rates = mix.map((m) => [m.kind, m.weight * REGION_STYLE[m.kind].verge.perMetre]);
    const rate = rates.reduce((sum, [, r]) => sum + r, 0);
    for (const side of [1, -1]) {
      const n = Math.floor(rate * frame.spacing * clumpScale + random());
      for (let t = 0; t < n; t += 1) {
        const [uKind, uPlant, uOff, uAlong, uYaw, uSize] = [random(), random(), random(), random(), random(), random()];
        const kind = pickFrom(rates.map(([k, r]) => [k, r / rate]), uKind);
        const plant = pickFrom(Object.entries(REGION_STYLE[kind].verge.mix), uPlant);
        put(plant, s, frame, side, half + ROADSIDE.gap + uOff * uOff * ROADSIDE.spread, uYaw, uSize, (uAlong - 0.5) * frame.spacing, false);
      }
    }
    const style = REGION_STYLE[mix[0].kind].props;
    const index = propIndex(s, frame.spacing, style.every);
    const [uAccept, uOff, uYaw, uSize] = [random(), random(), random(), random()];
    if (index >= 0 && uAccept < propScale) {
      put(style.kinds[index % style.kinds.length], s, frame, index % 2 === 0 ? 1 : -1, half + ROADSIDE.propGap + uOff * 2, uYaw, uSize, 0, true);
    }
  });
  return Object.fromEntries(Object.keys(lists).sort().map((id) => [id, Float32Array.from(lists[id])]));
}
