import { test } from "node:test";
import assert from "node:assert/strict";

import { Turntable } from "../public/js/view3d/lookTurntable.js";

test("the stand turns on its own", () => {
  const stand = new Turntable({ angle: 0, speed: 0.5 });
  stand.update(2);
  assert.equal(stand.angle, 1);
});

test("dragging turns the stand with the pointer and holds the auto-turn", () => {
  const stand = new Turntable({ angle: 0, speed: 0.5, radiansPerPixel: 0.01, holdS: 3 });
  stand.grab();
  stand.drag(50);
  assert.equal(stand.angle, 0.5);
  stand.update(1);
  assert.equal(stand.angle, 0.5, "no auto-turn while held");
  stand.release();
  stand.update(2.9);
  assert.equal(stand.angle, 0.5, "it waits after letting go");
  stand.update(0.2);
  assert.ok(stand.angle > 0.5, "then turns on again");
});

test("with reduced motion it only turns by hand", () => {
  const stand = new Turntable({ angle: 1, speed: 0.5, still: true, radiansPerPixel: 0.01 });
  stand.update(5);
  assert.equal(stand.angle, 1);
  stand.grab();
  stand.drag(-100);
  assert.equal(stand.angle, 0);
});
