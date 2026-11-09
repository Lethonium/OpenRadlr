/**
 * The Living island's moving things as plain data: each mover has a path, a
 * speed and a phase, and `moverPose` gives its place at a moment. Nothing is
 * stored between frames, so a ride of many hours has no jumps and no drift.
 * Purely decorative, and not synced between riders.
 */
import { MeshBuilder } from "../meshBuilder.js";
import { PAVEMENT } from "../features.js";
import { yawFor } from "../math.js";
import { roadFrame, roadHalfWidth } from "../world.js";
import { coastSpots } from "./coast.js";
import { buildParkedTractor, nearParcels, parcelPoint } from "./dressing.js";

export const BIRD_FLOCKS = 12;
const BIRDS_PER_FLOCK = 6;
const BOATS = 10;
const TRACTORS = 8;
const BALLOONS = 4;
const VILLAGERS_MIN = 6;
const VILLAGERS_MAX = 10;
const TWO_PI = Math.PI * 2;

const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const shortestTurn = (from, to) => ((to - from + Math.PI * 3) % TWO_PI) - Math.PI;
const positiveFract = (x) => x - Math.floor(x);

/** A back-and-forth path through `points`, with its length worked out. */
function pingPath(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { type: "ping", points, lengths, total: lengths.at(-1) };
}

function pingPoint(path, distance) {
  const { points, lengths } = path;
  let i = 1;
  while (i < points.length - 1 && lengths[i] < distance) i += 1;
  const [a, b] = [points[i - 1], points[i]];
  const t = clamp01((distance - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], 1e-6));
  return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], heading: [b[0] - a[0], 0, b[2] - a[2]] };
}

/** Time spent standing at each end of a ping, as a share of a leg. */
const HOLD = (mover) => mover.path.pause ?? 0;
/** How long a turn at the end of a ping takes, as a share of a leg. */
const TURN = 0.15;

function pingPose(mover, timeS) {
  const { path, speed, phase } = mover;
  if (speed === 0) return { position: path.points[0], yaw: path.yaw ?? 0 };
  const hold = HOLD(mover);
  const legSeconds = path.total / speed / (1 - hold);
  const u = positiveFract((timeS + phase) / (2 * legSeconds));
  const forward = u < 0.5;
  const leg = forward ? u * 2 : u * 2 - 1;
  const progress = smoothstep(clamp01(leg / (1 - hold)));
  const along = forward ? progress * path.total : (1 - progress) * path.total;
  const { position, heading } = pingPoint(path, along);
  const yawOf = (dir) => yawFor([heading[0] * dir, 0, heading[2] * dir]);
  const here = yawOf(forward ? 1 : -1);
  const turn = smoothstep(clamp01(leg / TURN));
  // Into the leg the mover swings round from facing the other way.
  return { position, yaw: here - shortestTurn(here, yawOf(forward ? -1 : 1)) * (1 - turn) };
}

function circlePose(mover, timeS) {
  const { path, speed, phase } = mover;
  const angle = phase + (speed / path.radius) * timeS;
  const squash = path.squash ?? 1;
  const x = path.center[0] + Math.cos(angle) * path.radius;
  const z = path.center[1] + Math.sin(angle) * path.radius * squash;
  const bob = path.bob ? Math.sin(angle * 3 + phase) * path.bob : 0;
  return { position: [x, path.height + bob, z], yaw: yawFor([-Math.sin(angle), 0, Math.cos(angle) * squash]) };
}

/**
 * Where a mover is at `timeS` seconds.
 * @returns {{position: number[], yaw: number, pose: number}}
 */
export function moverPose(mover, timeS) {
  const place = mover.path.type === "circle" ? circlePose(mover, timeS) : pingPose(mover, timeS);
  const pose = mover.flap ? Math.floor(timeS * mover.flap + mover.phase * 17) & 1 : 0;
  return { position: place.position, yaw: place.yaw, pose };
}

/** Where a mover is roughly: enough to tell the near ones without working out poses. */
const anchorOf = ({ path }) => (path.type === "circle" ? path.center : [path.points[0][0], path.points[0][2]]);

/** The movers worth drawing from `eye`: the nearest up to `cap`, every balloon included (they read from afar). */
export function selectMovers(movers, eye, cap = 150) {
  const balloons = [];
  const rest = [];
  for (const mover of movers) {
    const anchor = anchorOf(mover);
    const distance = (anchor[0] - eye[0]) ** 2 + (anchor[1] - eye[2]) ** 2;
    if (mover.kind === "balloon") balloons.push(mover);
    else rest.push({ mover, distance });
  }
  rest.sort((a, b) => a.distance - b.distance);
  return [...balloons, ...rest.slice(0, Math.max(0, cap - balloons.length)).map((item) => item.mover)];
}

const twoPoses = (mesh) => [mesh, mesh];

function birdModel(up) {
  const m = new MeshBuilder();
  const wing = up ? 0.34 : -0.1;
  const body = [0.2, 0.2, 0.22];
  m.triangleFacing([0, 0, 0.3], [-0.65, wing, 0], [0, 0, -0.2], body, [0, 1, 0]);
  m.triangleFacing([0, 0, 0.3], [0.65, wing, 0], [0, 0, -0.2], body, [0, 1, 0]);
  return m.build();
}

function walkerModel(step) {
  const m = new MeshBuilder();
  const skin = [0.82, 0.68, 0.52];
  const trousers = [0.26, 0.28, 0.4];
  for (const side of [-1, 1]) {
    const swing = (step ? 1 : -1) * side * 0.18;
    m.box([0.13 * side, 0.45, swing], [0.14, 0.9, 0.16], trousers);
  }
  m.box([0, 1.2, 0], [0.42, 0.6, 0.24], [1, 1, 1]);
  m.ellipsoid([0, 1.7, 0], [0.14, 0.16, 0.14], skin, 2, 6);
  return m.build();
}

function boatModel(biome) {
  const { paint, woodLight } = biome.living;
  const m = new MeshBuilder();
  m.box([0, 0.5, 0], [1.6, 0.8, 5], paint[1]);
  m.box([0, 3.3, 0], [0.08, 5, 0.08], woodLight);
  m.triangleFacing([0, 1.4, 0.2], [0, 5.4, 0.2], [0, 1.4, 2.4], [0.95, 0.94, 0.9], [1, 0, 0]);
  m.triangleFacing([0, 1.4, -0.2], [0, 4.6, -0.2], [0, 1.4, -2], [0.86, 0.3, 0.26], [1, 0, 0]);
  return m.build();
}

function balloonModel(biome) {
  const { paint, wood } = biome.living;
  const m = new MeshBuilder();
  m.ellipsoid([0, 18, 0], [8.5, 10, 8.5], paint[2], 6, 12);
  m.ellipsoid([0, 18, 0], [8.7, 3.2, 8.7], paint[0], 3, 12);
  m.box([0, 4.6, 0], [1.6, 1.3, 1.6], wood);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) m.segment([x, 5.2, z], [x * 2.2, 9.5, z * 2.2], 0.04, 0.04, wood);
  return m.build();
}

function tractorModel(biome) {
  const m = new MeshBuilder();
  buildParkedTractor(m, 0, 0, 0, Math.PI / 2, biome);
  return m.build();
}

/** Picks spread-out items from a seeded shuffle. */
function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function addBirds(ctx, movers) {
  const { terrain, fields, random, box, water } = ctx;
  const spots = coastSpots(fields, terrain, ctx.seed);
  const flock = (index, center, height, kind) => {
    const radius = 25 + random() * 40;
    const speed = 12 + random() * 6;
    const flap = 5 + random() * 3;
    const start = random() * TWO_PI;
    for (let b = 0; b < BIRDS_PER_FLOCK; b += 1) {
      const spread = random();
      const path = { type: "circle", center, radius: radius * (0.8 + spread * 0.4), height: height + spread * 8 };
      movers.push({ kind, model: "bird", flock: index, path, speed, phase: start + (b / BIRDS_PER_FLOCK) * 1.2, flap, scale: 1.2, tint: kind === "gull" ? [1, 1, 1] : null });
    }
  };
  for (let i = 0; i < BIRD_FLOCKS; i += 1) {
    if (i % 3 === 2 && spots.length > 0) {
      const spot = spots[Math.floor(random() * spots.length)];
      flock(i, [spot.x + spot.seaward[0] * 30, spot.z + spot.seaward[1] * 30], water + 18 + random() * 22, "gull");
      continue;
    }
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 40; tries += 1) {
      x = box.x0 + random() * (box.x1 - box.x0);
      z = box.z0 + random() * (box.z1 - box.z0);
      if (terrain.height(x, z) > water + 5) break;
    }
    flock(i, [x, z], terrain.height(x, z) + 28 + random() * 30, "bird");
  }
}

function addBoats(ctx, movers) {
  const { terrain, fields, random, water } = ctx;
  const spots = shuffled(coastSpots(fields, terrain, ctx.seed), random);
  for (const spot of spots) {
    if (movers.filter((m) => m.kind === "boat").length >= BOATS) break;
    const out = 260 + random() * 300;
    const center = [spot.x + spot.seaward[0] * out, spot.z + spot.seaward[1] * out];
    const radius = 45 + random() * 45;
    const squash = 0.45;
    let atSea = true;
    for (let k = 0; k < 16 && atSea; k += 1) {
      const a = (k / 16) * TWO_PI;
      if (terrain.height(center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius * squash) > water - 1) atSea = false;
    }
    if (!atSea) continue;
    movers.push({ kind: "boat", model: "boat", path: { type: "circle", center, radius, squash, height: water + 0.1, bob: 0.15 }, speed: 2 + random() * 2, phase: random() * TWO_PI, scale: 1, tint: null });
  }
}

function addTractors(ctx, movers) {
  const { fields, keepClear, terrain, random } = ctx;
  const parcels = shuffled(nearParcels(ctx, 420).filter((p) => p.crop === "ploughed" || p.crop === "hay"), random);
  let placed = 0;
  for (const parcel of parcels) {
    if (placed >= TRACTORS) break;
    const v = parcel.depth / 2;
    const points = [];
    let usable = true;
    for (let u = 10; u <= parcel.width - 10 && usable; u += 12) {
      const [x, z] = parcelPoint(parcel, u, v);
      if (fields.parcelAt(x, z)?.id !== parcel.id || keepClear(x, z, 3)) usable = false;
      else points.push([x, terrain.height(x, z), z]);
    }
    if (!usable || points.length < 4) continue;
    movers.push({ kind: "tractor", model: "tractor", path: pingPath(points), speed: 2.5 + random(), phase: random() * 120, scale: 1, tint: null });
    placed += 1;
  }
}

function addVillagers(ctx, movers) {
  const { ordered, zonesOf, terrain, random } = ctx;
  for (const road of ordered) {
    const offset = roadHalfWidth(road.lanes) + PAVEMENT * 0.6;
    for (const village of zonesOf.get(road).villages) {
      const count = VILLAGERS_MIN + Math.floor(random() * (VILLAGERS_MAX - VILLAGERS_MIN + 1));
      for (let n = 0; n < count; n += 1) {
        const side = random() < 0.5 ? -1 : 1;
        const stretch = 40 + random() * Math.min(60, village.to - village.from - 40);
        const from = village.from + random() * (village.to - village.from - stretch);
        const points = [];
        for (let d = from; d <= from + stretch; d += 8) {
          const f = roadFrame(road, d);
          const x = f.center[0] + f.right[0] * side * offset;
          const z = f.center[2] + f.right[2] * side * offset;
          points.push([x, terrain.height(x, z) + 0.12, z]);
        }
        movers.push({ kind: "walker", model: "walker", path: pingPath(points), speed: 1.1 + random() * 0.5, phase: random() * 60, flap: 1.8, scale: 1, tint: [0.7 + random() * 0.3, 0.4 + random() * 0.5, 0.3 + random() * 0.6] });
      }
    }
  }
}

function addAnimals(ctx, movers) {
  const { terrain, landClear, random } = ctx;
  for (const animal of ctx.animals) {
    const reach = 3 + random() * 4;
    const turn = random() * TWO_PI;
    const x1 = animal.x + Math.cos(turn) * reach;
    const z1 = animal.z + Math.sin(turn) * reach;
    // Their own field is occupied by the herd, so only roads and rivers keep them back.
    if (landClear(x1, z1, 2) || landClear(animal.x, animal.z, 2)) continue;
    const points = [[animal.x, animal.y, animal.z], [x1, terrain.height(x1, z1) - 0.05, z1]];
    movers.push({ kind: "animal", model: animal.kind, path: { ...pingPath(points), pause: 0.6 }, speed: 0.5, phase: random() * 200, scale: 1, tint: null });
  }
}

function addBalloons(ctx, movers) {
  const { terrain, random, box } = ctx;
  const cx = (box.x0 + box.x1) / 2;
  const cz = (box.z0 + box.z1) / 2;
  const span = Math.min(box.x1 - box.x0, box.z1 - box.z0);
  for (let i = 0; i < BALLOONS; i += 1) {
    const angle = (i / BALLOONS) * TWO_PI + random();
    const center = [cx + Math.cos(angle) * span * 0.18, cz + Math.sin(angle) * span * 0.18];
    const radius = 300 + random() * 500;
    let highest = -Infinity;
    for (let k = 0; k < 32; k += 1) {
      const a = (k / 32) * TWO_PI;
      highest = Math.max(highest, terrain.height(center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius));
    }
    movers.push({ kind: "balloon", model: "balloon", path: { type: "circle", center, radius, height: highest + 170 + random() * 150, bob: 3 }, speed: 3 + random() * 2, phase: random() * TWO_PI, scale: 1, tint: null });
  }
}

/**
 * Everything that moves on the island, and its models.
 * @returns {{movers: object[], models: {[model: string]: object[]}}}
 */
export function buildMovers(ctx) {
  const movers = [];
  addBirds(ctx, movers);
  addBoats(ctx, movers);
  addTractors(ctx, movers);
  addVillagers(ctx, movers);
  addAnimals(ctx, movers);
  addBalloons(ctx, movers);
  const { biome } = ctx;
  const models = {
    bird: [birdModel(true), birdModel(false)],
    boat: twoPoses(boatModel(biome)),
    tractor: twoPoses(tractorModel(biome)),
    walker: [walkerModel(true), walkerModel(false)],
    balloon: twoPoses(balloonModel(biome)),
    animal1: twoPoses(biome.models.animal1()),
    animal2: twoPoses(biome.models.animal2()),
    animal3: twoPoses(biome.models.animal3()),
  };
  return { movers, models };
}
