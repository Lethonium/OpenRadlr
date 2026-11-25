import { test } from "node:test";
import assert from "node:assert/strict";
import { CHART_DURATIONS, curveKeyPoints, curveModel, durationLabel, nearestPoint, niceMax, timelineModel } from "../public/js/view/rideCharts.js";

const SIZE = { width: 600, height: 200 };
const T0 = Date.UTC(2026, 10, 25, 7, 0, 0);

/** A recording at 1 Hz: power, heart rate and elevation from functions of the second. */
function recording(seconds, { power = () => 200, heartRate = () => 140, elevation = (i) => 100 + i / 10, pauseAt = null } = {}) {
  const samples = [];
  for (let i = 0; i < seconds; i += 1) {
    const t = T0 + i * 1000 + (pauseAt !== null && i >= pauseAt ? 120_000 : 0);
    samples.push({ t, distance: i * 8, power: power(i), cadence: 85, heartRate: heartRate(i), speed: 8, elevation: elevation(i), lat: null, lon: null, route: null, routeM: null });
  }
  const pauses = pauseAt === null ? [] : [{ from: T0 + pauseAt * 1000 - 500, to: T0 + pauseAt * 1000 + 119_500 }];
  return { samples, pauses, intervalMs: 1000 };
}

test("the chart's durations run from a second to three hours, each once", () => {
  assert.equal(CHART_DURATIONS[0], 1);
  assert.equal(CHART_DURATIONS.at(-1), 10800);
  assert.deepEqual([...new Set(CHART_DURATIONS)].sort((a, b) => a - b), CHART_DURATIONS);
});

test("an axis ends at a round number above the highest value", () => {
  assert.equal(niceMax(354), 400);
  assert.equal(niceMax(1180), 1200);
  assert.equal(niceMax(87), 90);
  assert.equal(niceMax(0), 100);
});

test("durations read as seconds, minutes and hours", () => {
  assert.deepEqual([1, 30, 60, 300, 3600, 5400].map(durationLabel), ["1 s", "30 s", "1 min", "5 min", "1 h", "1.5 h"]);
});

test("the curve runs left to right with longer durations and never leaves the chart", () => {
  const model = curveModel({ 1: 600, 5: 500, 60: 350, 300: 280, 1200: 240, 3600: 210, 7200: null }, SIZE);
  const xs = model.points.map((p) => p.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  assert.deepEqual(model.points.map((p) => p.seconds), [1, 5, 60, 300, 1200, 3600]);
  for (const { x, y } of model.points) {
    assert.ok(x >= model.plot.left && x <= model.plot.right && y >= model.plot.top && y <= model.plot.bottom);
  }
  assert.equal(model.points[0].x, model.plot.left);
  assert.equal(model.points.at(-1).x, model.plot.right);
});

test("the curve's height follows the watts: the best effort is highest", () => {
  const model = curveModel({ 5: 500, 60: 350, 1200: 240 }, SIZE);
  const [short, , long] = model.points;
  assert.ok(short.y < long.y);
  assert.equal(model.yTicks.at(-1).label, "500 W");
});

test("the curve's line and area are SVG paths through every point", () => {
  const model = curveModel({ 5: 500, 60: 350, 1200: 240 }, SIZE);
  assert.match(model.line, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){2}$/);
  assert.ok(model.area.startsWith(model.line) && model.area.endsWith("Z"));
});

test("the time axis is logarithmic and labels only what fits the ride", () => {
  const model = curveModel({ 1: 600, 60: 350, 1200: 240 }, SIZE);
  assert.deepEqual(model.xTicks.map((t) => t.label), ["1 s", "5 s", "30 s", "1 min", "5 min", "20 min"]);
  const at = (label) => model.xTicks.find((t) => t.label === label).x;
  // Equal ratios of time take equal room: 1 s → 1 min against 1 min → 20 min is ln 60 : ln 20
  // (positions are rounded to a tenth of a pixel for the SVG).
  assert.ok(Math.abs((at("1 min") - at("1 s")) / (at("20 min") - at("1 min")) - Math.log(60) / Math.log(20)) < 0.01);
});

test("a curve needs two points", () => {
  assert.equal(curveModel({ 5: 500 }, SIZE), null);
  assert.equal(curveModel(null, SIZE), null);
});

test("the key points are the record's: 5 s, 1, 5 and 20 min and the longest", () => {
  const keys = curveKeyPoints({ 1: 700, 5: 600, 15: 520, 60: 400, 300: 300, 1200: 250, 2400: 230 });
  assert.deepEqual(keys.map((k) => [k.label, k.watts]), [["5 s", "600 W"], ["1 min", "400 W"], ["5 min", "300 W"], ["20 min", "250 W"], ["40 min", "230 W"]]);
});

test("the nearest point to where the pointer is", () => {
  const points = [{ x: 10 }, { x: 50 }, { x: 90 }];
  assert.equal(nearestPoint(points, 0), points[0]);
  assert.equal(nearestPoint(points, 69), points[1]);
  assert.equal(nearestPoint(points, 75), points[2]);
  assert.equal(nearestPoint([], 5), null);
});

test("the timeline averages into buckets: a long ride stays light", () => {
  const model = timelineModel(recording(3600, { power: (i) => (i % 2 ? 300 : 100) }), { ...SIZE, buckets: 120 });
  assert.equal(model.points.length, 120);
  assert.ok(model.points.every((p) => p.power === 200));
});

test("power, heart rate and elevation each get a line or area, average power a level", () => {
  const model = timelineModel(recording(600, { power: (i) => 150 + (i % 60) }), SIZE);
  assert.match(model.power, /^M/);
  assert.match(model.heartRate, /^M/);
  assert.ok(model.elevation.endsWith("Z"));
  assert.ok(model.averageY > model.plot.top && model.averageY < model.plot.bottom);
  assert.equal(model.averagePower, 180);
});

test("no heart rate, no heart rate line; no elevation, no area", () => {
  const model = timelineModel(recording(300, { heartRate: () => null, elevation: () => null }), SIZE);
  assert.equal(model.heartRate, null);
  assert.equal(model.elevation, null);
  assert.match(model.power, /^M/);
});

test("a heart rate that drops out breaks the line instead of joining across", () => {
  const model = timelineModel(recording(300, { heartRate: (i) => (i >= 100 && i < 200 ? null : 140) }), { ...SIZE, buckets: 30 });
  assert.equal((model.heartRate.match(/M/g) ?? []).length, 2);
});

test("the timeline runs on riding time: a pause takes no room", () => {
  const model = timelineModel(recording(600, { pauseAt: 300 }), { ...SIZE, buckets: 60 });
  assert.equal(model.points.at(-1).seconds, 590);
  assert.ok(model.xTicks.every((t) => t.seconds <= 600));
});

test("the timeline's axis labels whole minutes, a handful at most", () => {
  const model = timelineModel(recording(3600), SIZE);
  assert.deepEqual(model.xTicks.map((t) => t.label), ["0:00", "15:00", "30:00", "45:00"]);
  const short = timelineModel(recording(300), SIZE);
  assert.ok(short.xTicks.length >= 2 && short.xTicks.length <= 6);
});

test("a recording too short to plot gives no timeline", () => {
  assert.equal(timelineModel(recording(1), SIZE), null);
  assert.equal(timelineModel({ samples: [], pauses: [] }, SIZE), null);
});

test("heart rate has its own axis on the right, in bpm", () => {
  const model = timelineModel(recording(600, { heartRate: (i) => 120 + Math.round(i / 10) }), SIZE);
  assert.ok(model.heartTicks.length >= 2);
  assert.ok(model.heartTicks.every((tick) => /^\d+ bpm$/.test(tick.label) && tick.y >= model.plot.top && tick.y <= model.plot.bottom));
  assert.ok(model.plot.right < SIZE.width - 30, "room for the right axis");
});

test("without heart rate there is no right axis and no room kept for it", () => {
  const model = timelineModel(recording(600, { heartRate: () => null }), SIZE);
  assert.deepEqual(model.heartTicks, []);
  assert.ok(model.plot.right > SIZE.width - 20);
});

test("the timeline's readout sits on the power line", () => {
  const model = timelineModel(recording(600, { power: (i) => 100 + i }), { ...SIZE, buckets: 60 });
  const [first, last] = [model.points[0], model.points.at(-1)];
  assert.ok(first.y > last.y, "more power, higher up");
  assert.ok(model.points.every((p) => p.y >= model.plot.top && p.y <= model.plot.bottom));
});
