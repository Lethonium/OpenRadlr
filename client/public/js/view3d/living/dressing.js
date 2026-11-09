/**
 * What the Living island's land is dressed with close to the roads: woods,
 * hedges, orchards, fences and farm props, as chunked geometry. Far away the
 * ground map carries it all. Each builder keeps out of what must stay clear
 * and stops at its vertex limit, returning the vertices it added.
 */
import { buildHayBale } from "../structures.js";
import { placement } from "../math.js";
import { roadFrame, roadHalfWidth } from "../world.js";
import { PAVEMENT } from "../features.js";

/** Metres from a road within which hedges, walls and the rest are real objects. */
const NEAR = Object.freeze({ hedges: 440, woods: 750, orchards: 300, fences: 250, props: 420, fine: 150 });
const HEDGE_SHARE = 0.33;
const ORCHARD_SHARE = 0.14;
const PLANTED = new Set(["ploughed", "wheat", "rapeseed", "lavender", "sunflower", "hay"]);

const sizeOf = (ctx, start) => ctx.mesh.vertexCount - start;

/** True in the open middle of a crop parcel: lone trees stay out, hedge lines and rough land keep theirs. */
export function treeBlocked(fields, x, z) {
  const parcel = fields.parcelAt(x, z);
  if (!parcel || !PLANTED.has(parcel.crop)) return false;
  return Math.min(parcel.u, parcel.v, parcel.width - parcel.u, parcel.depth - parcel.v) > 6;
}

const ground = (ctx, x, z) => ctx.terrain.height(x, z);

/** Dense clumps of cheap trees within reach of the roads, with detailed ones at their edges. */
export function buildWoods(ctx, limit) {
  const { fields, grid, mesh, random, box, biome } = ctx;
  const start = mesh.vertexCount;
  const candidates = [];
  const step = 13;
  for (let z = box.z0; z < box.z1; z += step) {
    for (let x = box.x0; x < box.x1; x += step) {
      const road = grid.roadAt(x, z);
      if (road > NEAR.woods) continue;
      const wood = fields.woodAt(x, z);
      if (wood > 0.05) candidates.push({ x, z, road, wood });
    }
  }
  candidates.sort((a, b) => a.road - b.road);
  const colors = biome.living.woodland;
  for (const { x: gx, z: gz, wood, road } of candidates) {
    if (sizeOf(ctx, start) + 120 > limit) break;
    const x = gx + (random() - 0.5) * 9;
    const z = gz + (random() - 0.5) * 9;
    if (ctx.keepClear(x, z, 3)) continue;
    const y = ground(ctx, x, z) - 0.3;
    const kind = random();
    if (wood < 0.7 && road < NEAR.fine) {
      biome.flora.tree({ mesh, x, y, z, kind: 0.3 + kind * 0.7, random });
      continue;
    }
    const height = 7 + random() * 7;
    const radius = height * (0.28 + random() * 0.1);
    mesh.cone([x, y, z], radius, height, colors[Math.floor(random() * colors.length)], 6, random() * Math.PI);
  }
  return sizeOf(ctx, start);
}

/** One edge piece lying along the ground: a hedge or a stone wall. */
function boxAlong(mesh, a, b, height, width, color, y) {
  const ux = b[0] - a[0];
  const uz = b[1] - a[1];
  const length = Math.hypot(ux, uz) || 1;
  const across = [(-uz / length) * width, 0, (ux / length) * width];
  mesh.orientedBox([(a[0] + b[0]) / 2, y + height / 2, (a[1] + b[1]) / 2], [ux, 0, uz], [0, height, 0], across, color);
}

/** Hedges on about a third of the field edges near roads, stone walls on rough land. */
export function buildHedges(ctx, limit) {
  const { fields, grid, mesh, random, biome } = ctx;
  const start = mesh.vertexCount;
  const { hedge, wall } = biome.living;
  for (const { a, b } of fields.edges()) {
    const pick = random();
    const color = random();
    if (pick >= HEDGE_SHARE) continue;
    const midX = (a[0] + b[0]) / 2;
    const midZ = (a[1] + b[1]) / 2;
    if (grid.roadAt(midX, midZ) > NEAR.hedges) continue;
    const land = fields.landAt(midX, midZ);
    const stone = land === "rough";
    if (land !== "farm" && !stone) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const near = grid.roadAt(midX, midZ) < NEAR.fine;
    const pieces = Math.max(1, Math.round(length / (near ? 8 : 20)));
    for (let k = 0; k < pieces; k += 1) {
      if (sizeOf(ctx, start) + 36 > limit) return sizeOf(ctx, start);
      const p = [a[0] + ((b[0] - a[0]) * k) / pieces, a[1] + ((b[1] - a[1]) * k) / pieces];
      const q = [a[0] + ((b[0] - a[0]) * (k + 1)) / pieces, a[1] + ((b[1] - a[1]) * (k + 1)) / pieces];
      const cx = (p[0] + q[0]) / 2;
      const cz = (p[1] + q[1]) / 2;
      if (grid.roadAt(cx, cz) > NEAR.hedges || ctx.keepClear(cx, cz, 2)) continue;
      const palette = stone ? wall : hedge;
      boxAlong(mesh, p, q, stone ? 1.0 : 1.7 + color * 0.8, stone ? 0.6 : 1.1, palette[Math.floor(color * palette.length)], ground(ctx, cx, cz) - 0.15);
    }
  }
  return sizeOf(ctx, start);
}

/** The parcels reachable from a road, each once, in a stable order. */
export function nearParcels(ctx, reach) {
  const { fields, grid, box } = ctx;
  const seen = new Map();
  for (let z = box.z0; z < box.z1; z += 45) {
    for (let x = box.x0; x < box.x1; x += 45) {
      if (grid.roadAt(x, z) > reach) continue;
      const parcel = fields.parcelAt(x, z);
      if (parcel && !seen.has(parcel.id)) seen.set(parcel.id, parcel);
    }
  }
  return [...seen.values()];
}

/** A point of `parcel`, `u` and `v` metres from its corner. */
export function parcelPoint(parcel, u, v) {
  const cos = Math.cos(parcel.angle);
  const sin = Math.sin(parcel.angle);
  const du = u - parcel.width / 2;
  const dv = v - parcel.depth / 2;
  return [parcel.center[0] + du * cos - dv * sin, parcel.center[1] + du * sin + dv * cos];
}

/** Tidy rows of small fruit trees on some parcels near the roads. */
export function buildOrchards(ctx, limit) {
  const { fields, mesh, random, biome } = ctx;
  const start = mesh.vertexCount;
  const { orchard, fruit, wood } = biome.living;
  for (const parcel of nearParcels(ctx, NEAR.orchards)) {
    if (random() >= ORCHARD_SHARE || (parcel.crop !== "meadow" && parcel.crop !== "pasture")) continue;
    for (let v = 8; v < parcel.depth - 8; v += 7) {
      for (let u = 8; u < parcel.width - 8; u += 7) {
        if (sizeOf(ctx, start) + 90 > limit) return sizeOf(ctx, start);
        const [x, z] = parcelPoint(parcel, u, v);
        if (fields.parcelAt(x, z)?.id !== parcel.id || ctx.keepClear(x, z, 2)) continue;
        const y = ground(ctx, x, z) - 0.2;
        const height = 1.6 + random() * 0.6;
        mesh.box([x, y + height / 2, z], [0.22, height, 0.22], wood);
        const size = 1.1 + random() * 0.5;
        mesh.ellipsoid([x, y + height + size * 0.5, z], [size, size * 0.8, size], orchard[Math.floor(random() * orchard.length)], 2, 6, random() * Math.PI);
        if (random() < 0.5) mesh.ellipsoid([x + size * 0.6, y + height + size * 0.2, z], [0.14, 0.14, 0.14], fruit, 2, 4);
      }
    }
  }
  return sizeOf(ctx, start);
}

/** Post-and-rail fences along pasture edges near the roads. */
export function buildFences(ctx, limit) {
  const { fields, grid, mesh, random, biome } = ctx;
  const start = mesh.vertexCount;
  const { woodLight } = biome.living;
  for (const { a, b } of fields.edges()) {
    const pick = random();
    const midX = (a[0] + b[0]) / 2;
    const midZ = (a[1] + b[1]) / 2;
    if (pick > 0.4 || grid.roadAt(midX, midZ) > NEAR.fences) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / length;
    const nz = (b[0] - a[0]) / length;
    const side = fields.parcelAt(midX + nx * 2, midZ + nz * 2);
    const other = fields.parcelAt(midX - nx * 2, midZ - nz * 2);
    if (side?.crop !== "pasture" && other?.crop !== "pasture") continue;
    const posts = Math.max(1, Math.round(length / 6));
    let previous = null;
    for (let k = 0; k <= posts; k += 1) {
      if (sizeOf(ctx, start) + 108 > limit) return sizeOf(ctx, start);
      const x = a[0] + ((b[0] - a[0]) * k) / posts;
      const z = a[1] + ((b[1] - a[1]) * k) / posts;
      if (ctx.keepClear(x, z, 1)) {
        previous = null;
        continue;
      }
      const y = ground(ctx, x, z) - 0.1;
      mesh.box([x, y + 0.6, z], [0.14, 1.2, 0.14], woodLight);
      if (previous) {
        for (const rail of [0.55, 1.0]) mesh.segment([previous[0], previous[1] + rail, previous[2]], [x, y + rail, z], 0.08, 0.05, woodLight);
      }
      previous = [x, y, z];
    }
  }
  return sizeOf(ctx, start);
}

/** Places `model` on the ground at (x, z). */
function place(mesh, model, x, y, z, yaw) {
  mesh.append(model, placement([x, y, z], yaw));
}

function buildScarecrow(mesh, x, y, z, biome) {
  const { wood, paint } = biome.living;
  mesh.box([x, y + 1.1, z], [0.12, 2.2, 0.12], wood);
  mesh.box([x, y + 1.7, z], [1.5, 0.1, 0.1], wood);
  mesh.box([x, y + 1.55, z], [0.5, 0.7, 0.3], paint[0]);
  mesh.ellipsoid([x, y + 2.2, z], [0.2, 0.22, 0.2], [0.82, 0.72, 0.5], 2, 6);
  mesh.cone([x, y + 2.35, z], 0.32, 0.4, wood, 6);
}

function buildBeehive(mesh, x, y, z, biome) {
  const { paint, woodLight } = biome.living;
  mesh.box([x, y + 0.35, z], [0.6, 0.7, 0.6], paint[2]);
  mesh.box([x, y + 0.78, z], [0.75, 0.12, 0.75], woodLight);
}

function buildShed(mesh, x, y, z, yaw, biome) {
  const { wood, woodLight } = biome.living;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  mesh.orientedBox([x, y + 1.2, z], [3.5 * cos, 0, 3.5 * sin], [0, 2.4, 0], [-3 * sin, 0, 3 * cos], wood);
  mesh.orientedBox([x, y + 2.5, z], [4.0 * cos, 0, 4.0 * sin], [0, 0.2, 0], [-3.4 * sin, 0, 3.4 * cos], woodLight);
}

export function buildParkedTractor(mesh, x, y, z, yaw, biome) {
  const { paint } = biome.living;
  const dark = [0.14, 0.14, 0.15];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const at = (u, v, h) => [x + u * cos - v * sin, y + h, z + u * sin + v * cos];
  mesh.orientedBox(at(0.3, 0, 1.2), [2.6 * cos, 0, 2.6 * sin], [0, 1, 0], [-1.3 * sin, 0, 1.3 * cos], paint[1]);
  mesh.orientedBox(at(-0.5, 0, 2.1), [1.2 * cos, 0, 1.2 * sin], [0, 1.2, 0], [-1.2 * sin, 0, 1.2 * cos], [0.8, 0.85, 0.9]);
  for (const [u, v, r] of [[-1, 1, 0.9], [-1, -1, 0.9], [1.2, 1, 0.5], [1.2, -1, 0.5]]) mesh.ellipsoid(at(u, v, r), [r, r, 0.3], dark, 2, 8, yaw);
}

function buildWashingLine(mesh, x, y, z, yaw, biome) {
  const { wood, paint } = biome.living;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const a = [x - 3 * cos, y, z - 3 * sin];
  const b = [x + 3 * cos, y, z + 3 * sin];
  mesh.box([a[0], y + 1, a[2]], [0.1, 2, 0.1], wood);
  mesh.box([b[0], y + 1, b[2]], [0.1, 2, 0.1], wood);
  mesh.segment([a[0], y + 1.9, a[2]], [b[0], y + 1.9, b[2]], 0.03, 0.03, wood);
  for (let k = 0; k < 4; k += 1) {
    const t = (k + 0.7) / 5;
    const cx = a[0] + (b[0] - a[0]) * t;
    const cz = a[2] + (b[2] - a[2]) * t;
    mesh.orientedBox([cx, y + 1.5, cz], [0.7 * cos, 0, 0.7 * sin], [0, 0.8, 0], [-0.03 * sin, 0, 0.03 * cos], paint[k % paint.length]);
  }
}

/** Hay bales, scarecrows, beehives, sheds and parked tractors on the parcels, washing lines by the gardens. */
export function buildProps(ctx, limit) {
  const { mesh, random, biome, occupancy } = ctx;
  const start = mesh.vertexCount;
  const bale = buildHayBale();
  const spot = (parcel, inset = 15) => {
    const [x, z] = parcelPoint(parcel, inset + random() * (parcel.width - 2 * inset), inset + random() * (parcel.depth - 2 * inset));
    if (ctx.fields.parcelAt(x, z)?.id !== parcel.id || ctx.keepClear(x, z, 4) || occupancy.blocked(x, z, 4)) return null;
    occupancy.add(x, z, 4);
    return [x, ground(ctx, x, z) - 0.05, z];
  };
  for (const parcel of nearParcels(ctx, NEAR.props)) {
    if (sizeOf(ctx, start) + 2000 > limit) break;
    const chance = random();
    switch (parcel.crop) {
      case "hay":
        for (let n = 0; n < 7 + Math.floor(random() * 8); n += 1) {
          const at = spot(parcel, 12);
          if (at) place(mesh, bale, at[0], at[1], at[2], random() * Math.PI);
        }
        break;
      case "wheat":
      case "ploughed":
        if (chance < 0.12) {
          const at = spot(parcel, 25);
          if (at) buildScarecrow(mesh, at[0], at[1], at[2], biome);
        } else if (chance < 0.22 && parcel.crop === "ploughed") {
          const at = spot(parcel, 25);
          if (at) buildParkedTractor(mesh, at[0], at[1], at[2], parcel.angle, biome);
        }
        break;
      case "meadow":
        if (chance < 0.18) {
          for (let n = 0; n < 4; n += 1) {
            const at = spot(parcel, 25);
            if (at) buildBeehive(mesh, at[0], at[1], at[2], biome);
          }
        }
        break;
      case "pasture":
        if (chance < 0.14) {
          const at = spot(parcel, 12);
          if (at) buildShed(mesh, at[0], at[1], at[2], parcel.angle, biome);
        }
        break;
      case "garden":
        if (chance < 0.25) {
          const at = spot(parcel, 8);
          if (at) (chance < 0.12 ? buildWashingLine : buildShed)(mesh, at[0], at[1], at[2], parcel.angle, biome);
        }
        break;
      default:
    }
  }
  return sizeOf(ctx, start) + buildVillageStreets(ctx, limit - sizeOf(ctx, start));
}

/** Bunting across village streets, market stalls and benches beside them. */
function buildVillageStreets(ctx, limit) {
  const { mesh, random, biome, ordered, zonesOf, terrain } = ctx;
  const start = mesh.vertexCount;
  const { paint, woodLight, wood } = biome.living;
  for (const road of ordered) {
    const half = roadHalfWidth(road.lanes) + PAVEMENT + 2;
    for (const village of zonesOf.get(road).villages) {
      for (let d = village.from + 30; d < village.to - 30; d += 45) {
        if (sizeOf(ctx, start) + 600 > limit) return sizeOf(ctx, start);
        const f = roadFrame(road, d);
        const reach = roadHalfWidth(road.lanes) + PAVEMENT + 0.5;
        const left = [f.center[0] - f.right[0] * reach, f.center[1] + 6, f.center[2] - f.right[2] * reach];
        const right = [f.center[0] + f.right[0] * reach, f.center[1] + 6, f.center[2] + f.right[2] * reach];
        mesh.segment(left, right, 0.04, 0.04, wood);
        for (let k = 0; k < 8; k += 1) {
          const t = (k + 0.5) / 8;
          const x = left[0] + (right[0] - left[0]) * t;
          const y = left[1] + (right[1] - left[1]) * t;
          const z = left[2] + (right[2] - left[2]) * t;
          const color = paint[k % paint.length];
          const sx = f.right[0] * 0.25;
          const sz = f.right[2] * 0.25;
          mesh.triangle([x - sx, y, z - sz], [x + sx, y, z + sz], [x, y - 0.5, z], color);
        }
        const side = random() < 0.5 ? -1 : 1;
        const x = f.center[0] + f.right[0] * side * (half + 1.5);
        const z = f.center[2] + f.right[2] * side * (half + 1.5);
        if (!ctx.keepClear(x, z, 2)) {
          const y = terrain.height(x, z);
          if (random() < 0.5) {
            mesh.box([x, y + 1.1, z], [2.4, 0.08, 1.6], paint[Math.floor(random() * paint.length)]);
            mesh.box([x, y + 0.55, z], [2, 1.1, 1.2], woodLight);
          } else {
            mesh.box([x, y + 0.42, z], [1.5, 0.08, 0.4], woodLight);
            mesh.box([x, y + 0.2, z], [0.15, 0.4, 0.3], wood);
          }
        }
      }
    }
  }
  return sizeOf(ctx, start);
}
