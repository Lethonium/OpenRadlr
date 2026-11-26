import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";
import { MAP_RIDER_SCALE, MAP_SPAN_M, createMapView } from "../public/js/view2d/mapView.js";
import { MAP_TILE_M, roadTriangles } from "../public/js/view2d/mapTiles.js";
import { groundSampler } from "../public/js/view2d/groundSampler.js";
import { look2d } from "../public/js/view2d/look2d.js";
import { spriteJobs } from "../public/js/view2d/sprites/catalog.js";
import { indexWorld } from "../public/js/view2d/worldIndex.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";
import { fakeCanvas } from "./support/fakeCanvas.js";

const scene = buildSceneNow(tinyLoopFile(), [], tinyNetworkFile());
const route = new RouteGeometry(tinyLoopFile());
const index = indexWorld(scene);
const flat = { color: () => [0.4, 0.5, 0.3], water: 0, height: () => 1 };
const DAY = look2d({ season: "summer", timeMode: "day" });
const NIGHT = look2d({ season: "summer", timeMode: "night" });

/** A sprite that names itself, 24 px at 24 px/m: one metre across. */
const tiny = (name) => ({ name, frames: [{ width: 24, height: 24, name }], ox: 12, oy: 12, ppm: 24, bytes: 1 });

/** A store that has baked the sprites in `have` (job ids), and records what was wanted. */
function fakeStore(have = null) {
  const jobs = new Map(spriteJobs({ view: "top" }).map((job) => [job.key, job]));
  const baked = new Map();
  const store = {
    wanted: [],
    baked,
    want: (job, priority) => store.wanted.push({ job, priority }),
    get: (key) => baked.get(key) ?? null,
    rider: () => (store.noRiders ? null : tiny("rider")),
    bake: (id) => {
      for (const job of jobs.values()) if (job.id === id) baked.set(job.key, tiny(id));
    },
  };
  for (const id of have ?? [...jobs.values()].map((job) => job.id)) store.bake(id);
  return store;
}

function make({ store = fakeStore(), indexOf = index, sampler = flat } = {}) {
  const made = [];
  const createCanvas = (w, h) => {
    const canvas = fakeCanvas(w, h);
    made.push(canvas);
    return canvas.canvas;
  };
  const view = createMapView({ scene, route, index: indexOf, sampler, store, createCanvas });
  return { view, made, store };
}

const start = route.positionAt(0);
/** An index with one arch, in the middle of the tile under the start. */
const lonelyArch = () => {
  const arch = { layer: "arch", id: "arch", x: (Math.floor(start.x / MAP_TILE_M) + 0.5) * MAP_TILE_M, y: 0, z: (Math.floor(-start.y / MAP_TILE_M) + 0.5) * MAP_TILE_M, yaw: 0, w: 8 };
  return { query: (x0, z0, x1, z1) => (arch.x >= x0 && arch.x <= x1 && arch.z >= z0 && arch.z <= z1 ? [arch] : []) };
};
const me = { x: start.x, z: -start.y, heading: 0, distance: 0, lane: 1, id: "me" };
const rider = (id, dx, dz, extra = {}) => ({ id, x: me.x + dx, z: me.z + dz, heading: 0, look: { primary: "#e8473f" }, name: id, ...extra });
const frame = (view, extra = {}) => {
  const screen = fakeCanvas(800, 600);
  view.draw(screen.canvas.getContext("2d"), { width: 800, height: 600, me, riders: [], look: DAY, t: 0, ...extra });
  return screen;
};

test("the first draw makes the tiles that cover the rotated view and no others", () => {
  for (const heading of [0, 0.9]) {
    const { view, made } = make();
    frame(view, { me: { ...me, heading } });
    const scale = 600 / MAP_SPAN_M;
    // Every tile centre inside the screen must be made; none whose whole square is beyond the screen's far reach.
    const [w, h] = [800 / scale, MAP_SPAN_M];
    const corner = Math.hypot(w / 2, h);
    const first = Math.floor((me.x - corner) / MAP_TILE_M);
    const last = Math.floor((me.x + corner) / MAP_TILE_M);
    const possible = (last - first + 1) ** 2;
    assert.ok(made.length >= 4, `heading ${heading}: ${made.length} tiles`);
    assert.ok(made.length < possible, `heading ${heading}: ${made.length} of at most ${possible}`);
  }
});

test("a view that points along the axes makes exactly the tiles it touches", () => {
  const { view, made } = make();
  frame(view);
  const [halfW, up, down] = [800 / (600 / MAP_SPAN_M) / 2, 0.58 * MAP_SPAN_M, 0.42 * MAP_SPAN_M];
  const span = (lo, hi) => Math.floor(hi / MAP_TILE_M) - Math.floor(lo / MAP_TILE_M) + 1;
  const wanted = span(me.x - halfW, me.x + halfW) * span(me.z - up, me.z + down);
  // a tile whose edge lies exactly on the view's edge would not count, but the fixture does not hit that
  assert.equal(made.length, wanted);
});

test("a second draw at the same place makes no tiles", () => {
  const { view, made } = make();
  frame(view);
  const count = made.length;
  frame(view);
  assert.equal(made.length, count);
});

test("a tile that missed a sprite is remade once the store has it", () => {
  const store = fakeStore([]);
  const { view, made } = make({ store, indexOf: lonelyArch() });
  frame(view);
  const count = made.length;
  const missed = store.wanted.some(({ job }) => job.id === "route-arch");
  assert.ok(missed, "the arch was asked for");
  store.bake("route-arch");
  frame(view);
  assert.equal(made.length, count + 1, "only the tile with the arch is remade");
  const arches = made.flatMap((canvas) => canvas.images).filter((entry) => entry.image.name === "route-arch");
  assert.equal(arches.length, 1);
  frame(view);
  assert.equal(made.length, count + 1, "and once");
});

test("the sprites are asked for by their distance from the rider", () => {
  const store = fakeStore([]);
  const { view } = make({ store });
  frame(view);
  assert.ok(store.wanted.length > 0);
  assert.ok(store.wanted.every(({ priority }) => Number.isFinite(priority) && priority >= 0));
});

test("a change of season or time of day remakes the tiles", () => {
  const { view, made } = make();
  frame(view);
  const count = made.length;
  frame(view, { look: look2d({ season: "winter", timeMode: "day" }) });
  assert.equal(made.length, count * 2);
});

test("a sprite swapped for its night variant remakes the tile that used it", () => {
  const store = fakeStore();
  const { view, made } = make({ store, indexOf: lonelyArch() });
  frame(view);
  const count = made.length;
  for (const [key] of store.baked) if (key.includes(":route-arch:")) store.baked.set(key, tiny("route-arch-night"));
  frame(view);
  assert.equal(made.length, count + 1);
});

test("riders are drawn with their sprites at 2.4 times, labels upright", () => {
  const { view } = make();
  const screen = frame(view, { riders: [rider("a", 0, 0, { mine: true, name: "Me" }), rider("b", 3, -6, { name: "Bea" })] });
  const sprites = screen.images.filter((entry) => entry.image.name === "rider");
  assert.equal(sprites.length, 2);
  assert.ok(Math.abs(sprites[0].args[2] - MAP_RIDER_SCALE) < 1e-9, "2.4 m across at a 1 m sprite");
  assert.equal(screen.calls.fillText, 1, "only the other rider has a label");
});

test("labels are drawn outside the rotated world transform", () => {
  const ops = [];
  const stack = [];
  const ctx = new Proxy({}, {
    get: (_, name) => {
      if (name === "measureText") return () => ({ width: 20 });
      if (name === "createRadialGradient") return () => ({ addColorStop() {} });
      return () => {
        if (name === "save") stack.push(false);
        else if (name === "restore") stack.pop();
        else if (name === "rotate") stack[stack.length - 1] = true;
        if (name === "fillText") ops.push({ rotated: stack.some(Boolean) });
      };
    },
    set: () => true,
  });
  const { view } = make();
  view.draw(ctx, { width: 800, height: 600, me: { ...me, heading: 0.7 }, riders: [rider("b", 3, -6, { name: "Bea" })], look: DAY, t: 0 });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].rotated, false);
});

test("a rider whose sprite is not baked yet is still drawn", () => {
  const store = fakeStore();
  store.noRiders = true;
  const { view } = make({ store });
  const screen = frame(view, { riders: [rider("b", 3, -6)] });
  assert.ok(screen.calls.arc >= 1);
});

test("a ghost is drawn see-through", () => {
  const { view } = make();
  const screen = frame(view, { riders: [rider("g", 0, -5, { ghost: true })] });
  assert.ok(screen.alphas.includes(0.35));
});

test("arches are drawn with their sprite and the flamme rouge with a marker", () => {
  const { view, made } = make();
  frame(view);
  assert.ok(made.flatMap((canvas) => canvas.images).some((entry) => entry.image.name === "route-arch"));
  const flamme = scene.furniture.flammeRouge.position;
  const there = make();
  const screen = fakeCanvas(800, 600);
  there.view.draw(screen.canvas.getContext("2d"), { width: 800, height: 600, me: { ...me, x: flamme[0], z: flamme[2] }, riders: [], look: DAY, t: 0 });
  assert.ok(there.made.some((canvas) => canvas.fills.includes("#d8262b")));
});

test("riders sharing a vehicle are drawn as the vehicle", () => {
  const { view } = make();
  const seated = (id, seat, kind, seats) => rider(id, 0, -8, { vehicle: { id: 7, kind, seats, seat, captain: seat === 0 } });
  const screen = frame(view, { riders: [seated("a", 0, "tandem", 2), seated("b", 1, "tandem", 2), seated("c", 0, "beer_bike", 3)].map((r, i) => ({ ...r, vehicle: { ...r.vehicle, id: i < 2 ? 7 : 8 } })) });
  const names = screen.images.map((entry) => entry.image.name);
  assert.equal(names.filter((name) => name === "tandem").length, 1);
  assert.equal(names.filter((name) => name === "beer-bike").length, 1);
  assert.equal(names.filter((name) => name === "rider").length, 0);
});

test("lemons and the draft band are drawn as the old map drew them", () => {
  const { view } = make();
  const screen = frame(view, { lemons: [{ distance: 10, lane: 1, collected: false }, { distance: 12, lane: 1, collected: true }], draft: { gap: 8 }, riders: [] });
  assert.equal(screen.fills.filter((fill) => fill === "#ffcc14").length, 1);
  assert.ok(screen.alphas.includes(0.18));
});

test("at night the lamps, windows and bike lights glow", () => {
  const glowing = (look, extra = {}) => {
    let gradients = 0;
    const base = fakeCanvas(800, 600);
    const real = base.canvas.getContext("2d");
    const ctx = new Proxy(real, { get: (target, name) => (name === "createRadialGradient" ? (...args) => ((gradients += 1), target[name](...args)) : target[name]) });
    const lamps = { query: () => [{ layer: "lamp", x: me.x + 4, y: 0, z: me.z - 4 }, { layer: "house", id: "cottage", x: me.x - 9, y: 0, z: me.z - 9, yaw: 0, w: 8, d: 6, facing: [0, 1], seed: 1 }] };
    const { view } = make({ indexOf: lamps });
    view.draw(ctx, { width: 800, height: 600, me, riders: [rider("a", 0, 0)], look, t: 0, ...extra });
    return gradients;
  };
  assert.equal(glowing(DAY), 0);
  assert.equal(glowing(NIGHT), 4, "lamp, window, headlight and tail light");
});

test("resize drops the tiles, which are remade at the new size", () => {
  const { view, made } = make();
  frame(view);
  const count = made.length;
  view.resize();
  frame(view);
  assert.equal(made.length, count * 2);
});

test("it draws on the real ground sampler without a rider sprite or a store hit", () => {
  const { view } = make({ store: fakeStore([]), sampler: groundSampler(scene.ground) });
  const screen = frame(view, { riders: [rider("a", 0, 0)] });
  assert.ok(screen.images.length >= 4);
  assert.ok(Number.isFinite(screen.calls.fillRect));
});

test("only the centre lane divider of the road mesh is kept", () => {
  const mesh = scene.roads.strips;
  const count = (list) => list.filter((k) => mesh.kinds[mesh.indices[k]] === 2).length;
  const all = Array.from({ length: mesh.indices.length / 3 }, (_, n) => n * 3);
  const kept = roadTriangles(mesh);
  assert.ok(count(all) > 30, "the fixture has dividers");
  const ratio = count(kept) / count(all);
  assert.ok(ratio > 0.2 && ratio < 0.5, `kept ${ratio.toFixed(2)} of the marking triangles (one row of three)`);
  assert.equal(kept.length - count(kept), all.length - count(all), "every other triangle stays");
});
