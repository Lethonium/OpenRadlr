/**
 * World features placed along a route: spectators, guard rails, signs, village name boards, the café, the
 * outdoor gym and the studio's site. (Towns, farms, turbines, landmarks and far islands are scene layers.)
 *
 * All placement is deterministic (route geometry + seed). Builders write into
 * mesh targets passed in (usually chunked), and return lists of dynamic
 * objects (spectators) that the view animates per frame.
 */
import { CROWD } from "./crowd.js";
import { add, cellKey, normalize, placement, scale, sub, yawFor } from "./math.js";
import { seededRandom } from "../world/noise.js";
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

// ------------------------------------------------------------ shared models ---

/** Metres from the road's edge to a village name board. */
const BOARD_SETBACK = 3.2;

const modelsByBiome = new Map();
function sharedModels(biome) {
  let models = modelsByBiome.get(biome.id);
  if (!models) {
    models = { warning: biome.models.warning(), villageSign: biome.models.villageSign() };
    modelsByBiome.set(biome.id, models);
  }
  return models;
}

/** The village name boards at both ends of each zone, facing approaching riders. */
function buildVillageSigns(route, villages, terrain, { structures, bright, biome }) {
  const half = roadHalfWidth(route.lanes);
  const m = sharedModels(biome);
  for (const zone of villages) {
    for (const d of [zone.from, zone.to]) {
      const f = roadFrame(route, d);
      const pos = add(f.center, scale(f.right, half + BOARD_SETBACK));
      const model = placement([pos[0], terrain.height(pos[0], pos[2]), pos[2]], yawFor(scale(f.forward, -1)));
      structures.append(m.villageSign.post, model);
      bright.append(m.villageSign.face, model);
    }
  }
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
 * yards and rivers.
 */
export function buildSpectators(route, terrain, { structures, seed, perSide = 16, biome = temperate, blocked = () => false }) {
  const random = seededRandom(seed ^ 0x5bec);
  // Placement added later draws from its own stream: the first crowds stay where they always stood.
  const more = seededRandom(seed ^ 0xc4e3);
  const crowd = biome.people ?? temperate.people;
  const shirts = crowd.shirts ?? temperate.people.shirts;
  const barrier = biome.road.barrier ?? temperate.road.barrier;
  const half = roadHalfWidth(route.lanes) + VERGE;
  const people = [];
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
        const y0 = terrain.height(p0[0], p0[2]);
        structures.box([p0[0], y0 + 0.5, p0[2]], [0.07, 1.0, 0.07], barrier.post);
        const mid = scale(add(p0, p1), 0.5);
        const color = barrier.stripes[Math.floor((s + 24) / 3) % barrier.stripes.length];
        structures.orientedBox([mid[0], y0 + 0.85, mid[2]], sub(p1, p0), [0, 0.28, 0], scale(f0.right, 0.04), color);
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
  return people;
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
 * without `rails`: signs only). `twoWay` roads get rails where they are
 * steeper (5 %) either way, since a climb is a descent the other way.
 * `villages` are zone stretches whose ends get a name board. `cliffs` are stretches along a cliff: a rail on the side where the ground
 * falls away (the sea side), whichever way the road runs.
 */
export function buildRoadside(route, terrain, { structures, bright, skip = () => false, markers = true, rails = true, twoWay = false, railGrade = 3, railStep = 4, cliffs = [], villages = [], biome = temperate }) {
  const half = roadHalfWidth(route.lanes) + VERGE;
  const m = sharedModels(biome);
  const palette = biome.palette;
  buildVillageSigns(route, villages, terrain, { structures, bright, biome });

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
    for (const side of sides) {
      const p0 = add(f0.center, scale(f0.right, side * (half + 0.3)));
      const p1 = add(f1.center, scale(f1.right, side * (half + 0.3)));
      structures.box([p0[0], p0[1] + 0.2, p0[2]], [0.12, 0.9, 0.12], palette.pole);
      const mid = scale(add(p0, p1), 0.5);
      structures.orientedBox([mid[0], mid[1] + 0.55, mid[2]], sub(p1, p0), [0, 0.3, 0], scale(f0.right, 0.06), palette.metal);
    }
  }

  // Signs and the flamme rouge belong to the ridden route only.
  if (!markers) return;

  const sign = (distance, model) => {
    const f = roadFrame(route, distance);
    const pos = add(f.center, scale(f.right, half + 0.9));
    const placementMatrix = placement([pos[0], terrain.height(pos[0], pos[2]), pos[2]], yawFor(scale(f.forward, -1)));
    structures.append(model.post, placementMatrix);
    bright.append(model.face, placementMatrix);
  };
  for (const marker of route.markers) {
    if (marker.type !== "climb") continue;
    sign(marker.distance - 120, m.warning);
    sign(marker.distance + (marker.length ?? 0) + 25, m.warning);
  }

  // Flamme rouge: red pennant over the road one kilometre before the finish.
  if (route.length > 1500) {
    const f = roadFrame(route, route.length - 1000);
    const width = half + 0.6;
    for (const side of [-1, 1]) structures.box(add(add(f.center, scale(f.right, side * width)), [0, 2.6, 0]), [0.25, 5.2, 0.25], palette.white);
    structures.orientedBox(add(f.center, [0, 5.3, 0]), scale(f.right, 2 * width + 0.3), [0, 0.3, 0], scale(normalize([f.forward[0], 0, f.forward[2]]), -0.2), palette.white);
    const face = scale(normalize([f.forward[0], 0, f.forward[2]]), -1);
    const top = add(f.center, [0, 5.15, 0]);
    bright.triangleFacing(add(top, scale(f.right, -1.4)), add(top, scale(f.right, 1.4)), add(f.center, [0, 3.6, 0]), palette.red, face);
  }
}

// --------------------------------------------------------------- bike café ---

/** Metres after the start/finish line where the café stands, on the right. */
export const CAFE_DISTANCE = 45;

/**
 * The bike café at the start: a paved forecourt along the road, then the
 * terrace and the café itself facing the road.
 */
export function buildBikeCafe(route, terrain, { structures, bright, occupancy, avoid = () => false, biome = temperate }) {
  const half = roadHalfWidth(route.lanes);
  const terraceDepth = 7;
  const forecourt = 3;
  const side = 1;
  const center = route.wrap(CAFE_DISTANCE);
  const f = roadFrame(route, center);
  const setback = half + forecourt + terraceDepth + 4;
  const pos = add(f.center, scale(f.right, side * setback));
  if (avoid(pos[0], pos[2], 12)) return null;

  // Paved forecourt between the road and the terrace.
  const from = center - 11;
  const to = center + 11;
  for (let d = from; d < to; d += 2) {
    const f0 = roadFrame(route, d);
    const f1 = roadFrame(route, Math.min(to, d + 2));
    const at = (fr, o, y) => add(add(fr.center, scale(fr.right, side * o)), [0, y, 0]);
    const inner = half + 0.02;
    const outer = half + forecourt + terraceDepth;
    const stone = biome.palette.forecourt;
    structures.triangleFacing(at(f0, inner, 0.1), at(f0, outer, 0.1), at(f1, outer, 0.1), stone, [0, 1, 0]);
    structures.triangleFacing(at(f0, inner, 0.1), at(f1, outer, 0.1), at(f1, inner, 0.1), stone, [0, 1, 0]);
    structures.triangleFacing(at(f0, inner, 0.1), at(f1, inner, 0.1), at(f1, inner, -0.3), biome.palette.forecourtEdge, scale(f0.right, -side));
    structures.triangleFacing(at(f0, inner, 0.1), at(f1, inner, -0.3), at(f0, inner, -0.3), biome.palette.forecourtEdge, scale(f0.right, -side));
  }

  const cafe = cafeModel(biome);
  const yaw = yawFor(scale(f.right, -side));
  const model = placement([pos[0], f.center[1] + 0.1, pos[2]], yaw);
  structures.append(cafe.mesh, model);
  bright.append(cafe.bright, model);
  occupancy.add(pos[0], pos[2], 14);
  const forecourtMid = add(f.center, scale(f.right, side * (half + (forecourt + terraceDepth) / 2)));
  occupancy.add(forecourtMid[0], forecourtMid[2], 10);
  return { position: pos, distance: center };
}

// ------------------------------------------------------------- outdoor gym ---

/** Metres after the start line where the outdoor gym's mat is centred: just past the café. */
export const GYM_DISTANCE = CAFE_DISTANCE + 24;
/** Metres between neighbouring spots on the mat (two rows of four). */
const SPOT_GAP = 1.8;

/**
 * The outdoor gym beside the café (#77): on the café's side of the road, set
 * back like it, a little further along. Workout riders stand on its mat.
 * Skipped (null) where `avoid` says so or something else stands there.
 *
 * The statue row (workout figures on plinths) stands behind the pad at local
 * z 8; its strip is reserved so scenery keeps off it.
 *
 * @returns {{center: number[], yaw: number, spots: {position: number[], yaw: number}[], cafeId: string | null, statueRow: {position: number[], yaw: number}} | null}
 */
export function buildOutdoorGym(route, terrain, { structures, bright, occupancy, avoid = () => false, biome = temperate, cafeId = null }) {
  const half = roadHalfWidth(route.lanes);
  const side = 1;
  const f = roadFrame(route, route.wrap(GYM_DISTANCE));
  const pos = add(f.center, scale(f.right, side * (half + 14)));
  const yaw = yawFor(scale(f.right, -side));
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
  const signGround = terrain ? terrain.height(...local(biome.models.gymSign.x, biome.models.gymSign.z)) : f.center[1];
  const gym = biome.models.gym({ drop: base - lowest + 0.4, signLift: signGround - base });
  const model = placement([pos[0], base, pos[2]], yaw);
  structures.append(gym.mesh, model);
  bright.append(gym.bright, model);
  occupancy.add(padX, padZ, 11);
  for (const x of [-5, 0, 5]) occupancy.add(...local(x, 8), 4);

  const spots = [];
  for (const z of [-SPOT_GAP / 2, SPOT_GAP / 2]) {
    for (let k = 0; k < 4; k += 1) {
      const [x, wz] = local((k - 1.5) * SPOT_GAP, z);
      spots.push({ position: [x, base + gym.top, wz], yaw });
    }
  }
  const [rowX, rowZ] = local(0, 8);
  return { center: [pos[0], base + gym.top, pos[2]], yaw, spots, cafeId, statueRow: { position: [rowX, base, rowZ], yaw } };
}

// ------------------------------------------------------------ spin studio ---

/** Metres after the start line where the spin studio stands, across the road from the café. */
export const STUDIO_DISTANCE = CAFE_DISTANCE + 12;
/** The studio's footprint in its local frame (riders face -Z; the glass front is at `front`). */
export const STUDIO_FOOTPRINT = Object.freeze({ halfWidth: 8.5, front: -10, back: 8 });
/** Metres between the road edge and the studio's glass front. */
const STUDIO_SETBACK = 8;

/**
 * Where the spin studio stands: on the side opposite the café, glass front
 * facing the road, on the highest ground under its footprint, which it
 * reserves (plus a metre). Null where `avoid` says so or something stands there.
 *
 * @returns {{position: number[], yaw: number} | null}
 */
export function studioSite(route, terrain, { occupancy, avoid = () => false }) {
  const side = -1;
  const { halfWidth, front, back } = STUDIO_FOOTPRINT;
  const f = roadFrame(route, route.wrap(STUDIO_DISTANCE));
  const origin = add(f.center, scale(f.right, side * (roadHalfWidth(route.lanes) + STUDIO_SETBACK - front)));
  const yaw = yawFor(scale(f.right, -side));
  const local = (x, z) => [origin[0] + x * Math.cos(yaw) + z * Math.sin(yaw), origin[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
  const [midX, midZ] = local(0, (front + back) / 2);
  const reach = Math.hypot(halfWidth, (back - front) / 2) + 1;
  if (avoid(origin[0], origin[2], 10) || avoid(midX, midZ, 10) || occupancy.blocked(midX, midZ, reach)) return null;
  const y = terrain ? Math.max(...[-halfWidth, halfWidth].flatMap((x) => [front, back].map((z) => terrain.height(...local(x, z))))) : f.center[1];
  occupancy.add(midX, midZ, reach);
  return { position: [origin[0], y, origin[2]], yaw };
}

const cafeCache = new Map();
function cafeModel(biome) {
  let cafe = cafeCache.get(biome.id);
  if (!cafe) {
    cafe = biome.models.cafe();
    cafeCache.set(biome.id, cafe);
  }
  return cafe;
}
