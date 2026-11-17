/**
 * Town light (#117): at dusk a settlement shows warm windows, pools under the
 * lamps and a few market lights. The planner is plain data, so the whole look
 * can be tested without a renderer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { SETTLEMENT_KIND, layoutSettlement } from "../public/js/land/settlement.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { facadeWindows } from "../public/js/view3d/scenery/windows.js";
import { TOWN_LIGHT, buildTownLight, nearestLights, planTownLight } from "../public/js/view3d/townLight.js";

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

test("a model's real window openings become the light anchors", () => {
  // A cream wall with a brown frame ring around a 1 m hole: the detector
  // should find the hole, not the wall or the bounding box.
  const mesh = new MeshBuilder();
  const wall = [0.94, 0.89, 0.78, 0];
  mesh.quad([-3, 4, -3.1], [3, 4, -3.1], [3, 0, -3.1], [-3, 0, -3.1], wall);
  const frame = [0.68, 0.41, 0.31, 0];
  const ring = (x0, x1, y0, y1) => mesh.quad([x0, y1, -3], [x1, y1, -3], [x1, y0, -3], [x0, y0, -3], frame);
  ring(-0.6, 0.6, 1.4, 1.5);
  ring(-0.6, 0.6, 2.5, 2.6);
  ring(-0.6, -0.5, 1.4, 2.6);
  ring(0.5, 0.6, 1.4, 2.6);
  const found = facadeWindows(mesh.build());
  assert.ok(found, "the facade was found");
  assert.ok(Math.abs(found.facade - 3.1) < 0.05, `facade ${found.facade}`);
  assert.equal(found.windows.length, 1, `windows ${JSON.stringify(found.windows)}`);
  const [window] = found.windows;
  assert.ok(Math.abs(window.x) < 0.1, `x ${window.x}`);
  assert.ok(Math.abs(window.y - 2) < 0.15, `y ${window.y}`);
  assert.ok(window.width > 0.8 && window.height > 0.8, `size ${window.width}x${window.height}`);
});

test("a house with real openings gets its panes in them, not on the wall", () => {
  const layout = { id: "a", center: [0, 0], frame: { u: [1, 0], v: [0, 1] }, plots: [], lamps: [], props: [], square: null };
  const houses = [{
    x: 0, z: 0, facing: [0, -1], yaw: Math.PI, width: 8, depth: 6, ground: 0, height: 6,
    facade: 2.9, wallWidth: 8,
    windows: [{ x: 1.5, y: 3.5, width: 1, height: 0.8 }],
  }];
  const light = planTownLight(layout, { houses });
  assert.equal(light.windows.length, 1, `windows ${JSON.stringify(light.windows)}`);
  const [window] = light.windows;
  assert.ok(Math.abs(window.x - 1.5) < 1e-6, `x ${window.x}`);
  assert.ok(Math.abs(window.z + 2.92) < 1e-6, `z ${window.z}`);
  assert.ok(Math.abs(window.y - 3.5) < 1e-6, `y ${window.y}`);
  assert.ok(Math.abs(window.width - 0.9) < 1e-6, `width ${window.width}`);
  assert.ok(Math.abs(window.height - 0.72) < 1e-6, `height ${window.height}`);
});

test("a house without openings keeps its windows on the real wall plane", () => {
  const layout = { id: "e", center: [0, 0], frame: { u: [1, 0], v: [0, 1] }, plots: [], lamps: [], props: [], square: null };
  const houses = [{
    x: 0, z: 0, facing: [0, -1], yaw: Math.PI, width: 8, depth: 6, ground: 0, height: 6,
    facade: 2.9, wallWidth: 8,
  }];
  const light = planTownLight(layout, { houses });
  assert.ok(light.windows.length > 0, "the fallback still lights the house");
  for (const window of light.windows) {
    assert.ok(Math.abs(window.z + 2.92) < 1e-6, `on the wall plane, not the bounding box (${window.z})`);
  }
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

/** A mesh stand-in that records the geometry `buildTownLight` adds. */
function collector() {
  const calls = [];
  return {
    calls,
    triangleFacing(a, b, c, colour) {
      calls.push({ kind: "triangle", a, b, c, colour: [...colour] });
    },
    box(center, size, colour) {
      calls.push({ kind: "box", center, size, colour: [...colour] });
    },
  };
}

test("windows go into bright, their halos and the pools into glow", () => {
  const bright = collector();
  const glow = collector();
  const structures = collector();
  const light = plan();
  const built = buildTownLight(light, { bright, glow, structures, height: TERRAIN.height });
  assert.equal(built.windows, light.windows.length);
  assert.equal(built.pools, light.pools.length);
  assert.ok(built.windows > 0 && built.pools > 0 && built.bulbs > 0);
  // Two triangles per window, four per crossed bulb and two for the sign.
  assert.equal(bright.calls.length, built.windows * 2 + built.bulbs * 4 + 2);
  // 32 triangles per window glow (2 rings of 8 segments) and 72 per pool.
  assert.equal(glow.calls.length, built.windows * 32 + built.pools * 72);
  assert.equal(structures.calls.length, 1, "the sign gets one post");
  assert.equal(structures.calls[0].kind, "box");
});

test("the pools keep the dusk alpha, so they glow instead of painting the road", () => {
  const glow = collector();
  buildTownLight(plan(), { glow, height: TERRAIN.height });
  // The brightest pool ring is the lamp colour times the dusk alpha (0.22).
  const red = Math.max(...glow.calls.map((call) => call.colour[0]));
  assert.ok(red <= TOWN_LIGHT.poolAlpha.dusk + 1e-6, `brightest pool red ${red}`);
  assert.ok(red > 0.1, `the pools are visible (${red})`);
});

test("the market square has string bulbs, lit stalls and a sign", () => {
  const light = plan();
  assert.equal(light.market.bulbs.length, 9, "a string of bulbs across the square");
  assert.ok(light.market.stalls.length >= 3, `stalls ${light.market.stalls.length}`);
  assert.ok(light.market.sign, "one lit sign by the road");
  // The bulbs hang on a catenary: the middle of the string is lower than its ends.
  assert.ok(light.market.bulbs[4].y < light.market.bulbs[0].y, "the bulbs sag");
});

test("the nearest-light list is capped at the shader's eight", () => {
  const lights = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 0, z: 0 }));
  assert.equal(nearestLights(lights, [0, 0, 0], 99).length, 8);
});
