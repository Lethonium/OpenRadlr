import { test } from "node:test";
import assert from "node:assert/strict";

import { RouteGeometry } from "../public/js/route/geometry.js";
import { RoadIndex, roadFrame, roadHalfWidth } from "../public/js/world/roads.js";
import { MASK, buildMasks } from "../public/js/world/plan/masks.js";
import { bakeGrassClear, grassClearAt } from "../public/js/view3d/scene/grassField.js";

/** A four-lane bend of 90° on a 60 m radius, crossing many 16 m terrain cells at an angle. */
function bend() {
  const points = [];
  for (let a = 0; a <= 90; a += 2) points.push([60 * Math.cos((a * Math.PI) / 180), 60 * Math.sin((a * Math.PI) / 180), 10]);
  return new RouteGeometry({ id: "bend", name: "bend", lanes: 4, seed: 1, loop: false, points });
}

test("no blade root on the asphalt of a bend", () => {
  const route = bend();
  const masks = buildMasks({ roads: new RoadIndex([route]), rivers: [], bounds: { x0: -40, z0: -100, x1: 100, z1: 40 } });
  const clear = bakeGrassClear(masks);
  const half = roadHalfWidth(route.lanes);
  let grassy = 0;
  for (let d = 0; d <= route.length; d += 1) {
    const { center, right } = roadFrame(route, d);
    for (let o = -half; o <= half; o += 0.5) grassy += grassClearAt(clear, center[0] + right[0] * o, center[2] + right[2] * o);
  }
  assert.equal(grassy, 0);
});

test("grass may grow on free ground, verges and meadows, not on roads, rivers or built ground", () => {
  const data = Uint8Array.from([MASK.free, MASK.road, MASK.river, MASK.field, MASK.verge, MASK.built, MASK.meadow]);
  const clear = bakeGrassClear({ cell: 4, x0: 0, z0: 0, columns: 7, rows: 1, data });
  assert.deepEqual([...clear.data], [255, 0, 0, 255, 255, 0, 255]);
  assert.equal(grassClearAt(clear, 2, 2), 1);
  assert.equal(grassClearAt(clear, 6, 2), 0);
});

test("a mask too big for one texture shrinks, and any road in a block clears the block", () => {
  const data = new Uint8Array(8 * 2);
  data[3] = MASK.road;
  const clear = bakeGrassClear({ cell: 4, x0: 0, z0: 0, columns: 8, rows: 2, data }, 4);
  assert.deepEqual([clear.columns, clear.rows], [4, 1]);
  assert.deepEqual([...clear.data], [255, 0, 255, 255]);
  assert.equal(clear.width, 32);
});
