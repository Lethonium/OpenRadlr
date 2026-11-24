/**
 * The map as an island (#20): the land falls to the sea around the roads,
 * with sandy beaches, some cliffs and open sea out to the horizon.
 *
 * The coastline is derived from the roads and the map seed only, so every
 * client sees the same island: seen from the island's centre, the coast runs
 * a seeded margin beyond the farthest road in every direction, with a slow
 * wobble (bays and headlands) and a little roughness on top.
 */
import { fbm } from "./noise.js";

/** Route elevations are metres above sea level, so the sea sits at 0. */
export const SEA_LEVEL = 0;

export const COAST = Object.freeze({
  /** Land between the farthest road and the coast (metres, before the wobble). */
  margin: 640,
  /** Bays and headlands: ± this much on the margin. */
  wobble: 230,
  /** Small-scale roughness of the coastline. */
  rough: 45,
  /** Angular resolution of the coast profile. */
  bins: 256,
  /** Roads widen the island over ± this angle, so it does not hug them. */
  spread: 0.32,
  /** Width of the beach and how long the land takes to rise behind it. */
  beach: 70,
  rise: 360,
  /** Cliffs rise this fast instead. */
  cliffRise: 45,
  /** How deep the sea floor drops, and over which distance. */
  depth: 38,
  shelf: 420,
});

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Periodic noise around a circle in [0, 1]: `angle` in radians, `turns` features per circle. */
const ringNoise = (angle, turns, seed, octaves = 3) => fbm(Math.cos(angle) * turns, Math.sin(angle) * turns, seed, octaves);

/**
 * The island's shape around road `samples` ({x, z} in world coordinates).
 * `inland(x, z)` is roughly the distance to the coast: positive on land,
 * negative at sea.
 */
export function islandShape(samples, seed) {
  const xs = samples.map((s) => s.x);
  const zs = samples.map((s) => s.z);
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  const { bins, spread, margin, wobble, rough } = COAST;
  const binOf = (angle) => (((Math.round((angle / (2 * Math.PI)) * bins) % bins) + bins) % bins);

  const farthest = new Float64Array(bins);
  for (const s of samples) {
    const b = binOf(Math.atan2(s.z - center[1], s.x - center[0]));
    farthest[b] = Math.max(farthest[b], Math.hypot(s.x - center[0], s.z - center[1]));
  }
  // Widen: a road at some angle also pushes the coast out next to it.
  const reach = Math.ceil((spread / (2 * Math.PI)) * bins);
  const widened = Float64Array.from(farthest, (_, b) => {
    let best = 0;
    for (let k = -reach; k <= reach; k += 1) {
      const r = farthest[(b + k + bins) % bins];
      // Projected onto this direction, so the outline stays round, not star-shaped.
      best = Math.max(best, r * Math.cos((k / bins) * 2 * Math.PI));
    }
    return best;
  });
  // Smooth, then add the margin and the seeded wobble.
  const radius = Float64Array.from(widened, (_, b) => {
    let sum = 0;
    for (let k = -6; k <= 6; k += 1) sum += widened[(b + k + bins) % bins];
    const angle = (b / bins) * 2 * Math.PI;
    return Math.max(widened[b], sum / 13) + margin + (ringNoise(angle, 2.2, seed + 401) - 0.5) * 2 * wobble;
  });
  const cliffs = Float64Array.from(radius, (_, b) => smoothstep(0.56, 0.68, ringNoise((b / bins) * 2 * Math.PI, 3.1, seed + 433, 2)));

  const lookup = (table, angle) => {
    const u = (((angle / (2 * Math.PI)) * bins) % bins + bins) % bins;
    const i = Math.floor(u);
    const f = u - i;
    return table[i] + (table[(i + 1) % bins] - table[i]) * f;
  };

  return {
    center,
    /** Distance from the centre to the coast in a direction (without roughness). */
    radiusAt: (angle) => lookup(radius, angle),
    /** 0 for a beach, 1 for a cliff, in a direction. */
    cliffAt: (angle) => lookup(cliffs, angle),
    inland(x, z) {
      const dx = x - center[0];
      const dz = z - center[1];
      const coast = lookup(radius, Math.atan2(dz, dx));
      return coast - Math.hypot(dx, dz) + (fbm(x / 170, z / 170, seed + 457, 3) - 0.5) * 2 * rough;
    },
  };
}

/**
 * Shapes `natural` land height at a point `inland` metres from the coast
 * (`cliff` 0…1): the sea floor offshore, a beach just above the sea, then
 * the land rising behind it, quickly where there are cliffs.
 */
export function coastHeight(natural, inland, cliff, sea = SEA_LEVEL) {
  const { beach, rise, cliffRise, depth, shelf } = COAST;
  if (inland <= 0) {
    // Offshore: a short steep drop under cliffs, a long shallow shelf off beaches.
    const drop = shelf * (1 - 0.7 * cliff);
    return sea - 0.6 - depth * smoothstep(0, drop, -inland);
  }
  const sand = beach * (1 - cliff);
  const shore = sea - 0.6 + (1.6 + 0.6 * cliff) * smoothstep(0, Math.max(sand, 8), inland);
  const width = rise + (cliffRise - rise) * cliff;
  const t = smoothstep(sand, sand + width, inland);
  return shore + Math.max(0, natural - shore) * t;
}
