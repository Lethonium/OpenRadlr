import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadNetworkOf } from "../public/js/route/worldMap.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { sceneOf, transferList } from "../public/js/view3d/worldScene.js";
import { livingEligible } from "../public/js/view3d/living/index.js";
import { temperate } from "../public/js/view3d/biomes/temperate.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../../routes/${path}`, import.meta.url), "utf8"));
const valleyRoute = new RouteGeometry(read("island-tour.json"));
const valleyNetwork = roadNetworkOf(read("maps/valley.json"));
const hills = new RouteGeometry(read("rolling-hills.json"));

const timed = (build) => {
  const start = performance.now();
  return { world: build(), ms: performance.now() - start };
};
const { world: plain, ms: plainMs } = timed(() => buildWorld(valleyRoute, { network: valleyNetwork }));
const { world: living, ms: livingMs } = timed(() => buildWorld(valleyRoute, { network: valleyNetwork, living: true }));

const vertices = (world) => Object.values(world.chunks).flat().reduce((sum, chunk) => sum + chunk.mesh.vertexCount, 0);
const positionsOf = (world, group) => world.chunks[group].map((chunk) => chunk.mesh.positions);

test("plain world is unaffected", () => {
  assert.equal(plain.chunks.life, undefined);
  assert.equal(plain.living, null);
  assert.equal(vertices(plain), 4_722_774, "the plain valley map keeps its size");
});

test("layout is the same with Living", () => {
  assert.deepEqual(living.overview, plain.overview);
  assert.deepEqual(living.gyms, plain.gyms);
  assert.deepEqual(positionsOf(living, "road"), positionsOf(plain, "road"));
  assert.deepEqual(positionsOf(living, "terrain"), positionsOf(plain, "terrain"));
});

test("Living carries a ground map and a life group", () => {
  const { groundMap } = living.living;
  assert.equal(groundMap.width, 2048);
  assert.equal(groundMap.data.length, 2048 * 2048 * 4);
  assert.ok(Array.isArray(living.chunks.life));
  assert.deepEqual(living.living.movers, []);
});

test("the living scene crosses the worker boundary", () => {
  const scene = sceneOf(living);
  assert.ok(transferList(scene).includes(scene.living.groundMap.data.buffer));
  assert.doesNotThrow(() => structuredClone({ living: { ...scene.living, groundMap: { ...scene.living.groundMap, data: null } } }));
});

test("winter renders like plain 3D", () => {
  const winter = buildWorld(valleyRoute, { network: valleyNetwork, biome: "winter", living: true });
  assert.equal(winter.living, null);
  assert.equal(winter.chunks.life, undefined);
});

test("a world without a road network renders like plain 3D", () => {
  const world = buildWorld(hills, { living: true });
  assert.equal(world.living, null);
  assert.equal(world.chunks.life, undefined);
});

test("a huge island falls back", () => {
  assert.equal(livingEligible({ biome: temperate, network: {}, box: { x0: 0, z0: 0, x1: 20000, z1: 20000 } }), false);
});

test("the build stays within budget", (t) => {
  const added = vertices(living) - vertices(plain);
  t.diagnostic(`added ${added} vertices; plain ${Math.round(plainMs)} ms, Living ${Math.round(livingMs)} ms (extra ${Math.round(livingMs - plainMs)} ms)`);
  assert.ok(added <= 1_650_000, `${added} added vertices`);
});
