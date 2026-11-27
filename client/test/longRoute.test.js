import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { triangleCount } from "../public/js/view3d/assets/geom.js";
import { roadPostGeometry } from "../public/js/view3d/assets/props/roadPost.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { terrainModel } from "../public/js/world/roads.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";
import { BIOME_IDS } from "../public/js/view3d/biomes/index.js";

const rollingHills = () => new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));

test("the valley world keeps its terrain", () => {
  const route = rollingHills();
  const terrain = terrainModel(route);
  const expected = [[2400,-950,151.75],[2700,-950,145.92],[3400,-950,-26.99],[5400,-950,-38.6],[2482,231,73.83],[2782,231,30.36],[3482,231,-38.6],[5482,231,-38.6],[1283,1684,42.37],[1583,1684,44.65],[2283,1684,-38.6],[4283,1684,-38.6],[1440,-361,71.72],[1740,-361,84.37],[2440,-361,102.21],[4440,-361,-38.6],[-5000,0,-38.6],[5000,0,-38.6],[0,6000,-38.6],[0,-6000,-38.6]];
  for (const [x, z, height] of expected) assert.ok(Math.abs(terrain.height(x, z) - height) < 0.01, `${x},${z}`);
  const ground = groundExtent(terrain);
  assert.deepEqual(ground.bounds, { x0: 240, z0: -1984, x1: 3536, z1: 2640 });
  assert.equal(ground.horizon, 4200);
});

/** A rolling rounded-rectangle loop, `width` × `height` metres, ridden at 1 point per 200 m. */
function bigLoop(width, height) {
  const points = [];
  const perimeter = 2 * (width + height);
  for (let d = 0; d < perimeter; d += 200) {
    let x;
    let y;
    if (d < width) [x, y] = [d, 0];
    else if (d < width + height) [x, y] = [width, d - width];
    else if (d < 2 * width + height) [x, y] = [width - (d - width - height), height];
    else [x, y] = [0, height - (d - 2 * width - height)];
    points.push([x, y, 150 + 100 * Math.sin(d / 3000)]);
  }
  return new RouteGeometry({ id: "big", name: "Big", lanes: 4, seed: 9, points });
}

test("a 50 km route builds its terrain with the horizon around the whole island", () => {
  const route = bigLoop(30000, 20000);
  const started = Date.now();
  const terrain = terrainModel(route);
  const ground = groundExtent(terrain);
  const { far } = buildGroundGrids(terrain, ground, { season: "summer", long: true });
  assert.ok(Date.now() - started < 60_000, "built in under a minute");

  const farBox = { x0: far.x0, x1: far.x0 + (far.columns - 1) * far.cell, z0: far.z0, z1: far.z0 + (far.rows - 1) * far.cell };
  assert.ok(far.heights.every(Number.isFinite));
  // The horizon grid reaches beyond the island's fine box on every side.
  assert.ok(farBox.x0 < ground.bounds.x0 - 4000 && farBox.x1 > ground.bounds.x1 + 4000, `${farBox.x0} ${farBox.x1}`);
  assert.ok(farBox.z0 < ground.bounds.z0 - 4000 && farBox.z1 > ground.bounds.z1 + 4000, `${farBox.z0} ${farBox.z1}`);
  for (const [x, z] of [[ground.bounds.x0, ground.bounds.z0], [ground.bounds.x1, ground.bounds.z1], [15000, -10000]]) {
    assert.ok(Number.isFinite(terrain.height(x, z)));
  }
});

/** Triangles of the road's quads and its posts (the adapter draws nothing else of the world). */
const roadTriangles = (scene) => {
  const shapes = new Map();
  const triangles = (post) => {
    const shape = `${post.kind}${post.capped}`;
    if (!shapes.has(shape)) shapes.set(shape, triangleCount(roadPostGeometry(post.kind, scene.roads.style.post, { capped: post.capped })));
    return shapes.get(shape);
  };
  return scene.roads.strips.indices.length / 3 + scene.roads.posts.reduce((sum, post) => sum + triangles(post), 0);
};

test("the valley world keeps its density", () => {
  const scene = buildSceneNow(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));
  // 40810: the road's quads (towns' streets and pavements included) and its posts. Was 252122 before the old trees, tufts and
  // flowers went (the scene draws plants from the plan); the ground is tiled by the main thread from `scene.ground`.
  assert.equal(roadTriangles(scene), 40810);
});

test("a long route's world is thinned to a size a browser can build", () => {
  const route = bigLoop(30000, 20000);
  const scene = buildSceneNow({ id: "big", name: "Big", lanes: 4, seed: 9, points: route.nodes.map((n) => [n.x, n.y, n.elevation]) });
  const perKm = roadTriangles(scene) / (route.length / 1000);
  assert.ok(perKm < 12_000, `${Math.round(perKm)} triangles per km`);
});

test("a long route stays inside the triangle budget in every biome", () => {
  const route = bigLoop(30000, 20000);
  const file = { id: "big", name: "Big", lanes: 4, seed: 9, points: route.nodes.map((n) => [n.x, n.y, n.elevation]) };
  const temperate = roadTriangles(buildSceneNow(file));
  for (const id of BIOME_IDS) {
    const triangles = roadTriangles(buildSceneNow(file, [], null, id));
    const perKm = triangles / (route.length / 1000);
    assert.ok(perKm < 12_000, `${id}: ${Math.round(perKm)} triangles per km`);
    assert.ok(triangles <= temperate * 1.3, `${id}: ${triangles} triangles vs temperate ${temperate}`);
  }
});
