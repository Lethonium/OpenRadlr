import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMasks, clearAt, maskAt } from "../public/js/world/plan/masks.js";
import { PLAN_BUDGET } from "../public/js/world/plan/index.js";
import { REGION_STYLE } from "../public/js/world/regionKinds.js";
import { regionMix } from "../public/js/world/regions.js";
import { RIVER } from "../public/js/world/rivers.js";
import { VERGE, roadHalfWidth } from "../public/js/world/roads.js";
import { SEASONS } from "../public/js/world/seasons.js";
import { sceneOf, transferList, buildSceneNow } from "../public/js/view3d/worldScene.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";
import { longWorld, planOf, tinyWorld } from "./support/planFixture.js";

const tiny = tinyWorld();
let longCache = null;
const long = () => (longCache ??= longWorld());
const LEVELS = ["low", "medium", "high", "ultra"];

/** Every item of a `{[plantId]: Float32Array}` map as `{id, x, y, z}`; trees and verge items have 5 floats each. */
function* itemsOf(byPlant) {
  for (const [id, data] of Object.entries(byPlant)) {
    for (let i = 0; i < data.length; i += 5) yield { id, x: data[i], y: data[i + 1], z: data[i + 2] };
  }
}
const count = (byPlant) => Object.values(byPlant).reduce((n, data) => n + data.length / 5, 0);

function assertClear(world, plan, label) {
  const { terrain } = world;
  for (const list of [itemsOf(plan.trees), itemsOf(plan.roadside)]) {
    for (const { id, x, z } of list) {
      const near = terrain.index.nearest(x, z, 2);
      if (near) assert.ok(near.distance >= roadHalfWidth(near.sample.route.lanes) + VERGE + 1, `${label} ${id} on a road at ${x},${z}`);
      assert.ok((terrain.riverDistance?.(x, z) ?? Infinity) >= RIVER.halfWidth + 2, `${label} ${id} in a river at ${x},${z}`);
    }
  }
  for (const field of plan.fields) {
    for (let k = 0; k < 4; k += 1) {
      const [x, z] = [field.corners[k * 3], field.corners[k * 3 + 2]];
      const near = terrain.index.nearest(x, z, 2);
      if (near) assert.ok(near.distance >= roadHalfWidth(near.sample.route.lanes) + VERGE + 1, `${label} field corner on a road at ${x},${z}`);
    }
  }
}

test("masks mark roads and rivers and leave the rest free", () => {
  const masks = buildMasks({ roads: tiny.roads, rivers: tiny.rivers, bounds: tiny.bounds });
  const onRoad = tiny.roads.samples[10];
  assert.equal(maskAt(masks, onRoad.x, onRoad.z), 1);
  assert.equal(clearAt(masks, onRoad.x, onRoad.z), false);
  const inside = (p) => p.x > tiny.bounds.x0 && p.x < tiny.bounds.x1 && p.z > tiny.bounds.z0 && p.z < tiny.bounds.z1;
  const inRiver = tiny.rivers[0].points.find((p) => inside(p) && (tiny.roads.nearest(p.x, p.z, 2)?.distance ?? 99) > 60);
  assert.ok(inRiver, "a river point away from the road");
  assert.equal(maskAt(masks, inRiver.x, inRiver.z), 2);
  assert.equal(clearAt(masks, tiny.bounds.x0 + 1, tiny.bounds.z0 + 1), true);
  assert.equal(clearAt(masks, tiny.bounds.x0 - 500, 0), false, "outside the box is not free");
});

test("masks stay under their cell budget on a huge island", () => {
  const { masks } = planOf(long());
  assert.ok(masks.columns * masks.rows <= 6_000_000);
  assert.equal(masks.data.length, masks.columns * masks.rows);
});

test("nothing grows on roads or rivers", () => {
  const plan = planOf(tiny);
  assert.ok(count(plan.trees) > 500, `${count(plan.trees)} trees`);
  assert.ok(count(plan.roadside) > 100, `${count(plan.roadside)} roadside items`);
  assertClear(tiny, plan, "tiny");
  assert.ok(plan.fields.length > 0, "the fixture has fields");
});

test("nothing grows on roads in the long route either", () => {
  const world = long();
  assertClear(world, planOf(world), "long");
});

test("the plan is deterministic", () => {
  assert.deepEqual(planOf(tiny), planOf(tiny));
});

test("an oliveTerraces region grows olives", () => {
  const plan = planOf(tiny);
  const [cx, cz] = tiny.centers.olives;
  const near = [...itemsOf(plan.trees)].filter(({ x, z }) => Math.hypot(x - cx, z - cz) < 150);
  assert.ok(near.length > 40, `${near.length} trees`);
  assert.ok(near.filter((t) => t.id === "olive").length / near.length >= 0.6);
});

test("a deepWood is at least three times as dense as meadow", () => {
  const plan = planOf(tiny);
  const around = ([cx, cz]) => [...itemsOf(plan.trees)].filter(({ x, z }) => Math.hypot(x - cx, z - cz) < 150).length;
  const meadow = around(tiny.centers.meadow);
  assert.ok(meadow > 20, `${meadow} meadow trees`);
  assert.ok(around(tiny.centers.wood) >= 3 * meadow, `${around(tiny.centers.wood)} vs ${meadow}`);
});

test("roadside items stay near a road", () => {
  for (const world of [tiny, long()]) {
    const plan = planOf(world);
    for (const { id, x, z } of itemsOf(plan.roadside)) {
      const near = world.terrain.index.nearest(x, z, 2);
      assert.ok(near && near.distance <= 25, `${id} ${near?.distance} m from a road`);
    }
  }
});

test("every level stays inside its budget", () => {
  for (const world of [tiny, long()]) {
    for (const level of LEVELS) {
      const plan = planOf(world, { detail: level });
      assert.ok(count(plan.trees) <= PLAN_BUDGET[level].trees, `${level} trees ${count(plan.trees)}`);
      assert.ok(count(plan.roadside) <= PLAN_BUDGET[level].roadside, `${level} roadside ${count(plan.roadside)}`);
    }
  }
});

test("a higher level plans more on a big island", () => {
  const world = long();
  const counts = LEVELS.map((detail) => {
    const plan = planOf(world, { detail });
    return [count(plan.trees), count(plan.roadside)];
  });
  for (let i = 1; i < LEVELS.length; i += 1) {
    assert.ok(counts[i][0] > counts[i - 1][0], `trees ${counts.map((c) => c[0])}`);
    assert.ok(counts[i][1] > counts[i - 1][1], `roadside ${counts.map((c) => c[1])}`);
  }
});

test("the budgets are frozen and grow with the level", () => {
  assert.ok(Object.isFrozen(PLAN_BUDGET));
  for (const key of ["trees", "roadside"]) {
    for (let i = 1; i < LEVELS.length; i += 1) assert.ok(PLAN_BUDGET[LEVELS[i]][key] > PLAN_BUDGET[LEVELS[i - 1]][key]);
  }
  assert.throws(() => planOf(tiny, { detail: "nope" }), /detail/);
});

test("seasons change crops, not positions", () => {
  const plans = SEASONS.map((season) => [season, planOf(tiny, { season })]);
  for (const [, plan] of plans) {
    assert.deepEqual(plan.trees, plans[0][1].trees);
    assert.deepEqual(plan.roadside, plans[0][1].roadside);
    assert.deepEqual(plan.fields.map((f) => [f.x, f.z, f.width, f.depth, f.yaw]), plans[0][1].fields.map((f) => [f.x, f.z, f.width, f.depth, f.yaw]));
  }
  for (const [season, plan] of plans) {
    for (const field of plan.fields) {
      const [top] = regionMix(field.x, field.z, tiny.regions, tiny.seed);
      assert.ok(REGION_STYLE[top.kind].crops[season].includes(field.crop), `${field.crop} in ${season} on ${top.kind}`);
    }
  }
});

test("fields are marked on the mask and keep off roads", () => {
  const plan = planOf(tiny);
  const [field] = plan.fields;
  assert.equal(maskAt(plan.masks, field.x, field.z), 3);
  assert.equal(field.corners.length, 12);
});

test("a route file without a network gets a plan", () => {
  const scene = buildSceneNow(JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url))));
  assert.ok(count(scene.plan.trees) > 100);
  assert.ok(count(scene.plan.roadside) > 50);
  assert.deepEqual(Object.keys(scene.plan).sort(), ["fields", "masks", "roadside", "trees"]);
});

test("the plan transfers", () => {
  const scene = sceneOf({ ...buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()) });
  const buffers = transferList(scene);
  const wanted = [scene.plan.masks.data, ...Object.values(scene.plan.trees), ...Object.values(scene.plan.roadside), ...scene.plan.fields.map((f) => f.corners)];
  assert.ok(wanted.length > 5);
  for (const array of wanted) assert.ok(buffers.includes(array.buffer));
});
