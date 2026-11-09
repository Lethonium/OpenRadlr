import { test } from "node:test";
import assert from "node:assert/strict";
import { boxOf, fakeIsland } from "./livingFixture.js";
import { buildFields, groundGrid } from "../public/js/view3d/living/fields.js";
import { LIVING_MAX_BOX_M, livingEligible } from "../public/js/view3d/living/index.js";

function setup(options) {
  const terrain = fakeIsland(options);
  const grid = groundGrid(terrain, boxOf(terrain));
  return { terrain, grid, fields: buildFields(terrain, grid, { seed: terrain.seed, sea: 0, villages: () => false }) };
}

/** Points on a regular lattice over the island's land. */
function* lattice(step, radius = 1400) {
  for (let x = -radius; x <= radius; x += step) for (let z = -radius; z <= radius; z += step) yield [x, z];
}

function farmParcels(fields) {
  const parcels = new Map();
  for (const [x, z] of lattice(30)) {
    if (fields.landAt(x, z) !== "farm") continue;
    const parcel = fields.parcelAt(x, z);
    if (parcel) parcels.set(parcel.id, parcel);
  }
  return [...parcels.values()];
}

test("every point of a parcel has that parcel's crop", () => {
  const { fields } = setup();
  const crops = new Map();
  for (const [x, z] of lattice(29)) {
    const parcel = fields.parcelAt(x, z);
    if (!parcel) continue;
    if (crops.has(parcel.id)) assert.equal(parcel.crop, crops.get(parcel.id));
    else crops.set(parcel.id, parcel.crop);
  }
  assert.ok(crops.size > 40, `${crops.size} parcels`);
});

test("parcels are 80 to 200 m across", () => {
  const { fields } = setup();
  for (const parcel of farmParcels(fields)) {
    assert.ok(parcel.width >= 80 && parcel.width <= 200, `width ${parcel.width}`);
    assert.ok(parcel.depth >= 80 && parcel.depth <= 200, `depth ${parcel.depth}`);
  }
});

test("crops are varied and none dominates", () => {
  const { fields } = setup();
  const counts = new Map();
  const parcels = farmParcels(fields);
  for (const { crop } of parcels) counts.set(crop, (counts.get(crop) ?? 0) + 1);
  assert.ok(counts.size >= 5, [...counts.keys()].join());
  assert.ok(Math.max(...counts.values()) / parcels.length <= 0.35, JSON.stringify([...counts]));
});

test("neighbouring parcels usually differ", () => {
  const { fields } = setup();
  let crossings = 0;
  let changes = 0;
  for (const { a, b } of fields.edges()) {
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    const one = fields.parcelAt(mx + nx * 3, mz + nz * 3);
    const two = fields.parcelAt(mx - nx * 3, mz - nz * 3);
    if (!one || !two) continue;
    crossings += 1;
    if (one.crop !== two.crop) changes += 1;
  }
  assert.ok(crossings > 50, `${crossings} crossings`);
  assert.ok(changes / crossings >= 0.6, `${changes}/${crossings}`);
});

test("parcel edges are straight, with a different parcel on either side", () => {
  const { fields } = setup();
  let checked = 0;
  for (const { a, b } of fields.edges()) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 30) continue;
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    for (const t of [0.25, 0.5, 0.75]) {
      const mx = a[0] + (b[0] - a[0]) * t;
      const mz = a[1] + (b[1] - a[1]) * t;
      const one = fields.parcelAt(mx + nx * 1.5, mz + nz * 1.5);
      const two = fields.parcelAt(mx - nx * 1.5, mz - nz * 1.5);
      if (!one || !two) continue;
      assert.notEqual(one.id, two.id, `edge at ${mx}, ${mz}`);
      checked += 1;
    }
  }
  assert.ok(checked > 50, `${checked} edge points`);
});

test("land classes follow height and slope", () => {
  // Bands of constant height along x, and a steep ramp at the far end.
  const height = (x) => {
    if (x < -1200) return -5;
    if (x < -800) return 1;
    if (x < -400) return 30;
    if (x < 0) return 80;
    if (x < 400) return 120;
    if (x < 800) return 300;
    return 300 + (x - 800);
  };
  const { fields } = setup({ height });
  const at = (x) => fields.landAt(x, 300);
  assert.equal(at(-1350), "sea");
  assert.equal(at(-1000), "sand");
  assert.equal(at(-600), "farm");
  assert.equal(at(-200), "rough");
  assert.equal(at(200), "moor");
  assert.equal(at(600), "scree");
  assert.equal(at(1200), "rock");
});

test("beside a river the land is river meadow, without crops", () => {
  const { fields } = setup({ riverDistance: (x) => Math.abs(x - 300) });
  assert.equal(fields.landAt(300, 400), "river");
  assert.equal(fields.parcelAt(300, 400), null);
  assert.equal(fields.landAt(900, 400), "farm");
});

test("village land is its own class", () => {
  const terrain = fakeIsland();
  const grid = groundGrid(terrain, boxOf(terrain));
  const fields = buildFields(terrain, grid, { seed: 7, sea: 0, villages: (x, z) => Math.hypot(x - 300, z - 300) < 150 });
  assert.equal(fields.landAt(300, 300), "village");
  assert.equal(fields.parcelAt(300, 300).crop, "garden");
});

test("parcels follow the road they are near", () => {
  const { fields } = setup();
  for (const [x, z] of [[100, 200], [-300, -250]]) {
    const { angle } = fields.parcelAt(x, z);
    assert.ok(Math.abs(Math.sin(angle)) < 0.01, `angle ${angle} along the x road`);
  }
});

test("woods are dark only where the map says, and every wood point is land", () => {
  const { fields } = setup({ height: () => 80 });
  let wooded = 0;
  for (const [x, z] of lattice(50)) {
    const wood = fields.woodAt(x, z);
    assert.ok(wood >= 0 && wood <= 1);
    if (wood > 0) wooded += 1;
  }
  assert.ok(wooded > 0, "some rough ground is wooded");
});

test("the same seed gives the same fields", () => {
  const sample = () => {
    const { fields } = setup();
    return [...lattice(70)].map(([x, z]) => [fields.landAt(x, z), fields.parcelAt(x, z), fields.woodAt(x, z)]);
  };
  assert.deepEqual(sample(), sample());
});

test("eligible only with a hook, a network and a small enough box", () => {
  const box = { x0: 0, z0: 0, x1: 13000, z1: 12000 };
  const biome = { living: {} };
  assert.equal(livingEligible({ biome, network: {}, box }), true);
  assert.equal(livingEligible({ biome: {}, network: {}, box }), false);
  assert.equal(livingEligible({ biome, network: null, box }), false);
  assert.equal(livingEligible({ biome, network: {}, box: { x0: 0, z0: 0, x1: LIVING_MAX_BOX_M + 1, z1: 100 } }), false);
  assert.equal(livingEligible({ biome, network: {}, box: { x0: 0, z0: 0, x1: LIVING_MAX_BOX_M, z1: LIVING_MAX_BOX_M } }), true);
});
