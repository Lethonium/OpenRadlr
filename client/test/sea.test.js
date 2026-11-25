import { test } from "node:test";
import assert from "node:assert/strict";

import { SEA, seaDepthData, seaScale } from "../public/js/view3d/scene/sea.js";
import { DRONE_LENS, RIDE_LENS, droneLens } from "../public/js/view3d/view3d.js";

test("the sea reaches every lens' far plane, so no plane edge shows inside the view", () => {
  for (const lens of [RIDE_LENS, DRONE_LENS, droneLens({ radius: 9000 })]) {
    assert.ok((SEA.size * seaScale(lens.far)) / 2 >= lens.far, `far ${lens.far}`);
  }
});

test("the sea is only stretched in whole steps and never shrunk", () => {
  assert.equal(seaScale(100), 1);
  assert.ok(Number.isInteger(seaScale(40000)));
});

test("the water is deep at the edge of a depth grid, so no shelf ends in a straight line", () => {
  const grid = { columns: 40, rows: 30, cell: 16, water: 0, heights: new Float32Array(40 * 30).fill(-6) };
  const data = seaDepthData(grid);
  const red = (i, j) => data[(j * grid.columns + i) * 4];
  for (let i = 0; i < grid.columns; i += 1) assert.equal(red(i, 0) / 255, 1, `top ${i}`);
  for (let j = 0; j < grid.rows; j += 1) assert.equal(red(grid.columns - 1, j) / 255, 1, `right ${j}`);
  assert.equal(red(20, 15), Math.round((6 / SEA.depthRange) * 255), "the inside keeps its depth");
  assert.ok(red(2, 15) > red(20, 15) && red(2, 15) < 255, "it deepens towards the edge");
});
