/**
 * Builds the static 3D world for a route: road, verge, lane markings, posts,
 * the ground as grids (an island: fine over the land, coarse out to the
 * horizon; the main thread tiles them, see scene/terrainLayer.js) and arches (the plants, towns, farms,
 * landmarks and far islands are the scene's layers). The sea
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
  buildBikeCafe,
  buildOutdoorGym,
  studioSite,
  buildRoadside,
  buildSpectators,
} from "./features.js";
import { COAST } from "../world/island.js";
import {
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
import { inStretch, resolveZones } from "../world/zones.js";
import { add, normalize, scale } from "./math.js";
import { resolveBiome, temperate } from "./biomes/index.js";
import { groundGrid } from "../world/groundGrid.js";
import { planWorld } from "../world/plan/index.js";
import { junctionPads, roadStrips } from "../world/plan/roadStrips.js";
import { riverStrips } from "../world/plan/riverStrips.js";
import { streetStrips } from "../world/plan/streetStrips.js";
import { mergeStrips } from "../world/plan/strips.js";
import { buildBridges } from "./bridges.js";
import { buildRoadPosts } from "./roadPosts.js";
import { roadStyle } from "./roadStyle.js";
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
 * Points along every route's forest stretches, one per 40 m of road, for the plan to wood densely.
 * @param {object[]} routes
 * @param {Map<object, {forests: {from: number, to: number}[]}>} zonesOf
 * @returns {{x: number, z: number}[]}
 */
export function forestPoints(routes, zonesOf) {
  const points = [];
  for (const route of routes) {
    for (const { from, to } of zonesOf.get(route)?.forests ?? []) {
      for (let d = from; d <= to; d += 40) {
        const [x, , z] = roadFrame(route, d).center;
        points.push({ x, z });
      }
    }
  }
  return points;
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
const DEFAULT_RIVER = Object.freeze([0.22, 0.45, 0.6]);
const LONG = Object.freeze({ trees: 0.12, ground: 0.1, roadStep: 8, markingStep: 6, railGrade: 6, railStep: 8 });

/**
 * Builds the whole world for a route and the `others` on its map, or, given
 * the map's road `network` (#26), for the route on that network.
 *
 * Shared things (terrain, rivers, the plan) are built for all
 * routes in a fixed order, so the world looks the same whichever route you
 * ride; markers, arches, spectators and signs belong to the ridden route.
 * With a network they are built per road instead, so a road several routes
 * share is decorated once, and every café of the map gets its café.
 *
 * Returns chunked groups (drawn and shadowed only near the camera/rider),
 * always-drawn meshes (arches), blended meshes (sea,
 * rivers) and dynamic objects the view animates (spectators).
 */
export function buildWorld(route, { others = [], network = null, biome = temperate, season = "summer", detail = "high" } = {}) {
  biome = resolveBiome(typeof biome === "string" ? biome : biome.id);
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
    structures: new ChunkedMesh(),
    bright: new ChunkedMesh(),
  };

  const long = route.length > LONG_ROUTE_M;
  const ground = groundExtent(terrain);

  // Where woods, fields and verges go (and which ground is farmed): the plan, then the ground that tints and ploughs by it.
  const regions = network?.regions ?? [];
  const plan = planWorld({ terrain, roads: terrain.index, rivers, regions, forests: forestPoints(routes, zonesOf), settlements: network?.settlements ?? [], landmarks: network?.landmarks ?? [], routes, seed, season, detail, bounds: ground.bounds });
  const grids = buildGroundGrids(terrain, ground, { season, long, regions, masks: plan.masks });

  // Ploughed banks flatten out near a fork or corner, so no road's snow
  // shoulder runs across another road's asphalt.
  const junctionPoints = junctionClearings(network);
  const bankAt = (x, z) => junctionBankAt(junctionPoints, x, z);

  // The ridden road on top; the others skip what is already drawn and sit
  // lower where they overlap it at junctions, markings included.
  const shared = new Map();
  // On a network the ridden route runs on roads of the index: those aren't "other" roads to it.
  const ridden = new Set(network ? roads.filter((road) => sharedStretches(road, [route]).length > 0) : []);
  const strips = [];
  const posts = new MeshBuilder();
  for (const [i, r] of routes.entries()) {
    const stretches = sharedStretches(r, routes.slice(0, i));
    shared.set(r, stretches);
    const other = (s) => s.route !== r && !(i === 0 && ridden.has(s.route));
    const otherRoad = (x, z) => base.index.nearest(x, z, 1, other)?.distance < roadHalfWidth(r.lanes) + VERGE;
    const skip = (d) => onStretches(stretches, d);
    strips.push(
      roadStrips(r, {
        ...(long ? { step: LONG.roadStep, markingStep: LONG.markingStep } : {}),
        bank: biome.road.bank ?? null,
        rut: long ? null : (biome.road.rut ?? null),
        lift: i === 0 ? ROAD_LIFT.ridden : ROAD_LIFT.other,
        skip,
        ...(junctionPoints.length ? { bankAt } : {}),
      }),
    );
    buildRoadPosts(r, { biome, detail: !long, skip, clear: otherRoad, into: posts });
  }

  // Where roads of a network meet at an angle, an asphalt pad closes the
  // gap between their square ends (under every road, so markings stay on top).
  if (network) strips.unshift(junctionPads(network));
  // The towns' streets, squares and pavements and the farms' drives ride with the road.
  strips.push(streetStrips(plan.settlements, terrain, { farms: plan.farms }));

  // Places other features must keep clear of.
  const occupancy = new Occupancy();
  const nearRiver = (x, z, margin = 0) => terrain.riverDistance(x, z) < RIVER.halfWidth + RIVER.bank * 0.6 + margin;
  const nearRoad = (x, z, radius) => terrain.distanceToRoad(x, z) < half + radius * 0.8;
  const avoid = (x, z, radius = 0) => nearRiver(x, z, radius) || terrain.height(x, z) < ground.water + 2.5 || nearRoad(x, z, radius);
  const onBridge = (r, d) => rivers.some((river) => river.route === r && Math.abs(r.wrap(d - river.at + r.length / 2) - r.length / 2) < BRIDGE_HALF_LENGTH + 6);

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
  const spectators = buildSpectators(route, terrain, { structures: chunks.structures, seed: route.seed >>> 0, biome, blocked: (x, z) => nearRiver(x, z) || occupancy.blocked(x, z, 1) });
  // The crowd's two poses are biome models like every other shape; the view
  // only alternates them (and adds the hop) while drawing.
  const spectatorMeshes = [biome.people.model(false), biome.people.model(true)];
  for (const r of ordered) {
    const { villages, cliffs } = zonesOf.get(r);
    buildRoadside(r, terrain, {
      cliffs,
      villages,
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

  // The river's colour is a bare colour or an object with colour, opacity and (frozen) ice patches.
  const river = Array.isArray(biome.river) ? { color: biome.river } : (biome.river ?? {});
  const riverStyle = { color: [...(river.color ?? DEFAULT_RIVER)], alpha: river.alpha ?? 0.85, ice: river.ice ?? null };

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
    },
    weather: buildWeather(terrain, { biome }),
    roads: { strips: mergeStrips(strips), style: roadStyle(biome), posts: posts.build() },
    rivers: { strips: riverStrips(rivers, riverStyle), bridges: buildBridges(rivers, terrain, biome), style: riverStyle },
    spectators,
    spectatorMeshes,
  };
}
