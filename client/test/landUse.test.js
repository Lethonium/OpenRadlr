import test from "node:test";
import assert from "node:assert/strict";
import { COAST_BAND, LAND_KINDS } from "../public/js/world/landKinds.js";
import { MASK, buildMasks, maskAt, stampDisc } from "../public/js/world/plan/masks.js";
import { planLandUse } from "../public/js/world/plan/landUse.js";
import { planSettlements } from "../public/js/world/plan/settlements/plan.js";
import { waterLevel } from "../public/js/world/roads.js";
import { sceneOf } from "../public/js/view3d/worldScene.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const valley = valleyWorld();

/** The valley's inputs to `planLandUse`, with its settlements planned on fresh masks. */
function valleyInput(overrides = {}) {
  const { terrain, roads, rivers, regions, bounds, routes, settlements, seed } = valley;
  const water = waterLevel(roads);
  const masks = buildMasks({ roads, rivers, bounds });
  const villages = planSettlements({ settlements, routes, terrain, roads, regions, seed, masks, water });
  return { terrain, roads, regions, settlements: villages, seed, season: "summer", masks, water, bounds, ...overrides };
}

/** A flat island at height 30 over the sea at 0, with no road: the least a map can have. */
function bareInput(half, overrides = {}) {
  const roads = { samples: [], nearest: () => null };
  const bounds = { x0: -half, z0: -half, x1: half, z1: half };
  const masks = buildMasks({ roads, rivers: [], bounds });
  return { terrain: { height: () => 30 }, roads, regions: [], settlements: [], seed: 5, season: "summer", masks, water: 0, bounds, ...overrides };
}

/** World points of a parcel: its corners and a grid across it. */
function* pointsOf(p) {
  const [c, s] = [Math.cos(p.yaw), Math.sin(p.yaw)];
  for (let k = 0; k < 4; k += 1) yield [p.corners[k * 3], p.corners[k * 3 + 2]];
  for (const u of [-0.5, 0, 0.5]) for (const v of [-0.5, 0, 0.5]) yield [p.x + u * p.width * c - v * p.depth * s, p.z + u * p.width * s + v * p.depth * c];
}

const valleyPlan = planLandUse(valleyInput());

test("parcels lie away from the roads too", () => {
  const arable = valleyPlan.parcels.filter((p) => p.kind === "arable");
  assert.ok(arable.length > 20, `only ${arable.length} arable parcels`);
  const far = arable.filter((p) => (valley.roads.nearest(p.x, p.z, 6)?.distance ?? Infinity) > 300).length;
  assert.ok(far / arable.length >= 0.4, `only ${far} of ${arable.length} arable parcels are far from the roads`);
});

test("the coast is not ploughed", () => {
  const farm = valleyPlan.parcels.filter((p) => ["arable", "orchard", "vineyard"].includes(p.kind));
  assert.ok(farm.length > 0);
  const { terrain } = valley;
  const water = waterLevel(valley.roads);
  for (const p of farm) {
    for (let a = 0; a < 16; a += 1) {
      const angle = (a / 16) * Math.PI * 2;
      for (let r = 20; r < COAST_BAND - 30; r += 60) {
        assert.ok(terrain.height(p.x + Math.cos(angle) * r, p.z + Math.sin(angle) * r) >= water, `${p.kind} at ${p.x},${p.z} has the sea within ${r} m`);
      }
    }
  }
});

test("no parcel on a road, river, built ground or the sea", () => {
  const input = valleyInput();
  stampDisc(input.masks, input.bounds.x0 + 2000, input.bounds.z0 + 2000, 300, MASK.built);
  const before = { ...input.masks, data: Uint8Array.from(input.masks.data) };
  const { parcels } = planLandUse(input);
  assert.ok(parcels.length > 0);
  for (const p of parcels) {
    for (const [x, z] of pointsOf(p)) assert.equal(maskAt(before, x, z), MASK.free, `${p.kind} at ${x},${z} on mask ${maskAt(before, x, z)}`);
    for (let k = 0; k < 4; k += 1) assert.ok(p.corners[k * 3 + 1] >= input.water + 1, `${p.kind} corner in the sea`);
    assert.ok(p.corners instanceof Float32Array && p.corners.length === 12);
    assert.ok(LAND_KINDS.includes(p.kind));
    assert.ok(["wall", "hedge", "none"].includes(p.edge));
    assert.ok(p.tint >= -1 && p.tint <= 1);
    assert.equal(p.kind === "arable", typeof p.crop === "string");
  }
});

test("the same seed plans the same land", () => {
  assert.deepEqual(planLandUse(valleyInput()), valleyPlan);
  assert.notDeepEqual(planLandUse(valleyInput({ seed: valley.seed + 1 })).parcels, valleyPlan.parcels);
});

test("a bare map still gets land use", () => {
  const { parcels } = planLandUse(bareInput(1500));
  assert.ok(parcels.length > 0);
});

test("a huge island plans in time", () => {
  const input = bareInput(15000);
  const start = performance.now();
  const { parcels } = planLandUse(input);
  const took = performance.now() - start;
  assert.ok(parcels.length > 0);
  assert.ok(took < 5000, `took ${Math.round(took)} ms`);
});

test("fields come from the arable parcels near roads", () => {
  const plan = planOf(valley);
  const arable = plan.landUse.parcels.filter((p) => p.kind === "arable");
  assert.ok(plan.fields.length > 0);
  for (const f of plan.fields) {
    const parcel = arable.find((p) => p.x === f.x && p.z === f.z && p.width === f.width && p.depth === f.depth && p.yaw === f.yaw && p.crop === f.crop);
    assert.ok(parcel, `field at ${f.x},${f.z} is no arable parcel`);
    const near = valley.roads.nearest(f.x, f.z, 5);
    assert.ok(near && near.distance <= 260, "field within 260 m of a road");
  }
});

test("the plan hands the land use to the page", () => {
  const scene = sceneOf({ plan: planOf(valley) });
  assert.ok(scene.plan.landUse.parcels.length > 0);
});
