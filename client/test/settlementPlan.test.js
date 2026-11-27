/** `planSettlements`: map towns and route-file villages as data, stamped on the built mask. */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { RIVER } from "../public/js/world/rivers.js";
import { terrainModel, waterLevel, roadHalfWidth } from "../public/js/world/roads.js";
import { groundExtent } from "../public/js/view3d/world.js";
import { MASK, buildMasks, maskAt } from "../public/js/world/plan/masks.js";
import { SETTLEMENT_STYLE } from "../public/js/world/plan/settlements/styles.js";
import { planSettlements } from "../public/js/world/plan/settlements/plan.js";
import { tinyWorld } from "./support/planFixture.js";

let cachedTiny;
const tiny = () => (cachedTiny ??= tinyWorld());

/** `planSettlements` on a fixture world with fresh masks. */
function plan(world, settlements, routes = []) {
  const masks = buildMasks({ roads: world.roads, rivers: world.rivers, bounds: world.bounds });
  const water = waterLevel(world.roads);
  const result = planSettlements({ settlements, routes, terrain: world.terrain, roads: world.roads, regions: world.regions, seed: world.seed, masks, water });
  return { result, masks, water };
}

const riverPoint = (world) => {
  const points = world.rivers[0].points;
  const p = points[Math.floor(points.length / 2)];
  return [p.x, p.z];
};

test("every settlement's plots, streets and square are stamped built", () => {
  const world = tiny();
  const { result, masks } = plan(world, [{ id: "a", kind: "town", center: [150, 300], radius: 300, seed: 11 }]);
  const [town] = result;
  assert.ok(town.plots.length > 5, `plots ${town.plots.length}`);
  for (const p of town.plots) assert.equal(maskAt(masks, p.x, p.z), MASK.built);
  for (const street of town.streets.filter((s) => !s.existing)) {
    for (const [x, z] of street.points) assert.notEqual(maskAt(masks, x, z), MASK.free, `street ${street.id} at ${x},${z}`);
  }
  if (town.square) assert.equal(maskAt(masks, town.square.center[0], town.square.center[1]), MASK.built);
});

test("no plot lies within a road's half width plus pavement, in a river, or below water + 2", () => {
  const world = tiny();
  const center = riverPoint(world);
  const { result, water } = plan(world, [{ id: "river-town", kind: "town", center, radius: 300, seed: 3 }]);
  const [town] = result;
  assert.ok(town.plots.length > 3, `plots ${town.plots.length}`);
  for (const p of town.plots) {
    const reach = Math.hypot(p.width, p.depth) / 2;
    assert.ok(world.terrain.riverDistance(p.x, p.z) > RIVER.halfWidth, `plot ${p.x},${p.z} is in the river`);
    assert.ok(world.terrain.height(p.x, p.z) >= water + 2, `plot ${p.x},${p.z} is below water`);
    const near = world.roads.nearest(p.x, p.z, 3);
    if (near) assert.ok(near.distance > roadHalfWidth(near.sample.route.lanes) + SETTLEMENT_STYLE.town.pavement, `plot ${p.x},${p.z} is on the road (reach ${reach})`);
  }
});

test("a town founds each house on its lowest ground", () => {
  const world = tiny();
  const { result } = plan(world, [{ id: "a", kind: "town", center: [150, 300], radius: 300, seed: 11 }]);
  const [town] = result;
  assert.equal(town.ground.length, town.plots.length);
  town.plots.forEach((p, i) => assert.ok(town.ground[i] <= world.terrain.height(p.x, p.z) + 1e-4, `plot ${i}`));
});

/** A 3 km straight road with a village zone from 1000 to 1400. */
function zoneWorld() {
  const route = new RouteGeometry({ id: "zr", name: "Zone", lanes: 2, seed: 5, closed: false, markers: [], zones: [{ type: "village", from: 1000, to: 1400 }], points: [[0, 0, 30], [3000, 0, 30]] });
  const terrain = terrainModel(route);
  return { route, terrain, roads: terrain.index, rivers: [], regions: [], seed: terrain.seed, bounds: groundExtent(terrain).bounds };
}

test("a route-file village becomes a settlement on its stretch", () => {
  const world = zoneWorld();
  const { result } = plan(world, [], [world.route]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "zr:village:0");
  assert.equal(result[0].kind, "village");
  assert.ok(Math.abs(result[0].center[0] - 1200) < 5, `centre ${result[0].center}`);
  assert.equal(result[0].radius, 250);
});

test("a zone village inside a map town is dropped", () => {
  const world = zoneWorld();
  const { result } = plan(world, [{ id: "map-town", kind: "town", center: [1200, 20], radius: 300, seed: 9 }], [world.route]);
  assert.deepEqual(result.map((s) => s.id), ["map-town"]);
});

test("a town takes its region's house style", () => {
  const world = tiny();
  const { result } = plan(world, [
    { id: "olive-town", kind: "village", center: world.centers.olives, radius: 150, seed: 4 },
    { id: "meadow-town", kind: "village", center: world.centers.meadow, radius: 150, seed: 5 },
  ]);
  assert.equal(result[0].houses, "whitewashed");
  assert.equal(result[1].houses, "cottage");
});
