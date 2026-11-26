/**
 * World features placed along a route: spectators, guard rails, signs, village name boards, the café, the
 * outdoor gym and the studio's site. (Towns, farms, turbines, landmarks and far islands are scene layers.)
 *
 * All placement is deterministic (route geometry + seed). Builders return plain placement data that the
 * scene's layers draw (rails, signs, the crowd, the café and the gym).
 */
import { CROWD } from "./crowd.js";
import { GYM_SIGN, GYM_TOP } from "../world/venues.js";
import { add, cellKey, normalize, scale, yawFor } from "./math.js";
import { seededRandom } from "../world/noise.js";
import { FOOTPRINT } from "./studioLayout.js";
import { temperate } from "./biomes/index.js";
import { VERGE, roadFrame, roadHalfWidth } from "../world/roads.js";


// ----------------------------------------------------------------- spatial ---

/** Circles that other features must keep out of (buildings, farm yards, turbine bases). */
export class Occupancy {
  #cells = new Map();

  constructor(cell = 50) {
    this.cell = cell;
  }

  add(x, z, radius) {
    const c = this.cell;
    for (let i = Math.floor((x - radius) / c); i <= Math.floor((x + radius) / c); i += 1) {
      for (let j = Math.floor((z - radius) / c); j <= Math.floor((z + radius) / c); j += 1) {
        const key = cellKey(i, j);
        if (!this.#cells.has(key)) this.#cells.set(key, []);
        this.#cells.get(key).push({ x, z, radius });
      }
    }
  }

  blocked(x, z, radius = 0) {
    const key = cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell));
    return (this.#cells.get(key) ?? []).some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius);
  }
}

// ------------------------------------------------------------- village boards ---

/** Metres from the road's edge to a village name board. */
const BOARD_SETBACK = 3.2;

/** The village name boards at both ends of each zone, facing approaching riders. */
function villageSigns(route, villages, terrain) {
  const half = roadHalfWidth(route.lanes);
  const signs = [];
  for (const zone of villages) {
    for (const d of [zone.from, zone.to]) {
      const f = roadFrame(route, d);
      const pos = add(f.center, scale(f.right, half + BOARD_SETBACK));
      signs.push({ kind: "village", position: [pos[0], terrain.height(pos[0], pos[2]), pos[2]], yaw: yawFor(scale(f.forward, -1)) });
    }
  }
  return signs;
}

// -------------------------------------------------------------- spectators ---

/** Flag colours some spectators wave (tinted onto the flag's white cloth). */
const FLAGS = [
  [0.86, 0.16, 0.14],
  [0.16, 0.38, 0.86],
  [1.0, 0.82, 0.1],
  [0.95, 0.95, 0.95],
  [0.18, 0.62, 0.3],
  [0.98, 0.5, 0.1],
];

/**
 * Crowds behind barriers at the finish, on top of every climb and at every
 * sprint line (`rank` 0: always out), and loose groups lining the last
 * `CROWD.liningM` of each climb, thicker towards the top (`rank` in (0, 1):
 * out when `crowdShare` of the riders online is above it). Some wave a flag
 * (`flag`: its colour). `blocked(x, z)` keeps the lining out of buildings,
 * yards and rivers. Returns placement data for scene/crowdLayer.js (`people`) and
 * scene/furnitureLayer.js (`barriers`: segments `a` to `b` on the ground, `color` their stripe).
 */
export function buildSpectators(route, terrain, { seed, perSide = 16, biome = temperate, blocked = () => false }) {
  const random = seededRandom(seed ^ 0x5bec);
  // Placement added later draws from its own stream: the first crowds stay where they always stood.
  const more = seededRandom(seed ^ 0xc4e3);
  const crowd = biome.people ?? temperate.people;
  const shirts = crowd.shirts ?? temperate.people.shirts;
  const barrier = biome.road.barrier ?? temperate.road.barrier;
  const half = roadHalfWidth(route.lanes) + VERGE;
  const people = [];
  const barriers = [];
  const person = (p, facing, rank) => {
    // Drawn in the order the crowd always drew them, so the first crowds look as they did.
    const shirt = shirts[Math.floor(random() * shirts.length)];
    const yaw = yawFor(facing) + (random() - 0.5) * 0.6;
    const armsUp = random() < 0.55;
    const phase = random() * Math.PI * 2;
    const size = 0.92 + random() * 0.16;
    const flag = more() < CROWD.flags ? FLAGS[Math.floor(more() * FLAGS.length)] : null;
    people.push({ position: [p[0], terrain.height(p[0], p[2]), p[2]], yaw, shirt: crowd.tint ? shirt : [1, 1, 1], armsUp, motion: crowd.motion, phase, scale: size, rank, flag });
  };

  const spots = [0];
  for (const marker of route.markers) if (marker.type === "climb") spots.push(marker.distance + (marker.length ?? 0));
  const sprints = route.markers.filter((m) => m.type === "sprint").map((m) => m.distance + (m.length ?? 0));
  for (const spot of [...spots, ...sprints]) {
    // Barriers.
    for (const side of [-1, 1]) {
      for (let s = -24; s < 24; s += 3) {
        const f0 = roadFrame(route, spot + s);
        const f1 = roadFrame(route, spot + s + 3);
        const p0 = add(f0.center, scale(f0.right, side * (half + 0.5)));
        const p1 = add(f1.center, scale(f1.right, side * (half + 0.5)));
        const color = barrier.stripes[Math.floor((s + 24) / 3) % barrier.stripes.length];
        barriers.push({ a: [p0[0], terrain.height(p0[0], p0[2]), p0[2]], b: [p1[0], terrain.height(p1[0], p1[2]), p1[2]], color });
      }
    }
    // People, two loose rows per side.
    for (const side of [-1, 1]) {
      for (let k = 0; k < perSide; k += 1) {
        const along = (random() - 0.5) * 44;
        const f = roadFrame(route, spot + along);
        const lateral = half + 1.0 + (k % 2) * 0.8 + random() * 0.4;
        person(add(f.center, scale(f.right, side * lateral)), scale(f.right, -side), 0);
      }
    }
  }

  // Loose groups up the last stretch of each climb, more of them towards the top.
  for (const marker of route.markers) {
    if (marker.type !== "climb") continue;
    const top = marker.distance + (marker.length ?? 0);
    const from = Math.max(marker.distance, top - CROWD.liningM);
    for (const side of [-1, 1]) {
      for (let d = from; d < top - 28; d += 9) {
        const t = (d - from) / Math.max(1, top - from);
        if (more() > 0.15 + 0.75 * t * t) continue;
        const size = 1 + Math.floor(more() * 4);
        const rank = Math.max(0.001, more() * (1 - 0.6 * t));
        for (let k = 0; k < size; k += 1) {
          const f = roadFrame(route, d + (more() - 0.5) * 4);
          const lateral = half + 0.8 + more() * 1.8;
          const p = add(f.center, scale(f.right, side * lateral));
          if (terrain.distanceToRoad(p[0], p[2]) < half + 0.3 || blocked(p[0], p[2])) continue;
          person(p, scale(f.right, -side), rank);
        }
      }
    }
  }
  return { people, barriers };
}

// ---------------------------------------------------------- infrastructure ---

/** How far out (metres) the sea is looked for to tell the sea side of a cliff. The ground is levelled under the road, so only the sea itself says which side falls away. */
const CLIFF_LOOK = 400;
const CLIFF_STEP = 20;

/** Metres from (x, z) along (dx, dz) to the first ground below the sea, or Infinity. */
function seaDistance(terrain, x, z, dx, dz) {
  const sea = terrain.seaLevel ?? 0;
  for (let m = CLIFF_STEP; m <= CLIFF_LOOK; m += CLIFF_STEP) if (terrain.height(x + dx * m, z + dz * m) < sea) return m;
  return Infinity;
}

/**
 * Guard rails on descents, warning signs around climbs and a flamme rouge
 * one kilometre before the finish (without `markers`: guard rails only;
 * without `rails`: signs only), as placement data for scene/furnitureLayer.js:
 * `rails` are segments (`a`, `b`: their ends on the road's height), `signs` are
 * `warning` or `village` boards (`position` on the ground, `yaw` facing the
 * approaching rider), `flammeRouge` the pennant's spot (`position` the road's
 * centre, `halfWidth` the posts' offset) or null. `twoWay` roads get rails
 * where they are steeper (5 %) either way, since a climb is a descent the
 * other way. `villages` are zone stretches whose ends get a name board.
 * `cliffs` are stretches along a cliff: a rail on the side where the ground
 * falls away (the sea side), whichever way the road runs.
 */
export function roadsideFurniture(route, terrain, { skip = () => false, markers = true, rails = true, twoWay = false, railGrade = 3, railStep = 4, cliffs = [], villages = [] }) {
  const half = roadHalfWidth(route.lanes) + VERGE;
  const furniture = { rails: [], signs: villageSigns(route, villages, terrain), flammeRouge: null };

  // Guard rails wherever the road descends steeply (either way on a two-way road).
  for (let d = 0; rails && d < route.length; d += railStep) {
    const grade = route.gradeAt(d);
    if (skip(d)) continue;
    const f0 = roadFrame(route, d);
    const f1 = roadFrame(route, d + railStep);
    let sides = (twoWay ? Math.abs(grade) - 2 : -grade) < railGrade ? [] : [-1, 1];
    if (sides.length === 0 && cliffs.some((c) => d >= c.from && d <= c.to)) {
      const gap = (side) => seaDistance(terrain, f0.center[0], f0.center[2], f0.right[0] * side, f0.right[2] * side);
      sides = [gap(1) < gap(-1) ? 1 : -1];
    }
    for (const side of sides) furniture.rails.push({ a: add(f0.center, scale(f0.right, side * (half + 0.3))), b: add(f1.center, scale(f1.right, side * (half + 0.3))) });
  }

  // Signs and the flamme rouge belong to the ridden route only.
  if (!markers) return furniture;

  const sign = (distance) => {
    const f = roadFrame(route, distance);
    const pos = add(f.center, scale(f.right, half + 0.9));
    furniture.signs.push({ kind: "warning", position: [pos[0], terrain.height(pos[0], pos[2]), pos[2]], yaw: yawFor(scale(f.forward, -1)) });
  };
  for (const marker of route.markers) {
    if (marker.type !== "climb") continue;
    sign(marker.distance - 120);
    sign(marker.distance + (marker.length ?? 0) + 25);
  }

  // Flamme rouge: red pennant over the road one kilometre before the finish.
  if (route.length > 1500) {
    const f = roadFrame(route, route.length - 1000);
    furniture.flammeRouge = { position: [...f.center], yaw: yawFor(scale(normalize([f.forward[0], 0, f.forward[2]]), -1)), halfWidth: half + 0.6 };
  }
  return furniture;
}

// --------------------------------------------------------------- bike café ---

/** Metres after the start/finish line where the café stands, on the right. */
export const CAFE_DISTANCE = 45;
/** Metres of paving between the road and the terrace, and the terrace's depth, and the café's setback from them. */
const FORECOURT = 3;
const TERRACE = 7;
const CAFE_SETBACK = 4;
/** Metres from the café's middle that the town's houses and the plants keep out of. */
const CAFE_CLEARING = 14;

/** Where the café on `route` stands: its frame at `CAFE_DISTANCE`, its spot (on the right) and the yaw that turns its front to the road. */
function cafeSite(route) {
  const half = roadHalfWidth(route.lanes);
  const center = route.wrap(CAFE_DISTANCE);
  const f = roadFrame(route, center);
  const pos = add(f.center, scale(f.right, half + FORECOURT + TERRACE + CAFE_SETBACK));
  return { half, center, f, pos, yaw: yawFor(scale(f.right, -1)) };
}

/**
 * The ground the café on `route` takes, whether or not it ends up built: `{x, z, radius}` around its spot. The
 * world plan keeps the towns' houses and the plants off it.
 */
export function cafeClearing(route) {
  const { pos } = cafeSite(route);
  return { x: pos[0], z: pos[2], radius: CAFE_CLEARING };
}

/**
 * The bike café at the start, as placement data: where it stands and which way it faces (`yaw`: its front is the
 * model's -z), plus the paved forecourt along the road, as two edges of points every 2 m from 11 m before the café's
 * middle to 11 m after it, the inner one at the road's edge and the outer one 10 m out, 0.1 m over the road.
 * Null where `avoid` says so.
 *
 * @returns {{position: number[], distance: number, yaw: number, forecourt: {inner: number[][], outer: number[][]}} | null}
 */
export function buildBikeCafe(route, terrain, { occupancy, avoid = () => false }) {
  const { half, center, f, pos, yaw } = cafeSite(route);
  if (avoid(pos[0], pos[2], 12)) return null;

  const inner = [];
  const outer = [];
  const from = center - 11;
  const to = center + 11;
  for (let d = from; d < to + 1e-9; d += 2) {
    const fr = roadFrame(route, Math.min(to, d));
    inner.push(add(add(fr.center, scale(fr.right, half + 0.02)), [0, 0.1, 0]));
    outer.push(add(add(fr.center, scale(fr.right, half + FORECOURT + TERRACE)), [0, 0.1, 0]));
  }
  occupancy.add(pos[0], pos[2], 14);
  const forecourtMid = add(f.center, scale(f.right, half + (FORECOURT + TERRACE) / 2));
  occupancy.add(forecourtMid[0], forecourtMid[2], 10);
  return { position: [pos[0], f.center[1] + 0.1, pos[2]], distance: center, yaw, forecourt: { inner, outer } };
}

// ------------------------------------------------------------- outdoor gym ---

export { GYM_TOP };

/** Metres after the start line where the outdoor gym's mat is centred: just past the café. */
export const GYM_DISTANCE = CAFE_DISTANCE + 24;
/** Metres between neighbouring spots on the mat (two rows of four). */
const SPOT_GAP = 1.8;

/** Where the outdoor gym's mat stands on `route`: its centre and yaw, from the road alone. */
function gymSite(route) {
  const f = roadFrame(route, route.wrap(GYM_DISTANCE));
  const side = 1;
  return { f, side, pos: add(f.center, scale(f.right, side * (roadHalfWidth(route.lanes) + 14))), yaw: yawFor(scale(f.right, -side)) };
}

/** Metres from the pad's middle (local z 3) that cover the pad and the statue row behind it. */
const GYM_CLEARING = 12;

/**
 * The ground the outdoor gym on `route` takes, whether or not it ends up built: `{x, z, radius}`.
 * The world plan keeps plants off it.
 */
export function gymClearing(route) {
  const { pos, yaw } = gymSite(route);
  return { x: pos[0] + 3 * Math.sin(yaw), z: pos[2] + 3 * Math.cos(yaw), radius: GYM_CLEARING };
}

/**
 * The outdoor gym beside the café (#77): on the café's side of the road, set
 * back like it, a little further along. Workout riders stand on its mat.
 * Skipped (null) where `avoid` says so or something else stands there.
 *
 * The statue row (workout figures on plinths) stands behind the pad at local
 * z 8; its strip is reserved so scenery keeps off it.
 *
 * @returns {{center: number[], yaw: number, spots: {position: number[], yaw: number}[], cafeId: string | null, statueRow: {position: number[], yaw: number}, position: number[], base: number, drop: number, signLift: number} | null}
 */
export function buildOutdoorGym(route, terrain, { occupancy, avoid = () => false, cafeId = null }) {
  const { f, pos, yaw } = gymSite(route);
  // The pad reaches from the mat towards the road and back to the bench (local z −3.6…6.6).
  const local = (x, z) => [pos[0] + x * Math.cos(yaw) + z * Math.sin(yaw), pos[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
  const [padX, padZ] = local(0, 1.5);
  if (avoid(pos[0], pos[2], 10) || avoid(padX, padZ, 10) || occupancy.blocked(padX, padZ, 7)) return null;

  // Level on the highest ground under the pad; the pad reaches down to the lowest.
  let highest = f.center[1];
  let lowest = f.center[1];
  if (terrain) {
    const heights = [
      [-8.6, -3.6],
      [8.6, -3.6],
      [-8.6, 6.6],
      [8.6, 6.6],
      [0, 0],
    ].map(([x, z]) => terrain.height(...local(x, z)));
    highest = Math.max(...heights);
    lowest = Math.min(...heights);
  }
  const base = highest + 0.05;
  const signGround = terrain ? terrain.height(...local(GYM_SIGN.x, GYM_SIGN.z)) : f.center[1];
  occupancy.add(padX, padZ, 11);
  for (const x of [-5, 0, 5]) occupancy.add(...local(x, 8), 4);

  const spots = [];
  for (const z of [-SPOT_GAP / 2, SPOT_GAP / 2]) {
    for (let k = 0; k < 4; k += 1) {
      const [x, wz] = local((k - 1.5) * SPOT_GAP, z);
      spots.push({ position: [x, base + GYM_TOP, wz], yaw });
    }
  }
  const [rowX, rowZ] = local(0, 8);
  return {
    center: [pos[0], base + GYM_TOP, pos[2]],
    yaw,
    spots,
    cafeId,
    statueRow: { position: [rowX, base, rowZ], yaw },
    position: [pos[0], base, pos[2]],
    base,
    // The pad reaches down to the lowest ground under it, and the sign's posts stand on the ground at the roadside.
    drop: base - lowest + 0.4,
    signLift: signGround - base,
  };
}

// ------------------------------------------------------------ spin studio ---

/** Metres after the start line where the spin studio stands, across the road from the café. */
export const STUDIO_DISTANCE = CAFE_DISTANCE + 12;
/** The studio's footprint in its local frame (riders face -Z; the glass front is at `front`). */
export const STUDIO_FOOTPRINT = FOOTPRINT;
/** Metres between the road edge and the studio's glass front. */
const STUDIO_SETBACK = 8;

/** The studio's frame on `route`: its origin at the road, its yaw, and the middle and reach of its footprint. */
function studioFrame(route) {
  const side = -1;
  const { halfWidth, front, back } = STUDIO_FOOTPRINT;
  const f = roadFrame(route, route.wrap(STUDIO_DISTANCE));
  const origin = add(f.center, scale(f.right, side * (roadHalfWidth(route.lanes) + STUDIO_SETBACK - front)));
  const yaw = yawFor(scale(f.right, -side));
  const local = (x, z) => [origin[0] + x * Math.cos(yaw) + z * Math.sin(yaw), origin[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
  return { f, origin, yaw, local, mid: local(0, (front + back) / 2), reach: Math.hypot(halfWidth, (back - front) / 2) + 1 };
}

/** The ground the plan keeps plants off for the spin studio on `route` (its footprint, plus two metres). */
export function studioClearing(route) {
  const { mid, reach } = studioFrame(route);
  return { x: mid[0], z: mid[1], radius: reach + 2 };
}

/**
 * Where the spin studio stands: on the side opposite the café, glass front
 * facing the road, on the highest ground under its footprint, which it
 * reserves (plus a metre). Null where `avoid` says so or something stands there.
 *
 * @returns {{position: number[], yaw: number} | null}
 */
export function studioSite(route, terrain, { occupancy, avoid = () => false }) {
  const { halfWidth, front, back } = STUDIO_FOOTPRINT;
  const { f, origin, yaw, local, mid: [midX, midZ], reach } = studioFrame(route);
  if (avoid(origin[0], origin[2], 10) || avoid(midX, midZ, 10) || occupancy.blocked(midX, midZ, reach)) return null;
  const y = terrain ? Math.max(...[-halfWidth, halfWidth].flatMap((x) => [front, back].map((z) => terrain.height(...local(x, z))))) : f.center[1];
  occupancy.add(midX, midZ, reach);
  return { position: [origin[0], y, origin[2]], yaw };
}
