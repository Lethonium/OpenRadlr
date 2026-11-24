/** Fauna plan (`world/plan/fauna.js`): herds, wild animals, flocks, butterflies and dolphins as data. */
import assert from "node:assert/strict";
import test from "node:test";
import { CREATURES } from "../public/js/view3d/assets/creatures/index.js";
import { waterLevel } from "../public/js/world/roads.js";
import { FAUNA_BUDGET, planFauna } from "../public/js/world/plan/fauna.js";
import { MASK, maskAt } from "../public/js/world/plan/masks.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const world = valleyWorld();
const water = waterLevel(world.roads);
const plans = new Map();
const planFor = (season, detail = "high") => {
  const key = `${season}/${detail}`;
  if (!plans.has(key)) plans.set(key, planOf(world, { season, detail }));
  return plans.get(key);
};
const faunaOf = (plan, season, detail = "high") => planFauna({ ...world, ...plan, water, season, detail });
const count = (f) => f.herds.length + f.wild.length + f.flocks.length + f.butterflies.length + f.dolphins.length;
const landed = (plan) => {
  const f = faunaOf(plan, "summer");
  return [...f.herds, ...f.wild, ...f.flocks, ...f.butterflies];
};

test("no animal stands on a road, in a river or in the sea", () => {
  const plan = planFor("summer");
  const f = faunaOf(plan, "summer");
  assert.ok(f.herds.length > 0 && f.wild.length > 0 && f.dolphins.length > 0, "something planned of each");
  for (const a of landed(plan)) {
    const m = maskAt(plan.masks, a.x, a.z);
    assert.ok(m !== MASK.road && m !== MASK.river, `mask ${m} at ${a.x},${a.z}`);
    assert.ok(world.terrain.height(a.x, a.z) > water, `dry at ${a.x},${a.z}`);
  }
  for (const d of f.dolphins) assert.ok(world.terrain.height(d.x, d.z) < water, "dolphins swim");
});

test("every plan names creatures that exist", () => {
  const f = faunaOf(planFor("summer"), "summer");
  for (const a of [...f.herds, ...f.wild]) assert.ok(CREATURES[a.kind], a.kind);
});

test("butterflies stay home in winter", () => {
  assert.equal(faunaOf(planFor("winter"), "winter").butterflies.length, 0);
  const summer = faunaOf(planFor("summer"), "summer");
  assert.ok(summer.butterflies.length > 0);
  const plan = planFor("summer");
  for (const b of summer.butterflies) assert.equal(maskAt(plan.masks, b.x, b.z), MASK.verge);
});

test("every paddock has a herd and every yard chickens; pigs wait out the winter", () => {
  const plan = { ...planFor("summer"), farms: planFor("summer").farms.slice(0, 8) }; // the herd budget serves the first farms
  const f = faunaOf(plan, "summer");
  const paddocks = plan.farms.filter((farm) => farm.paddock);
  assert.ok(paddocks.length > 0);
  for (const { paddock } of paddocks) {
    const herd = f.herds.find((h) => ["cow", "sheep", "horse"].includes(h.kind) && Math.hypot(h.x - paddock.x, h.z - paddock.z) < 1);
    assert.ok(herd, "paddock herd");
    assert.equal(herd.count, { cow: 6, sheep: 9, horse: 4 }[herd.kind]);
  }
  for (const farm of plan.farms) assert.ok(f.herds.some((h) => h.kind === "chicken" && Math.hypot(h.x - farm.x, h.z - farm.z) < 42 && h.count >= 6 && h.count <= 9), "chickens");
  assert.ok(f.herds.some((h) => h.kind === "pig"));
  const winter = planFor("winter");
  assert.ok(!faunaOf({ ...winter, farms: winter.farms.slice(0, 8) }, "winter").herds.some((h) => h.kind === "pig"));
});

test("wild deer and foxes keep 40 m from the road", () => {
  const f = faunaOf(planFor("summer"), "summer");
  for (const a of f.wild.filter((w) => w.kind === "deer" || w.kind === "fox")) assert.ok((world.roads.nearest(a.x, a.z, 2)?.distance ?? Infinity) >= 40);
});

test("each level stays in its budget and low plans fewer than medium", () => {
  const sizes = {};
  for (const detail of ["low", "medium", "high", "ultra"]) {
    const f = faunaOf(planFor("summer", detail), "summer", detail);
    const b = FAUNA_BUDGET[detail];
    assert.ok(f.herds.length <= b.herds && f.wild.length <= b.wild && f.flocks.length <= b.flocks, detail);
    assert.ok(f.butterflies.length <= b.butterflies && f.dolphins.length <= b.dolphins, detail);
    sizes[detail] = count(f);
  }
  assert.ok(sizes.low < sizes.medium, `${sizes.low} < ${sizes.medium}`);
  assert.ok(Object.isFrozen(FAUNA_BUDGET));
});

test("the fauna plan is deterministic", () => {
  const plan = planFor("summer");
  assert.deepEqual(faunaOf(plan, "summer"), faunaOf(plan, "summer"));
});
