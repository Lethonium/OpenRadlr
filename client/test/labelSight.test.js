import { test } from "node:test";
import assert from "node:assert/strict";
import { groundHeight, labelInSight, plotBoxes } from "../public/js/view3d/labelSight.js";

const flat = { height: () => 0, boxes: [] };
const eye = [0, 2, 0];
const head = [0, 1.8, -60];

test("a rider on an open road is in sight", () => {
  assert.equal(labelInSight(eye, head, flat), true);
});

test("a hill between hides the label", () => {
  const hill = { ...flat, height: (x, z) => (Math.abs(z + 30) < 8 ? 6 : 0) };
  assert.equal(labelInSight(eye, head, hill), false);
});

test("a house between hides the label", () => {
  const box = { x: 0, z: -30, halfX: 4, halfZ: 4, yaw: 0, top: 8 };
  assert.equal(labelInSight(eye, head, { ...flat, boxes: [box] }), false);
  assert.equal(labelInSight(eye, head, { ...flat, boxes: [{ ...box, x: 20 }] }), true);
});

test("a house turned by its yaw hides what its corner covers", () => {
  const box = { x: 5, z: -30, halfX: 8, halfZ: 1, yaw: 0, top: 8 };
  assert.equal(labelInSight(eye, head, { ...flat, boxes: [box] }), false, "long side across the line");
  assert.equal(labelInSight(eye, head, { ...flat, boxes: [{ ...box, yaw: Math.PI / 2 }] }), true, "turned along the line it lies beside it");
});

test("a rider seen over a house that is lower than the line is in sight", () => {
  const box = { x: 0, z: -30, halfX: 4, halfZ: 4, yaw: 0, top: 8 };
  assert.equal(labelInSight([0, 12, 0], [0, 12, -60], { ...flat, boxes: [box] }), true);
});

test("groundHeight reads the grid", () => {
  const near = { x0: 0, z0: 0, cell: 10, columns: 3, rows: 3, heights: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]) };
  const far = { x0: -1000, z0: -1000, cell: 1000, columns: 3, rows: 3, heights: new Float32Array(9).fill(50) };
  const height = groundHeight({ near, far });
  assert.equal(height(5, 5), 2, "cell centre: the mean of 0, 1, 3, 4");
  assert.equal(height(15, 5), 3, "cell centre: the mean of 1, 2, 4, 5");
  assert.equal(height(0, 0), 0);
  assert.equal(height(20, 20), 8);
  assert.equal(height(500, 500), 50, "off the near grid it reads the far one");
});

test("plotBoxes makes a box per plot and farm, a roof's height over the ground", () => {
  const plan = {
    settlements: [{ plots: [{ x: 10, z: 20, width: 12, depth: 8, facing: [0, 1] }], ground: [3] }],
    farms: [{ x: 100, y: 7, z: -50, yaw: 0 }],
  };
  const [plot, farm] = plotBoxes(plan);
  assert.deepEqual([plot.x, plot.z, plot.halfX, plot.halfZ, plot.top], [10, 20, 6, 4, 11]);
  assert.equal(farm.top, 15);
  assert.deepEqual(plotBoxes(undefined), []);
});
