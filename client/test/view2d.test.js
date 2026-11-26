import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { View2D } from "../public/js/view2d/view2d.js";
import { VIEW_MODES, nextViewMode, viewModeOf } from "../public/js/view2d/viewMode.js";
import { startingViewMode } from "../public/js/view/workoutStudioView.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";
import { fakeCanvas } from "./support/fakeCanvas.js";

const scene = buildSceneNow(tinyLoopFile(), [], tinyNetworkFile());
const route = new RouteGeometry(tinyLoopFile());
const COLORS = { me: "#ff7a1a", human: "#2f7de1", bot: "#888888", remote: "#28b37a" };

/** A fake baker: bakes tiny sprites, records every job, and costs `cost` ms of the fake clock per bake. */
function fakeBaker({ cost = 0 } = {}) {
  const baker = {
    jobs: [],
    clock: 0,
    disposed: 0,
    bake: (job) => {
      baker.jobs.push(job);
      baker.clock += cost;
      return { frames: [{ width: 24, height: 24 }], ox: 12, oy: 12, ppm: 24, bytes: 1 };
    },
    dispose: () => (baker.disposed += 1),
  };
  return baker;
}

function make({ baker = fakeBaker(), unavailable = false, ...options } = {}) {
  const screen = fakeCanvas(800, 600);
  const createBaker = () => {
    if (unavailable) throw new Error("no webgl2");
    return baker;
  };
  const view = new View2D(screen.canvas, route, scene, {
    season: "summer",
    timeMode: "day",
    createBaker,
    createCanvas: (w, h) => fakeCanvas(w, h).canvas,
    now: () => baker.clock,
    ...options,
  });
  return { view, baker, screen };
}

const rider = (id, distance, extra = {}) => ({ id, name: `r${id}`, distance, lane: 1, route: null, power: 200, ...extra });
const frame = (extra = {}) => {
  const riders = [rider(1, 10), rider(2, 30)];
  return { riders, myId: 1, me: riders[0], draft: null, lemons: [], ghost: null, timeS: 1, utcSeconds: 1e6, colors: COLORS, myCadence: 90, ...extra };
};
const viewsBaked = (baker) => new Set(baker.jobs.map((job) => job.view));

test("a baker that cannot start makes the views unavailable and render draws nothing", () => {
  const { view, screen } = make({ unavailable: true });
  assert.equal(view.available, false);
  view.render(frame());
  assert.deepEqual(screen.calls, { lineTo: 0, fill: 0, fillRect: 0, stroke: 0, arc: 0, fillText: 0 });
  assert.equal(screen.fills.length, 0);
});

test("render draws the map and bakes what the map asked for", () => {
  const { view, baker, screen } = make();
  assert.equal(view.available, true);
  view.render(frame());
  assert.ok(screen.calls.fillRect > 0);
  assert.deepEqual([...viewsBaked(baker)], ["top"]);
});

test("render pumps the store once a frame", () => {
  const { view, baker } = make({ baker: fakeBaker({ cost: 10 }) });
  view.render(frame());
  assert.equal(baker.jobs.length, 1);
  view.render(frame());
  assert.equal(baker.jobs.length, 2);
});

test("setMode side draws the side view from the next frame", () => {
  const { view, baker } = make();
  view.render(frame());
  view.setMode("side");
  view.render(frame());
  assert.ok(viewsBaked(baker).has("side"));
});

test("an unknown mode keeps the current one", () => {
  const { view, baker } = make();
  view.setMode("sideways");
  view.render(frame());
  assert.deepEqual([...viewsBaked(baker)], ["top"]);
});

test("the night asks for the night bakes", () => {
  const { view, baker } = make();
  view.render(frame());
  assert.equal(baker.jobs.some((job) => job.night), false);
  view.setTimeMode("night");
  view.render(frame());
  assert.equal(baker.jobs.some((job) => job.night), true);
});

test("rain draws more than clear weather", () => {
  const clear = make({ weather: { override: { kind: "clear", strength: 0 } } });
  const rain = make({ weather: { override: { kind: "rain", strength: 1 } } });
  clear.view.render(frame());
  rain.view.render(frame());
  assert.ok(rain.screen.calls.lineTo > clear.screen.calls.lineTo);
  rain.view.setWeather({ override: { kind: "clear", strength: 0 } });
  const before = rain.screen.calls.lineTo;
  rain.view.render(frame());
  assert.equal(rain.screen.calls.lineTo - before, clear.screen.calls.lineTo);
});

test("riders off my route, my ghost and a missing me are handled", () => {
  const { view, screen } = make();
  assert.doesNotThrow(() => view.render(frame({ me: undefined, riders: [] })));
  const ghost = { ...rider(-1, 5), ghost: true };
  assert.doesNotThrow(() => view.render(frame({ ghost })));
  view.setMode("side");
  assert.doesNotThrow(() => view.render(frame({ ghost })));
  assert.ok(screen.calls.fillRect > 0);
});

test("the canvas follows the element's size and a new pixel ratio", () => {
  const { view, screen } = make();
  globalThis.devicePixelRatio = 2;
  try {
    view.render(frame());
    assert.deepEqual([screen.canvas.width, screen.canvas.height], [1600, 1200]);
    globalThis.devicePixelRatio = 1;
    view.render(frame());
    assert.deepEqual([screen.canvas.width, screen.canvas.height], [800, 600]);
  } finally {
    delete globalThis.devicePixelRatio;
  }
});

test("at a pixel ratio of 2 the views draw in CSS pixels through a doubled transform", () => {
  for (const mode of ["map", "side"]) {
    const { view, screen } = make();
    view.setMode(mode);
    globalThis.devicePixelRatio = 2;
    try {
      view.render(frame());
      assert.deepEqual(screen.transforms.at(-1), [2, 0, 0, 2, 0, 0], `${mode}: the draw transform`);
      assert.ok(screen.fonts.length > 0 || mode === "map", "side: labels or none");
      assert.ok(screen.fonts.every((font) => font.includes("12px")), `${mode}: ${screen.fonts}`);
      assert.deepEqual([screen.canvas.width, screen.canvas.height], [1600, 1200]);
    } finally {
      delete globalThis.devicePixelRatio;
    }
  }
});

test("dispose frees the baker once", () => {
  const { view, baker } = make();
  view.render(frame());
  view.dispose();
  view.dispose();
  assert.equal(baker.disposed, 1);
});

test("a stored view of the old 2D reads as the map", () => {
  assert.deepEqual(VIEW_MODES, ["3d", "map", "side"]);
  assert.deepEqual(["2d", "map", "side", "3d", null, "x"].map(viewModeOf), ["map", "map", "side", "3d", "3d", "3d"]);
});

test("a workout starts in 3D, a ride in its stored view", () => {
  assert.equal(startingViewMode("side", { workout: true }), "3d");
  assert.equal(startingViewMode("2d"), "map");
  assert.equal(startingViewMode("side"), "side");
  assert.equal(startingViewMode(null), "3d");
});

test("the view key cycles through what is offered", () => {
  const all = { has3d: true, hasSide: true };
  assert.deepEqual(["3d", "map", "side"].map((mode) => nextViewMode(mode, all)), ["map", "side", "3d"]);
  assert.equal(nextViewMode("map", { has3d: true, hasSide: false }), "3d");
  assert.equal(nextViewMode("3d", { has3d: true, hasSide: false }), "map");
  assert.equal(nextViewMode("map", { has3d: false, hasSide: false }), "map");
});
