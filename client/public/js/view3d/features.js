/**
 * World features placed along a route: river with a bridge, village, farms
 * with animals, wind turbines, spectators, guard rails and signs.
 *
 * All placement is deterministic (route geometry + seed). Builders write into
 * mesh targets passed in (usually chunked), and return lists of dynamic
 * objects (turbine rotors, spectators) that the view animates per frame.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { add, cellKey, normalize, placement, scale, sub, yawFor } from "./math.js";
import { fbm, seededRandom } from "./noise.js";
import {
  PALETTE,
  buildBarn,
  buildChurch,
  buildCow,
  buildHayBale,
  buildHouse,
  buildSheep,
  buildSilo,
  buildStreetLamp,
  buildTurbineTower,
  buildVillageSign,
  buildCafe,
  buildOutdoorGymModel,
  GYM_SIGN,
  buildWarningSign,
} from "./structures.js";
import { VERGE, roadFrame, roadHalfWidth } from "./world.js";

export const RIVER = Object.freeze({ halfWidth: 9, bank: 26, belowRoad: 9, length: 2400, step: 15, rise: 0.05, mouthDepth: 2.5 });
export const BRIDGE_HALF_LENGTH = 34;
const POND_RADIUS = 34;
export const PAVEMENT = 2.4;
export const WIND = normalize([1, 0, 0.35]);

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

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
      const { surface, radius } = near.sample;
      const d = near.distance;
      const height = d <= radius ? surface - 2.6 + 2.2 * (d / radius) ** 2 : surface - 0.4 + (d - radius) * 0.9;
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
      if (!Number.isFinite(lowest) || distance > RIVER.halfWidth + RIVER.bank + 20) return natural;
      // Blend the valley wall into the natural slope.
      const t = smoothstep(RIVER.halfWidth, RIVER.halfWidth + RIVER.bank, distance);
      const valley = Math.min(natural, Math.max(floor + 0.3, lowest));
      return valley + (natural - valley) * t * t;
    },
    riverDistance(x, z) {
      return carve(x, z).distance;
    },
  };
}

/** Water ribbon along the river plus a disc for each pond. */
export function buildRiverWater(river, into = new MeshBuilder()) {
  const color = [0.22, 0.45, 0.6];
  const w = RIVER.halfWidth + 1.5;
  for (let i = 0; i + 1 < river.points.length; i += 1) {
    const a = river.points[i];
    const b = river.points[i + 1];
    const dir = normalize([b.x - a.x, 0, b.z - a.z]);
    const side = [-dir[2] * w, 0, dir[0] * w];
    const pa = [a.x, a.surface, a.z];
    const pb = [b.x, b.surface, b.z];
    into.triangleFacing(sub(pa, side), add(pa, side), add(pb, side), color, [0, 1, 0]);
    into.triangleFacing(sub(pa, side), add(pb, side), sub(pb, side), color, [0, 1, 0]);
  }
  for (const pond of river.ponds) into.disc([pond.x, pond.surface, pond.z], [pond.radius + 2, pond.radius + 2], color, 16);
  return into;
}

/** Stone arch bridge carrying the road over the river. */
export function buildBridge(route, terrain, river, into) {
  const half = roadHalfWidth(route.lanes) + VERGE;
  const L = BRIDGE_HALF_LENGTH;
  const stone = PALETTE.stone;
  const deckThickness = 1.4;
  const frameAt = (s) => roadFrame(route, river.at + s);
  const deckBottom = (s) => frameAt(s).center[1] - deckThickness;

  for (let s = -L; s < L; s += 2) {
    const f0 = frameAt(s);
    const f1 = frameAt(s + 2);
    const back = sub(f0.center, f1.center);
    const mid = scale(add(f0.center, f1.center), 0.5);
    into.orientedBox(add(mid, [0, -deckThickness / 2 + 0.02, 0]), scale(f0.right, 2 * half + 0.8), [0, deckThickness, 0], back, stone);
    for (const side of [-1, 1]) {
      into.orientedBox(add(add(mid, scale(f0.right, side * (half + 0.2))), [0, 0.38, 0]), scale(f0.right, 0.45), [0, 0.76, 0], back, PALETTE.stone);
      into.orientedBox(add(add(mid, scale(f0.right, side * (half + 0.2))), [0, 0.82, 0]), scale(f0.right, 0.6), [0, 0.12, 0], back, PALETTE.stoneDark);
    }
  }

  // Piers on the banks and arches between them and the abutments.
  const piers = [-16, 16];
  for (const s of piers) {
    const f = frameAt(s);
    const top = deckBottom(s);
    const ground = terrain.height(f.center[0], f.center[2]) - 1;
    const back = scale(f.forward, -2.4);
    into.orientedBox(add(f.center, [0, (top + ground) / 2 - f.center[1], 0]), scale(f.right, 2 * half + 0.4), [0, top - ground, 0], [back[0], 0, back[2]], stone);
  }
  const spans = [
    [-L, -16, 3.5],
    [-16, 16, 6.5],
    [16, L, 3.5],
  ];
  for (const [s0, s1, rise] of spans) {
    const steps = Math.max(6, Math.round((s1 - s0) / 1.5));
    for (let k = 0; k < steps; k += 1) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const sa = s0 + (s1 - s0) * t0;
      const sb = s0 + (s1 - s0) * t1;
      const tm = (t0 + t1) / 2;
      const depth = Math.max(0.5, rise * (1 - Math.sin(Math.PI * tm)));
      const fa = frameAt(sa);
      const fb = frameAt(sb);
      const mid = scale(add(fa.center, fb.center), 0.5);
      const bottom = (deckBottom(sa) + deckBottom(sb)) / 2;
      into.orientedBox(
        [mid[0], bottom - depth / 2, mid[2]],
        scale(fa.right, 2 * half + 0.3),
        [0, depth, 0],
        sub([fa.center[0], 0, fa.center[2]], [fb.center[0], 0, fb.center[2]]),
        PALETTE.stoneDark,
      );
    }
  }
  return into;
}

// ----------------------------------------------------------------- village ---

const houseCache = new Map();
function houseVariant(index) {
  if (!houseCache.has(index)) {
    const random = seededRandom(9001 + index);
    const pick = (list) => list[Math.floor(random() * list.length)];
    houseCache.set(index, {
      mesh: buildHouse({
        w: 7 + random() * 3.5,
        d: 6 + random() * 3,
        floors: random() < 0.6 ? 2 : random() < 0.5 ? 1 : 3,
        wall: pick(PALETTE.walls),
        roof: pick(PALETTE.roofs),
        chimney: random() < 0.6,
      }),
    });
  }
  return houseCache.get(index).mesh;
}
const HOUSE_VARIANTS = 14;

let models = null;
function sharedModels() {
  models ??= {
    church: buildChurch(),
    barn: buildBarn(),
    silo: buildSilo(),
    bale: buildHayBale(),
    lamp: buildStreetLamp(),
    warning: buildWarningSign(),
    villageSign: buildVillageSign(),
    cow: buildCow(false),
    cowBrown: buildCow(true),
    sheep: buildSheep(),
  };
  return models;
}

/** Lowest terrain height under a rectangular footprint (so nothing floats). */
function groundUnder(terrain, center, yaw, w, d) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let lowest = Infinity;
  for (const [lx, lz] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [w / 2, d / 2],
    [0, 0],
  ]) {
    const x = center[0] + lx * c + lz * s;
    const z = center[2] - lx * s + lz * c;
    lowest = Math.min(lowest, terrain.height(x, z));
  }
  return lowest;
}

/**
 * A village along `zone`: pavements, houses on both sides facing the road,
 * a church, street lamps and name boards at both ends.
 */
export function buildVillage(route, terrain, zone, { structures, bright, occupancy, seed, avoid = () => false }) {
  const random = seededRandom(seed ^ Math.round(zone.from * 7));
  const half = roadHalfWidth(route.lanes);
  const m = sharedModels();
  const houses = [];

  // Pavements with kerbs, covering the verge.
  for (let d = zone.from; d < zone.to; d += 4) {
    const f0 = roadFrame(route, d);
    const f1 = roadFrame(route, Math.min(zone.to, d + 4));
    for (const side of [-1, 1]) {
      const at = (f, o, y) => add(add(f.center, scale(f.right, side * o)), [0, y, 0]);
      const inner = half + 0.02;
      const outer = half + PAVEMENT;
      structures.triangleFacing(at(f0, inner, 0.14), at(f0, outer, 0.14), at(f1, outer, 0.14), [0.66, 0.66, 0.64], [0, 1, 0]);
      structures.triangleFacing(at(f0, inner, 0.14), at(f1, outer, 0.14), at(f1, inner, 0.14), [0.66, 0.66, 0.64], [0, 1, 0]);
      structures.triangleFacing(at(f0, inner, 0.14), at(f1, inner, 0.14), at(f1, inner, 0.0), [0.55, 0.55, 0.53], scale(f0.right, -side));
      structures.triangleFacing(at(f0, inner, 0.14), at(f1, inner, 0.0), at(f0, inner, 0.0), [0.55, 0.55, 0.53], scale(f0.right, -side));
      structures.triangleFacing(at(f0, outer, 0.14), at(f1, outer, 0.14), at(f1, outer, -0.8), [0.55, 0.55, 0.53], scale(f0.right, side));
      structures.triangleFacing(at(f0, outer, 0.14), at(f1, outer, -0.8), at(f0, outer, -0.8), [0.55, 0.55, 0.53], scale(f0.right, side));
    }
  }

  // Church in the middle on the right.
  const middle = (zone.from + zone.to) / 2;
  const cf = roadFrame(route, middle);
  const churchPos = add(cf.center, scale(cf.right, half + PAVEMENT + 15));
  if (!avoid(churchPos[0], churchPos[2], 16)) {
    const yaw = yawFor(scale(cf.right, -1));
    const y = groundUnder(terrain, churchPos, yaw, 10, 22);
    structures.append(m.church, placement([churchPos[0], y, churchPos[2]], yaw));
    occupancy.add(churchPos[0], churchPos[2], 18);
  }

  // Houses on both sides.
  for (const side of [-1, 1]) {
    let d = zone.from + 8 + random() * 6;
    while (d < zone.to - 6) {
      const f = roadFrame(route, d);
      const variant = Math.floor(random() * HOUSE_VARIANTS);
      const depth = 9;
      const setback = half + PAVEMENT + 2.5 + random() * 3.5 + depth / 2;
      const pos = add(f.center, scale(f.right, side * setback));
      const nearChurch = side > 0 && Math.abs(d - middle) < 17;
      if (!nearChurch && random() < 0.88 && !avoid(pos[0], pos[2], 7) && !occupancy.blocked(pos[0], pos[2], 5)) {
        const yaw = yawFor(scale(f.right, -side));
        const y = groundUnder(terrain, pos, yaw, 11, 10);
        structures.append(houseVariant(variant), placement([pos[0], y, pos[2]], yaw));
        occupancy.add(pos[0], pos[2], 7);
        houses.push(pos);
      }
      d += 13 + random() * 7;
    }
  }

  // Street lamps on alternating sides; heads go into the "bright" mesh.
  let lampSide = 1;
  for (let d = zone.from + 6; d < zone.to; d += 26) {
    const f = roadFrame(route, d);
    const pos = add(f.center, scale(f.right, lampSide * (half + PAVEMENT - 0.3)));
    const model = placement([pos[0], f.center[1] + 0.14, pos[2]], yawFor(scale(f.right, -lampSide)));
    structures.append(m.lamp.pole, model);
    bright.append(m.lamp.head, model);
    lampSide = -lampSide;
  }

  // Name boards at both ends, facing approaching riders.
  for (const d of [zone.from, zone.to]) {
    const f = roadFrame(route, d);
    const pos = add(f.center, scale(f.right, half + PAVEMENT + 0.8));
    const model = placement([pos[0], terrain.height(pos[0], pos[2]), pos[2]], yawFor(scale(f.forward, -1)));
    structures.append(m.villageSign.post, model);
    bright.append(m.villageSign.face, model);
  }
  return { houses };
}

// ------------------------------------------------------------------- farms ---

/** Farmsteads (barn, house, silo, hay bales) with grazing animals nearby. */
export function buildFarms(route, terrain, { structures, occupancy, seed, count = 7, lakeLevel = -Infinity, avoid = () => false }) {
  const random = seededRandom(seed ^ 0xfa53);
  const m = sharedModels();
  const farms = [];
  let attempts = 0;
  while (farms.length < count && attempts < count * 40) {
    attempts += 1;
    const d = random() * route.length;
    const f = roadFrame(route, d);
    const side = random() < 0.5 ? -1 : 1;
    const offset = 75 + random() * 170;
    const pos = add(f.center, scale(f.right, side * offset));
    if (avoid(pos[0], pos[2], 40) || occupancy.blocked(pos[0], pos[2], 40)) continue;
    if (terrain.distanceToRoad(pos[0], pos[2]) < 55) continue;
    const samples = [-18, 18].flatMap((dx) => [-18, 18].map((dz) => terrain.height(pos[0] + dx, pos[2] + dz)));
    if (Math.max(...samples) - Math.min(...samples) > 6 || Math.min(...samples) < lakeLevel + 2) continue;

    const yaw = yawFor(scale(f.right, -side)) + (random() - 0.5) * 0.5;
    const local = (lx, lz) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return [pos[0] + lx * c + lz * s, 0, pos[2] - lx * s + lz * c];
    };
    const place = (mesh, lx, lz, turn, w, dpt) => {
      const p = local(lx, lz);
      const y = groundUnder(terrain, p, yaw + turn, w, dpt);
      structures.append(mesh, placement([p[0], y, p[2]], yaw + turn));
    };
    place(m.barn, 0, 0, 0, 15, 10);
    place(houseVariant(Math.floor(random() * HOUSE_VARIANTS)), -17, -4, 0, 10, 9);
    place(m.silo, 10.5, 6, 0, 5, 5);
    for (let b = 0; b < 4 + Math.floor(random() * 4); b += 1) {
      place(m.bale, 4 + random() * 14, -9 - random() * 8, random() * Math.PI, 1.3, 1.5);
    }

    // A herd in a field further from the road.
    const field = local((random() - 0.5) * 30, 45 + random() * 20);
    const sheep = random() < 0.4;
    const animals = sheep ? 7 + Math.floor(random() * 6) : 4 + Math.floor(random() * 5);
    for (let a = 0; a < animals; a += 1) {
      const angle = random() * Math.PI * 2;
      const r = random() * 16;
      const x = field[0] + Math.cos(angle) * r;
      const z = field[2] + Math.sin(angle) * r;
      if (avoid(x, z, 2) || terrain.height(x, z) < lakeLevel + 1) continue;
      const mesh = sheep ? m.sheep : random() < 0.5 ? m.cow : m.cowBrown;
      structures.append(mesh, placement([x, terrain.height(x, z) - 0.05, z], random() * Math.PI * 2));
    }
    occupancy.add(pos[0], pos[2], 30);
    occupancy.add(field[0], field[2], 20);
    farms.push(pos);
  }
  return farms;
}

// ---------------------------------------------------------------- turbines ---

/** A row of wind turbines on the highest ground near the route. Returns rotor hubs. */
export function buildWindTurbines(route, terrain, { structures, occupancy, seed, bounds, count = 6, lakeLevel = -Infinity, avoid = () => false }) {
  const random = seededRandom(seed ^ 0x7b1e);
  const height = 62;
  let best = null;
  for (let i = 0; i < 300; i += 1) {
    const x = bounds.x0 - 300 + random() * (bounds.x1 - bounds.x0 + 600);
    const z = bounds.z0 - 300 + random() * (bounds.z1 - bounds.z0 + 600);
    const road = terrain.index.farDistance(x, z);
    if (road < 260 || road > 950 || avoid(x, z, 60)) continue;
    const y = terrain.height(x, z);
    if (!best || y > best.y) best = { x, z, y };
  }
  if (!best) return [];
  const across = [-WIND[2], 0, WIND[0]];
  const yaw = Math.atan2(-WIND[2], WIND[0]);
  const tower = buildTurbineTower(height);
  const rotors = [];
  for (let i = 0; i < count; i += 1) {
    const offset = (i - (count - 1) / 2) * 170 + (random() - 0.5) * 30;
    const x = best.x + across[0] * offset;
    const z = best.z + across[2] * offset;
    if (terrain.index.farDistance(x, z) < 180 || avoid(x, z, 30)) continue;
    const y = terrain.height(x, z);
    if (y < lakeLevel + 2) continue;
    structures.append(tower, placement([x, y, z], yaw));
    occupancy.add(x, z, 12);
    // The hub sits at the windward end of the nacelle (local −X).
    const hub = [x - Math.cos(yaw) * 3.4, y + height + 1.2, z + Math.sin(yaw) * 3.4];
    rotors.push({ hub, yaw, phase: random() * Math.PI * 2, speed: 0.9 + random() * 0.4 });
  }
  return rotors;
}

// -------------------------------------------------------------- spectators ---

const SHIRTS = [
  [0.86, 0.2, 0.2],
  [0.2, 0.45, 0.85],
  [0.98, 0.8, 0.2],
  [0.95, 0.95, 0.95],
  [0.25, 0.65, 0.35],
  [0.95, 0.5, 0.15],
  [0.55, 0.3, 0.75],
  [0.15, 0.15, 0.18],
];

/** Crowds behind barriers at the finish and on top of the climb. */
export function buildSpectators(route, terrain, { structures, seed, perSide = 16 }) {
  const random = seededRandom(seed ^ 0x5bec);
  const half = roadHalfWidth(route.lanes) + VERGE;
  const spots = [0];
  for (const marker of route.markers) if (marker.type === "climb") spots.push(marker.distance + (marker.length ?? 0));
  const people = [];
  for (const spot of spots) {
    // Barriers.
    for (const side of [-1, 1]) {
      for (let s = -24; s < 24; s += 3) {
        const f0 = roadFrame(route, spot + s);
        const f1 = roadFrame(route, spot + s + 3);
        const p0 = add(f0.center, scale(f0.right, side * (half + 0.5)));
        const p1 = add(f1.center, scale(f1.right, side * (half + 0.5)));
        const y0 = terrain.height(p0[0], p0[2]);
        structures.box([p0[0], y0 + 0.5, p0[2]], [0.07, 1.0, 0.07], PALETTE.metal);
        const mid = scale(add(p0, p1), 0.5);
        const color = Math.floor((s + 24) / 3) % 2 === 0 ? PALETTE.white : [0.2, 0.42, 0.85];
        structures.orientedBox([mid[0], y0 + 0.85, mid[2]], sub(p1, p0), [0, 0.28, 0], scale(f0.right, 0.04), color);
      }
    }
    // People, two loose rows per side.
    for (const side of [-1, 1]) {
      for (let k = 0; k < perSide; k += 1) {
        const along = (random() - 0.5) * 44;
        const f = roadFrame(route, spot + along);
        const lateral = half + 1.0 + (k % 2) * 0.8 + random() * 0.4;
        const p = add(f.center, scale(f.right, side * lateral));
        people.push({
          position: [p[0], terrain.height(p[0], p[2]), p[2]],
          yaw: yawFor(scale(f.right, -side)) + (random() - 0.5) * 0.6,
          shirt: SHIRTS[Math.floor(random() * SHIRTS.length)],
          armsUp: random() < 0.55,
          phase: random() * Math.PI * 2,
          scale: 0.92 + random() * 0.16,
        });
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
 * `cliffs` are stretches along a cliff: a rail on the side where the ground
 * falls away (the sea side), whichever way the road runs.
 */
export function buildRoadside(route, terrain, { structures, bright, skip = () => false, markers = true, rails = true, twoWay = false, railGrade = 3, railStep = 4, cliffs = [] }) {
  const half = roadHalfWidth(route.lanes) + VERGE;
  const m = sharedModels();

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
      structures.box([p0[0], p0[1] + 0.2, p0[2]], [0.12, 0.9, 0.12], PALETTE.pole);
      const mid = scale(add(p0, p1), 0.5);
      structures.orientedBox([mid[0], mid[1] + 0.55, mid[2]], sub(p1, p0), [0, 0.3, 0], scale(f0.right, 0.06), PALETTE.metal);
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
    for (const side of [-1, 1]) structures.box(add(add(f.center, scale(f.right, side * width)), [0, 2.6, 0]), [0.25, 5.2, 0.25], PALETTE.white);
    structures.orientedBox(add(f.center, [0, 5.3, 0]), scale(f.right, 2 * width + 0.3), [0, 0.3, 0], scale(normalize([f.forward[0], 0, f.forward[2]]), -0.2), PALETTE.white);
    const face = scale(normalize([f.forward[0], 0, f.forward[2]]), -1);
    const top = add(f.center, [0, 5.15, 0]);
    bright.triangleFacing(add(top, scale(f.right, -1.4)), add(top, scale(f.right, 1.4)), add(f.center, [0, 3.6, 0]), PALETTE.red, face);
  }
}

// --------------------------------------------------------------- bike café ---

/** Metres after the start/finish line where the café stands, on the right. */
export const CAFE_DISTANCE = 45;

/**
 * The bike café at the start: a paved forecourt along the road, then the
 * terrace and the café itself facing the road.
 */
export function buildBikeCafe(route, terrain, { structures, bright, occupancy, avoid = () => false }) {
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
    const stone = [0.7, 0.68, 0.64];
    structures.triangleFacing(at(f0, inner, 0.1), at(f0, outer, 0.1), at(f1, outer, 0.1), stone, [0, 1, 0]);
    structures.triangleFacing(at(f0, inner, 0.1), at(f1, outer, 0.1), at(f1, inner, 0.1), stone, [0, 1, 0]);
    structures.triangleFacing(at(f0, inner, 0.1), at(f1, inner, 0.1), at(f1, inner, -0.3), [0.55, 0.55, 0.53], scale(f0.right, -side));
    structures.triangleFacing(at(f0, inner, 0.1), at(f1, inner, -0.3), at(f0, inner, -0.3), [0.55, 0.55, 0.53], scale(f0.right, -side));
  }

  const cafe = cafeModel();
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
 * @returns {{center: number[], yaw: number, spots: {position: number[], yaw: number}[]} | null}
 */
export function buildOutdoorGym(route, terrain, { structures, bright, occupancy, avoid = () => false }) {
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
  const signGround = terrain ? terrain.height(...local(GYM_SIGN.x, GYM_SIGN.z)) : f.center[1];
  const gym = buildOutdoorGymModel({ drop: base - lowest + 0.4, signLift: signGround - base });
  const model = placement([pos[0], base, pos[2]], yaw);
  structures.append(gym.mesh, model);
  bright.append(gym.bright, model);
  occupancy.add(padX, padZ, 11);

  const spots = [];
  for (const z of [-SPOT_GAP / 2, SPOT_GAP / 2]) {
    for (let k = 0; k < 4; k += 1) {
      const [x, wz] = local((k - 1.5) * SPOT_GAP, z);
      spots.push({ position: [x, base + gym.top, wz], yaw });
    }
  }
  return { center: [pos[0], base + gym.top, pos[2]], yaw, spots };
}

let cafeCache = null;
function cafeModel() {
  cafeCache ??= buildCafe();
  return cafeCache;
}

