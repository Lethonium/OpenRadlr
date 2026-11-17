/**
 * The high country (#117): a treeline, bare rock above it, and permanent snow
 * on the peaks. The same rules are used by the world build, the ground colour
 * and the top-down map, so the three cannot disagree.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ROCK_SLOPE, SNOWLINE, TREELINE, canGrowTree, slopeAt, snowAt } from "../public/js/land/mountains.js";
import { temperate } from "../public/js/view3d/biomes/index.js";

test("snow starts at the snowline and covers the highest ground", () => {
  assert.equal(snowAt(100, 0), 0);
  assert.equal(snowAt(SNOWLINE - 20, 0), 0);
  assert.ok(snowAt(SNOWLINE + 20, 0) > 0.5);
  assert.equal(snowAt(SNOWLINE + 200, 0), 1);
  assert.equal(snowAt(SNOWLINE + 200, -Infinity), 0, "no sea level, no snow");
});

test("a tree may stand below the treeline and off the bare rock", () => {
  assert.equal(canGrowTree(TREELINE - 20, 0, 0.1), true);
  assert.equal(canGrowTree(TREELINE + 20, 0, 0.1), false);
  assert.equal(canGrowTree(100, 0, ROCK_SLOPE + 0.1), false);
  assert.equal(canGrowTree(100, -Infinity, 0.1), true, "a world without a sea keeps its trees");
});

test("slope is rise over run", () => {
  const flat = { height: () => 10 };
  const ramp = { height: (x) => x };
  assert.equal(slopeAt(flat, 0, 0), 0);
  assert.ok(Math.abs(slopeAt(ramp, 0, 0) - 1) < 1e-9);
});

test("the peak is snow-white and the lowland is not", () => {
  const spot = { x: 0, z: 0, steep: 0, seed: 1, water: 0, forest: null, field: null };
  const low = temperate.terrainColor({ ...spot, height: 20 });
  const high = temperate.terrainColor({ ...spot, height: SNOWLINE + 80 });
  const sum = (c) => c[0] + c[1] + c[2];
  assert.ok(sum(high) > sum(low) + 0.5, `snow ${sum(high)} vs low ${sum(low)}`);
  assert.ok(high.every((c) => c > 0.7), "snow is near-white");
});

test("snow wins over a wood that would otherwise be dark", () => {
  const spot = { x: 0, z: 0, steep: 0, seed: 1, water: 0, forest: 1, field: 0 };
  const peak = temperate.terrainColor({ ...spot, height: SNOWLINE + 80 });
  const low = temperate.terrainColor({ ...spot, height: 20 });
  assert.ok(peak[0] + peak[1] + peak[2] > low[0] + low[1] + low[2] + 0.5);
});
