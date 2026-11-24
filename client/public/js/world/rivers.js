/**
 * Rivers, pure: the river path across a road with its pond or mouth, and the
 * terrain wrapper that carves the valley. The drawing is in view3d/.
 */
import { VERGE, roadFrame, roadHalfWidth } from "./roads.js";
import { fbm, seededRandom } from "./noise.js";
import { add, cellKey, normalize, scale } from "./vec.js";

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const RIVER = Object.freeze({ halfWidth: 9, bank: 26, belowRoad: 9, length: 2400, step: 15, rise: 0.05, mouthDepth: 2.5, bed: 24 });
export const BRIDGE_HALF_LENGTH = 34;
const POND_RADIUS = 34;

/** Bucketed samples of a polyline with a water surface height per sample. */
class SampleIndex {
  #buckets = new Map();

  constructor(cell = 60) {
    this.cell = cell;
  }

  /** Bounding box of all samples, to skip far-away rivers quickly. */
  box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };

  add(sample) {
    const key = cellKey(Math.floor(sample.x / this.cell), Math.floor(sample.z / this.cell));
    if (!this.#buckets.has(key)) this.#buckets.set(key, []);
    this.#buckets.get(key).push(sample);
    this.box.x0 = Math.min(this.box.x0, sample.x);
    this.box.z0 = Math.min(this.box.z0, sample.z);
    this.box.x1 = Math.max(this.box.x1, sample.x);
    this.box.z1 = Math.max(this.box.z1, sample.z);
  }

  nearest(x, z) {
    const { box, cell } = this;
    if (x < box.x0 - cell || x > box.x1 + cell || z < box.z0 - cell || z > box.z1 + cell) return null;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = null;
    let bestSquared = Infinity;
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const bucket = this.#buckets.get(cellKey(cx + i, cz + j));
        if (!bucket) continue;
        for (const s of bucket) {
          const dx = s.x - x;
          const dz = s.z - z;
          const squared = dx * dx + dz * dz;
          if (squared < bestSquared) {
            bestSquared = squared;
            best = s;
          }
        }
      }
    }
    return best ? { sample: best, distance: Math.sqrt(bestSquared) } : null;
  }
}

// ------------------------------------------------------------------- river ---

/**
 * A river crossing the road at `at`. It runs roughly across the road,
 * meanders away from the bridge and flows out into the sea, or ends in a
 * pond wherever it would reach the road again (routes are loops, so a
 * straight river would cross twice). `seaLevel` is the sea (or lake) surface.
 */
export function buildRiverPath(route, baseTerrain, at, seed, seaLevel = -Infinity) {
  const frame = roadFrame(route, at);
  const random = seededRandom(seed ^ Math.round(at));
  const skew = (random() - 0.5) * 0.6;
  const dir = normalize([frame.right[0] * Math.cos(skew) - frame.right[2] * Math.sin(skew), 0, frame.right[0] * Math.sin(skew) + frame.right[2] * Math.cos(skew)]);
  const perp = [-dir[2], 0, dir[0]];
  // Just above the sea, so the river meets it at its mouth without a step.
  const minSurface = seaLevel + 0.25;
  const surfaceAtBridge = Math.max(minSurface, frame.center[1] - RIVER.belowRoad);
  const clearance = roadHalfWidth(route.lanes) + VERGE + RIVER.halfWidth + RIVER.bank + 12;
  // A pond is wider than the river, so it ends further from the next road.
  const pondClearance = clearance + POND_RADIUS;

  const arms = [];
  const ponds = [];
  for (const sign of [1, -1]) {
    const arm = [];
    for (let s = 0; s <= RIVER.length; s += RIVER.step) {
      const wobble = (fbm(s / 380, sign * 7.3, seed + 5, 3) - 0.5) * 260 * smoothstep(80, 420, s);
      const p = add(add(frame.center, scale(dir, sign * s)), scale(perp, wobble));
      if (s > 90 && baseTerrain.distanceToRoad(p[0], p[2]) < pondClearance) {
        const end = arm[arm.length - 1];
        ponds.push({ x: end.x, z: end.z });
        break;
      }
      // The mouth: the sea takes over at the coast (it fills the carved channel).
      if (s > 90 && baseTerrain.height(p[0], p[2]) < seaLevel + 0.5) break;
      arm.push({ x: p[0], z: p[2], s: sign * s });
    }
    arms.push(sign > 0 ? arm : arm.slice(1).reverse());
  }
  const points = [...arms[1], ...arms[0]];

  // Surface: at the bridge well below the road, elsewhere below the land and
  // rising gently with it, so the river runs in a valley rather than a gorge.
  const raw = points.map((p) => Math.min(surfaceAtBridge + RIVER.rise * Math.max(0, Math.abs(p.s) - 60), baseTerrain.height(p.x, p.z) - 2.5));
  const smooth = raw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -4; k <= 4; k += 1) {
      const v = raw[i + k];
      if (v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    return sum / n;
  });
  points.forEach((p, i) => (p.surface = Math.max(minSurface, Math.min(smooth[i], raw[i]))));

  const pondSamples = ponds.map((pond) => {
    const end = points.reduce((best, p) => (Math.hypot(p.x - pond.x, p.z - pond.z) < Math.hypot(best.x - pond.x, best.z - pond.z) ? p : best));
    return { x: end.x, z: end.z, surface: end.surface, radius: POND_RADIUS };
  });

  const index = new SampleIndex();
  for (const p of points) index.add({ x: p.x, z: p.z, surface: p.surface, radius: RIVER.halfWidth });
  for (const pond of pondSamples) {
    for (let a = 0; a < 12; a += 1) {
      const angle = (a / 12) * Math.PI * 2;
      for (const r of [0, 12, 24]) index.add({ x: pond.x + Math.cos(angle) * r, z: pond.z + Math.sin(angle) * r, surface: pond.surface, radius: RIVER.halfWidth });
    }
  }
  return { at, points, ponds: pondSamples, index, surfaceAtBridge };
}

/**
 * Wraps a terrain model so rivers carve their valleys into it. The river bed
 * never goes below `floor` (just under the sea), so it never digs a trench
 * into the sea floor.
 */
export function withRivers(base, rivers, floor = -Infinity) {
  const carve = (x, z) => {
    let lowest = Infinity;
    let distance = Infinity;
    for (const river of rivers) {
      const near = river.index.nearest(x, z);
      if (!near) continue;
      distance = Math.min(distance, near.distance);
      const { surface } = near.sample;
      const d = near.distance;
      // The bed is as wide as the ground mesh needs (its 16 m cells put a vertex within ~12 m of any
      // point): narrower, on a slope the mesh's bank vertices pull the ground up over the water between them.
      const height = d <= RIVER.bed ? surface - 2.6 + 2.2 * (d / RIVER.bed) ** 2 : surface - 0.4 + (d - RIVER.bed) * 0.9;
      lowest = Math.min(lowest, height);
    }
    return { lowest, distance };
  };
  return {
    ...base,
    baseHeight: base.height,
    height(x, z) {
      const natural = base.height(x, z);
      const { lowest, distance } = carve(x, z);
      if (!Number.isFinite(lowest) || distance > RIVER.bed + RIVER.bank + 20) return natural;
      // Blend the valley wall into the natural slope.
      const t = smoothstep(RIVER.bed, RIVER.bed + RIVER.bank, distance);
      const valley = Math.min(natural, Math.max(floor + 0.3, lowest));
      return valley + (natural - valley) * t * t;
    },
    riverDistance(x, z) {
      return carve(x, z).distance;
    },
  };
}
