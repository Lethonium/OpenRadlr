/**
 * Builds the static 3D world for a route: road, verge, lane markings, posts,
 * the ground as grids (an island: fine over the land, coarse out to the
 * horizon; the main thread tiles them, see scene/terrainLayer.js), trees,
 * bushes, rocks, grass tufts and flowers, arches and far-off islands. The sea
 * and the sky are scene layers, not meshes of the world.
 * Everything is derived deterministically from the route files (geometry +
 * seeds), so every client sees the same world. Routes on one shared map
 * (ADR 0010) are drawn together: one terrain from the map seed, every road,
 * and the scenery of every route; markers and arches only for the ridden one.
 *
 * World axes: X = route x (east), Y = up, Z = −route y (north is −Z).
 */
import { buildBanners, letterArch } from "./banners.js";
import { ChunkedMesh } from "./chunks.js";
import {
  Occupancy,
  PAVEMENT,
  buildBridge,
  buildBikeCafe,
  buildOutdoorGym,
  studioSite,
  buildFarms,
  buildRiverWater,
  buildRoadside,
  buildSpectators,
  buildVillage,
  buildWindTurbines,
} from "./features.js";
import { COAST } from "../world/island.js";
import {
  JUNCTION_LIFT,
  LANE_WIDTH,
  ROAD_LIFT,
  VERGE,
  junctionBankAt,
  junctionClearings,
  mapSeed,
  networkTerrain,
  roadFrame,
  roadHalfWidth,
  terrainModel,
  waterLevel,
} from "../world/roads.js";
import { BRIDGE_HALF_LENGTH, RIVER, buildRiverPath, withRivers } from "../world/rivers.js";
import { MeshBuilder } from "./meshBuilder.js";
import { inStretch, resolveZones } from "./zones.js";
import { add, normalize, placement, scale } from "./math.js";
import { seededRandom, valueNoise } from "../world/noise.js";
import { resolveBiome, temperate } from "./biomes/index.js";
import { groundGrid } from "../world/groundGrid.js";
import { planWorld } from "../world/plan/index.js";
import { buildWeather } from "./weather.js";

/** Box (world x/z) around the island's coast, with some sea around it. */
function islandBox(island, sea = 60) {
  const box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (let a = 0; a < 360; a += 2) {
    const angle = (a * Math.PI) / 180;
    const r = island.radiusAt(angle) + COAST.rough + sea;
    const x = island.center[0] + Math.cos(angle) * r;
    const z = island.center[1] + Math.sin(angle) * r;
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x);
    box.z0 = Math.min(box.z0, z);
    box.z1 = Math.max(box.z1, z);
  }
  return box;
}

/** Above this many fine-grid nodes an island is "huge" (a 180 km route): its ground grid is coarser, with a horizon around all of it. */
export const HUGE_ISLAND_NODES = 1_500_000;

/**
 * Where the ground is drawn: the fine grid's box (around the island, or the
 * routes with a margin), the sea level, the horizon distance and the centre.
 * The ground itself is `buildGroundGrids`; the main thread tiles it.
 */
export function groundExtent(terrain, { margin = 450, cell = 16, horizon = 4200 } = {}) {
  const { minX, maxX, minY, maxY } = terrain.bounds;
  const water = waterLevel(terrain.index);
  const box = terrain.island ? islandBox(terrain.island) : { x0: minX - margin, z0: -maxY - margin, x1: maxX + margin, z1: -minY + margin };
  const bounds = { x0: Math.floor(box.x0 / cell) * cell, z0: Math.floor(box.z0 / cell) * cell, x1: 0, z1: 0 };
  const columns = Math.ceil((box.x1 - bounds.x0) / cell);
  const rows = Math.ceil((box.z1 - bounds.z0) / cell);
  bounds.x1 = bounds.x0 + columns * cell;
  bounds.z1 = bounds.z0 + rows * cell;
  const huge = columns * rows > HUGE_ISLAND_NODES;
  const center = terrain.island?.center ?? terrain.index.center;
  return { bounds, water, horizon: huge ? Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 + horizon : horizon, center, huge };
}

/**
 * The ground as grids for the worker's typed-array hand-over: a fine one over
 * `groundExtent`'s box, plus a coarse one out to the horizon.
 */
export function buildGroundGrids(terrain, ground, { season, long, regions, masks }) {
  const [cx, cz] = ground.center;
  const options = { water: ground.water, season, seed: terrain.seed, regions, masks };
  const farCell = long ? 400 : 140;
  const reach = Math.ceil(ground.horizon / farCell) * farCell;
  return {
    near: groundGrid(terrain, { ...options, bounds: ground.bounds, cell: ground.huge ? 144 : 16 }),
    far: groundGrid(terrain, { ...options, bounds: { x0: cx - reach, z0: cz - reach, x1: cx + reach, z1: cz + reach }, cell: farCell }),
  };
}

/** A round asphalt pad where roads of a network meet (`node` in route coordinates). */
export function buildJunctionPad(node, into, { lanes = 4, sides = 20, biome = temperate } = {}) {
  const radius = roadHalfWidth(lanes) + 0.3;
  const center = [node.x, node.elevation + JUNCTION_LIFT, -node.y];
  const at = (k) => {
    const a = (k / sides) * 2 * Math.PI;
    return [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius];
  };
  for (let k = 0; k < sides; k += 1) into.triangleFacing(center, at(k), at(k + 1), biome.road.surface, [0, 1, 0]);
}

/** Wraps a target so builders can share the "own a mesh or write into one" pattern. */
const target = (into) => ({ mesh: into ?? new MeshBuilder(), own: !into });

const roadPostModels = new Map();

/**
 * The biome's own roadside marker, if it has one (winter turns the posts into
 * snowmen). Built once per variant: every post reuses the same mesh.
 */
function roadsideModel(biome, km) {
  const build = biome.models?.post;
  if (!build) return null;
  const key = `${biome.id}:${km ? 1 : 0}`;
  let model = roadPostModels.get(key);
  if (!model) {
    model = build(km);
    roadPostModels.set(key, model);
  }
  return model;
}

/**
 * Asphalt, verges, markings and posts along a route. Other roads of the map
 * pass a lower `lift` (so the ridden road wins where they overlap at
 * junctions) and `skip` the stretches already drawn; `clear` keeps posts off
 * other roads. `bankAt` (0..1) flattens the season's ploughed bank near
 * junctions, where raised shoulders would cut across the other roads.
 */
export function buildRoad(route, { step = 4, markingStep = 3, into = null, lift = ROAD_LIFT.ridden, skip = () => false, clear = () => false, detail = true, bankAt = null, biome = temperate } = {}) {
  const halfWidth = roadHalfWidth(route.lanes);
  const { mesh, own } = target(into);
  const random = seededRandom((route.seed >>> 0) ^ 0xa5f);
  const edgeAt = (frame, offset, extra = 0) => add(add(frame.center, scale(frame.right, offset)), [0, lift + extra, 0]);

  const laneEdge = (route.lanes * LANE_WIDTH) / 2;
  // Optional season detail on top of the same road: ploughed banks at the
  // verge, worn ruts along the lanes, snow on the posts. Long routes keep the
  // banks (they read from far away) and drop the close-up detail.
  const bank = biome.road.bank;
  const rut = detail ? biome.road.rut : null;
  const postCap = detail ? biome.road.postCap : null;
  // A ploughed bank fades from a flat verge (0) to full height (1), so the
  // snow can open up where roads meet instead of cutting across them.
  const shoulder = (k) => (bank ? -0.2 + (bank.height + 0.2) * k : -0.2);
  const ploughed = (frame) => (bankAt ? bankAt(frame.center[0], frame.center[2]) : 1);
  const steps = Math.ceil(route.length / step);
  for (let i = 0; i < steps; i += 1) {
    // Slight per-segment variation reads as patched asphalt.
    const v = 0.97 + random() * 0.06;
    if (skip(i * step) && skip(Math.min(route.length, (i + 1) * step))) continue;
    const f0 = roadFrame(route, i * step);
    const f1 = roadFrame(route, Math.min(route.length, (i + 1) * step));
    const asphalt = biome.road.surface.map((c) => c * v);
    mesh.quad(edgeAt(f0, -halfWidth), edgeAt(f0, halfWidth), edgeAt(f1, halfWidth), edgeAt(f1, -halfWidth), asphalt);
    // Gravel verge on both sides, sloping down into the grass. In winter it
    // is a raised snow shoulder closing into a small ploughed bank.
    const bank0 = bank ? ploughed(f0) : 0;
    const bank1 = bank ? ploughed(f1) : 0;
    const drop0 = shoulder(bank0);
    const drop1 = shoulder(bank1);
    for (const side of [-1, 1]) {
      const inner = side * halfWidth;
      const outer = side * (halfWidth + VERGE);
      const pts = side < 0 ? [edgeAt(f0, outer, drop0), edgeAt(f0, inner, -0.03), edgeAt(f1, inner, -0.03), edgeAt(f1, outer, drop1)] : [edgeAt(f0, inner, -0.03), edgeAt(f0, outer, drop0), edgeAt(f1, outer, drop1), edgeAt(f1, inner, -0.03)];
      mesh.quad(...pts, biome.road.verge);
      if (bank && (bank0 > 0 || bank1 > 0)) {
        // Close the shoulder down to the ground so the bank has a face.
        const top0 = edgeAt(f0, outer, drop0);
        const top1 = edgeAt(f1, outer, drop1);
        const down1 = edgeAt(f1, outer, -0.5);
        const down0 = edgeAt(f0, outer, -0.5);
        const facing = scale(f0.right, side);
        mesh.triangleFacing(top0, top1, down1, bank.color, facing);
        mesh.triangleFacing(top0, down1, down0, bank.color, facing);
      }
    }
    // Two darker ruts per lane, worn through the snow.
    if (rut) {
      for (let lane = 0; lane < route.lanes; lane += 1) {
        const offset = -laneEdge + (lane + 0.5) * LANE_WIDTH;
        const at = (f, o) => edgeAt(f, o, 0.005);
        mesh.quad(at(f0, offset - rut.width / 2), at(f0, offset + rut.width / 2), at(f1, offset + rut.width / 2), at(f1, offset - rut.width / 2), rut.color);
      }
    }
  }

  // Edge lines (solid) and lane dividers (dashed, 3 m on / 3 m off).
  const stripe = (offset, width, dashed, color) => {
    for (let d = 0; d < route.length; d += markingStep) {
      if (dashed && Math.floor(d / markingStep) % 2 === 1) continue;
      if (skip(d) && skip(Math.min(route.length, d + markingStep))) continue;
      const f0 = roadFrame(route, d);
      const f1 = roadFrame(route, Math.min(route.length, d + markingStep));
      // Lines stop at a junction instead of running across the other road.
      if (bankAt && (!ploughed(f0) || !ploughed(f1))) continue;
      const at = (f, o) => edgeAt(f, o, ROAD_LIFT.marking);
      mesh.quad(at(f0, offset - width / 2), at(f0, offset + width / 2), at(f1, offset + width / 2), at(f1, offset - width / 2), color);
    }
  };
  stripe(-laneEdge, 0.12, false, biome.road.edge);
  stripe(laneEdge, 0.12, false, biome.road.edge);
  for (let lane = 1; lane < route.lanes; lane += 1) stripe(-laneEdge + lane * LANE_WIDTH, 0.1, true, biome.road.marking);

  // Roadside posts every 50 m, alternating sides; every kilometre a pair with red tops.
  for (let d = 25; d < route.length; d += 50) {
    if (skip(d)) continue;
    const frame = roadFrame(route, d);
    const km = Math.abs((d % 1000) - 0) < 26 || Math.abs((d % 1000) - 1000) < 26;
    const sides = km ? [-1, 1] : [Math.floor(d / 50) % 2 === 0 ? -1 : 1];
    for (const side of sides) {
      const foot = add(frame.center, scale(frame.right, side * (halfWidth + VERGE + 0.3)));
      if (clear(foot[0], foot[2])) continue;
      const marker = detail ? roadsideModel(biome, km) : null;
      if (marker) {
        mesh.append(marker, placement(foot, 0));
        continue;
      }
      mesh.box(add(foot, [0, 0.5, 0]), [0.12, 1.0, 0.12], biome.road.postWhite);
      mesh.box(add(foot, [0, 1.05, 0]), [0.13, 0.12, 0.13], km ? biome.road.postRed : biome.road.postDark);
      if (postCap) mesh.box(add(foot, [0, 1.14, 0]), [0.16, 0.06, 0.16], postCap.color);
    }
  }
  return own ? mesh.build() : mesh;
}

/** Arches at the start/finish line and at climb and sprint segments, with their names; banners counting down climbs and at halfway. */
export function buildArches(route, { biome = temperate } = {}) {
  const colors = biome.arch;
  const mesh = new MeshBuilder();
  const halfWidth = roadHalfWidth(route.lanes) + 0.6;
  const arch = (distance, color, height = 5.2) => {
    const frame = roadFrame(route, distance);
    const along = scale(normalize([frame.forward[0], 0, frame.forward[2]]), -0.4);
    for (const side of [-1, 1]) {
      const foot = add(frame.center, scale(frame.right, side * halfWidth));
      mesh.orientedBox(add(foot, [0, height / 2, 0]), scale(frame.right, 0.4), [0, height, 0], along, colors.post);
    }
    const left = add(frame.center, scale(frame.right, -halfWidth));
    const right = add(frame.center, scale(frame.right, halfWidth));
    const beamCenter = add(scale(add(left, right), 0.5), [0, height, 0]);
    mesh.orientedBox(beamCenter, scale(frame.right, 2 * halfWidth + 0.4), [0, 1.0, 0], along, color);
    // Chequered strip on the start/finish line.
    if (color === colors.start) {
      const squares = 12;
      for (let i = 0; i < squares; i += 1) {
        const t0 = -halfWidth + 0.6 + (i / squares) * (2 * halfWidth - 1.2);
        const t1 = t0 + (2 * halfWidth - 1.2) / squares;
        const shade = colors.chequer[i % 2];
        const p = (t, o) => add(add(add(frame.center, scale(frame.right, t)), scale(normalize([frame.forward[0], 0, frame.forward[2]]), o)), [0, 0.06, 0]);
        mesh.quad(p(t0, -0.4), p(t1, -0.4), p(t1, 0.4), p(t0, 0.4), shade);
      }
    }
  };
  for (const marker of route.markers) {
    const height = marker.type === "start_finish" ? 5.6 : 5.2;
    if (marker.type === "start_finish") arch(marker.distance, colors.start, height);
    else if (marker.type === "climb") arch(marker.distance, colors.climb, height);
    else if (marker.type === "sprint") arch(marker.distance, colors.sprint, height);
    else continue;
    letterArch(mesh, route, marker, { height, halfWidth, depth: 0.4 });
  }
  buildBanners(mesh, route, { biome });
  return mesh.build();
}

/**
 * Trees (firs and leafy), bushes and rocks scattered deterministically:
 * denser near the road, clustered into small woods, never on the road and
 * never in the sea. Shadows come from the renderer's shadow map.
 */
export function buildScenery(
  route,
  terrain,
  bounds,
  { count = 1100, water = -Infinity, into = null, blocked = () => false, forests = [], biome = temperate } = {},
) {
  const random = seededRandom((route.seed >>> 0) ^ 0x5eed);
  const seed = route.seed >>> 0;
  const halfWidth = roadHalfWidth(route.lanes) + VERGE;
  const { mesh, own } = target(into);
  const positions = [];
  let attempts = 0;
  while (positions.length < count && attempts < count * 8) {
    attempts += 1;
    let x;
    let z;
    let inForest = false;
    const mode = random();
    if (forests.length > 0 && mode < 0.25) {
      // Forest stretches: trees close to the road, ignoring the woods noise.
      const stretch = forests[Math.floor(random() * forests.length)];
      const frame = roadFrame(route, stretch.from + random() * (stretch.to - stretch.from));
      const side = random() < 0.5 ? -1 : 1;
      [x, , z] = add(frame.center, scale(frame.right, side * (halfWidth + 5 + Math.pow(random(), 1.3) * 70)));
      inForest = true;
    } else if (mode < 0.65) {
      const frame = roadFrame(route, random() * route.length);
      const side = random() < 0.5 ? -1 : 1;
      const offset = halfWidth + 4 + Math.pow(random(), 1.7) * 170;
      [x, , z] = add(frame.center, scale(frame.right, side * offset));
    } else {
      x = bounds.x0 + random() * (bounds.x1 - bounds.x0);
      z = bounds.z0 + random() * (bounds.z1 - bounds.z0);
    }
    // Woods: keep most trees where a slow noise says "forest".
    const forest = valueNoise(x / 160, z / 160, seed + 99);
    if (!inForest && forest < 0.42 && random() < 0.75) continue;
    if (terrain.distanceToRoad(x, z) < halfWidth + 3 || blocked(x, z)) continue;
    const ground = terrain.height(x, z);
    if (ground < water + 2.5) continue; // no trees in the sea or on the beach
    const y = ground - 0.3;
    positions.push([x, y, z]);

    const kind = inForest ? 0.28 + random() * 0.72 : random();
    biome.flora.tree({ mesh, x, y, z, kind, random });
  }
  return { mesh: own ? mesh.build() : mesh, count: positions.length, positions };
}

/**
 * Grass tufts and wildflowers next to the road, where the camera sees them
 * up close. Three thin blades per tuft; flowers are a stem with a small head.
 */
export function buildGroundDetail(
  route,
  terrain,
  { tufts = 7000, flowers = 900, reach = 28, water = -Infinity, into = null, blocked = () => false, biome = temperate } = {},
) {
  const random = seededRandom((route.seed >>> 0) ^ 0x6a55);
  const halfWidth = roadHalfWidth(route.lanes) + VERGE;
  const { mesh, own } = target(into);
  let placed = 0;
  const spot = () => {
    const frame = roadFrame(route, random() * route.length);
    const side = random() < 0.5 ? -1 : 1;
    const offset = halfWidth + 0.4 + Math.pow(random(), 1.5) * reach;
    const [x, , z] = add(frame.center, scale(frame.right, side * offset));
    // On tight bends a spot beside one segment can land on the next one.
    if (terrain.distanceToRoad(x, z) < halfWidth + 0.2 || blocked(x, z)) return null;
    const y = terrain.height(x, z);
    return y < water + 2.5 ? null : [x, y, z];
  };
  for (let i = 0; i < tufts; i += 1) {
    const p = spot();
    if (!p) continue;
    placed += 1;
    biome.flora.tuft({ mesh, x: p[0], y: p[1], z: p[2], random });
  }
  for (let i = 0; i < flowers; i += 1) {
    const p = spot();
    if (!p) continue;
    placed += 1;
    biome.flora.flower({ mesh, x: p[0], y: p[1], z: p[2], random });
  }
  return { mesh: own ? mesh.build() : mesh, count: placed };
}

/**
 * Far-off islands on the horizon, out at sea around the map's island: a few
 * hazy rocky hills, some in small groups.
 */
export function buildFarIslands(route, terrain, { count = 11, distance = 1300, biome = temperate } = {}) {
  const random = seededRandom((terrain.seed ?? route.seed >>> 0) ^ 0x3a7);
  const mesh = new MeshBuilder();
  const island = terrain.island;
  const [cx, cz] = island?.center ?? terrain.index.center;
  const sea = terrain.seaLevel ?? waterLevel(terrain.index);
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + random() * 0.6) / count) * Math.PI * 2;
    const coast = island ? island.radiusAt(angle) : 1500;
    const far = coast + distance + random() * 2400;
    const hills = 1 + Math.floor(random() * 3);
    for (let h = 0; h < hills; h += 1) {
      const height = (h === 0 ? 120 : 50) + random() * (h === 0 ? 260 : 110);
      const radius = height * (1.6 + random() * 0.8);
      const a = angle + (random() - 0.5) * 0.08;
      const d = far + radius + random() * 300;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const color = random() < 0.5 ? biome.farIsland : biome.farIslandDark;
      // A rounded hump, mostly under water, with a rocky top on the taller ones.
      const depth = height * 0.4;
      mesh.ellipsoid([x, sea - depth, z], [radius, height + depth, radius * (0.55 + random() * 0.4)], color, 5, 9, random() * Math.PI);
      if (height > 220) mesh.cone([x, sea + height * 0.55, z], radius * 0.28, height * 0.62, biome.rock, 6, random() * Math.PI);
    }
  }
  return mesh.build();
}

/**
 * What a camera flying over the map needs to know, as plain data: the
 * island's centre and size, the sea level, and a coarse height grid so it
 * never flies into a hill.
 */
export function worldOverview(terrain, sea, cell = 100) {
  const island = terrain.island;
  const center = island?.center ?? terrain.index.center;
  let radius = 1500;
  if (island) for (let a = 0; a < 360; a += 5) radius = Math.max(radius, island.radiusAt((a * Math.PI) / 180));
  const x0 = Math.floor((center[0] - radius - cell) / cell) * cell;
  const z0 = Math.floor((center[1] - radius - cell) / cell) * cell;
  const columns = Math.ceil((2 * radius + 2 * cell) / cell) + 1;
  const heights = new Float32Array(columns * columns);
  for (let r = 0; r < columns; r += 1) {
    for (let c = 0; c < columns; c += 1) heights[r * columns + c] = Math.max(sea, terrain.height(x0 + c * cell, z0 + r * cell));
  }
  return { center, radius, sea, grid: { x0, z0, cell, columns, rows: columns, heights } };
}

/**
 * Stretches of `route` (by distance) that run on points already drawn for
 * one of `drawn`, in either direction: map routes and network roads share
 * stretches point for point (ADR 0010).
 */
export function sharedStretches(route, drawn) {
  const key = (n) => `${n.x.toFixed(2)},${n.y.toFixed(2)}`;
  const taken = new Set();
  for (const other of drawn) {
    for (let i = 0; i + 1 < other.nodes.length; i += 1) {
      // Either way round: a route may ride a road of the network backwards.
      taken.add(`${key(other.nodes[i])}>${key(other.nodes[i + 1])}`);
      taken.add(`${key(other.nodes[i + 1])}>${key(other.nodes[i])}`);
    }
  }
  const stretches = [];
  for (let i = 0; i + 1 < route.nodes.length; i += 1) {
    if (!taken.has(`${key(route.nodes[i])}>${key(route.nodes[i + 1])}`)) continue;
    const from = route.cumulative[i];
    const to = route.cumulative[i + 1];
    const last = stretches[stretches.length - 1];
    if (last && Math.abs(last.to - from) < 1e-6) last.to = to;
    else stretches.push({ from, to });
  }
  return stretches;
}

const onStretches = (stretches, d) => stretches.some((s) => d >= s.from - 1e-6 && d <= s.to + 1e-6);

/**
 * A route this long (a 180 km course) can't have the valley's density all
 * along it: the world would have millions of triangles. Scenery, ground
 * detail, roads and far terrain get this much thinner instead.
 */
export const LONG_ROUTE_M = 60_000;
const LONG = Object.freeze({ trees: 0.12, ground: 0.1, roadStep: 8, markingStep: 6, railGrade: 6, railStep: 8 });

/**
 * Builds the whole world for a route and the `others` on its map, or, given
 * the map's road `network` (#26), for the route on that network.
 *
 * Shared things (terrain, rivers, villages, farms, trees) are built for all
 * routes in a fixed order, so the world looks the same whichever route you
 * ride; markers, arches, spectators and signs belong to the ridden route.
 * With a network they are built per road instead, so a road several routes
 * share is decorated once, and every café of the map gets its café.
 *
 * Returns chunked groups (drawn and shadowed only near the camera/rider),
 * always-drawn meshes (horizon, far islands, arches), blended meshes (sea,
 * rivers) and dynamic objects the view animates (turbine rotors, spectators).
 */
export function buildWorld(route, { others = [], network = null, biome = temperate, season = "summer", detail = "high" } = {}) {
  biome = resolveBiome(typeof biome === "string" ? biome : biome.id);
  const density = biome.flora.density;
  const roads = network ? network.roads() : null;
  // Every route of the map keeps its asphalt clear, whichever is ridden, so the world looks the same from all of them.
  const mapRoutes = [route, ...others.filter((o) => o.id !== route.id)];
  // Tracks (#107): routes of the map that aren't walks over its roads, drawn and levelled like them.
  const tracks = network ? mapRoutes.filter((r) => !network.routes.some((w) => w.id === r.id)) : [];
  // Everything drawn as a road (the ridden route first), and what the shared
  // things are built along.
  const routes = network ? [route, ...roads, ...tracks.filter((t) => t !== route)] : mapRoutes;
  const ordered = network ? roads : [...routes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seed = network ? network.seed : mapSeed(route);
  const zonesOf = new Map(routes.map((r) => [r, resolveZones(r)]));
  const base = network ? networkTerrain(network, [...roads, ...tracks], { keepClear: mapRoutes }) : terrainModel(ordered, { seed });
  const sea = waterLevel(base.index);
  const rivers = ordered.flatMap((r) => zonesOf.get(r).rivers.map((z) => ({ ...buildRiverPath(r, base, z.at, r.seed >>> 0, sea), route: r })));
  const terrain = rivers.length > 0 ? withRivers(base, rivers, sea - RIVER.mouthDepth) : { ...base, riverDistance: () => Infinity };
  const half = roadHalfWidth(route.lanes) + VERGE;

  const chunks = {
    road: new ChunkedMesh(),
    detail: new ChunkedMesh(),
    scenery: new ChunkedMesh(),
    structures: new ChunkedMesh(),
    bright: new ChunkedMesh(),
  };

  const long = route.length > LONG_ROUTE_M;
  const ground = groundExtent(terrain);

  // Where woods, fields and verges go (and which ground is farmed): the plan, then the ground that tints and ploughs by it.
  const regions = network?.regions ?? [];
  const plan = planWorld({ terrain, roads: terrain.index, rivers, regions, seed, season, detail, bounds: ground.bounds });
  const grids = buildGroundGrids(terrain, ground, { season, long, regions, masks: plan.masks });

  // Nodes where a network's roads meet, for the junction pads.
  const degree = new Map();
  if (network) for (const road of roads) for (const id of [road.edge.from, road.edge.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  // Ploughed banks flatten out near a fork or corner, so no road's snow
  // shoulder runs across another road's asphalt.
  const junctionPoints = junctionClearings(network);
  const bankAt = (x, z) => junctionBankAt(junctionPoints, x, z);

  // The ridden road on top; the others skip what is already drawn and sit
  // lower where they overlap it at junctions, markings included.
  const shared = new Map();
  // On a network the ridden route runs on roads of the index: those aren't "other" roads to it.
  const ridden = new Set(network ? roads.filter((road) => sharedStretches(road, [route]).length > 0) : []);
  for (const [i, r] of routes.entries()) {
    const stretches = sharedStretches(r, routes.slice(0, i));
    shared.set(r, stretches);
    const other = (s) => s.route !== r && !(i === 0 && ridden.has(s.route));
    const otherRoad = (x, z) => base.index.nearest(x, z, 1, other)?.distance < roadHalfWidth(r.lanes) + VERGE;
    buildRoad(r, { into: chunks.road, biome, ...(long ? { step: LONG.roadStep, markingStep: LONG.markingStep, detail: false } : {}), lift: i === 0 ? ROAD_LIFT.ridden : ROAD_LIFT.other, skip: (d) => onStretches(stretches, d), clear: otherRoad, ...(junctionPoints.length ? { bankAt } : {}) });
  }

  // Where roads of a network meet at an angle, an asphalt pad closes the
  // gap between their square ends (under every road, so markings stay on top).
  if (network) {
    for (const node of network.nodes.values()) {
      if ((degree.get(node.id) ?? 0) >= 2) buildJunctionPad(node, chunks.road, { biome });
    }
  }

  // Places other features must keep clear of.
  const occupancy = new Occupancy();
  const nearRiver = (x, z, margin = 0) => terrain.riverDistance(x, z) < RIVER.halfWidth + RIVER.bank * 0.6 + margin;
  const nearRoad = (x, z, radius) => terrain.distanceToRoad(x, z) < half + radius * 0.8;
  const avoid = (x, z, radius = 0) => nearRiver(x, z, radius) || terrain.height(x, z) < ground.water + 2.5 || nearRoad(x, z, radius);
  const onBridge = (r, d) => rivers.some((river) => river.route === r && Math.abs(r.wrap(d - river.at + r.length / 2) - r.length / 2) < BRIDGE_HALF_LENGTH + 6);

  for (const river of rivers) buildBridge(river.route, terrain, river, chunks.structures, biome);
  for (const r of ordered) {
    for (const village of zonesOf.get(r).villages) {
      buildVillage(r, terrain, village, { structures: chunks.structures, bright: chunks.bright, occupancy, seed: r.seed >>> 0, avoid, biome });
    }
  }
  // The bike café where rides start, before anything else claims the spot
  // (one for all routes that start at the same place). A network has its
  // cafés as places: each gets one, beside the ridden route where it starts.
  const cafeRoads = network
    ? network.cafes().flatMap((cafe) => {
        const start = route.positionAt(0);
        if (Math.hypot(start.x - cafe.x, start.y - cafe.y) < 30) return [{ road: route, cafeId: cafe.id }];
        const road = network.roadFrom(cafe.id);
        return road ? [{ road, cafeId: cafe.id }] : [];
      })
    : ordered.map((road) => ({ road, cafeId: null }));
  const cafes = [];
  const cafeSpots = [];
  const gyms = [];
  let studio = null;
  for (const { road: r, cafeId } of cafeRoads) {
    const start = r.positionAt(0);
    if (cafes.some((c) => Math.hypot(c.x - start.x, c.y - start.y) < 30)) continue;
    cafes.push(start);
    const cafe = buildBikeCafe(r, terrain, { structures: chunks.structures, bright: chunks.bright, occupancy, avoid, biome });
    if (!cafe) continue;
    cafeSpots.push(cafe.position);
    // The outdoor gym next to it, where workout riders train (#77).
    const gym = buildOutdoorGym(r, terrain, { structures: chunks.structures, bright: chunks.bright, occupancy, avoid, biome, cafeId });
    if (gym) gyms.push(gym);
    // The spin studio across the road from the Valley Café only.
    if (cafeId === "valley-cafe") studio = studioSite(r, terrain, { occupancy, avoid });
  }
  // Route files: seven farms each. Network roads: about one per kilometre.
  const farmsOn = (r) => (network ? Math.max(1, Math.round(r.length / 1000)) : undefined);
  for (const r of ordered) buildFarms(r, terrain, { structures: chunks.structures, occupancy, seed: r.seed >>> 0, count: farmsOn(r), lakeLevel: ground.water, avoid, biome });
  const rotors = buildWindTurbines(route, terrain, {
    structures: chunks.structures,
    occupancy,
    seed,
    bounds: ground.bounds,
    lakeLevel: ground.water,
    avoid,
    biome,
  });
  const spectators = buildSpectators(route, terrain, { structures: chunks.structures, seed: route.seed >>> 0, biome, blocked: (x, z) => nearRiver(x, z) || occupancy.blocked(x, z, 1) });
  // The crowd's two poses are biome models like every other shape; the view
  // only alternates them (and adds the hop) while drawing.
  const spectatorMeshes = [biome.people.model(false), biome.people.model(true)];
  for (const r of ordered) {
    const { villages, cliffs } = zonesOf.get(r);
    buildRoadside(r, terrain, {
      cliffs,
      structures: chunks.structures,
      bright: chunks.bright,
      markers: r === route,
      twoWay: Boolean(network),
      biome,
      ...(long ? { railGrade: LONG.railGrade, railStep: LONG.railStep } : {}),
      skip: (d) => (!network && onStretches(shared.get(r), d)) || onBridge(r, d) || inStretch(r, villages, d, 10),
    });
  }
  // On a network the roads have the rails; the ridden route adds its signs.
  if (network) buildRoadside(route, terrain, { structures: chunks.structures, bright: chunks.bright, rails: false, biome });

  // Villages keep their streets clear of trees; nothing grows in rivers or buildings.
  const inVillage = (x, z) => {
    const near = terrain.index.nearest(x, z);
    return near !== null && near.distance < 70 && inStretch(near.sample.route, zonesOf.get(near.sample.route).villages, near.sample.distance, 20);
  };
  const blocked = (x, z) => nearRiver(x, z, -RIVER.bank * 0.4) || occupancy.blocked(x, z, 2) || inVillage(x, z);
  const detailBlocked = (x, z) => nearRiver(x, z, -RIVER.bank * 0.7) || occupancy.blocked(x, z) || (inVillage(x, z) && terrain.distanceToRoad(x, z) < half + PAVEMENT + 1);
  for (const r of ordered) {
    const km = r.length / 1000;
    const margin = 450;
    const { minX, maxX, minY, maxY } = r.bounds;
    const bounds = { x0: minX - margin, z0: -maxY - margin, x1: maxX + margin, z1: -minY + margin };
    buildScenery(r, terrain, bounds, { biome, water: ground.water, into: chunks.scenery, blocked, forests: zonesOf.get(r).forests, count: Math.round(density.trees * km * (long ? LONG.trees : 1)) });
    // Grass and flowers only show close up: thinner along the roads you don't ride.
    const detail = (network && !ridden.has(r) ? density.elsewhere : 1) * (long ? LONG.ground : 1);
    buildGroundDetail(r, terrain, {
      biome,
      water: ground.water,
      into: chunks.detail,
      tufts: Math.round(density.tufts * km * detail),
      flowers: Math.round(density.flowers * km * detail),
      blocked: detailBlocked,
    });
  }

  const rivers3d = new MeshBuilder();
  for (const river of rivers) buildRiverWater(river, rivers3d, biome.river ?? undefined);

  return {
    // The view needs the biome to resolve its sky and lighting at render time.
    biome: biome.id,
    season,
    terrain,
    zones: zonesOf.get(route),
    cafes: cafeSpots,
    gyms,
    studio,
    waterLevel: ground.water,
    ground: grids,
    plan,
    overview: worldOverview(terrain, ground.water),
    chunks: Object.fromEntries(Object.entries(chunks).map(([name, mesh]) => [name, mesh.build()])),
    meshes: {
      arches: buildArches(route, { biome }),
      islands: buildFarIslands(route, terrain, { biome }),
    },
    weather: buildWeather(terrain, { biome }),
    rivers: rivers3d.build(),
    rotors,
    spectators,
    spectatorMeshes,
  };
}
