import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { look2d } from "../public/js/view2d/look2d.js";
import { CAM_M, ROAD_AT, RIDER_AT, SPAN_M, VEX, sideCamera } from "../public/js/view2d/sideCamera.js";
import { CHUNK_PX, FAR_LATERALS, MIDDLE_LATERALS, createSideBands } from "../public/js/view2d/sideBands.js";
import { createSideView } from "../public/js/view2d/sideView.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";
import { fakeCanvas } from "./support/fakeCanvas.js";

const W = 800;
const H = 600;
const DAY = look2d({ season: "summer", timeMode: "day" });
const NIGHT = look2d({ season: "summer", timeMode: "night" });
/** A straight open road east, level for 400 m, then climbing 20 m over the next 400. */
const openFile = () => ({ id: "open", name: "Open", loop: false, lanes: 3, seed: 1, points: [[0, 0, 10], [400, 0, 10], [800, 0, 30]], markers: [], zones: [] });
const open = new RouteGeometry(openFile());
const loop = new RouteGeometry(tinyLoopFile());
const flat = () => ({ color: () => [0.4, 0.5, 0.3], water: 0, height: () => 5 });
/** A sampler that counts how often the ground is asked for its colour. */
const counting = () => {
  const sampler = { ...flat(), colors: 0, color: () => ((sampler.colors += 1), [0.4, 0.5, 0.3]) };
  return sampler;
};
const canvases = () => {
  const made = [];
  return { made, createCanvas: (w, h) => (made.push(fakeCanvas(w, h)), made.at(-1).canvas) };
};
/** A context that records every call and throws when a number is NaN or infinite. */
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, name) => {
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop() {} });
      if (name === "measureText") return () => ({ width: 10 });
      if (name === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return (...args) => {
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error(`${String(name)} got ${a}`);
        calls.push({ name, args });
      };
    },
    set: () => true,
  });
  return { ctx, calls };
}

test("the camera: no shrink on the road, half at the camera's distance, the rider at 0.3 across and the road at 0.64 down", () => {
  const me = { d: 100 };
  const cam = sideCamera({ width: W, height: H, me, route: open });
  assert.equal(cam.f(0), 1);
  assert.equal(cam.f(-CAM_M), 0.5);
  assert.equal(cam.scale, W / SPAN_M);
  assert.equal(cam.x(me.d, 0), RIDER_AT * W);
  assert.equal(cam.y(open.elevationAt(me.d), 0), ROAD_AT * H);
});

test("the road keeps its exaggerated grade and a hill far off is tamed", () => {
  const cam = sideCamera({ width: W, height: H, me: { d: 100 }, route: open });
  const rise = (lateral, metres) => cam.y(10, lateral) - cam.y(10 + metres, lateral);
  assert.ok(Math.abs(rise(0, 10) - 10 * cam.scale * VEX) < 1e-9);
  // 100 m up at 1000 m away rises less than at 100 m away (per metre of the land's height, and in pixels).
  assert.ok(rise(-1000, 100) < rise(-100, 100), `${rise(-1000, 100)} vs ${rise(-100, 100)}`);
  assert.ok(rise(-1000, 100) / cam.f(-1000) < rise(-100, 100) / cam.f(-100), "flatter, not just smaller");
});

test("on a route that is not a loop nothing is NaN and nothing asks past either end", () => {
  for (const d of [0, 1, open.length - 1, open.length]) {
    const asked = [];
    const route = new Proxy(open, {
      get: (target, key) => (typeof target[key] === "function" ? (...a) => (["positionAt", "elevationAt", "gradeAt"].includes(key) && asked.push(a[0]), target[key](...a)) : target[key]),
    });
    const { ctx } = recorder();
    const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route, sampler: flat(), createCanvas: canvases().createCanvas });
    view.draw(ctx, { width: W, height: H, me: { d }, riders: [], look: DAY, t: 0 });
    assert.ok(asked.length > 0);
    assert.ok(asked.every((a) => a >= 0 && a <= open.length), `d ${d}: asked ${asked.filter((a) => a < 0 || a > open.length).slice(0, 3)}`);
  }
});

test("at the end of an open route the road stops at the rider", () => {
  const { ctx, calls } = recorder();
  const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route: open, sampler: flat(), createCanvas: canvases().createCanvas });
  view.draw(ctx, { width: W, height: H, me: { d: open.length }, riders: [], look: DAY, t: 0 });
  const lines = calls.filter((c) => c.name === "lineTo");
  assert.ok(lines.length > 0);
  assert.ok(lines.every((c) => c.args[0] <= RIDER_AT * W + 1e-6 || c.args[1] >= H), "no road to the right of the end");
});

test("the road follows the route's elevation", () => {
  const { ctx, calls } = recorder();
  const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route: open, sampler: flat(), createCanvas: canvases().createCanvas });
  const me = { d: 390 };
  view.draw(ctx, { width: W, height: H, me, riders: [], look: DAY, t: 0 });
  const cam = sideCamera({ width: W, height: H, me, route: open });
  const x = RIDER_AT * W + 160;
  const expected = cam.y(open.elevationAt(me.d + 160 / cam.scale), 0);
  const climbing = calls.filter((c) => c.name === "lineTo" && Math.abs(c.args[0] - x) < 1e-6).map((c) => c.args[1]);
  assert.ok(climbing.length > 0, "a road point at that column");
  assert.ok(climbing.some((y) => y > expected && y < expected + 0.5 * cam.scale), `${climbing} vs ${expected}`);
  assert.ok(expected < cam.y(open.elevationAt(me.d), 0) - 1, "it does climb");
});

test("the far band is not redrawn for a 2 px scroll and is for a 6 px one", () => {
  const sampler = counting();
  const bands = createSideBands({ route: loop, sampler, createCanvas: canvases().createCanvas });
  const { ctx } = recorder();
  const scale = W / SPAN_M;
  const draw = (d) => bands.drawFar(ctx, sideCamera({ width: W, height: H, me: { d }, route: loop }), DAY);
  draw(100);
  const first = sampler.colors;
  assert.ok(first > 0);
  draw(100 + 2 / scale);
  assert.equal(sampler.colors, first);
  draw(100 + 6 / scale);
  assert.ok(sampler.colors > first);
});

test("a resize remakes the far band and the middle chunks", () => {
  const sampler = counting();
  const bands = createSideBands({ route: loop, sampler, createCanvas: canvases().createCanvas });
  const { ctx } = recorder();
  const cam = sideCamera({ width: W, height: H, me: { d: 100 }, route: loop });
  const all = () => {
    bands.drawFar(ctx, cam, DAY);
    for (const lateral of MIDDLE_LATERALS) bands.drawSlice(ctx, lateral, cam, DAY);
  };
  all();
  const first = sampler.colors;
  all();
  assert.equal(sampler.colors, first, "a second frame at the same place samples nothing");
  bands.resize();
  all();
  assert.equal(sampler.colors, first * 2);
});

test("a middle slice is cached in chunks that cover the screen, with a pixel of overlap", () => {
  const { made, createCanvas } = canvases();
  const bands = createSideBands({ route: loop, sampler: flat(), createCanvas });
  const { ctx, calls } = recorder();
  const cam = sideCamera({ width: W, height: H, me: { d: 100 }, route: loop });
  bands.drawSlice(ctx, MIDDLE_LATERALS.at(-1), cam, DAY);
  const images = calls.filter((c) => c.name === "drawImage");
  assert.ok(images.length >= Math.ceil(W / CHUNK_PX));
  assert.ok(images.length <= Math.ceil(W / CHUNK_PX) + 1);
  assert.ok(made.every((c) => c.canvas.width === CHUNK_PX + 1));
  const xs = images.map((c) => c.args[1]).sort((a, b) => a - b);
  assert.deepEqual(xs.slice(1).map((x, i) => x - xs[i]), Array(xs.length - 1).fill(CHUNK_PX));
});

test("the laterals are the specified ones and are ordered far to near", () => {
  assert.deepEqual(FAR_LATERALS, [-5200, -3600, -2600, -1900, -1400]);
  assert.equal(MIDDLE_LATERALS.length, 14);
  assert.deepEqual([...MIDDLE_LATERALS], [...MIDDLE_LATERALS].sort((a, b) => a - b));
});

test("a new season or time of day remakes the bands", () => {
  const sampler = counting();
  const bands = createSideBands({ route: loop, sampler, createCanvas: canvases().createCanvas });
  const { ctx } = recorder();
  const cam = sideCamera({ width: W, height: H, me: { d: 100 }, route: loop });
  bands.drawFar(ctx, cam, DAY);
  const first = sampler.colors;
  bands.drawFar(ctx, cam, NIGHT);
  assert.ok(sampler.colors > first);
});

test("the side view draws a frame on a loop with the sky, the land and the road", () => {
  const screen = fakeCanvas(W, H);
  const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route: loop, sampler: flat(), createCanvas: canvases().createCanvas });
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 100 }, riders: [], look: DAY, t: 0 });
  assert.ok(screen.images.length > 0, "cached land is drawn");
  assert.ok(screen.calls.stroke > 0, "the road");
});
