import { test } from "node:test";
import assert from "node:assert/strict";
import { SPLIT_SETTINGS, resolveSplitMode, computeSplits, compareSplits } from "../public/js/ride/splits.js";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";

const T0 = Date.UTC(2026, 9, 14, 13, 30, 0);

/** 1 Hz samples riding `speed` m/s around a loop of length L. */
function samples(n, { speed = 10, route = "loop", L = 1000, startM = 0, power = 200, hr = null } = {}) {
  return Array.from({ length: n + 1 }, (_, i) => ({
    t: T0 + i * 1000,
    distance: i * speed,
    power,
    cadence: 90,
    heartRate: hr,
    speed,
    elevation: null,
    lat: null,
    lon: null,
    route,
    routeM: route === null ? null : (startM + i * speed) % L,
  }));
}

const lengths = { loop: 1000, other: 700, big: 12_900 };
const routeLength = (id) => lengths[id] ?? null;
const lap = (s, extra = {}) => computeSplits(s, [], { mode: "lap", routeLength, ...extra });

test("resolveSplitMode", () => {
  assert.deepEqual(SPLIT_SETTINGS, ["auto", "lap", "1", "5", "10", "off"]);
  assert.equal(resolveSplitMode("auto", null), "5");
  assert.equal(resolveSplitMode("auto", 7800), "lap");
  assert.equal(resolveSplitMode("auto", 12900), "lap");
  assert.equal(resolveSplitMode("auto", 179600), "10");
  assert.equal(resolveSplitMode("auto", 40000), "5");
  assert.equal(resolveSplitMode("10", 7800), "10");
  assert.equal(resolveSplitMode("off", 7800), "off");
});

test("distance splits end at the first sample past each multiple; the last is partial", () => {
  const splits = computeSplits(samples(250), [], { mode: "1" });
  assert.equal(splits.length, 3);
  assert.deepEqual(splits.map((s) => s.toM), [1000, 2000, 2500]);
  assert.deepEqual(splits.map((s) => s.durationS), [100, 100, 50]);
  assert.deepEqual(splits.map((s) => s.kind), ["distance", "distance", "distance"]);
  assert.deepEqual(splits.map((s) => s.partial), [false, false, true]);
  assert.equal(splits[1].startIndex, splits[0].endIndex, "neighbours share the boundary sample");
  assert.equal(splits[0].avgPower, 200);
  assert.equal(splits[0].avgSpeed, 10);
});

test("a leftover under 200 m merges into the split before, unless the ride is still going", () => {
  const s = samples(215);
  const merged = computeSplits(s, [], { mode: "1" });
  assert.equal(merged.length, 2);
  assert.equal(merged[1].toM, 2150);
  assert.equal(merged[1].partial, false);
  const live = computeSplits(s, [], { mode: "1", final: false });
  assert.equal(live.length, 3);
  assert.equal(live[2].distanceM, 150);
});

test("live: a split that just closed is not the last element", () => {
  const live = computeSplits(samples(100), [], { mode: "1", final: false });
  assert.equal(live.length, 2, "the closed split plus the one just begun");
  assert.equal(live[0].toM, 1000);
  assert.equal(computeSplits(samples(99), [], { mode: "1", final: false }).length, 1);
});

test("a closed pause inside a split is not riding time", () => {
  const s = samples(250);
  for (let i = 31; i < s.length; i += 1) s[i].t += 60_000;
  const pauses = [{ from: s[30].t, to: s[31].t }];
  const splits = computeSplits(s, pauses, { mode: "1" });
  assert.equal(splits[0].durationS, 99, "the interval across the pause is not counted, as in summary()");
  const recorder = RideRecorder.from({ samples: s, pauses });
  assert.equal(splits.reduce((sum, x) => sum + x.durationS, 0), recorder.summary().durationS);
});

test("standing still counts as time", () => {
  const s = samples(30);
  for (let i = 11; i < 31; i += 1) s[i].distance = s[10].distance;
  const splits = computeSplits(s, [], { mode: "1" });
  assert.equal(splits.length, 1);
  assert.equal(splits[0].durationS, 30);
});


test("lap mode: clean laps are numbered, the rest is a free partial split", () => {
  const splits = lap(samples(350));
  assert.deepEqual(splits.map((s) => s.kind), ["lap", "lap", "lap", "free"]);
  assert.deepEqual(splits.map((s) => s.lap), [1, 2, 3, null]);
  assert.deepEqual(splits.map((s) => s.route), ["loop", "loop", "loop", null]);
  assert.equal(splits[3].partial, true);
  assert.equal(splits[0].durationS, 100);
});

test("lap mode: joining mid-loop makes the first stretch a free split", () => {
  const splits = lap(samples(250, { startM: 400 }));
  assert.deepEqual(splits.map((s) => s.kind), ["free", "lap", "free"]);
  assert.equal(splits[0].distanceM, 600);
  assert.equal(splits[1].lap, 1);
});

test("lap mode: leaving the route mid-lap makes that lap a free split", () => {
  const s = samples(350);
  for (let i = 120; i < 170; i += 1) Object.assign(s[i], { route: null, routeM: null });
  const splits = lap(s);
  assert.deepEqual(splits.map((x) => x.kind), ["lap", "free", "lap", "free"]);
  assert.deepEqual(splits.map((x) => x.lap), [1, null, 2, null]);
});

test("lap mode: a route switch is not a lap, and a wrap on the other route is not a crossing for the first", () => {
  const s = samples(250);
  for (let i = 150; i < s.length; i += 1) s[i].route = "other";
  const splits = lap(s);
  assert.equal(splits[0].kind, "lap");
  assert.equal(splits[1].kind, "free", "loop to other");
  assert.ok(splits.every((x) => x.kind !== "lap" || x.route === "loop" || x.startIndex >= 150));
});

test("lap mode: a stretch off the route is cut after 10 km", () => {
  const s = samples(1300, { route: null });
  const splits = lap(s);
  assert.equal(splits[0].kind, "free");
  assert.equal(splits[0].toM, 10_000);
  assert.equal(splits[1].toM, 13_000);
});

test("lap mode: a lap longer than 10 km stays whole", () => {
  const s = samples(3000, { route: "big", L: 12_900, speed: 10 });
  const splits = lap(s);
  assert.deepEqual(splits.map((x) => x.kind), ["lap", "lap", "free"]);
  assert.ok(Math.abs(splits[0].distanceM - 12_900) <= 10);
  assert.ok(Math.abs(splits[1].distanceM - 12_900) <= 10);
});

test("lap mode: samples without a route (old autosave) give one free split per 10 km", () => {
  const s = samples(2500).map((x) => ({ ...x, route: undefined, routeM: undefined }));
  const splits = lap(s);
  assert.ok(splits.every((x) => x.kind === "free"));
  assert.deepEqual(splits.map((x) => x.toM), [10_000, 20_000, 25_000]);
});

test("a ride that never reaches a boundary is one partial split", () => {
  const splits = computeSplits(samples(30), [], { mode: "5" });
  assert.equal(splits.length, 1);
  assert.equal(splits[0].partial, true);
  assert.deepEqual(computeSplits(samples(30, { startM: 400 }), [], { mode: "lap", routeLength }).map((x) => x.kind), ["free"]);
  assert.deepEqual(computeSplits(samples(30), [], { mode: "off" }), []);
  assert.deepEqual(computeSplits(samples(0), [], { mode: "1" }), []);
});

test("imperial: miles are the unit", () => {
  const splits = computeSplits(samples(400), [], { mode: "1", unitM: 1609.344 });
  assert.equal(splits[0].toM, 1610);
});

test("heart rate and elevation gain", () => {
  const s = samples(100, { hr: 140 });
  s.forEach((x, i) => (x.elevation = 100 + (i % 2)));
  const [split] = computeSplits(s, [], { mode: "1" });
  assert.equal(split.avgHeartRate, 140);
  assert.equal(split.elevationGainM, 50);
  assert.equal(computeSplits(samples(100), [], { mode: "1" })[0].avgHeartRate, null);
});

test("compareSplits: free splits are not comparable, the fastest lap is best", () => {
  const s = samples(300);
  s.forEach((x, i) => { if (i > 100 && i <= 200) x.t -= (i - 100) * 200; });
  for (let i = 201; i < s.length; i += 1) s[i].t -= 20_000;
  const splits = lap(s);
  const cmp = compareSplits(splits);
  assert.equal(cmp.length, splits.length);
  assert.ok(cmp[1].best);
  assert.ok(!cmp[0].best);
  assert.ok(cmp[1].speedDelta > 0 && cmp[0].speedDelta < 0);
  assert.equal(compareSplits([{ kind: "free", avgSpeed: 5 }])[0].comparable, false);
  const single = compareSplits([splits[0]]);
  assert.equal(single[0].best, false);
});

test("only the last split can be partial, even when the boundary sample overshoots", () => {
  const s = samples(200, { speed: 37 });
  const splits = computeSplits(s, [], { mode: "1" });
  assert.ok(splits.slice(0, -1).every((x) => !x.partial));
  assert.ok(splits.slice(0, -1).some((x) => x.distanceM < 1000), "the second split is a bit short");
});

test("a jump back across a pause is not a line crossing", () => {
  const s = samples(150, { speed: 10 });
  // After 70 s (700 m into the lap) the rider comes back at the line, 30 s later.
  for (let i = 71; i < s.length; i += 1) {
    s[i].t += 30_000;
    s[i].routeM = ((i - 71) * 10) % 1000;
  }
  const splits = lap(s, {});
  const withPause = computeSplits(s, [{ from: s[70].t, to: s[71].t }], { mode: "lap", routeLength });
  assert.ok(splits.length >= 2, "without the pause info the jump looks like a crossing");
  assert.ok(withPause.every((x) => x.distanceM > 700 || x.partial || x.kind === "free"), "no phantom lap");
  assert.equal(withPause.filter((x) => x.kind === "lap").length, 0);
});
