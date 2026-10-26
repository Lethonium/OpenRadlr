import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { ChunkedMesh, chunkNear, chunkVisible } from "../public/js/view3d/chunks.js";
import { BRIDGE_HALF_LENGTH, Occupancy, RIVER, buildRiverPath, buildRoadside } from "../public/js/view3d/features.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { placement } from "../public/js/view3d/math.js";
import { buildChurch, buildHouse, buildRotor, buildSpectator, PALETTE } from "../public/js/view3d/structures.js";
import { inStretch, resolveZones } from "../public/js/view3d/zones.js";
import { buildTerrain, buildWorld, mapSeed, roadFrame, roadHalfWidth, sharedStretches, terrainModel, VERGE } from "../public/js/view3d/world.js";
import { squareRoute } from "./helpers.js";

const flatsFile = () => JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url)));
const riversideFlats = () => new RouteGeometry(flatsFile());

// Built once: the full world is the expensive part of this suite. A route on
// its own (no network): the way route files outside a map are drawn.
const route = riversideFlats();
const world = buildWorld(route);

// --- zones --------------------------------------------------------------------

test("zones from the route file are used as given", () => {
  const zones = resolveZones(route);
  const file = flatsFile().zones;
  assert.deepEqual(zones.rivers, file.filter((z) => z.type === "river").map((z) => ({ at: z.at })));
  assert.deepEqual(zones.villages, file.filter((z) => z.type === "village").map((z) => ({ from: z.from, to: z.to })));
  assert.equal(zones.forests.length, file.filter((z) => z.type === "forest").length);
  assert.ok(zones.rivers.length > 0 && zones.villages.length > 0);
});

test("a network road has exactly its zones: none means none", () => {
  const road = new RouteGeometry({ id: "r", name: "r", lanes: 4, seed: 1, loop: false, points: [[0, 0, 10], [3000, 0, 10]], zones: [] });
  assert.ok(resolveZones(road).villages.length > 0, "a plain route without zones gets defaults");
  road.explicitZones = true;
  assert.deepEqual(resolveZones(road), { villages: [], rivers: [], forests: [], cliffs: [] });
});

test("cliff zones resolve to ranges and plain roads have none", () => {
  const r = squareRoute();
  r.zones = [{ type: "cliff", from: 100, to: 400 }, { type: "cliff", from: 10, to: 20 }];
  assert.deepEqual(resolveZones(r).cliffs, [{ from: 100, to: 400 }], "short ones are ignored");
  assert.deepEqual(resolveZones(route).cliffs, []);
});

test("invalid and unknown zones are ignored", () => {
  const r = squareRoute();
  r.zones = [{ type: "volcano", at: 3 }, { type: "village", from: 10, to: 20 }, { type: "river", at: -5 }, { type: "forest", from: 100, to: 400 }];
  const zones = resolveZones(r);
  assert.equal(zones.villages.length, 0, "too short");
  assert.equal(zones.rivers.length, 0, "outside the route");
  assert.deepEqual(zones.forests, [{ from: 100, to: 400 }]);
});

test("default zones are deterministic and keep clear of the start and climbs", () => {
  const r = new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/col-de-la-forge.json", import.meta.url))));
  r.zones = [];
  const a = resolveZones(r);
  const b = resolveZones(r);
  assert.deepEqual(a, b);
  assert.equal(a.villages.length, 1);
  assert.equal(a.rivers.length, 1);
  const climb = r.markers.find((m) => m.type === "climb");
  for (const v of a.villages) {
    assert.ok(v.to < climb.distance - 50 || v.from > climb.distance + climb.length + 50, "village is not on the climb");
    assert.ok(v.from > 150, "village is not at the start");
  }
});

test("stretches wrap around the start line", () => {
  const r = squareRoute();
  assert.ok(inStretch(r, [{ from: 950, to: 1000 }], 2, 5));
  assert.ok(!inStretch(r, [{ from: 100, to: 200 }], 300));
});

// --- chunks -------------------------------------------------------------------

test("chunked meshes split by tile and keep every triangle", () => {
  const chunked = new ChunkedMesh(100);
  const plain = new MeshBuilder();
  for (const target of [chunked, plain]) {
    target.box([10, 0, 10], [2, 2, 2], [1, 0, 0]);
    target.box([250, 0, 10], [2, 2, 2], [0, 1, 0]);
    target.append(buildRotor(5), placement([450, 0, 40], 0.3));
  }
  const chunks = chunked.build();
  assert.equal(chunks.length, 3);
  assert.equal(chunks.reduce((sum, c) => sum + c.mesh.vertexCount, 0), plain.build().vertexCount);
  for (const c of chunks) assert.equal(c.mesh.colors.length, c.mesh.vertexCount * 4);
});

test("chunk visibility: distance, behind the camera, inside the chunk", () => {
  const chunk = { center: [100, 0, 0], radius: 20 };
  assert.ok(chunkVisible(chunk, [0, 0, 0], [1, 0, 0], 500));
  assert.ok(!chunkVisible(chunk, [0, 0, 0], [1, 0, 0], 50), "too far");
  assert.ok(!chunkVisible(chunk, [0, 0, 0], [-1, 0, 0], 500), "behind");
  assert.ok(chunkVisible(chunk, [100, 0, 5], [-1, 0, 0], 500), "camera inside");
  assert.ok(chunkNear(chunk, [150, 0, 0], 40));
  assert.ok(!chunkNear(chunk, [300, 0, 0], 40));
});

test("occupancy blocks overlapping circles only", () => {
  const occupancy = new Occupancy(50);
  occupancy.add(100, 100, 10);
  assert.ok(occupancy.blocked(105, 100));
  assert.ok(occupancy.blocked(115, 100, 6));
  assert.ok(!occupancy.blocked(130, 100, 5));
});

// --- structures ---------------------------------------------------------------

test("houses, churches and spectators produce sensible models", () => {
  const house = buildHouse({ w: 8, d: 7, floors: 2, wall: PALETTE.walls[0], roof: PALETTE.roofs[0], chimney: true });
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 1; i < house.positions.length; i += 3) {
    top = Math.max(top, house.positions[i]);
    bottom = Math.min(bottom, house.positions[i]);
  }
  assert.ok(top > 7 && top < 12, `roof height ${top}`);
  close(bottom, -1.5, 1e-6);
  const church = buildChurch();
  let spire = -Infinity;
  for (let i = 1; i < church.positions.length; i += 3) spire = Math.max(spire, church.positions[i]);
  assert.ok(spire > 22, "the church tower is the village landmark");
  const up = buildSpectator(true);
  const down = buildSpectator(false);
  assert.equal(up.vertexCount, down.vertexCount);
});

function close(a, b, eps) {
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
}

// --- the assembled world -----------------------------------------------------

test("the river crosses the road only at the bridge, below it and above the lake", () => {
  const terrain = world.terrain;
  const crossings = resolveZones(route).rivers.map((z) => z.at);
  const at = crossings[0];
  for (let d = 0; d < route.length; d += 10) {
    const { center } = roadFrame(route, d);
    const offset = Math.min(...crossings.map((c) => Math.abs(route.wrap(d - c + route.length / 2) - route.length / 2)));
    const river = terrain.riverDistance(center[0], center[2]);
    if (offset > BRIDGE_HALF_LENGTH + 10) {
      assert.ok(river > RIVER.halfWidth + 8, `river too close to the road at ${d} m (${river})`);
      assert.ok(center[1] - terrain.height(center[0], center[2]) < 1.5, `road floats at ${d} m`);
    }
  }
  const bridge = roadFrame(route, at).center;
  const valley = terrain.height(bridge[0], bridge[2]);
  assert.ok(bridge[1] - valley > 6, "the bridge spans a real valley");
  assert.ok(valley > world.waterLevel, "the river bed is above the sea");
  assert.ok(world.rivers.vertexCount > 100);
});

test("the world has a village, farms, turbines and spectators off the road", () => {
  const halfRoad = roadHalfWidth(route.lanes);
  assert.ok(world.chunks.structures.length > 5);
  assert.ok(world.chunks.bright.length > 0, "lamp heads and sign faces");
  assert.ok(world.rotors.length >= 3, "a row of turbines");
  for (const rotor of world.rotors) assert.ok(world.terrain.index.farDistance(rotor.hub[0], rotor.hub[2]) > 170);
  assert.ok(world.spectators.length >= 32);
  for (const person of world.spectators) {
    const d = world.terrain.distanceToRoad(person.position[0], person.position[2]);
    assert.ok(d > halfRoad + VERGE, "spectators stand behind the verge");
    assert.equal(person.shirt.length, 3);
  }
});

test("the world is deterministic", () => {
  const again = buildWorld(riversideFlats());
  assert.deepEqual(again.rotors.map((r) => r.hub), world.rotors.map((r) => r.hub));
  assert.deepEqual(again.spectators.map((p) => p.position), world.spectators.map((p) => p.position));
  assert.equal(again.chunks.structures.length, world.chunks.structures.length);
});

// --- bike café ------------------------------------------------------------------

import { CAFE_DISTANCE, buildBikeCafe } from "../public/js/view3d/features.js";
import { buildCafe } from "../public/js/view3d/structures.js";

test("the café model has a terrace, bikes and a glowing sign", () => {
  const cafe = buildCafe();
  assert.ok(cafe.mesh.vertexCount > 1000);
  assert.ok(cafe.bright.vertexCount > 0, "window glow and sign go into the bright mesh");
});

test("the café stands beside the road just after the start line and keeps trees away", () => {
  const structures = new MeshBuilder();
  const bright = new MeshBuilder();
  const occupancy = new Occupancy();
  const cafe = buildBikeCafe(route, null, { structures, bright, occupancy });
  assert.ok(cafe);
  assert.equal(cafe.distance, CAFE_DISTANCE);
  const frame = roadFrame(route, CAFE_DISTANCE);
  const offset = [cafe.position[0] - frame.center[0], cafe.position[2] - frame.center[2]];
  const lateral = offset[0] * frame.right[0] + offset[1] * frame.right[2];
  assert.ok(lateral > roadHalfWidth(route.lanes) + 8, `café is ${lateral.toFixed(1)} m to the right`);
  assert.ok(occupancy.blocked(cafe.position[0], cafe.position[2]));
  assert.equal(buildBikeCafe(route, null, { structures, bright, occupancy, avoid: () => true }), null, "never in a river or lake");
});

// --- outdoor gym (#77) -----------------------------------------------------------

import { GYM_DISTANCE, buildOutdoorGym } from "../public/js/view3d/features.js";
import { gymOfRoute } from "../public/js/workout/gymSpots.js";

const lateralOf = (frame, p) => (p[0] - frame.center[0]) * frame.right[0] + (p[2] - frame.center[2]) * frame.right[2];

test("the outdoor gym stands beside the café, off the road, with eight spots facing it", () => {
  const structures = new MeshBuilder();
  const bright = new MeshBuilder();
  const occupancy = new Occupancy();
  buildBikeCafe(route, null, { structures, bright, occupancy });
  const before = structures.vertexCount;
  const gym = buildOutdoorGym(route, null, { structures, bright, occupancy });
  assert.ok(gym, "room next to the café");
  assert.ok(structures.vertexCount - before > 500, "mat, bars, bench, beam and sign");
  const frame = roadFrame(route, GYM_DISTANCE);
  assert.ok(lateralOf(frame, gym.center) > roadHalfWidth(route.lanes) + 8, "on the café side, set back");
  assert.equal(gym.spots.length, 8);
  for (const spot of gym.spots) {
    assert.ok(lateralOf(frame, spot.position) > roadHalfWidth(route.lanes) + 6, "nobody stands on the road");
    // Facing the road: the model's forward (-z turned by yaw) points to the left of the road's right.
    const forward = [-Math.sin(spot.yaw), -Math.cos(spot.yaw)];
    assert.ok(forward[0] * frame.right[0] + forward[1] * frame.right[2] < -0.9);
  }
  const gaps = gym.spots.slice(1, 4).map((s, i) => Math.hypot(s.position[0] - gym.spots[i].position[0], s.position[2] - gym.spots[i].position[2]));
  for (const gap of gaps) assert.ok(Math.abs(gap - 1.8) < 1e-6, "1.8 m apart");
  assert.ok(occupancy.blocked(gym.center[0], gym.center[2]), "trees keep away");
  assert.equal(buildOutdoorGym(route, null, { structures, bright, occupancy }), null, "not twice in one place");
  assert.equal(buildOutdoorGym(route, null, { structures, bright, occupancy: new Occupancy(), avoid: () => true }), null, "never in a river or on a road");
});

// --- one map for all routes: the road network (ADR 0010, #26) ---------------------

import { RoadNetwork } from "../public/js/route/network.js";
import { JUNCTION_LIFT } from "../public/js/view3d/world.js";

const ROUTE_IDS = ["riverside-flats", "rolling-hills", "col-de-la-forge", "balcony-road", "forge-circuit", "island-tour", "cape-loop"];
const loadRoute = (id) => new RouteGeometry(JSON.parse(readFileSync(new URL(`../../routes/${id}.json`, import.meta.url))));
const valley = ROUTE_IDS.map(loadRoute);
const networkFile = () => JSON.parse(readFileSync(new URL("../../routes/maps/valley.json", import.meta.url)));
const network = new RoadNetwork(networkFile());
const roads = network.roads();
const degree = (id) => roads.filter((r) => r.edge.from === id || r.edge.to === id).length;

test("the network has cafés, junctions and roads between them", () => {
  assert.ok(network.cafes().length >= 3, "at least three cafés");
  const junctions = [...network.nodes.values()].filter((n) => degree(n.id) >= 3);
  assert.ok(junctions.length >= 6, `about six crossings (${junctions.length})`);
  for (const node of network.nodes.values()) assert.ok(degree(node.id) >= 2, `${node.id} is on the way somewhere`);
  // Every place can be reached from every other.
  const seen = new Set([network.cafes()[0].id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of roads) {
      const [a, b] = [r.edge.from, r.edge.to];
      if (seen.has(a) !== seen.has(b)) {
        seen.add(a);
        seen.add(b);
        grew = true;
      }
    }
  }
  assert.equal(seen.size, network.nodes.size);
});

test("roads end exactly on their places, at the places' height", () => {
  for (const road of roads) {
    for (const [end, id] of [[road.nodes[0], road.edge.from], [road.nodes[road.nodes.length - 1], road.edge.to]]) {
      const node = network.nodes.get(id);
      assert.deepEqual([end.x, end.y], [node.x, node.y], `${road.edge.id} ends at ${id}`);
      assert.ok(Math.abs(end.elevation - node.elevation) < 0.05, `${road.edge.id} meets ${id} at its height`);
    }
    for (let d = 0; d + 10 <= road.length; d += 10) {
      const grade = Math.abs(road.elevationAt(d + 10) - road.elevationAt(d)) / 10;
      assert.ok(grade < 0.11, `${road.edge.id} is ${(grade * 100).toFixed(0)} % steep at ${d} m`);
    }
  }
});

test("roads stay apart away from the places they share", () => {
  for (let i = 0; i < roads.length; i += 1) {
    for (let j = i + 1; j < roads.length; j += 1) {
      const [a, b] = [roads[i], roads[j]];
      const shared = [a.edge.from, a.edge.to].filter((id) => id === b.edge.from || id === b.edge.to).map((id) => network.nodes.get(id));
      const nearShared = (p) => shared.some((n) => Math.hypot(p.x - n.x, p.y - n.y) < 260);
      for (let d = 0; d < a.length; d += 20) {
        const p = a.positionAt(d);
        if (nearShared(p)) continue;
        for (let e = 0; e < b.length; e += 20) {
          const q = b.positionAt(e);
          if (nearShared(q)) continue;
          assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 100, `${a.edge.id} and ${b.edge.id} run close at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
        }
      }
    }
  }
});

test("the bundled routes are walks over the network, starting at a café", () => {
  for (const r of valley) {
    assert.deepEqual(r.map, { id: "valley", seed: 2026 }, r.id);
    const start = r.positionAt(0);
    assert.ok(network.cafes().some((c) => Math.hypot(c.x - start.x, c.y - start.y) < 1e-6), `${r.id} starts at a café`);
    // Straight over the start line: no corner where the ride starts and ends.
    const out = roadFrame(r, 5).forward;
    const back = roadFrame(r, r.length - 5).forward;
    assert.ok(out[0] * back[0] + out[2] * back[2] > 0.97, `${r.id} runs straight over its start line`);
    // Point for point on the roads, apart from the rounded turns at places.
    const covered = sharedStretches(r, roads).reduce((sum, s) => sum + s.to - s.from, 0);
    assert.ok(covered > r.length * 0.95, `${r.id}: ${((100 * covered) / r.length).toFixed(1)} % on the network's roads`);
    const walk = network.routes.find((w) => w.id === r.id).walk;
    const walked = walk.reduce((sum, [id]) => sum + network.edges.get(id).length, 0);
    assert.ok(Math.abs(walked - r.length) < 120, `${r.id} is as long as its walk (${walked} / ${r.length.toFixed(0)} m)`);
  }
});

test("routes turn on curves where they change roads, never on a corner", () => {
  for (const r of valley) {
    for (let d = 0; d < r.length; d += 2) {
      const a = roadFrame(r, d).forward;
      const b = roadFrame(r, d + 4).forward;
      const turn = Math.acos(Math.min(1, (a[0] * b[0] + a[2] * b[2]) / Math.hypot(a[0], a[2]) / Math.hypot(b[0], b[2])));
      assert.ok(turn < 0.6, `${r.id} turns ${((turn * 180) / Math.PI).toFixed(0)}° within 4 m at ${d} m`);
    }
  }
});

// Built once per ridden route: the full map is the most expensive part of the suite.
const [flatsRoute, hillsRoute, colRoute] = valley;
const mapWorld = buildWorld(hillsRoute, { network });
const near = (p, places, radius) => places.some((n) => Math.hypot(p.x - n.x, p.y - n.y) < radius);
const places = [...network.nodes.values()];

test("on a slope the gym's pad and its roadside sign stand on the ground", () => {
  const terrain = { height: (x, z) => 100 + 0.12 * x - 0.08 * z };
  const structures = new MeshBuilder();
  const bright = new MeshBuilder();
  const gym = buildOutdoorGym(route, terrain, { structures, bright, occupancy: new Occupancy() });
  for (const spot of gym.spots) assert.ok(spot.position[1] >= terrain.height(spot.position[0], spot.position[2]), "the mat is never buried");
  // The sign's face is all that goes into the bright mesh.
  const face = bright.build().positions;
  let low = Infinity;
  let x = 0;
  let z = 0;
  for (let i = 0; i < face.length; i += 3) {
    low = Math.min(low, face[i + 1]);
    x += face[i] / (face.length / 3);
    z += face[i + 2] / (face.length / 3);
  }
  const above = low - terrain.height(x, z);
  assert.ok(above > 1.3 && above < 1.8, `the board is ${above.toFixed(2)} m above the ground at the sign`);
});

test("every café gets an outdoor gym", () => {
  assert.ok(mapWorld.gyms.length >= 1);
  assert.equal(mapWorld.gyms.length, mapWorld.cafes.length);
  for (const gym of mapWorld.gyms) assert.equal(gym.spots.length, 8);
  assert.ok(gymOfRoute(mapWorld.gyms, hillsRoute), "the ridden route's start has one");
  assert.deepEqual(sceneOf(mapWorld).gyms, mapWorld.gyms, "the gyms cross the worker boundary with the scene");
});

test("the map world: terrain hugs every road and rivers cross them only at bridges", () => {
  const terrain = mapWorld.terrain;
  const rivers = roads.flatMap((r) => resolveZones(r).rivers.map((z) => ({ route: r, at: z.at })));
  assert.ok(rivers.length >= 2, "the river crosses several roads");
  // Routes ride the roads point for point: only their rounded turns are new ground.
  const onRoads = new Map(valley.map((r) => [r, sharedStretches(r, roads)]));
  for (const r of [...roads, ...valley]) {
    for (let d = 0; d < r.length; d += 10) {
      if (near(r.positionAt(d), places, 25)) continue;
      if (onRoads.get(r)?.some((s) => d >= s.from && d <= s.to)) continue;
      const { center } = roadFrame(r, d);
      const onBridge = rivers.some((river) => Math.hypot(...[0, 2].map((k) => roadFrame(river.route, river.at).center[k] - center[k])) < BRIDGE_HALF_LENGTH + 10);
      if (onBridge) continue;
      const below = center[1] - terrain.height(center[0], center[2]);
      assert.ok(below > 0.1 && below < 1.5, `${r.id} at ${d} m: terrain ${below.toFixed(2)} m below the road`);
      assert.ok(terrain.riverDistance(center[0], center[2]) > RIVER.halfWidth + 8, `${r.id} at ${d} m is in a river`);
    }
  }
});

test("junction pads lie under every road and over the road bed", () => {
  assert.ok(JUNCTION_LIFT < ROAD_LIFT.other - depthStep(RIDE_LENS, 150), "under the other roads");
  assert.ok(JUNCTION_LIFT > -0.35 + 0.1, "over the terrain's road bed");
});

test("every café of the map gets its café, whichever route you ride", () => {
  assert.equal(mapWorld.cafes.length, network.cafes().length);
  for (const cafe of network.cafes()) {
    assert.ok(mapWorld.cafes.some((p) => Math.hypot(p[0] - cafe.x, p[2] + cafe.y) < 80), `a café at ${cafe.id}`);
  }
});

test("the map terrain is defined everywhere, out to the horizon", () => {
  for (let x = -7000; x <= 7000; x += 37) {
    for (let z = -7000; z <= 7000; z += 41) {
      const h = mapWorld.terrain.height(x, z);
      assert.ok(Number.isFinite(h), `terrain at (${x}, ${z}) is ${h}`);
    }
  }
});

// --- no flicker: stacked surfaces stay apart (#24) ---------------------------

import { DRONE_LENS, RIDE_LENS, depthStep } from "../public/js/view3d/view3d.js";
import { ROAD_LIFT } from "../public/js/view3d/world.js";

/** Height of the highest triangle of `meshes` over (x, z), or null where there is none. */
function surfaceOf(meshes, cell = 64) {
  const triangles = [];
  const buckets = new Map();
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i < mesh.vertexCount; i += 3) {
      const t = [0, 1, 2].map((k) => [p[(i + k) * 3], p[(i + k) * 3 + 1], p[(i + k) * 3 + 2]]);
      const id = triangles.push(t) - 1;
      const xs = t.map((v) => Math.floor(v[0] / cell));
      const zs = t.map((v) => Math.floor(v[2] / cell));
      for (let gx = Math.min(...xs); gx <= Math.max(...xs); gx += 1) {
        for (let gz = Math.min(...zs); gz <= Math.max(...zs); gz += 1) {
          const key = `${gx},${gz}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(id);
        }
      }
    }
  }
  const surface = (x, z) => {
    let top = null;
    for (const id of buckets.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      const [a, b, c] = triangles[id];
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      top = top === null ? y : Math.max(top, y);
    }
    return top;
  };
  surface.triangles = triangles.length;
  return surface;
}

test("terrain layers stay far enough apart for the depth buffer: fine over coarse over the sea floor", () => {
  const horizon = mapWorld.meshes.horizon;
  const coarseCount = horizon.vertexCount - 6; // the last quad is the sea-floor plane
  const floor = horizon.positions[coarseCount * 3 + 1];
  const fine = surfaceOf(mapWorld.chunks.terrain.map((chunk) => chunk.mesh));
  const coarse = surfaceOf([{ positions: horizon.positions.subarray(0, coarseCount * 3), vertexCount: coarseCount }], 280);
  // Fog ends by 4.2 km in the ride; the drone sees further but from higher up.
  const needed = Math.max(depthStep(RIDE_LENS, 4200), depthStep(DRONE_LENS, 9000)) * 4;
  let checked = 0;
  for (let x = -6000; x <= 6000; x += 29) {
    for (let z = -7000; z <= 5000; z += 31) {
      const below = coarse(x, z);
      if (below === null) continue;
      assert.ok(below - floor > needed, `coarse grid only ${(below - floor).toFixed(2)} m above the sea-floor plane at (${x}, ${z})`);
      const above = fine(x, z);
      if (above === null) continue;
      checked += 1;
      assert.ok(above - below > needed, `fine terrain only ${(above - below).toFixed(2)} m above the coarse grid at (${x}, ${z})`);
    }
  }
  assert.ok(checked > 10_000, `the island was sampled (${checked})`);
});

test("land far from the roads is drawn coarser, without holes and close to the full detail", () => {
  const terrainOf = (options) => {
    const into = new ChunkedMesh();
    buildTerrain(mapWorld.terrain, { ...options, into });
    return surfaceOf(into.build().map((chunk) => chunk.mesh));
  };
  const full = terrainOf({ detailReach: 0 });
  const lighter = terrainOf({});
  let land = 0;
  for (let x = -5000; x <= 6000; x += 23) {
    for (let z = -5000; z <= 5000; z += 29) {
      const want = full(x, z);
      if (want === null || want < 3) continue;
      land += 1;
      const got = lighter(x, z);
      assert.ok(got !== null, `a hole in the terrain at (${x}, ${z})`);
      assert.ok(Math.abs(got - want) < 3, `coarse terrain ${(got - want).toFixed(1)} m off the full detail at (${x}, ${z})`);
    }
  }
  assert.ok(land > 50_000, `the island was sampled (${land})`);
  assert.ok(lighter.triangles < full.triangles * 0.7, `fewer triangles (${lighter.triangles} of ${full.triangles})`);
});

test("other roads' markings stay under the ridden road's asphalt where they cross it", () => {
  const gap = ROAD_LIFT.ridden - (ROAD_LIFT.other + ROAD_LIFT.marking);
  assert.ok(gap > depthStep(RIDE_LENS, 600), `${gap} m apart flickers within 600 m`);
  assert.ok(gap > depthStep(DRONE_LENS, 3000), `${gap} m apart flickers from the drone`);
});

test("depth steps grow with distance and shrink with a larger near plane", () => {
  assert.ok(depthStep({ near: 1, far: 9000 }, 1000) < depthStep({ near: 0.3, far: 9000 }, 1000) / 3);
  assert.ok(depthStep(RIDE_LENS, 2000) > depthStep(RIDE_LENS, 1000) * 3.9);
  assert.ok(Math.abs(depthStep({ near: 1, far: 1e9 }, 4096) - 1) < 1e-6, "24 bits: 1 m at 4 km with a 1 m near plane");
});

test("the map is an island: every road above the sea and off the beach, the sea all around", () => {
  const { island, seaLevel } = mapWorld.terrain;
  const height = (x, y) => mapWorld.terrain.height(x, -y);
  for (const r of roads) {
    for (let d = 0; d < r.length; d += 40) {
      const { x, y } = r.positionAt(d);
      // A river's bed is below sea level too: only the sea counts, so skip the bridges.
      if (r.zones.some((z) => z.type === "river" && Math.abs(z.at - d) < 150)) continue;
      assert.ok(height(x, y) > seaLevel + 1.5, `${r.edge.id} at ${d} m rides in the surf`);
      for (let a = 0; a < 16; a += 1) {
        const angle = (a / 16) * 2 * Math.PI;
        assert.ok(height(x + 60 * Math.cos(angle), y + 60 * Math.sin(angle)) > seaLevel, `${r.edge.id} at ${d} m has eaten the beach`);
      }
    }
  }
  let beach = 0;
  let cliff = 0;
  for (let a = 0; a < 360; a += 3) {
    const angle = (a * Math.PI) / 180;
    const at = (r) => [island.center[0] + Math.cos(angle) * r, island.center[1] + Math.sin(angle) * r];
    const coast = island.radiusAt(angle);
    assert.ok(mapWorld.terrain.height(...at(coast + 250)) < seaLevel - 2, `sea beyond the coast at ${a}°`);
    assert.ok(mapWorld.terrain.height(...at(coast + 2500)) < seaLevel - 20, `open sea at ${a}°`);
    // Walking in from the sea: a beach rises gently, a cliff steeply.
    let r = coast + 200;
    while (r > 0 && mapWorld.terrain.height(...at(r)) < seaLevel + 0.5) r -= 5;
    if (mapWorld.terrain.height(...at(r - 70)) - seaLevel > 18) cliff += 1;
    else beach += 1;
  }
  assert.ok(beach > cliff && cliff > 4, `mostly beaches, some cliffs (${beach} / ${cliff})`);
});

test("the island comes with the network: the same land for every client", () => {
  const again = new RoadNetwork(networkFile());
  for (const [x, y] of [[0, 0], [1234, -2345], [-3000, 2500], [8000, 8000]]) assert.equal(again.heightAt(x, y), network.heightAt(x, y));
  assert.ok(network.heightAt(0, 0) > 30 && network.heightAt(0, 0) < 45, "the valley café sits in the valley");
  assert.ok(network.heightAt(9000, -9000) < -20, "open sea far out");
});

test("without a network, the coast comes from the roads and the map seed alone", () => {
  const once = terrainModel([colRoute, flatsRoute, hillsRoute], { seed: mapSeed(hillsRoute) });
  const again = terrainModel([hillsRoute, colRoute, flatsRoute], { seed: mapSeed(hillsRoute) });
  const other = terrainModel([colRoute, flatsRoute, hillsRoute], { seed: mapSeed(hillsRoute) + 1 });
  const angles = [0, 1, 2, 3, 4, 5, 6];
  assert.deepEqual(angles.map(again.island.radiusAt), angles.map(once.island.radiusAt));
  assert.notDeepEqual(angles.map(other.island.radiusAt), angles.map(once.island.radiusAt));
});

test("rivers never run below the sea", () => {
  const { seaLevel } = mapWorld.terrain;
  const land = { ...mapWorld.terrain, height: mapWorld.terrain.baseHeight };
  for (const r of roads) {
    for (const z of resolveZones(r).rivers) {
      const river = buildRiverPath(r, land, z.at, r.seed >>> 0, seaLevel);
      for (const p of river.points) assert.ok(p.surface >= seaLevel, "rivers never run below the sea");
    }
  }
});

test("rivers run in valleys, not gorges", () => {
  for (const r of roads) {
    for (const z of resolveZones(r).rivers) {
      const land = { ...mapWorld.terrain, height: mapWorld.terrain.baseHeight };
      const river = buildRiverPath(r, land, z.at, r.seed >>> 0, mapWorld.waterLevel);
      const depths = river.points.filter((p) => Math.abs(p.s) > 120).map((p) => mapWorld.terrain.baseHeight(p.x, p.z) - p.surface);
      const mean = depths.reduce((sum, d) => sum + d, 0) / depths.length;
      assert.ok(mean < 16, `${r.id} river at ${z.at} m runs ${mean.toFixed(0)} m below the land on average`);
    }
  }
});

test("the map world looks the same whichever route you ride", () => {
  const fromCol = buildWorld(colRoute, { network });
  const vertices = (world, name) => world.chunks[name].reduce((sum, c) => sum + c.mesh.vertexCount, 0);
  // Grass and flowers are thinner along roads you don't ride; the rest is the same.
  for (const name of ["terrain", "scenery"]) assert.equal(vertices(fromCol, name), vertices(mapWorld, name), name);
  assert.deepEqual(fromCol.rotors.map((r) => r.hub), mapWorld.rotors.map((r) => r.hub));
  // Only the ridden route has arches and spectators.
  assert.notDeepEqual(fromCol.spectators.map((p) => p.position), mapWorld.spectators.map((p) => p.position));
});

test("one café at the shared start, however many routes start there", () => {
  const cafes = new Occupancy();
  const structures = new MeshBuilder();
  const bright = new MeshBuilder();
  const first = buildBikeCafe(flatsRoute, null, { structures, bright, occupancy: cafes });
  const second = buildBikeCafe(colRoute, null, { structures, bright, occupancy: cafes });
  assert.deepEqual(first.position, second.position, "every route's café is the same spot");
});

// --- building off the main thread --------------------------------------------------

import { buildScene, sceneOf, transferList } from "../public/js/view3d/worldScene.js";

const tinyFile = { id: "tiny", name: "Tiny", lanes: 2, seed: 3, points: [[0, 0, 50], [400, 0, 50], [400, 400, 55], [0, 400, 55]], zones: [] };

test("the scene is plain data whose buffers can be handed to the main thread", () => {
  const scene = sceneOf(world);
  assert.deepEqual(Object.keys(scene).sort(), ["chunks", "clouds", "gyms", "meshes", "overview", "rivers", "rotors", "spectators", "water"]);
  const buffers = transferList(scene);
  assert.ok(buffers.length > 20 && buffers.every((b) => b instanceof ArrayBuffer));
  assert.equal(new Set(buffers).size, buffers.length, "each buffer once");
  assert.doesNotThrow(() => structuredClone(scene), "no functions in the scene");
});

test("without workers the scene is built in place, and a failing worker falls back too", async () => {
  const inPlace = await buildScene(tinyFile, [], { createWorker: () => null });
  assert.ok(inPlace.chunks.terrain.length > 0);

  let terminated = false;
  const failing = {
    postMessage() {
      queueMicrotask(() => this.onerror({ message: "module workers unsupported", preventDefault() {} }));
    },
    terminate() {
      terminated = true;
    },
  };
  const original = console.warn;
  console.warn = () => {};
  try {
    const fallback = await buildScene(tinyFile, [], { createWorker: () => failing });
    assert.ok(fallback.chunks.terrain.length > 0);
    assert.ok(terminated);
  } finally {
    console.warn = original;
  }
});

test("a worker's scene is used as it arrives", async () => {
  const scene = { meshes: {}, chunks: {}, rotors: [], spectators: [] };
  const worker = {
    postMessage(message) {
      assert.equal(message.route.id, "tiny");
      queueMicrotask(() => this.onmessage({ data: { scene } }));
    },
    terminate() {},
  };
  assert.equal(await buildScene(tinyFile, [], { createWorker: () => worker }), scene);
});

test("the drone's haze grows with the island, its draw reach does not", async () => {
  const { droneLens } = await import("../public/js/view3d/view3d.js");
  assert.deepEqual({ ...droneLens({ radius: 2000 }), reach: undefined }, { ...DRONE_LENS, reach: undefined });
  const big = droneLens({ radius: 6500 });
  assert.ok(big.haze > DRONE_LENS.haze && big.far >= 6500 * 3);
  assert.equal(big.reach, Math.sqrt(DRONE_LENS.haze));
});

test("the gym's lens keeps the low orbit's foreground out of the near plane", async () => {
  const { gymLens, droneLens, GYM_LENS } = await import("../public/js/view3d/view3d.js");
  const { MENU_CAMERA } = await import("../public/js/view3d/menuCamera.js");
  const lens = gymLens({ radius: 2000 });
  // The drone's near plane (20 m) clips the ground the gym orbit skims over.
  assert.ok(MENU_CAMERA.gymHeight < DRONE_LENS.near, "the orbit really does fly inside the drone's near plane");
  assert.ok(lens.near < MENU_CAMERA.gymHeight, `near (${lens.near} m) clears the foreground ground`);
  // Otherwise the gym lens is the drone lens: same haze and draw reach.
  assert.deepEqual({ ...lens, near: undefined }, { ...droneLens({ radius: 2000 }), near: undefined });
  assert.equal(GYM_LENS.near, lens.near);
});

test("Cape Loop runs along the sea", () => {
  const { seaLevel } = mapWorld.terrain;
  const route = loadRoute("cape-loop");
  const height = (x, y) => mapWorld.terrain.height(x, -y);
  let seaside = 0;
  let high = -Infinity;
  for (let d = 0; d < route.length; d += 40) {
    const { x, y } = route.positionAt(d);
    high = Math.max(high, route.elevationAt(d));
    let sea = false;
    for (let a = 0; a < 16; a += 1) {
      const angle = (a / 16) * 2 * Math.PI;
      if (height(x + 150 * Math.cos(angle), y + 150 * Math.sin(angle)) < seaLevel) sea = true;
    }
    if (sea) seaside += 40;
  }
  assert.ok(seaside >= 3000, `${seaside} m within 150 m of the sea`);
  assert.ok(high < 60, `highest point ${high} m`);
  assert.ok(route.length > 17000 && route.length < 23000, `${route.length} m long`);
});

test("Island Tour rides the coast", () => {
  const walk = network.routes.find((w) => w.id === "island-tour").walk.map((s) => s[0] ?? s.edge ?? s);
  assert.ok(walk.includes("south-coast") && walk.includes("west-coast"), "rides both coastal roads");
  assert.ok(!walk.includes("lower-valley"), "no longer takes the inland road");
});

test("a cliff zone gets a guard rail on the sea side only", () => {
  const road = new RouteGeometry({ id: "c", name: "c", lanes: 4, seed: 1, loop: false, points: [[0, 0, 10], [600, 0, 10]], zones: [] });
  const posts = [];
  const structures = { box: (at) => posts.push(at), orientedBox: () => {} };
  // The ground falls away on one side of the road: that is the sea.
  const terrain = { height: (x, z) => (z > 0 ? -5 : 25) };
  buildRoadside(road, terrain, { structures, bright: {}, markers: false, cliffs: [{ from: 100, to: 400 }] });
  assert.ok(posts.length > 30, `${posts.length} posts`);
  for (const [x, , z] of posts) {
    assert.ok(x >= 99 && x <= 401, `post at ${x} m is outside the cliff zone`);
    assert.ok(terrain.height(x, Math.sign(z) * 15) < terrain.height(x, -Math.sign(z) * 15), `post at z ${z} is on the land side`);
  }
});

test("on the real map the cliff rail is on the side the sea is nearer", () => {
  const road = roads.find((r) => r.edge.id === "south-coast");
  const { seaLevel } = mapWorld.terrain;
  const posts = [];
  const structures = { box: (at) => posts.push(at), orientedBox: () => {} };
  buildRoadside(road, mapWorld.terrain, { structures, bright: {}, markers: false, twoWay: true, railGrade: 1000, cliffs: resolveZones(road).cliffs });
  const toSea = (x, z, dx, dz) => {
    for (let m = 20; m <= 400; m += 20) if (mapWorld.terrain.height(x + dx * m, z + dz * m) < seaLevel) return m;
    return Infinity;
  };
  let checked = 0;
  for (const [x, , z] of posts) {
    let best = { gap: Infinity, d: 0 };
    for (let d = 0; d <= road.length; d += 4) {
      const c = roadFrame(road, d).center;
      const gap = Math.hypot(c[0] - x, c[2] - z);
      if (gap < best.gap) best = { gap, d };
    }
    const f = roadFrame(road, best.d);
    const out = [x - f.center[0], z - f.center[2]];
    const len = Math.hypot(...out);
    const [dx, dz] = [out[0] / len, out[1] / len];
    const here = toSea(x, z, dx, dz);
    const away = toSea(x, z, -dx, -dz);
    if (here === Infinity && away === Infinity) continue;
    checked += 1;
    assert.ok(here < away, `post at ${best.d} m is on the land side (${here} m / ${away} m to the sea)`);
  }
  assert.ok(checked > 100, `${checked} rail posts by the sea`);
});
