/** Roadside furniture placement: guard rails, signs and the flamme rouge come out as plain data. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadsideFurniture } from "../public/js/view3d/features.js";
import { VERGE, roadFrame, roadHalfWidth } from "../public/js/world/roads.js";

const flat = { height: () => 0 };
const straight = (points, markers = []) => new RouteGeometry({ id: "t", name: "t", lanes: 4, seed: 1, loop: false, points, markers });

test("rails follow steep descents on both sides of a two-way road", () => {
  // Flat to 300 m, a 6 % descent to 600 m, flat again.
  const route = straight([[0, 0, 100], [300, 0, 100], [600, 0, 82], [900, 0, 82]]);
  const { rails } = roadsideFurniture(route, flat, { markers: false, twoWay: true });
  assert.ok(rails.length > 0 && rails.length % 2 === 0, `${rails.length} rails, two per step`);
  for (const { a } of rails) assert.ok(a[0] >= 290 && a[0] <= 610, `rail at ${a[0]} m is outside the descent`);
  const sides = new Set(rails.map(({ a }) => Math.sign(a[2])));
  assert.deepEqual([...sides].sort(), [-1, 1], "both sides");
  const half = roadHalfWidth(route.lanes) + VERGE + 0.3;
  for (const { a } of rails) assert.ok(Math.abs(Math.abs(a[2]) - half) < 0.01, `rail stands ${a[2]} m off the centre line`);
  const { rails: none } = roadsideFurniture(route, flat, { markers: false, rails: false });
  assert.equal(none.length, 0);
});

test("the flamme rouge stands a kilometre before the finish", () => {
  const long = straight([[0, 0, 0], [1500, 0, 0], [3000, 0, 0]]);
  const { flammeRouge } = roadsideFurniture(long, flat, {});
  const at = roadFrame(long, long.length - 1000).center;
  assert.ok(Math.abs(flammeRouge.position[0] - at[0]) < 0.01 && Math.abs(flammeRouge.position[2] - at[2]) < 0.01);
  assert.ok(flammeRouge.halfWidth > roadHalfWidth(long.lanes));
  assert.equal(roadsideFurniture(straight([[0, 0, 0], [1200, 0, 0]]), flat, {}).flammeRouge, null);
  assert.equal(roadsideFurniture(long, flat, { markers: false }).flammeRouge, null, "only the ridden route has one");
});

test("climb warnings stand before and after each climb", () => {
  const route = straight([[0, 0, 0], [2000, 0, 0]], [{ type: "climb", distance: 600, length: 400 }, { type: "climb", distance: 1400, length: 200 }]);
  const { signs } = roadsideFurniture(route, flat, {});
  const warnings = signs.filter((s) => s.kind === "warning");
  assert.equal(warnings.length, 4);
  const xs = warnings.map((s) => Math.round(s.position[0])).sort((p, q) => p - q);
  assert.deepEqual(xs, [480, 1025, 1280, 1625]);
});

test("village boards stand at both ends of a zone", () => {
  const route = straight([[0, 0, 0], [1000, 0, 0]]);
  const { signs } = roadsideFurniture(route, flat, { markers: false, villages: [{ from: 200, to: 500 }] });
  assert.deepEqual(signs.map((s) => [s.kind, Math.round(s.position[0])]), [["village", 200], ["village", 500]]);
});
