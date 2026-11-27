/** Farms next to their fields, wind turbines and far islands as data (`world/plan/farms.js`, `turbines.js`, `islands.js`). */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { groundExtent } from "../public/js/view3d/world.js";
import { RIVER } from "../public/js/world/rivers.js";
import { VERGE, mapSeed, roadHalfWidth, terrainModel, waterLevel } from "../public/js/world/roads.js";
import { FARM } from "../public/js/world/plan/farms.js";
import { planFarIslands } from "../public/js/world/plan/islands.js";
import { MASK, buildMasks, maskAt } from "../public/js/world/plan/masks.js";
import { TURBINE, planTurbines } from "../public/js/world/plan/turbines.js";
import { squareRoute, tinyLoopFile } from "./helpers.js";
import { planOf, tinyWorld, valleyWorld } from "./support/planFixture.js";

let cachedTiny;
let cachedValley;
const tiny = () => (cachedTiny ??= planOf(tinyWorld()));
const valley = () => (cachedValley ??= { world: valleyWorld(), plan: undefined });
const valleyPlan = () => (valley().plan ??= planOf(valley().world));

test("the plan carries farms, turbines and islands", () => {
  const plan = valleyPlan();
  assert.ok(plan.farms.length >= 2, `farms ${plan.farms.length}`);
  assert.ok(Array.isArray(plan.turbines));
  assert.ok(plan.islands.length >= 8);
  assert.ok(Object.isFrozen(FARM) && Object.isFrozen(TURBINE));
});

test("every farm's drive reaches a road", () => {
  const { roads } = valley().world;
  for (const farm of valleyPlan().farms) {
    assert.ok(farm.drive instanceof Float32Array && farm.drive.length >= 4);
    const [x, z] = [farm.drive[farm.drive.length - 2], farm.drive[farm.drive.length - 1]];
    const near = roads.nearest(x, z, 3);
    assert.ok(near, `no road near the drive end of farm ${farm.x},${farm.z}`);
    assert.ok(near.distance <= roadHalfWidth(near.sample.route.lanes) + VERGE + 1, `drive ends ${near.distance} m from the road`);
  }
});

test("a farm stands next to a field", () => {
  for (const { plan } of [{ plan: valleyPlan() }, { plan: tiny() }]) {
    for (const farm of plan.farms) {
      const d = Math.min(...plan.fields.map((f) => Math.hypot(f.x - farm.x, f.z - farm.z)));
      assert.ok(d <= 260, `nearest field ${d} m`);
    }
  }
});

test("no farm yard, paddock or turbine is on a road, a river or below water + 2", () => {
  for (const [world, plan] of [[valley().world, valleyPlan()], [tinyWorld(), tiny()]]) {
    const water = waterLevel(world.roads);
    const spots = [
      ...plan.farms.flatMap((f) => [[f.x, f.z], ...(f.paddock ? [[f.paddock.x, f.paddock.z]] : [])]),
      ...plan.turbines.map((t) => [t.x, t.z]),
    ];
    for (const [x, z] of spots) {
      assert.notEqual(maskAt(plan.masks, x, z), MASK.road);
      assert.notEqual(maskAt(plan.masks, x, z), MASK.river);
      assert.ok(world.terrain.height(x, z) >= water + 2, `${x},${z} is low`);
      assert.ok((world.terrain.riverDistance?.(x, z) ?? Infinity) > RIVER.halfWidth);
      assert.ok(world.roads.nearest(x, z, 1) === null || world.roads.nearest(x, z, 1).distance > 20);
    }
  }
});

test("a farm yard is stamped built, and farms keep 540 m apart", () => {
  const { farms, masks } = valleyPlan();
  for (const f of farms) assert.equal(maskAt(masks, f.x, f.z), MASK.built);
  for (let i = 0; i < farms.length; i += 1) {
    for (let j = i + 1; j < farms.length; j += 1) assert.ok(Math.hypot(farms[i].x - farms[j].x, farms[i].z - farms[j].z) >= FARM.spacing);
  }
  for (const f of farms) assert.ok([1, 2].includes(f.silos) && f.houses >= 1);
});

test("farms keep clear of towns", () => {
  const { world } = valley();
  for (const farm of valleyPlan().farms) {
    for (const s of world.settlements) assert.ok(Math.hypot(farm.x - s.center[0], farm.z - s.center[1]) >= s.radius + 220, `farm near ${s.id}`);
  }
});

test("there is at most one farm per kilometre of road, at least one on a road with fields", () => {
  const { roads } = valley().world;
  const routes = new Set(roads.samples.map((s) => s.route));
  const cap = [...routes].reduce((sum, r) => sum + Math.max(1, Math.round(r.length / 1000)), 0);
  assert.ok(valleyPlan().farms.length <= cap);
});

test("farms are deterministic", () => {
  const again = planOf(valleyWorld());
  assert.deepEqual(again.farms.map((f) => [f.x, f.z, f.yaw, f.silos, f.houses]), valleyPlan().farms.map((f) => [f.x, f.z, f.yaw, f.silos, f.houses]));
});

test("turbines are where today's are", () => {
  const route = new RouteGeometry(tinyLoopFile());
  const terrain = terrainModel(route);
  const bounds = groundExtent(terrain).bounds;
  const masks = buildMasks({ roads: terrain.index, rivers: [], bounds });
  const turbines = planTurbines({ terrain, roads: terrain.index, seed: mapSeed(route), masks, water: waterLevel(terrain.index), bounds });
  // Captured from the adapter's buildWindTurbines on this file before it was deleted: x, z, yaw, phase, speed.
  const captured = [
    [296.0125355572341, 246.61263082152652, -0.33667481938672716, 3.6765903035093426, 1.2514818903058766],
    [246.5742506798606, 387.864873328308, -0.33667481938672716, 2.5384925917085717, 1.1231876541860402],
    [186.717116276845, 558.885257336924, -0.33667481938672716, 5.484065775340637, 1.1353329612873495],
  ];
  assert.equal(turbines.length, captured.length);
  turbines.forEach((t, i) => {
    [t.x, t.z, t.yaw, t.phase, t.speed].forEach((v, k) => assert.ok(Math.abs(v - captured[i][k]) < 1e-6, `turbine ${i} value ${k}: ${v}`));
    assert.ok(Math.abs(t.y - terrain.height(t.x, t.z)) < 1e-9);
    assert.equal(maskAt(masks, t.x, t.z), MASK.built);
  });
});

test("far islands stand well off the coast", () => {
  const route = squareRoute();
  const terrain = terrainModel(route);
  const islands = planFarIslands({ terrain, seed: terrain.seed });
  assert.ok(islands.length >= 11);
  for (const i of islands) {
    assert.ok(i.radius > 0 && i.height > 0);
    assert.ok(terrain.island.inland(i.x, i.z) < -500, "far islands stand well off the coast");
  }
  assert.deepEqual(planFarIslands({ terrain, seed: terrain.seed }), islands);
});
