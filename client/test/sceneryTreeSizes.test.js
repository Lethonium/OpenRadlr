/**
 * Where a tree is, decides how tall it grows (#117): a few giants stand only
 * in the deep wood, and the trees in and beside a settlement are short enough
 * to sit among 6-9 m houses.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { buildScenery, townTreeScale } from "../public/js/view3d/world.js";

const ROUTE = new RouteGeometry({ id: "t", name: "T", points: [[0, 0], [500, 0]], lanes: 2, markers: [], zones: {}, closed: false, seed: 5 });
const BOUNDS = { x0: -400, z0: -400, x1: 400, z1: 400 };
const TERRAIN = { height: () => 0, distanceToRoad: () => 1000, index: { nearest: () => null }, water: -50 };

/** A land whose wood deepens towards +x, so one world has both thin and deep woods. */
const LAND = { forestAt: (x) => Math.min(1, Math.max(0, (x + 400) / 800)), fieldAt: () => 0 };

/** Every tree drawn, with the scale the flora was asked for. */
function drawn(options) {
  const trees = [];
  const flora = { tree: ({ x, z, kind, scale }) => trees.push({ x, z, kind, scale }), tuft() {}, flower() {} };
  buildScenery(ROUTE, TERRAIN, BOUNDS, { count: 600, water: -50, flora, land: LAND, ...options });
  return trees;
}

test("giants stand only where the wood is deep", () => {
  const trees = drawn({});
  const giants = trees.filter((t) => t.scale > 1);
  assert.ok(giants.length > 0, "the deep wood grows some giants");
  for (const g of giants) {
    assert.equal(g.scale, 1.4);
    assert.ok(LAND.forestAt(g.x) >= 0.75, `a giant at forest ${LAND.forestAt(g.x).toFixed(2)}`);
  }
  const deep = trees.filter((t) => LAND.forestAt(t.x) >= 0.75 && t.kind >= 0.28);
  const share = giants.length / deep.length;
  assert.ok(share > 0.08 && share < 0.25, `${(share * 100).toFixed(0)}% of the deep wood is giants`);
});

test("the same wood grows the same giants, so the far copy matches the near one", () => {
  assert.deepEqual(drawn({}), drawn({}));
});

test("a tree beside a town is short, and grows to full height with distance", () => {
  assert.equal(townTreeScale(0), 0.45);
  assert.equal(townTreeScale(40), 0.45);
  assert.equal(townTreeScale(120), 1);
  assert.equal(townTreeScale(500), 1);
  const middle = townTreeScale(80);
  assert.ok(middle > 0.45 && middle < 1, `${middle}`);
  assert.ok(Math.abs(middle - 0.725) < 1e-9, "blends linearly");
});

test("the world asks how far a tree is from a town and scales it by that", () => {
  const at = { 20: 0, 150: 0, 80: 0 };
  for (const metres of [20, 80, 150]) {
    const trees = drawn({ nearTown: () => metres, land: { forestAt: () => 0.1, fieldAt: () => 0 } });
    const scales = new Set(trees.filter((t) => t.kind >= 0.28).map((t) => t.scale));
    assert.equal(scales.size, 1, `one scale at ${metres} m`);
    at[metres] = [...scales][0];
  }
  assert.equal(at[20], 0.45);
  assert.equal(at[150], 1);
  assert.ok(at[80] > 0.45 && at[80] < 1);
});
