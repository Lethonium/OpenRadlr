/**
 * The Living island's few surprises: a lighthouse with a turning beam, a
 * giant bicycle mown into a field for the drone to find, a sheep on a tower
 * of hay, an escaped penguin and a handful of small roadside scenes.
 */
import { MeshBuilder } from "../meshBuilder.js";
import { placement } from "../math.js";
import { buildCow, buildHayBale, buildSheep } from "../structures.js";
import { buildPenguin } from "../biomes/winter/people.js";
import { roadFrame } from "../world.js";
import { coastSpots } from "./coast.js";
import { nearParcels, parcelPoint } from "./dressing.js";

const SCENE_EVERY_M = 5000;
const SCENES_AT_MOST = 8;
const BEAM_RPS = 0.12;
const MOWN = [186, 196, 118];

/** How many roadside scenes a map of `roadLength` metres gets. */
export const sceneCount = (roadLength) => Math.min(SCENES_AT_MOST, Math.max(1, Math.round(roadLength / SCENE_EVERY_M)));

/** A large, flat meadow or hay parcel beside a road, picked the same way on every client. */
export function pickBicycleParcel(fields, terrain, seed) {
  let best = null;
  let bestScore = Infinity;
  const { radiusAt, center } = terrain.island;
  const reach = radiusAt(0) * 1.2;
  for (let z = center[1] - reach; z < center[1] + reach; z += 37) {
    for (let x = center[0] - reach; x < center[0] + reach; x += 37) {
      const parcel = fields.parcelAt(x, z);
      if (!parcel || !["meadow", "hay", "pasture"].includes(parcel.crop) || parcel.width < 120 || parcel.depth < 110) continue;
      const road = terrain.index.nearest(parcel.center[0], parcel.center[1], 5)?.distance ?? Infinity;
      if (road < 30 || road > 250) continue;
      const heights = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => terrain.height(parcel.center[0] + a * parcel.width * 0.45, parcel.center[1] + b * parcel.depth * 0.45)));
      const range = Math.max(...heights) - Math.min(...heights);
      if (range > 3) continue;
      const score = range + ((parcel.id ^ seed) % 1000) / 2000;
      if (score < bestScore) {
        bestScore = score;
        best = parcel;
      }
    }
  }
  return best;
}

/** Distance from (u, v) to the segment a–b. */
function toSegment(u, v, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(u - ax - dx * t, v - ay - dy * t);
}

/** The parcel's frame: wheels and frame of a bicycle laid out on the ground, as an overlay. */
function bicycleOverlay(fields, parcel) {
  const cos = Math.cos(parcel.angle);
  const sin = Math.sin(parcel.angle);
  const [halfW, halfD] = [parcel.width / 2, parcel.depth / 2];
  const r = Math.min(parcel.width * 0.22, parcel.depth * 0.32);
  const wheelGap = r * 1.15;
  const stroke = 8;
  const [cx, cz] = parcel.center;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + a * halfW * cos - b * halfD * sin, cz + a * halfW * sin + b * halfD * cos]);
  const paint = (x, z) => {
    if (fields.parcelAt(x, z)?.id !== parcel.id) return null;
    const dx = x - cx;
    const dz = z - cz;
    const u = dx * cos + dz * sin;
    const v = dz * cos - dx * sin;
    const rear = [-wheelGap, 0];
    const front = [wheelGap, 0];
    const seat = [-0.25 * wheelGap, r * 0.9];
    const head = [0.55 * wheelGap, r * 0.95];
    const crank = [0, 0];
    const onRing = (centre) => Math.abs(Math.hypot(u - centre[0], v - centre[1]) - r) < stroke / 2;
    const onFrame = (a, b) => toSegment(u, v, a, b) < stroke / 2;
    if (onRing(rear) || onRing(front)) return MOWN;
    if ([[rear, crank], [crank, seat], [seat, rear], [crank, head], [seat, head], [head, front]].some(([a, b]) => onFrame(a, b))) return MOWN;
    return null;
  };
  return { x0: Math.min(...corners.map((p) => p[0])), z0: Math.min(...corners.map((p) => p[1])), x1: Math.max(...corners.map((p) => p[0])), z1: Math.max(...corners.map((p) => p[1])), paint };
}

/** A striped tower on the headland, with a lamp room for the beam. */
function buildLighthouse(mesh, x, y, z) {
  const white = [0.95, 0.95, 0.92];
  const red = [0.82, 0.2, 0.18];
  for (let band = 0; band < 5; band += 1) mesh.cylinder([x, y + band * 3.2, z], 3.1 - band * 0.25, 3.2, band % 2 ? red : white, 12, 2.85 - band * 0.25, false);
  mesh.cylinder([x, y + 16, z], 2.2, 0.3, [0.2, 0.2, 0.22], 12);
  mesh.cylinder([x, y + 16.3, z], 1.5, 2.2, [0.95, 0.9, 0.5], 10);
  mesh.cone([x, y + 18.5, z], 2.2, 1.5, red, 10);
}

/** The beam as a slim fan, bright so it shows at dusk. */
function beamModel() {
  const m = new MeshBuilder();
  const color = [1, 0.96, 0.7];
  m.triangleFacing([0, 17.4, 0], [-9, 16.2, 140], [9, 16.2, 140], color, [0, 1, 0]);
  m.triangleFacing([0, 17.4, 0], [-9, 16.2, -140], [9, 16.2, -140], color, [0, 1, 0]);
  return m.build();
}

function scarecrowModel(up) {
  const m = new MeshBuilder();
  const wood = [0.42, 0.3, 0.2];
  m.box([0, 1.1, 0], [0.12, 2.2, 0.12], wood);
  m.box([0, 1.55, 0], [0.5, 0.7, 0.3], [0.8, 0.26, 0.22]);
  m.ellipsoid([0, 2.2, 0], [0.2, 0.22, 0.2], [0.82, 0.72, 0.5], 2, 6);
  m.cone([0, 2.35, 0], 0.32, 0.4, wood, 6);
  m.segment([-0.15, 1.75, 0], [-0.9, 1.65, 0], 0.1, 0.1, wood);
  m.segment([0.15, 1.75, 0], up ? [0.75, 2.4, 0] : [0.9, 1.3, 0], 0.1, 0.1, wood);
  return m.build();
}

function gnomes(mesh, x, y, z) {
  const hat = [0.84, 0.18, 0.16];
  const coat = [0.2, 0.42, 0.72];
  for (let k = 0; k < 7; k += 1) {
    const a = (k / 7) * Math.PI * 2;
    const gx = x + Math.cos(a) * 1.5;
    const gz = z + Math.sin(a) * 1.5;
    mesh.cylinder([gx, y, gz], 0.2, 0.42, coat, 7);
    mesh.ellipsoid([gx, y + 0.56, gz], [0.14, 0.14, 0.14], [0.9, 0.78, 0.62], 2, 6);
    mesh.cone([gx, y + 0.66, gz], 0.2, 0.42, hat, 7);
  }
}

function picnic(mesh, x, y, z) {
  mesh.box([x, y + 0.03, z], [3.4, 0.06, 2.4], [0.9, 0.86, 0.72]);
  // The sandwich, somewhat too large for anyone's lunch.
  mesh.box([x, y + 0.5, z], [1.4, 0.26, 1.4], [0.84, 0.66, 0.34]);
  mesh.box([x, y + 0.72, z], [1.3, 0.14, 1.3], [0.35, 0.6, 0.25]);
  mesh.box([x, y + 0.88, z], [1.25, 0.14, 1.25], [0.86, 0.72, 0.3]);
  mesh.box([x, y + 1.08, z], [1.4, 0.26, 1.4], [0.84, 0.66, 0.34]);
}

function cowInPond(mesh, pond, cow) {
  mesh.disc([pond.x, pond.surface + 0.05, pond.z], [pond.radius, pond.radius], [0.24, 0.5, 0.62], 14);
  mesh.append(cow, placement([pond.x, pond.surface - 0.55, pond.z], 1.2));
}

/** Evenly spread points along the roads, for scenes and props, keeping out of what must stay clear. */
function roadsideSpots(ctx, count, radius) {
  const { ordered, random, keepClear } = ctx;
  const total = ordered.reduce((sum, road) => sum + road.length, 0);
  const spots = [];
  if (total === 0) return spots;
  for (let n = 0; n < count; n += 1) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      let along = (n + random()) * (total / count);
      const road = ordered.find((r) => {
        if (along < r.length) return true;
        along -= r.length;
        return false;
      }) ?? ordered[0];
      const f = roadFrame(road, along);
      const side = random() < 0.5 ? -1 : 1;
      const offset = 15 + random() * 15;
      const x = f.center[0] + f.right[0] * side * offset;
      const z = f.center[2] + f.right[2] * side * offset;
      if (keepClear(x, z, radius)) continue;
      spots.push({ x, z, y: ctx.terrain.height(x, z), road });
      break;
    }
  }
  return spots;
}

/**
 * The surprises: statics into `ctx.mesh` (stopping before `limit` vertices),
 * and what the painter and the movers need.
 * @returns {{overlays: object[], movers: object[], models: object, placed: string[]}}
 */
export function buildWhimsy(ctx, limit) {
  const { mesh, fields, terrain, keepClear, random, seed, ordered } = ctx;
  const start = mesh.vertexCount;
  const fits = (vertices) => mesh.vertexCount - start + vertices <= limit;
  const overlays = [];
  const movers = [];
  const models = {};
  const placed = [];

  const parcel = pickBicycleParcel(fields, terrain, seed);
  if (parcel) {
    overlays.push(bicycleOverlay(fields, parcel));
    placed.push("bicycle");
  }

  const spots = coastSpots(fields, terrain, seed);
  const headland = spots.filter((s) => !keepClear(s.x, s.z, 8)).sort((a, b) => terrain.island.radiusAt(Math.atan2(b.z - terrain.island.center[1], b.x - terrain.island.center[0])) - terrain.island.radiusAt(Math.atan2(a.z - terrain.island.center[1], a.x - terrain.island.center[0])))[0];
  if (headland && fits(1200)) {
    const x = headland.x - headland.seaward[0] * 6;
    const z = headland.z - headland.seaward[1] * 6;
    const y = terrain.height(x, z);
    buildLighthouse(mesh, x, y, z);
    models.beam = [beamModel(), beamModel()];
    const radius = 0.02;
    movers.push({ kind: "beam", model: "beam", bright: true, path: { type: "circle", center: [x, z], radius, height: y }, speed: BEAM_RPS * Math.PI * 2 * radius, phase: 0, scale: 1, tint: null });
    placed.push("lighthouse");
  }

  const walk = spots.find((s) => !keepClear(s.x, s.z, 3));
  if (walk) {
    const tangent = [-walk.seaward[1], walk.seaward[0]];
    const points = [];
    for (let k = -3; k <= 3; k += 1) {
      const x = walk.x + tangent[0] * k * 10;
      const z = walk.z + tangent[1] * k * 10;
      if (["sand", "dunes", "wetSand"].includes(fields.landAt(x, z))) points.push([x, terrain.height(x, z), z]);
      else if (points.length) break;
    }
    if (points.length >= 3) {
      models.penguin = [buildPenguin(true), buildPenguin(false)];
      const lengths = [0];
      for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]));
      movers.push({ kind: "penguin", model: "penguin", path: { type: "ping", points, lengths, total: lengths.at(-1) }, speed: 0.55, phase: 7, flap: 3, scale: 1.1, tint: null });
      placed.push("penguin");
    }
  }

  const fieldsNear = nearParcels(ctx, 420);
  for (const wheat of fieldsNear.filter((p) => p.crop === "wheat" || p.crop === "ploughed")) {
    const [x, z] = parcelPoint(wheat, wheat.width * 0.3, 25);
    if (fields.parcelAt(x, z)?.id !== wheat.id || keepClear(x, z, 3)) continue;
    models.scarecrow = [scarecrowModel(true), scarecrowModel(false)];
    movers.push({ kind: "scarecrow", model: "scarecrow", path: { type: "ping", points: [[x, terrain.height(x, z), z]], lengths: [0], total: 0, yaw: wheat.angle }, speed: 0, phase: 0, flap: 1, scale: 1.1, tint: null });
    placed.push("scarecrow");
    break;
  }

  const [tower] = roadsideSpots(ctx, 1, 4);
  if (tower && fits(4000)) {
    const bale = buildHayBale();
    for (let level = 0; level < 3; level += 1) mesh.append(bale, placement([tower.x, tower.y - 0.05 + level * 1.42, tower.z], level * 1.1));
    mesh.append(buildSheep(), placement([tower.x, tower.y + 4.2, tower.z], 2.6));
    placed.push("sheepTower");
  }

  const total = ordered.reduce((sum, road) => sum + road.length, 0);
  const rotation = ["gnomes", "picnic", "cowInPond"];
  const ponds = [...(ctx.ponds ?? [])];
  const cow = buildCow(false);
  for (const [n, spot] of roadsideSpots(ctx, sceneCount(total), 5).entries()) {
    if (!fits(3000)) break;
    // A pond is rare enough that the first scene claims it.
    const kind = ponds.length > 0 && n === 0 ? "cowInPond" : rotation[(n + Math.floor(random() * 3)) % 3];
    if (kind === "cowInPond" && ponds.length > 0) {
      cowInPond(mesh, ponds.pop(), cow);
      placed.push("cowInPond");
    } else if (kind === "picnic" || kind === "cowInPond") {
      picnic(mesh, spot.x, spot.y, spot.z);
      placed.push("picnic");
    } else {
      gnomes(mesh, spot.x, spot.y, spot.z);
      placed.push("gnomes");
    }
  }
  return { overlays, movers, models, placed };
}
