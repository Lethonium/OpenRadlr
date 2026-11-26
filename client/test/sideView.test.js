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
  const lines = calls.slice(0, calls.findIndex((c) => c.name === "roundRect")).filter((c) => c.name === "lineTo");
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

// ---- Scenery, riders and the route strip ----
/** A fake store: every job's sprite is one frame (with its key), riders have 12 frames; asked jobs are kept. */
function fakeStore() {
  const asked = [];
  const sprites = new Map();
  const sprite = (key) => {
    if (!sprites.has(key)) sprites.set(key, { frames: [{ key, width: 10, height: 10 }], ox: 0, oy: 0, ppm: 10 });
    return sprites.get(key);
  };
  return {
    asked,
    want: (job) => asked.push(job.key),
    get: (key) => sprite(key),
    rider: (look) => ({ frames: Array.from({ length: 12 }, (_, i) => ({ rider: i, name: look.name, width: 10, height: 10 })), ox: 0, oy: 0, ppm: 10 }),
  };
}
const worldOf = (items) => ({ query: () => items });
const treeAt = (d, lateral, extra = {}) => ({ layer: "tree", id: "pine", x: d, y: 10, z: lateral, yaw: 0, s: 1, ...extra });
const sideSetup = (items, { route = open } = {}) => {
  const store = fakeStore();
  const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route, sampler: flat(), createCanvas: canvases().createCanvas, index: worldOf(items), store });
  return { view, store };
};
const imageIds = (screen) => screen.images.map((i) => i.image.key ?? (i.image.rider === undefined ? "chunk" : `rider${i.image.rider}`));
const firstIndex = (ids, part) => ids.findIndex((id) => id.includes(part));

test("scenery behind the road is drawn between the middle bands by depth, the front after the riders", () => {
  const { view } = sideSetup([treeAt(200, -60, { id: "olive" }), treeAt(200, -45, { id: "pine" }), treeAt(200, -10, { id: "cypress" }), treeAt(200, 8, { id: "birch" })]);
  const screen = fakeCanvas(W, H);
  const riders = [{ id: "a", d: 200, lane: 1, look: { name: "x" }, name: "A", cadence: 0, phase: 0 }];
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders, look: DAY, t: 0 });
  const ids = imageIds(screen);
  const [olive, pine, cypress, rider, birch] = ["olive", "pine", "cypress", "rider", "birch"].map((p) => firstIndex(ids, p));
  assert.ok(ids.slice(olive, pine).includes("chunk"), "a band between the 60 m and the 45 m thing");
  assert.ok(olive < pine && pine < cypress);
  assert.ok(ids.slice(0, olive).includes("chunk") && ids.slice(pine, cypress).includes("chunk"), "bands on both sides");
  assert.ok(cypress < rider, "the road side before the riders");
  assert.ok(rider < birch, "the near side after the riders");
});

test("a house picks the sprite nearest its turn plus the tilt", () => {
  const house = (turn) => ({ layer: "house", id: "cottage", x: 200, y: 10, z: -12, yaw: 0, w: 8, d: 6, seed: 1, facing: [Math.sin(turn), Math.cos(turn)] });
  for (const [turn, expected] of [[0, "-0.400"], [1, "0.400"], [-1.3, "-1.200"]]) {
    const { view } = sideSetup([house(turn)]);
    const screen = fakeCanvas(W, H);
    view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders: [], look: DAY, t: 0 });
    const shown = imageIds(screen).find((id) => id.includes(":house:"));
    assert.ok(shown?.endsWith(`:${expected}`), `turn ${turn}: ${shown}`);
  }
});

test("a building stands at the higher of its own ground and the road plus 0.2 m", () => {
  const { view } = sideSetup([{ layer: "house", id: "cottage", x: 200, y: 0, z: -12, yaw: 0, w: 8, d: 6, seed: 1, facing: [0, 1] }]);
  const screen = fakeCanvas(W, H);
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders: [], look: DAY, t: 0 });
  const cam = sideCamera({ width: W, height: H, me: { d: 200 }, route: open });
  const sprite = screen.images.find((i) => i.image.key?.includes(":house:"));
  assert.ok(Math.abs(sprite.args[1] - cam.y(open.elevationAt(200) + 0.2, -12)) < 1e-6, `${sprite.args[1]} vs ${cam.y(10.2, -12)}`);
  assert.ok(Math.abs(sprite.args[0] - cam.x(200, -12)) < 1e-6);
});

test("things behind the road fade by distance, near ones do not", () => {
  const { view } = sideSetup([treeAt(200, -60)]);
  const screen = fakeCanvas(W, H);
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders: [], look: DAY, t: 0 });
  assert.ok(screen.alphas.some((a) => Math.abs(a - (1 - 0.7 * Math.min(0.5, 60 / 140))) < 1e-9), `${screen.alphas}`);
  const near = sideSetup([treeAt(200, 8)]);
  const nearScreen = fakeCanvas(W, H);
  near.view.draw(nearScreen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders: [], look: DAY, t: 0 });
  assert.ok(nearScreen.alphas.every((a) => a === 1));
});

test("a rider pedals by cadence and phase, tilted along the grade, labelled unless it is me", () => {
  const { view } = sideSetup([]);
  const { ctx, calls } = recorder();
  const riders = [
    { id: "me", d: 600, lane: 1, look: { name: "me" }, name: "Me", mine: true, cadence: 90, phase: 0.1 },
    { id: "mara", d: 604, lane: 0, look: { name: "mara" }, name: "Mara", cadence: 90, phase: 0.1 },
  ];
  view.draw(ctx, { width: W, height: H, me: { d: 600, id: "me" }, riders, look: DAY, t: 0.5 });
  const sprites = calls.filter((c) => c.name === "drawImage" && c.args[0].rider !== undefined);
  assert.equal(sprites.length, 2);
  assert.ok(sprites.every((c) => c.args[0].rider === Math.floor((0.5 * 90 / 60 + 0.1) * 12) % 12));
  const grade = open.gradeAt(600);
  assert.ok(grade > 4);
  const turns = calls.filter((c) => c.name === "rotate").map((c) => c.args[0]);
  assert.ok(turns.every((angle) => Math.abs(angle + Math.atan((grade / 100) * VEX)) < 1e-9) && turns.length === 2, `${turns}`);
  assert.deepEqual(calls.filter((c) => c.name === "fillText").map((c) => c.args[0]), ["Mara"]);
});

test("riders in the far lane are drawn before the near lane", () => {
  const { view } = sideSetup([]);
  const screen = fakeCanvas(W, H);
  const riders = [{ id: "near", d: 200, lane: 2, look: { name: "near" }, name: "N" }, { id: "far", d: 202, lane: 0, look: { name: "far" }, name: "F" }];
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders, look: DAY, t: 0 });
  const names = screen.images.filter((i) => i.image.rider !== undefined).map((i) => i.image.name);
  assert.deepEqual(names, ["far", "near"]);
});

test("riders sharing a vehicle are drawn as its sprite, and lemons with the lemon sprite", () => {
  const { view, store } = sideSetup([]);
  const screen = fakeCanvas(W, H);
  const seat = (id, n) => ({ id, d: 200, lane: 1, look: { name: id }, name: id, vehicle: { id: 7, kind: "tandem", seats: 2, seat: n, captain: n === 0 } });
  const lemons = [{ distance: 210, lane: 1, collected: false }, { distance: 215, lane: 1, collected: true }];
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200, id: "a" }, riders: [seat("a", 0), seat("b", 1)], lemons, look: DAY, t: 0 });
  const ids = imageIds(screen);
  assert.equal(ids.filter((id) => id.includes(":tandem:")).length, 1);
  assert.equal(ids.filter((id) => id.startsWith("rider")).length, 0);
  assert.equal(ids.filter((id) => id.includes(":lemon:")).length, 1);
  assert.ok(store.asked.length > 0);
});

test("arches stand over the road at their distance and the flamme rouge is a red pennant", () => {
  const arch = { layer: "arch", id: "arch", x: 210, y: 10, z: 0, yaw: 0, w: 8 };
  const flamme = { layer: "arch", id: "flammeRouge", x: 230, y: 10, z: 0, yaw: 0, w: 8 };
  const { view } = sideSetup([arch, flamme]);
  const screen = fakeCanvas(W, H);
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders: [], look: DAY, t: 0 });
  const cam = sideCamera({ width: W, height: H, me: { d: 200 }, route: open });
  const sprite = screen.images.find((i) => i.image.key?.includes(":route-arch:"));
  assert.ok(sprite, "the arch sprite");
  assert.ok(Math.abs(sprite.args[0] - cam.x(210, 0)) < 1e-6);
  assert.equal(screen.images.filter((i) => i.image.key?.includes(":route-arch:")).length, 1, "the flamme rouge is not an arch sprite");
  assert.ok(screen.fills.includes("#d8262b"), "red");
});

test("after dark lamps, windows and bike lights glow; by day nothing does", () => {
  const radials = (look, items, riders) => {
    const { view } = sideSetup(items);
    const log = [];
    const ctx = new Proxy({}, {
      get: (_, name) => {
        if (name === "createRadialGradient") return (...a) => (log.push(a), { addColorStop() {} });
        if (name === "createLinearGradient") return () => ({ addColorStop() {} });
        if (name === "measureText") return () => ({ width: 10 });
        if (name === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        return () => {};
      },
      set: () => true,
    });
    view.draw(ctx, { width: W, height: H, me: { d: 200 }, riders, look, t: 0 });
    return log.length;
  };
  const lamp = { layer: "lamp", x: 205, y: 0, z: -8 };
  const rider = { id: "r", d: 200, lane: 1, look: { name: "r" }, name: "R" };
  assert.equal(radials(NIGHT, [lamp], []), 1);
  assert.equal(radials(NIGHT, [lamp], [rider]), 3, "a head light and a tail light");
  assert.equal(radials(DAY, [lamp], [rider]), 1, "only the sun's own glow");
  const house = { layer: "house", id: "cottage", x: 200, y: 10, z: -12, yaw: 0, w: 8, d: 6, seed: 1, facing: [0, 1] };
  assert.equal(radials(NIGHT, [house], []), 4, "a few window glows over the wall");
  assert.equal(radials(NIGHT, [{ ...house, seed: 3 }], []), 0, "a dark house");
});

test("the profile strip is drawn along the bottom", () => {
  const { view } = sideSetup([]);
  const screen = fakeCanvas(W, H);
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders: [{ id: "a", d: 200, lane: 1, look: { name: "a" }, name: "A", mine: true }], look: DAY, t: 0 });
  assert.ok(screen.calls.arc >= 1);
});

test("with no world or store given the side view still draws (land, road, strip)", () => {
  const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route: open, sampler: flat(), createCanvas: canvases().createCanvas });
  const { ctx } = recorder();
  view.draw(ctx, { width: W, height: H, me: { d: 100 }, riders: [{ id: "a", d: 100, lane: 1, look: {}, name: "A" }], look: DAY, t: 0 });
});

test("the land slices ask for almost no grain, which would stripe them up close", () => {
  const grains = [];
  const sampler = { ...flat(), color: (x, z, sun, grain) => (grains.push(grain), [0.4, 0.5, 0.3]) };
  const bands = createSideBands({ route: loop, sampler, createCanvas: canvases().createCanvas });
  const cam = sideCamera({ width: W, height: H, me: { d: 100 }, route: loop });
  bands.drawSlice(recorder().ctx, MIDDLE_LATERALS.at(-1), cam, DAY);
  assert.ok(grains.length > 0);
  assert.ok(grains.every((g) => g <= 0.01), `${grains.slice(0, 3)}`);
});

test("near-side scenery in front of a rider is drawn faint, so it never hides them", () => {
  const { view } = sideSetup([treeAt(200, 8, { id: "birch" }), treeAt(240, 8, { id: "cypress" })]);
  const screen = fakeCanvas(W, H);
  const riders = [{ id: "a", d: 201, lane: 1, look: { name: "a" }, name: "A" }];
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 200 }, riders, look: DAY, t: 0 });
  assert.deepEqual(screen.alphas, [0.3], "only the birch in front of the rider");
});

test("at a pixel ratio of 2 the cached bands are made at device size and drawn at CSS size", () => {
  const { made, createCanvas } = canvases();
  const view = createSideView({ scene: buildSceneNow(tinyLoopFile(), [], tinyNetworkFile()), route: loop, sampler: flat(), createCanvas });
  const screen = fakeCanvas(W, H);
  view.draw(screen.canvas.getContext("2d"), { width: W, height: H, ratio: 2, me: { d: 100 }, riders: [], look: DAY, t: 0 });
  assert.deepEqual([made[0].canvas.width, made[0].canvas.height], [2 * W, 2 * H], "the far band");
  assert.deepEqual(screen.images[0].args.slice(-2), [W, H], "drawn at CSS size");
  const chunk = made.at(-1);
  assert.equal(chunk.canvas.width, 2 * (CHUNK_PX + 1));
  const drawn = screen.images.at(-1).args;
  assert.equal(drawn[2], CHUNK_PX + 1, "a chunk is drawn at CSS size");
});

test("setRoute remakes the scenery and the profile strip for the new route", () => {
  const { view, store } = sideSetup([treeAt(700, -20, { id: "olive" })], { route: loop });
  const screen = fakeCanvas(W, H);
  const draw = () => view.draw(screen.canvas.getContext("2d"), { width: W, height: H, me: { d: 700 }, riders: [], look: DAY, t: 0 });
  draw();
  assert.equal(store.asked.some((key) => key.includes("olive")), false, "no tree beside the old route");
  view.setRoute(open);
  draw();
  assert.equal(store.asked.some((key) => key.includes("olive")), true, "the tree beside the new route");
  const { ctx, calls } = recorder();
  view.draw(ctx, { width: W, height: H, me: { d: open.length }, riders: [], look: DAY, t: 0 });
  const lines = calls.slice(0, calls.findIndex((c) => c.name === "roundRect")).filter((c) => c.name === "lineTo");
  assert.ok(lines.every((c) => c.args[0] <= RIDER_AT * W + 1e-6 || c.args[1] >= H), "the road ends where the open route does");
});
