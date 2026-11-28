import test from "node:test";
import assert from "node:assert/strict";
import { look2d } from "../public/js/view2d/look2d.js";
import { groundSampler } from "../public/js/view2d/groundSampler.js";
import { drawGlows, drawTint, drawWeather } from "../public/js/view2d/overlays.js";
import { SEASON_LOOK } from "../public/js/world/seasons.js";
import { sceneOf, buildSceneNow } from "../public/js/view3d/worldScene.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";
import { fakeCanvas } from "./support/fakeCanvas.js";

const date = (hour) => new Date(2026, 6, 1, hour, 0, 0);
const ground = () => sceneOf(buildSceneNow(tinyLoopFile(), [], tinyNetworkFile())).ground;

test("night is lit by lamps and tinted blue; day has neither", () => {
  const night = look2d({ timeMode: "night" });
  assert.equal(night.night, true);
  assert.equal(night.lights, 1);
  assert.ok(night.tint);
  const day = look2d({ timeMode: "day" });
  assert.equal(day.night, false);
  assert.equal(day.lights, 0);
  assert.equal(day.tint, null);
  assert.equal(look2d({ timeMode: "dusk" }).lights, 0.5);
});

test("the season picks the ground look, and auto follows the date", () => {
  assert.equal(look2d({ season: "winter" }).ground, SEASON_LOOK.winter);
  assert.equal(look2d({ season: "auto", date: new Date(2026, 0, 10) }).season, "winter");
});

test("auto time resolves by the injected date", () => {
  assert.equal(look2d({ timeMode: "auto", date: date(12) }).time, "day");
  assert.equal(look2d({ timeMode: "auto", date: date(23) }).night, true);
});

test("the weather sets rain and snow, and cloud dims the day", () => {
  const snow = look2d({ weather: { kind: "snow", strength: 1 } });
  assert.equal(snow.snowing, true);
  assert.equal(snow.raining, false);
  const storm = look2d({ weather: { kind: "storm", strength: 1 } });
  assert.equal(storm.raining, true);
  assert.ok(storm.overcast > 0 && storm.tint);
  assert.ok(storm.shadow < look2d({}).shadow);
  assert.equal(look2d({ weather: { kind: "rain", strength: 1 }, precipitation: 0 }).raining, false);
});

test("the sky comes from the 3D presets", () => {
  const night = look2d({ timeMode: "night" }).sky;
  const day = look2d({ timeMode: "day" }).sky;
  assert.ok(night.top[2] < day.top[2]);
});

test("a painted cell differs from the bare ground by the paint", () => {
  const g = ground();
  const sun = look2d({}).sun;
  const bare = { ...g, paint: { ...g.paint, rgba: new Uint8ClampedArray(g.paint.rgba.length) } };
  const painted = { ...g, paint: { ...g.paint, rgba: g.paint.rgba.map((v, i) => (i % 4 === 3 ? 255 : i % 4 === 0 ? 255 : 0)) } };
  const n = g.near;
  const land = n.heights.findIndex((h) => h > n.water + 2);
  assert.ok(land >= 0);
  const x = n.x0 + (land % n.columns) * n.cell;
  const z = n.z0 + Math.floor(land / n.columns) * n.cell;
  assert.ok(x >= g.paint.x0 && z >= g.paint.z0 && x < g.paint.x0 + g.paint.columns * g.paint.cell && z < g.paint.z0 + g.paint.rows * g.paint.cell);
  const a = groundSampler(bare).color(x, z, sun);
  const b = groundSampler(painted).color(x, z, sun);
  assert.notDeepEqual(a, b);
  assert.ok(b[0] > b[2]);
});

test("far outside the grid there is still a colour and a finite height", () => {
  const s = groundSampler(ground());
  const c = s.color(1e6, -1e6, look2d({}).sun);
  assert.equal(c.length, 3);
  assert.ok(c.every(Number.isFinite));
  assert.ok(Number.isFinite(s.height(1e6, -1e6)));
});

test("below the water the colour is the sea, deeper is darker", () => {
  const g = ground();
  const n = g.near;
  const flat = { ...g, near: { ...n, heights: n.heights.map(() => n.water - 2) } };
  const deep = { ...g, near: { ...n, heights: n.heights.map(() => n.water - 30) } };
  const sun = look2d({}).sun;
  const shallow = groundSampler(flat).color(n.x0 + n.cell * 2, n.z0 + n.cell * 2, sun);
  const dark = groundSampler(deep).color(n.x0 + n.cell * 2, n.z0 + n.cell * 2, sun);
  assert.ok(dark[0] < shallow[0]);
  assert.ok(shallow[2] > shallow[0]);
});

test("the weather overlay draws rain strokes, snow flakes, and nothing when clear", () => {
  const frame = { width: 400, height: 300, t: 2 };
  const rain = fakeCanvas();
  drawWeather(rain.canvas.getContext("2d"), look2d({ weather: { kind: "rain", strength: 1 } }), frame);
  assert.ok(rain.calls.stroke > 0);
  const snow = fakeCanvas();
  drawWeather(snow.canvas.getContext("2d"), look2d({ weather: { kind: "snow", strength: 1 } }), frame);
  assert.ok(snow.calls.arc > 0);
  const clear = fakeCanvas();
  drawWeather(clear.canvas.getContext("2d"), look2d({}), frame);
  assert.deepEqual(clear.calls, { lineTo: 0, fill: 0, fillRect: 0, stroke: 0, arc: 0, fillText: 0 });
});

test("the tint fills only when there is one; glows only after dark", () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const day = fakeCanvas();
  drawTint(day.canvas.getContext("2d"), look2d({}), rect);
  assert.equal(day.calls.fillRect, 0);
  const night = fakeCanvas();
  const nightLook = look2d({ timeMode: "night" });
  drawTint(night.canvas.getContext("2d"), nightLook, rect);
  assert.equal(night.calls.fillRect, 1);
  const glow = { x: 1, y: 1, r: 3, rgb: [1, 0.8, 0.5], a: 0.5 };
  drawGlows(night.canvas.getContext("2d"), nightLook, [glow]);
  assert.equal(night.calls.fillRect, 2);
  drawGlows(day.canvas.getContext("2d"), look2d({}), [glow]);
  assert.equal(day.calls.fillRect, 0);
});
