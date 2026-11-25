/** Roadside furniture placement: guard rails, signs and the flamme rouge come out as plain data. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { readFileSync } from "node:fs";
import { GYM_TOP, Occupancy, buildBikeCafe, buildOutdoorGym, buildSpectators, cafeClearing, roadsideFurniture } from "../public/js/view3d/features.js";
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

test("spectators stand where they always stood", () => {
  // Recorded from the crowd the adapter drew before it moved to the new world.
  const hills = new RouteGeometry(JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url))));
  const terrain = { height: (x, z) => 0.01 * x + 0.005 * z, distanceToRoad: () => Infinity };
  const { people } = buildSpectators(hills, terrain, { seed: hills.seed >>> 0 });
  assert.equal(people.length, 231);
  const first = people.slice(0, 5).map((p) => ({ position: p.position.map((v) => Math.round(v * 1e4) / 1e4), shirt: p.shirt, flag: p.flag }));
  assert.deepEqual(first, [
    { position: [2407.5981, 19.3755, -940.1048], shirt: [0.55, 0.3, 0.75], flag: null },
    { position: [2409.0382, 19.4033, -937.4248], shirt: [0.2, 0.45, 0.85], flag: [0.18, 0.62, 0.3] },
    { position: [2408.7767, 19.4152, -934.514], shirt: [0.15, 0.15, 0.18], flag: null },
    { position: [2408.1242, 19.367, -942.8467], shirt: [0.2, 0.45, 0.85], flag: null },
    { position: [2405.7885, 19.2956, -952.4521], shirt: [0.95, 0.95, 0.95], flag: null },
  ]);
});

test("barriers line both sides of each crowd spot", () => {
  // Three spots: the start line, the climb's top and the sprint line.
  const route = straight([[0, 0, 0], [3000, 0, 0]], [{ type: "sprint", distance: 600, length: 0 }, { type: "climb", distance: 1800, length: 1000 }]);
  const { barriers } = buildSpectators(route, { ...flat, distanceToRoad: () => Infinity }, { seed: 1 });
  assert.equal(barriers.length, 3 * 2 * 16);
  const half = roadHalfWidth(route.lanes) + VERGE + 0.5;
  for (const { a, b, color } of barriers) {
    assert.ok(Math.abs(Math.abs(a[2]) - half) < 0.01, `a stands ${a[2]} m off the centre line`);
    assert.ok(b[0] - a[0] < 3.01, "at most three metres long (the first ones are cut at the road's start)");
    assert.equal(color.length, 3);
  }
  assert.equal(new Set(barriers.map(({ color }) => color.join())).size, 2, "two stripe colours");
});

test("the gym's spots sit on the mat", () => {
  const route = straight([[0, 0, 100], [400, 0, 100]]);
  const gym = buildOutdoorGym(route, null, { occupancy: new Occupancy() });
  assert.ok(gym && Number.isFinite(gym.base) && gym.spots.length === 8);
  for (const spot of gym.spots) assert.ok(Math.abs(spot.position[1] - (gym.base + GYM_TOP)) < 1e-6, `spot at ${spot.position[1]}`);
  assert.ok(gym.drop > 0 && Number.isFinite(gym.signLift) && gym.position.length === 3);
});

test("a café is data: its spot, yaw and the paved forecourt along the road", () => {
  const route = straight([[0, 0, 100], [400, 0, 100]]);
  const cafe = buildBikeCafe(route, null, { occupancy: new Occupancy() });
  assert.ok(cafe && Number.isFinite(cafe.yaw));
  const { inner, outer } = cafe.forecourt;
  assert.equal(inner.length, outer.length);
  assert.ok(inner.length >= 11, "an edge point every 2 m over 22 m");
  const half = roadHalfWidth(route.lanes);
  assert.ok(Math.abs(Math.abs(inner[0][2]) - (half + 0.02)) < 1e-6 && Math.abs(Math.abs(outer[0][2]) - (half + 10)) < 1e-6);
  const clearing = cafeClearing(route);
  assert.equal(clearing.radius, 14);
  assert.ok(Math.hypot(clearing.x - cafe.position[0], clearing.z - cafe.position[2]) < 1e-6, "centred on the café");
});
