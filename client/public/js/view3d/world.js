/**
 * Builds the static 3D world for a route: road, verge, lane markings, post and bridge placements,
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
import { ARCH_HEIGHT, BANNERS, archSpots, bannerPlacements } from "./banners.js";
import { boardClearings, boardSites, placeBoards } from "./boards.js";
import {
  Occupancy,
  buildBikeCafe,
  buildOutdoorGym,
  cafeClearing,
  gymClearing,
  studioClearing,
  studioSite,
  roadsideFurniture,
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
import { inStretch, resolveZones } from "../world/zones.js";
import { normalize, yawFor } from "./math.js";
import { resolveBiome, temperate } from "./biomes/index.js";
import { groundGrid } from "../world/groundGrid.js";
import { paintLandUse } from "../world/landPaint.js";
import { planClouds } from "../world/clouds.js";
import { planWorld } from "../world/plan/index.js";
import { junctionPads, roadStrips } from "../world/plan/roadStrips.js";
import { riverStrips } from "../world/plan/riverStrips.js";
import { streetStrips } from "../world/plan/streetStrips.js";
import { mergeStrips } from "../world/plan/strips.js";
import { buildBridges } from "./bridges.js";
import { buildRoadPosts } from "./roadPosts.js";
import { roadStyle } from "./roadStyle.js";

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
export function buildGroundGrids(terrain, ground, { season, long, regions, landUse }) {
  const [cx, cz] = ground.center;
  const options = { water: ground.water, season, seed: terrain.seed, regions };
  const farCell = long ? 400 : 140;
  const reach = Math.ceil(ground.horizon / farCell) * farCell;
  return {
    near: groundGrid(terrain, { ...options, bounds: ground.bounds, cell: ground.huge ? 144 : 16 }),
    far: groundGrid(terrain, { ...options, bounds: { x0: cx - reach, z0: cz - reach, x1: cx + reach, z1: cz + reach }, cell: farCell }),
    ...(landUse ? { paint: paintLandUse(landUse.parcels, { bounds: ground.bounds, season }) } : {}),
  };
}

/**
 * Where the arches and banners stand, as plain data for the main thread (scene/archLayer.js): arches at the
 * start/finish line and at climb and sprint segments, banners counting down climbs and at halfway. `position` is the
 * road's centre at the spot, `yaw` the level road direction, `height` the beam's centre (arch) or the cloth's top (banner).
 */
export function archPlacements(route) {
  const halfWidth = roadHalfWidth(route.lanes) + 0.6;
  const at = (spot, banner) => {
    const frame = roadFrame(route, spot.distance);
    return { kind: spot.kind, text: spot.text, position: frame.center, yaw: yawFor(normalize([frame.forward[0], 0, frame.forward[2]])), halfWidth, height: banner ? BANNERS.bottom + BANNERS.height : ARCH_HEIGHT, banner };
  };
  return [...archSpots(route).map((spot) => at(spot, false)), ...bannerPlacements(route).map((spot) => at(spot, true))];
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

/** The ridden road's drawn asphalt, as `roadSurfaceAt` takes it: the strip step this route is built with, and its lift. */
export function riddenSurface(route) {
  return { step: route.length > LONG_ROUTE_M ? LONG.roadStep : 4, lift: ROAD_LIFT.ridden };
}
const DEFAULT_RIVER = Object.freeze([0.22, 0.45, 0.6]);
/** The look of each café of the valley map; any other café is a valley café. */
const CAFE_STYLE = Object.freeze({ "valley-cafe": "valley", "forge-hut": "hut", "hill-cafe": "hilltop", "beach-cafe": "beach" });
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
 * Returns placement data for the new world (arches, furniture, crowd, cafés and gyms), the road and river strips
 * and the ground grids.
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

  const long = route.length > LONG_ROUTE_M;
  const ground = groundExtent(terrain);

  // Where woods, fields and verges go (and which ground is farmed): the plan, then the ground that tints and ploughs by it.
  const regions = network?.regions ?? [];
  // Where the cafés (and so the outdoor gyms) stand: the plan keeps plants and the towns' houses off them.
  const cafeRoads = network
    ? network.cafes().flatMap((cafe) => {
        const start = route.positionAt(0);
        if (Math.hypot(start.x - cafe.x, start.y - cafe.y) < 30) return [{ road: route, cafeId: cafe.id }];
        const road = network.roadFrom(cafe.id);
        return road ? [{ road, cafeId: cafe.id }] : [];
      })
    : ordered.map((road) => ({ road, cafeId: null }));
  // The roadside boards' sites on the ridden route; their ground is kept clear like the cafés'.
  const boardSitesOnRoute = boardSites(route, { villages: zonesOf.get(route).villages });
  const plan = planWorld({ terrain, roads: terrain.index, rivers, regions, forests: forestPoints(routes, zonesOf), settlements: network?.settlements ?? [], landmarks: network?.landmarks ?? [], clearings: [...cafeRoads.flatMap(({ road, cafeId }) => [cafeClearing(road), gymClearing(road), ...(cafeId === "valley-cafe" ? [studioClearing(road)] : [])]), ...boardClearings(route, boardSitesOnRoute)], routes, seed, season, detail, bounds: ground.bounds });
  const grids = buildGroundGrids(terrain, ground, { season, long, regions, landUse: plan.landUse });

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
  const posts = [];
  // Where a road crosses a river on a bridge: no posts or rails there (the parapets stand in their place).
  const onBridge = (r, d) => rivers.some((river) => river.route === r && Math.abs(r.wrap(d - river.at + r.length / 2) - r.length / 2) < BRIDGE_HALF_LENGTH + 6);
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
    buildRoadPosts(r, { biome, detail: !long, skip: (d) => skip(d) || onBridge(r, d), clear: otherRoad, into: posts });
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

  // The bike café where rides start, before anything else claims the spot
  // (one for all routes that start at the same place); each cafe road gets one.
  const cafes = [];
  const cafeSpots = [];
  const cafeSites = [];
  const cafeNames = new Map((network?.cafes() ?? []).map((node) => [node.id, node.name]));
  const gyms = [];
  let studio = null;
  for (const { road: r, cafeId } of cafeRoads) {
    const start = r.positionAt(0);
    if (cafes.some((c) => Math.hypot(c.x - start.x, c.y - start.y) < 30)) continue;
    cafes.push(start);
    const cafe = buildBikeCafe(r, terrain, { occupancy, avoid });
    if (!cafe) continue;
    cafeSpots.push(cafe.position);
    cafeSites.push({ id: cafeId, name: cafeNames.get(cafeId) ?? "Bike café" /* i18n-ok */, style: CAFE_STYLE[cafeId] ?? "valley", position: cafe.position, yaw: cafe.yaw, forecourt: cafe.forecourt });
    // The outdoor gym next to it, where workout riders train (#77).
    const gym = buildOutdoorGym(r, terrain, { occupancy, avoid, cafeId });
    if (gym) gyms.push(gym);
    // The spin studio across the road from the Valley Café only.
    if (cafeId === "valley-cafe") studio = studioSite(r, terrain, { occupancy, avoid });
  }
  const boards = placeBoards(route, terrain, boardSitesOnRoute, { occupancy, avoid });
  const { people, barriers } = buildSpectators(route, terrain, { seed: route.seed >>> 0, biome, blocked: (x, z) => nearRiver(x, z) || occupancy.blocked(x, z, 1) });
  // Rails, signs and the crowd's barriers are placement data for the furniture layer; the people are the crowd layer's.
  const furniture = { rails: [], signs: [], flammeRouge: null, barriers };
  const collect = (found) => {
    for (const rail of found.rails) furniture.rails.push(rail);
    for (const sign of found.signs) furniture.signs.push(sign);
    furniture.flammeRouge ??= found.flammeRouge;
  };
  for (const r of ordered) {
    const { villages, cliffs } = zonesOf.get(r);
    collect(roadsideFurniture(r, terrain, {
      cliffs,
      villages,
      markers: r === route,
      twoWay: Boolean(network),
      ...(long ? { railGrade: LONG.railGrade, railStep: LONG.railStep } : {}),
      skip: (d) => (!network && onStretches(shared.get(r), d)) || onBridge(r, d) || inStretch(r, villages, d, 10),
    }));
  }
  // On a network the roads have the rails; the ridden route adds its signs.
  if (network) collect(roadsideFurniture(route, terrain, { rails: false }));

  // The river's colour is a bare colour or an object with colour, opacity and (frozen) ice patches.
  const river = Array.isArray(biome.river) ? { color: biome.river } : (biome.river ?? {});
  const riverStyle = { color: [...(river.color ?? DEFAULT_RIVER)], alpha: river.alpha ?? 0.85, ice: river.ice ?? null };

  return {
    // The view needs the biome to resolve its sky and lighting at render time.
    biome: biome.id,
    season,
    // The level the plan's populations (trees, roadside, animals) were budgeted for.
    detail,
    terrain,
    zones: zonesOf.get(route),
    cafes: cafeSpots,
    cafeSites,
    gyms,
    studio,
    boards,
    waterLevel: ground.water,
    ground: grids,
    plan,
    clouds: planClouds({ seed, center: terrain.index.center, meanElevation: terrain.index.meanElevation, style: biome.sky?.clouds ?? temperate.sky.clouds }),
    overview: worldOverview(terrain, ground.water),
    arches: archPlacements(route),
    furniture,
    roads: { strips: mergeStrips(strips), style: roadStyle(biome), posts },
    rivers: { strips: riverStrips(rivers, riverStyle), bridges: buildBridges(rivers, terrain, biome), style: riverStyle },
    crowd: { people, figure: biome.people.motion === "clap" ? "penguin" : "person" },
  };
}
