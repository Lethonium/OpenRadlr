import test from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { sceneOf, buildSceneNow } from "../public/js/view3d/worldScene.js";
import { indexWorld } from "../public/js/view2d/worldIndex.js";
import { routeProjector, sideScenery } from "../public/js/view2d/routeProjector.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";

const scene = sceneOf(buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()));
const route = new RouteGeometry(tinyLoopFile());
const index = indexWorld(scene);
const ALL = [-1e5, -1e5, 1e5, 1e5];
const layer = (name) => index.query(...ALL).filter((i) => i.layer === name);

test("the index holds every tree and every plot of the plan", () => {
  const trees = Object.values(scene.plan.trees).reduce((n, a) => n + a.length / 5, 0);
  const plots = scene.plan.settlements.reduce((n, s) => n + s.plots.length, 0);
  assert.ok(trees > 100 && plots > 0);
  assert.equal(layer("tree").length, trees);
  assert.equal(layer("house").length, plots);
});

test("the index holds the people, cafés, arches and the flamme rouge", () => {
  assert.equal(layer("person").length, scene.crowd.people.length);
  assert.equal(layer("cafe").length, scene.cafeSites.length);
  const arches = layer("arch");
  assert.equal(arches.filter((a) => a.id === "arch").length, scene.arches.length);
  assert.equal(arches.filter((a) => a.id === "flammeRouge").length, scene.furniture.flammeRouge ? 1 : 0);
});

test("herds are spread round their centre, one animal per head", () => {
  const heads = scene.plan.fauna.herds.reduce((n, h) => n + h.count, 0);
  const animals = layer("animal");
  assert.equal(animals.length, heads);
  const h = scene.plan.fauna.herds[0];
  assert.ok(animals.some((a) => Math.hypot(a.x - h.x, a.z - h.z) <= h.radius));
});

test("a box with nothing in it finds nothing", () => {
  assert.deepEqual(index.query(1e6, 1e6, 1e6 + 10, 1e6 + 10), []);
});

test("query fills a given array", () => {
  const out = [];
  assert.equal(index.query(...ALL, out), out);
  assert.ok(out.length > 0);
});

test("a point 10 m right of the route is found at its distance along", () => {
  const p = route.positionAt(100);
  const q = route.positionAt(101);
  const l = Math.hypot(q.x - p.x, q.y - p.y);
  const tx = (q.x - p.x) / l;
  const tz = -(q.y - p.y) / l;
  const hit = routeProjector(route).project(p.x - tz * 10, -p.y + tx * 10, 60);
  assert.ok(Math.abs(hit.d - 100) < 1, `d ${hit.d}`);
  assert.ok(Math.abs(hit.lateral - 10) < 0.5, `lateral ${hit.lateral}`);
});

test("a point far from the route has no projection", () => {
  assert.equal(routeProjector(route).project(1e6, 1e6, 60), null);
});

test("the side scenery keeps buildings behind the road and nothing on it", () => {
  const entries = sideScenery(index, route, { behind: 70, front: 22 });
  assert.ok(entries.length > 10);
  const buildings = ["house", "farm", "cafe", "landmark"];
  for (const e of entries) {
    if (buildings.includes(e.item.layer)) assert.ok(e.lateral <= -7, `${e.item.layer} at ${e.lateral}`);
    if (e.item.layer !== "person") assert.ok(Math.abs(e.lateral) >= 3.5, `${e.item.layer} at ${e.lateral}`);
    assert.ok(Math.abs(e.turn) <= Math.PI / 2 + 1e-9);
    assert.ok(e.lateral <= 22 && e.lateral >= -70);
  }
  assert.ok(entries.some((e) => buildings.includes(e.item.layer)));
  for (let i = 1; i < entries.length; i += 1) assert.ok(entries[i - 1].lateral <= entries[i].lateral);
});

test("vine rows and scrub other than bushes stay out of the side scenery", () => {
  for (const e of sideScenery(index, route, {})) {
    assert.ok(!(e.item.layer === "row" && e.item.id === "vine"));
    assert.ok(e.item.layer !== "scrub" || e.item.id === "bush" || e.item.id === "lavender");
  }
});

test("a house facing the camera has no turn", () => {
  // The camera looks from the right of travel, so a house at the route's start whose front points right is face on.
  const p = route.positionAt(50);
  const q = route.positionAt(51);
  const l = Math.hypot(q.x - p.x, q.y - p.y);
  const tx = (q.x - p.x) / l;
  const tz = -(q.y - p.y) / l;
  const house = { layer: "house", id: "h", x: p.x + tz * 12, z: -p.y - tx * 12, y: 0, facing: [-tz, tx] };
  const fake = { query: () => [house] };
  const [entry] = sideScenery(fake, route, {});
  assert.ok(entry, "the house is kept");
  assert.ok(Math.abs(entry.turn) < 0.05, `turn ${entry.turn}`);
});
