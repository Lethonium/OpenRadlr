import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVING_KEY, fromViewChoice, livingDefault, resolveLiving, viewChoice } from "../public/js/view3d/living/setting.js";

test("the setting has one storage key", () => {
  assert.equal(LIVING_KEY, "openride.living");
});

test("off on low memory and on phones, otherwise on", () => {
  assert.equal(livingDefault({ deviceMemory: 2, coarsePointer: false, narrow: false }), false);
  assert.equal(livingDefault({ deviceMemory: 8, coarsePointer: true, narrow: true }), false);
  assert.equal(livingDefault({ deviceMemory: 8, coarsePointer: false, narrow: false }), true);
  assert.equal(livingDefault({ coarsePointer: false, narrow: false }), true, "no memory report counts as enough");
});

test("a touch laptop and a narrow desktop window still count as desktops", () => {
  assert.equal(livingDefault({ deviceMemory: 8, coarsePointer: true, narrow: false }), true);
  assert.equal(livingDefault({ deviceMemory: 8, coarsePointer: false, narrow: true }), true);
});

test("an explicit choice wins over the default", () => {
  const phone = { deviceMemory: 2, coarsePointer: true, narrow: true };
  assert.equal(resolveLiving("on", phone), true);
  assert.equal(resolveLiving("off", { deviceMemory: 16, coarsePointer: false, narrow: false }), false);
});

test("a garbage or missing value counts as unset", () => {
  const desktop = { deviceMemory: 16, coarsePointer: false, narrow: false };
  const phone = { deviceMemory: 2, coarsePointer: true, narrow: true };
  for (const saved of [null, undefined, "banana", ""]) {
    assert.equal(resolveLiving(saved, desktop), true);
    assert.equal(resolveLiving(saved, phone), false);
  }
});

test("the view choice maps both ways and 2D leaves Living alone", () => {
  assert.equal(viewChoice("3d", true), "living");
  assert.equal(viewChoice("3d", false), "3d");
  assert.equal(viewChoice("2d", true), "2d");
  assert.deepEqual(fromViewChoice("living"), { mode: "3d", living: true });
  assert.deepEqual(fromViewChoice("3d"), { mode: "3d", living: false });
  assert.deepEqual(fromViewChoice("2d"), { mode: "2d", living: null });
});
