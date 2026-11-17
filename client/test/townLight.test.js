/**
 * Town light (#117): at dusk a settlement shows warm windows, pools under the
 * lamps and a few market lights. The planner is plain data, so the whole look
 * can be tested without a renderer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { SETTLEMENT_KIND, layoutSettlement } from "../public/js/land/settlement.js";
import { nearestLights, planTownLight } from "../public/js/view3d/townLight.js";

const TERRAIN = { height: () => 10, distanceToRoad: () => 1000 };
const ROAD = new RouteGeometry({ id: "road", name: "Road", points: [[-1000, 0], [1000, 0]], lanes: 4, markers: [], zones: [], closed: false });
const LAYOUT = layoutSettlement({ id: "hilltop", kind: SETTLEMENT_KIND.city, center: [0, 0], radius: 400, seed: 2026, terrain: TERRAIN, roads: [ROAD] });
const plan = (options = {}) => planTownLight(LAYOUT, { height: TERRAIN.height, ...options });

test("the same settlement gets the same town light", () => {
  assert.deepEqual(plan(), plan());
});

test("a city has lit windows, lamp pools and market lights", () => {
  const light = plan();
  assert.ok(light.windows.length >= 40, `windows ${light.windows.length}`);
  assert.ok(light.pools.length >= 10, `pools ${light.pools.length}`);
  assert.ok(light.lights.length >= 10, `lights ${light.lights.length}`);
  assert.ok(light.market.bulbs.length > 0, "the square has string lights");
});

test("the windows sit on the street side of their house", () => {
  const light = plan();
  const house = LAYOUT.plots[0];
  const window = light.windows.find((w) => Math.hypot(w.x - house.x, w.z - house.z) < house.depth);
  assert.ok(window, "a plot near the street has a window");
  const offset = (window.x - house.x) * house.facing[0] + (window.z - house.z) * house.facing[1];
  assert.ok(offset > 0, `window is towards the street (${offset})`);
});

test("day has no pools, dusk does", () => {
  assert.equal(plan({ mode: "day" }).pools.length, 0);
  assert.ok(plan({ mode: "dusk" }).pools.length > 0);
});

test("the nearest eight lights are stable and never more than eight", () => {
  const lights = plan().lights;
  const first = nearestLights(lights, [0, 12, 0]);
  assert.ok(first.length > 0);
  assert.ok(first.length <= 8, `selected ${first.length}`);
  assert.deepEqual(nearestLights(lights, [0, 12, 0]), first);
});

test("the nearest lights are the closest ones, in order", () => {
  const lights = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 0, z: 0 }));
  assert.deepEqual(nearestLights(lights, [0, 0, 0]).map((light) => light.x), [0, 10, 20, 30, 40, 50, 60, 70]);
});

test("a settlement without lamps has no pools", () => {
  const bare = { ...LAYOUT, lamps: [], square: null, props: [] };
  assert.equal(planTownLight(bare, { height: TERRAIN.height }).pools.length, 0);
});
