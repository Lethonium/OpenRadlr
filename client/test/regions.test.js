import { test } from "node:test";
import assert from "node:assert/strict";
import { REGION_KIND, regionAt } from "../public/js/land/regions.js";

const regions = [
  { id: "a", kind: REGION_KIND.pineCoast, center: [0, 0], radius: 1000 },
  { id: "b", kind: REGION_KIND.farmBelt, center: [1500, 0], radius: 1000 },
];
const SEED = 2026;

test("a region has full weight at its centre", () => {
  assert.deepEqual(regionAt(0, 0, regions.slice(0, 1), SEED), [{ kind: "pineCoast", weight: 1 }]);
});

test("far from every region nothing is returned", () => {
  assert.deepEqual(regionAt(0, 3000, regions.slice(0, 1), SEED), []);
});

test("the edge blends: somewhere on the radius the weight is between 0 and 1", () => {
  const weights = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return regionAt(Math.cos(a) * 1000, Math.sin(a) * 1000, regions.slice(0, 1), SEED)[0]?.weight ?? 0;
  });
  assert.ok(weights.some((w) => w > 0 && w < 1));
});

test("the edge wanders: equal radius, different angles, different weights", () => {
  const at = (a) => regionAt(Math.cos(a) * 1000, Math.sin(a) * 1000, regions.slice(0, 1), SEED)[0]?.weight ?? 0;
  const set = new Set([0, 1, 2, 3, 4, 5].map(at));
  assert.ok(set.size > 1);
});

test("the same inputs give the same answer", () => {
  assert.deepEqual(regionAt(900, 100, regions, SEED), regionAt(900, 100, regions, SEED));
});

test("overlapping regions are both returned, strongest first", () => {
  const found = regionAt(900, 0, regions, SEED);
  assert.deepEqual(found.map((r) => r.kind).sort(), ["farmBelt", "pineCoast"]);
  assert.ok(found[0].weight >= found[1].weight);
  assert.equal(found[0].kind, "farmBelt");
});
