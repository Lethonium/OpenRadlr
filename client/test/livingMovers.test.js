import { test } from "node:test";
import assert from "node:assert/strict";
import { boxOf, fakeIsland } from "./livingFixture.js";
import { Occupancy } from "../public/js/view3d/features.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { seededRandom } from "../public/js/view3d/noise.js";
import { temperate } from "../public/js/view3d/biomes/temperate.js";
import { VERGE, roadHalfWidth } from "../public/js/view3d/world.js";
import { buildFields, groundGrid } from "../public/js/view3d/living/fields.js";
import { BIRD_FLOCKS, buildMovers, moverPose, selectMovers } from "../public/js/view3d/living/movers.js";

/** One village on the road and three penned animals; beach at the rim. */
function context({ animals = [] } = {}) {
  const terrain = fakeIsland({ radius: 2400 });
  const box = boxOf(terrain);
  const grid = groundGrid(terrain, box);
  const fields = buildFields(terrain, grid, { seed: terrain.seed, sea: 0, villages: (x, z) => Math.hypot(x - 300, z) < 200 });
  const village = { from: 2600, to: 3000 };
  const route = terrain.route;
  const zonesOf = new Map([[route, { villages: [village], forests: [], rivers: [], cliffs: [] }]]);
  const keepClear = (x, z, r = 0) => Math.abs(z) < roadHalfWidth(2) + VERGE + r + 1;
  return { mesh: new MeshBuilder(), cafes: [], fields, grid, terrain, occupancy: new Occupancy(), keepClear, landClear: keepClear, random: seededRandom(5), biome: temperate, zonesOf, ordered: [route], water: 0, box, seed: terrain.seed, animals };
}

const built = buildMovers(context({ animals: [{ x: 500, y: 40, z: 700, yaw: 1, kind: "animal1" }, { x: 900, y: 40, z: 800, yaw: 2, kind: "animal2" }, { x: 1000, y: 40, z: -600, yaw: 0, kind: "animal3" }] }));
const kind = (name) => built.movers.filter((m) => m.kind === name);
const samples = (mover, count = 500, span = 4000) => Array.from({ length: count }, (_, i) => moverPose(mover, (i * span) / count));

test("a tractor never leaves its parcel", () => {
  const { fields } = context();
  const tractors = kind("tractor");
  assert.equal(tractors.length, 8);
  for (const tractor of tractors) {
    const ids = new Set(samples(tractor).map(({ position: [x, , z] }) => fields.parcelAt(x, z)?.id));
    assert.equal(ids.size, 1, `tractor crossed parcels: ${[...ids]}`);
    assert.ok(!ids.has(undefined));
  }
});

test("a tractor goes up and down its parcel", () => {
  const tractor = kind("tractor")[0];
  const xs = samples(tractor).map((p) => p.position[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 20);
});

test("villagers stay on the pavement and never reach the road", () => {
  const { terrain } = context();
  const walkers = kind("walker");
  assert.ok(walkers.length >= 6 && walkers.length <= 10, `${walkers.length}`);
  for (const walker of walkers) {
    for (const { position: [x, , z] } of samples(walker, 200)) {
      const d = terrain.distanceToRoad(x, z);
      assert.ok(d > roadHalfWidth(2) + VERGE && d < roadHalfWidth(2) + VERGE + 3, `distance ${d}`);
    }
  }
});

test("boats stay at sea", () => {
  const { terrain } = context();
  const boats = kind("boat");
  assert.equal(boats.length, 10);
  for (const boat of boats) for (const { position: [x, , z] } of samples(boat, 120)) assert.ok(terrain.height(x, z) < 0);
});

test("balloons stay well above the ground", () => {
  const { terrain } = context();
  const balloons = kind("balloon");
  assert.ok(balloons.length >= 3 && balloons.length <= 5);
  for (const balloon of balloons) for (const { position: [x, y, z] } of samples(balloon, 120)) assert.ok(y - terrain.height(x, z) >= 150);
});

test("no mover enters a road", () => {
  const { terrain } = context();
  const clear = roadHalfWidth(2) + VERGE;
  for (const name of ["tractor", "animal", "walker"]) {
    for (const mover of kind(name)) {
      for (const { position: [x, , z] } of samples(mover, 200)) assert.ok(terrain.distanceToRoad(x, z) > clear, `${name} at ${x}, ${z}`);
    }
  }
});

test("a pose is continuous across the path's wrap", () => {
  const epsilon = 1e-3;
  for (const mover of built.movers) {
    for (const t of [0, 86_400, 123_456.78]) {
      const a = moverPose(mover, t - epsilon).position;
      const b = moverPose(mover, t + epsilon).position;
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.2, `${mover.kind} at ${t}`);
    }
  }
});

test("a turn doesn't snap the heading", () => {
  const tractor = kind("tractor")[0];
  let previous = moverPose(tractor, 0).yaw;
  for (let t = 0.1; t < 2000; t += 0.1) {
    const { yaw } = moverPose(tractor, t);
    const turn = Math.abs(((yaw - previous + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    assert.ok(turn < 0.8, `jumped ${turn} at ${t}`);
    previous = yaw;
  }
});

test("a pose is a pure function of time", () => {
  const mover = kind("boat")[0];
  assert.deepEqual(moverPose(mover, 42.5), moverPose(mover, 42.5));
});

test("selectMovers caps at 150, nearest first, balloons always", () => {
  const mover = (kind, x) => ({ kind, model: kind, path: { type: "circle", center: [x, 0], radius: 1, height: 0 }, speed: 1, phase: 0, scale: 1, tint: null });
  const movers = [...Array.from({ length: 400 }, (_, i) => mover("bird", i + 10)), mover("balloon", 9000)];
  const picked = selectMovers(movers, [0, 0, 0], 150);
  assert.equal(picked.length, 150);
  assert.ok(picked.some((m) => m.kind === "balloon"), "the far balloon is kept");
  const birds = picked.filter((m) => m.kind === "bird");
  assert.deepEqual(birds.map((m) => m.path.center[0]), Array.from({ length: 149 }, (_, i) => i + 10));
});

test("counts follow the design", () => {
  const flocks = new Set(built.movers.filter((m) => m.flock !== undefined).map((m) => m.flock));
  assert.equal(flocks.size, BIRD_FLOCKS);
  assert.equal(BIRD_FLOCKS, 12);
});

test("about a third of the herd comes from the farms' moving animals", () => {
  assert.equal(kind("animal").length, 3);
});

test("every mover's model is built with two poses", () => {
  for (const { model } of built.movers) assert.equal(built.models[model]?.length, 2, model);
});

test("the same seed gives the same movers", () => {
  const animals = [{ x: 500, y: 40, z: 700, yaw: 1, kind: "animal1" }];
  assert.deepEqual(buildMovers(context({ animals })).movers, buildMovers(context({ animals })).movers);
});

/** The mean z of a model's vertices that `pick` accepts. */
function meanZ(mesh, pick) {
  const zs = [];
  for (let i = 0; i < mesh.vertexCount; i += 1) if (pick(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2])) zs.push(mesh.positions[i * 3 + 2]);
  return zs.reduce((sum, z) => sum + z, 0) / zs.length;
}

test("a tractor drives forwards: its cab sits behind the middle, away from −Z", () => {
  assert.ok(meanZ(built.models.tractor[0], (x, y) => y > 2.4) > 0);
});

test("a bird flies beak first, towards −Z", () => {
  const bird = built.models.bird[0];
  assert.ok(Math.abs(Math.min(...Array.from({ length: bird.vertexCount }, (_, i) => bird.positions[i * 3 + 2]))) > 0.25);
});
