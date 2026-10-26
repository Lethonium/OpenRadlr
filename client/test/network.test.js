import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { NETWORK_LANES, RoadNetwork, hashSeed } from "../public/js/route/network.js";
import { fetchMapNetwork, roadNetworkOf } from "../public/js/route/worldMap.js";
import { buildWorld, sharedStretches } from "../public/js/view3d/world.js";
import { buildScene } from "../public/js/view3d/worldScene.js";
import { drawMapPreview } from "../public/js/view/mapPreview.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";

// --- open roads ------------------------------------------------------------------

test("a network road is open: no closing segment, distances clamp to its ends", () => {
  const road = new RouteGeometry({ id: "r", name: "r", lanes: 4, seed: 1, loop: false, points: [[0, 0, 10], [100, 0, 20]] });
  assert.equal(road.loop, false);
  assert.equal(road.length, 100);
  assert.equal(road.wrap(130), 100);
  assert.equal(road.wrap(-5), 0);
  assert.deepEqual(road.positionAt(150), { x: 100, y: 0 });
  assert.equal(road.elevationAt(50), 15);
  assert.equal(road.signedGap(80, 20), -60, "no way round an open road");
  const loop = new RouteGeometry({ id: "l", name: "l", lanes: 4, seed: 1, points: [[0, 0, 10], [100, 0, 20]] });
  assert.equal(loop.length, 200, "routes still close themselves");
});

// --- the network file -------------------------------------------------------------

const network = new RoadNetwork(tinyNetworkFile());

test("a network file gives places, roads and the land", () => {
  assert.equal(network.id, "tiny");
  assert.deepEqual(network.cafes().map((c) => c.id), ["cafe"]);
  assert.deepEqual(network.roads().map((r) => r.edge.id), ["south-road", "diagonal", "west-road"]);
  const road = network.edges.get("diagonal");
  assert.equal(road.loop, false);
  assert.equal(road.lanes, NETWORK_LANES);
  assert.equal(road.explicitZones, true);
  assert.deepEqual(road.edge, { id: "diagonal", from: "east", to: "north", type: "road", markers: [] });
  assert.equal(road.seed, hashSeed("diagonal", 5));
  assert.notEqual(hashSeed("diagonal", 5), hashSeed("west-road", 5));
});

test("the land is smooth between grid nodes and matches them on them", () => {
  assert.equal(network.heightAt(0, 0), 30);
  assert.ok(network.heightAt(5000, 5000) <= -19.9, "sea beyond the grid");
  // Across a grid line the height changes smoothly, not in steps.
  let previous = network.heightAt(-1200 + 40 * 46, 150);
  for (let x = -1200 + 40 * 46; x < -1200 + 40 * 52; x += 2) {
    const h = network.heightAt(x, 150);
    assert.ok(Math.abs(h - previous) < 1, `smooth at x = ${x}`);
    previous = h;
  }
});

test("the island is in world coordinates: north is −z", () => {
  const file = tinyNetworkFile();
  file.coast = { center: [100, 200], radius: Array.from({ length: 4 }, (_, i) => [1000, 2000, 3000, 4000][i]) };
  const island = new RoadNetwork(file).island();
  assert.deepEqual(island.center, [100, -200]);
  assert.equal(island.radiusAt(0), 1000, "east");
  assert.equal(island.radiusAt(-Math.PI / 2), 2000, "north: −z in the world");
  assert.equal(island.radiusAt(Math.PI / 2), 4000, "south");
});

test("a road can be taken out of either of its places", () => {
  assert.equal(network.roadFrom("cafe"), network.edges.get("south-road"));
  const back = network.roadFrom("north");
  assert.deepEqual(back.positionAt(0), { x: 0, y: 500 });
  const out = network.roadFrom("cafe");
  assert.deepEqual(out.positionAt(0), { x: 0, y: 0 });
  assert.equal(network.roadFrom("nowhere"), null);
});

test("broken network files are refused", () => {
  assert.throws(() => new RoadNetwork(null));
  assert.throws(() => new RoadNetwork({ id: "x", nodes: [], edges: [] }), /terrain/);
  const file = tinyNetworkFile();
  file.edges[0].to = "atlantis";
  assert.throws(() => new RoadNetwork(file), /unknown places/);
});

// --- loading -------------------------------------------------------------------------

test("the network is fetched for routes on a map, and missing ones fall back", async () => {
  const file = tinyNetworkFile();
  const onMap = { id: "tiny-loop", map: { id: "tiny", seed: 5 } };
  assert.equal(await fetchMapNetwork(onMap, async (id) => (id === "tiny" ? file : null)), file);
  assert.equal(await fetchMapNetwork({ id: "alone" }, async () => file), null, "no map, no network");
  assert.equal(await fetchMapNetwork(onMap, async () => ({ ...file, id: "other" })), null, "another map's network");
  assert.equal(await fetchMapNetwork(onMap, async () => Promise.reject(new Error("404"))), null);
  assert.equal(await fetchMapNetwork(onMap, null), null);
  assert.equal(roadNetworkOf(file), roadNetworkOf(file), "decoded once per file");
});

// --- the world on a network ----------------------------------------------------------

const loop = new RouteGeometry(tinyLoopFile());
const world = buildWorld(loop, { network });

test("a route on a network rides its roads point for point", () => {
  const covered = sharedStretches(loop, network.roads()).reduce((sum, s) => sum + s.to - s.from, 0);
  assert.ok(Math.abs(covered - loop.length) < 1e-6);
});

test("the world on a network: every road once, the café, junction pads", () => {
  // Drawn once: the ridden route on top, the roads only where it doesn't run.
  const alone = buildWorld(loop, { network: new RoadNetwork({ ...tinyNetworkFile(), edges: tinyNetworkFile().edges.slice(0, 1), routes: [] }) });
  const vertices = (w) => w.chunks.road.reduce((sum, c) => sum + c.mesh.vertexCount, 0);
  assert.ok(vertices(world) < vertices(alone) * 1.2, "roads under the ridden route are not drawn again");
  assert.equal(world.cafes.length, 1);
  assert.ok(Math.hypot(world.cafes[0][0], world.cafes[0][2]) < 80, "the café is at the café");
  // The land comes from the network, the road bed from the roads.
  assert.ok(Math.abs(world.terrain.height(300, -300) - 30) < 4);
  assert.ok(Math.abs(world.terrain.height(250, 0) - (30 - 0.35)) < 0.05, "flattened under the road");
  assert.ok(world.terrain.height(0, -1150) < 0, "the sea around");
});

test("the scene is built with the network, in a worker too", async () => {
  const file = tinyNetworkFile();
  let posted = null;
  const scene = { meshes: {}, chunks: {} };
  const worker = {
    postMessage(message) {
      posted = message;
      queueMicrotask(() => this.onmessage({ data: { scene } }));
    },
    terminate() {},
  };
  assert.equal(await buildScene(tinyLoopFile(), [], { network: file, createWorker: () => worker }), scene);
  assert.equal(posted.network, file, "the worker gets the network file");
  const inPlace = await buildScene(tinyLoopFile(), [], { network: file, createWorker: () => null });
  assert.ok(inPlace.chunks.road.length > 0);
});

// --- the menu's map --------------------------------------------------------------------

test("the menu map draws the island and every road of the network", () => {
  const calls = { lineTo: 0, arcs: 0 };
  const ctx = new Proxy(
    {},
    {
      get: (_, name) => (name === "lineTo" ? () => (calls.lineTo += 1) : name === "arc" ? () => (calls.arcs += 1) : () => {}),
      set: () => true,
    },
  );
  const canvas = { getContext: () => ctx, clientWidth: 300, clientHeight: 200, width: 0, height: 0, style: {}, getBoundingClientRect: () => ({ width: 300, height: 200 }) };
  drawMapPreview(canvas, { routes: [loop], selectedId: loop.id, network: tinyNetworkFile() });
  assert.ok(calls.lineTo > 200, "coast, roads and the route");
  assert.equal(calls.arcs, 1, "the start");
});
