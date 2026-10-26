import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { FloatBuffer } from "../public/js/view3d/meshBuilder.js";
import { buildTerrain, terrainModel } from "../public/js/view3d/world.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";

const rollingHills = () => new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));

test("the valley world keeps its terrain", () => {
  const route = rollingHills();
  const terrain = terrainModel(route);
  const expected = [[2400,-950,151.75],[2700,-950,145.92],[3400,-950,-26.99],[5400,-950,-38.6],[2482,231,73.83],[2782,231,30.36],[3482,231,-38.6],[5482,231,-38.6],[1283,1684,42.37],[1583,1684,44.65],[2283,1684,-38.6],[4283,1684,-38.6],[1440,-361,71.72],[1740,-361,84.37],[2440,-361,102.21],[4440,-361,-38.6],[-5000,0,-38.6],[5000,0,-38.6],[0,6000,-38.6],[0,-6000,-38.6]];
  for (const [x, z, height] of expected) assert.ok(Math.abs(terrain.height(x, z) - height) < 0.01, `${x},${z}`);
  const ground = buildTerrain(terrain);
  assert.equal(ground.mesh.positions.length / 9, 66462);
  assert.deepEqual(ground.bounds, { x0: 240, z0: -1984, x1: 3536, z1: 2640 });
  assert.equal(ground.floor, -98.6);
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
  const ground = buildTerrain(terrain);
  assert.ok(Date.now() - started < 60_000, "built in under a minute");

  const positions = ground.mesh.positions;
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    assert.ok(Number.isFinite(positions[i + 1]));
    lo[0] = Math.min(lo[0], positions[i]);
    hi[0] = Math.max(hi[0], positions[i]);
    lo[1] = Math.min(lo[1], positions[i + 2]);
    hi[1] = Math.max(hi[1], positions[i + 2]);
  }
  // The horizon ring reaches beyond the island's fine box on every side.
  assert.ok(lo[0] < ground.bounds.x0 - 4000 && hi[0] > ground.bounds.x1 + 4000, `${lo[0]} ${hi[0]}`);
  assert.ok(lo[1] < ground.bounds.z0 - 4000 && hi[1] > ground.bounds.z1 + 4000, `${lo[1]} ${hi[1]}`);
  for (const [x, z] of [[ground.bounds.x0, ground.bounds.z0], [ground.bounds.x1, ground.bounds.z1], [15000, -10000]]) {
    assert.ok(Number.isFinite(terrain.height(x, z)));
  }
});

const chunkTriangles = (scene) => Object.values(scene.chunks).reduce((sum, chunks) => sum + chunks.reduce((n, c) => n + c.mesh.positions.length / 9, 0), 0);

test("the valley world keeps its density", () => {
  const scene = buildSceneNow(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));
  assert.equal(chunkTriangles(scene), 308562);
});

test("a long route's world is thinned to a size a browser can build", () => {
  const route = bigLoop(30000, 20000);
  const scene = buildSceneNow({ id: "big", name: "Big", lanes: 4, seed: 9, points: route.nodes.map((n) => [n.x, n.y, n.elevation]) });
  const perKm = chunkTriangles(scene) / (route.length / 1000);
  assert.ok(perKm < 12_000, `${Math.round(perKm)} triangles per km`);
});

test("FloatBuffer grows and trims", () => {
  const buffer = new FloatBuffer();
  for (let i = 0; i < 1000; i += 1) buffer.push(i, i + 0.5);
  buffer.pushRange([7, 8, 9], 1, 3);
  const out = buffer.toFloat32();
  assert.equal(out.length, 2002);
  assert.deepEqual([...out.slice(-4)], [999, 999.5, 8, 9]);
});
