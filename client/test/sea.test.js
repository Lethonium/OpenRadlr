import { test } from "node:test";
import assert from "node:assert/strict";

import { SEA, seaScale } from "../public/js/view3d/scene/sea.js";
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
