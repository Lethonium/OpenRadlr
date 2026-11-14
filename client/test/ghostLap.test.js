import { test } from "node:test";
import assert from "node:assert/strict";
import { GhostStore, LapRun, formatLapGap, ghostAt, timeAt } from "../public/js/ride/ghostLap.js";
import { squareRoute } from "./helpers.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** Rides `run` from `fromM` to `toM` (may wrap) at `speed` m/s, one update per `dt` s; returns every event. */
function ride(run, route, { fromM, toM, speed = 10, dt = 0.5, clock, lane = 1 }) {
  const results = [];
  let m = fromM;
  const gap = route.wrap(toM - fromM);
  const steps = Math.round(gap / (speed * dt));
  for (let i = 0; i <= steps; i += 1) {
    results.push(...run.update({ routeId: route.id, routeM: route.wrap(m), lane, clockS: clock.t }));
    m += speed * dt;
    clock.t += dt;
  }
  return results;
}

// --- traces -------------------------------------------------------------------

const trace = { points: [0, 0, 1, 10, 100, 1, 20, 300, 2] };

test("the ghost is where the lap had got to after the same time, between points", () => {
  close(ghostAt(trace, 5).routeM, 50);
  close(ghostAt(trace, 15).routeM, 200);
  close(ghostAt(trace, 15).lane, 1.5);
  close(ghostAt(trace, 15).speed, 20);
});

test("the ghost waits at the line before its start and is gone after its finish", () => {
  assert.equal(ghostAt(trace, -1), null);
  assert.equal(ghostAt(trace, 21), null);
});

test("the time the lap reached a point gives the gap to it", () => {
  close(timeAt(trace, 50), 5);
  close(timeAt(trace, 300), 20);
  assert.equal(timeAt(trace, 301), null);
});

// --- laps ---------------------------------------------------------------------

test("a lap starts at the line and ends at the next crossing", () => {
  const route = squareRoute();
  const run = new LapRun(route);
  const clock = { t: 100 };
  const results = ride(run, route, { fromM: 990, toM: 20, clock });
  assert.deepEqual(results.map((r) => r.type), ["start"]);
  const more = ride(run, route, { fromM: 25, toM: 15, clock });
  const lap = more.find((r) => r.type === "lap");
  assert.ok(lap, "the lap closes at the line");
  close(lap.durationS, route.length / 10, 0.6);
  assert.equal(lap.routeId, route.id);
  assert.ok(more.some((r) => r.type === "start"), "the next lap starts right away");
});

test("a ride that begins just past the line starts a lap at once", () => {
  const route = squareRoute();
  const run = new LapRun(route);
  assert.deepEqual(run.update({ routeId: route.id, routeM: 12, lane: 1, clockS: 0 }).map((e) => e.type), ["start"]);
});

test("joining mid-lap starts no lap until the line", () => {
  const route = squareRoute();
  const run = new LapRun(route);
  const clock = { t: 0 };
  assert.deepEqual(ride(run, route, { fromM: 300, toM: 900, clock }), []);
});

test("the lap's trace starts at the line, has a point about every second and ends at the line", () => {
  const route = squareRoute();
  const run = new LapRun(route);
  const clock = { t: 0 };
  ride(run, route, { fromM: 0, toM: 990, clock, dt: 0.25 });
  const lap = ride(run, route, { fromM: 995, toM: 5, clock, dt: 0.25 }).find((r) => r.type === "lap");
  const points = lap.trace.points;
  assert.equal(points[1], 0);
  close(points.at(-2), route.length);
  close(points.at(-3), lap.durationS);
  const count = points.length / 3;
  assert.ok(count > lap.durationS * 0.9 && count < lap.durationS * 1.2, `${count} points for ${lap.durationS} s`);
});

test("leaving the route, switching routes or jumping drops the lap", () => {
  const route = squareRoute();
  for (const breakIt of [
    (run) => run.update({ routeId: null, routeM: 500, lane: 1, clockS: 50 }),
    (run) => run.update({ routeId: "other", routeM: 500, lane: 1, clockS: 50 }),
    (run) => run.update({ routeId: route.id, routeM: 800, lane: 1, clockS: 50 }),
  ]) {
    const run = new LapRun(route);
    const clock = { t: 0 };
    ride(run, route, { fromM: 0, toM: 450, clock });
    breakIt(run);
    const after = ride(run, route, { fromM: 800, toM: 10, clock });
    assert.ok(!after.some((r) => r.type === "lap"), "no lap");
    assert.ok(after.some((r) => r.type === "start"), "a fresh one starts at the line");
  }
});

test("a route that isn't a loop has no laps", () => {
  const route = squareRoute();
  route.loop = false;
  const run = new LapRun(route);
  assert.deepEqual(run.update({ routeId: route.id, routeM: 5, lane: 1, clockS: 0 }), []);
});

test("the gap is how much later I reach my position than the ghost did", () => {
  const route = squareRoute();
  const run = new LapRun(route);
  const clock = { t: 0 };
  ride(run, route, { fromM: 0, toM: 990, clock });
  const lap = ride(run, route, { fromM: 995, toM: 5, clock }).find((r) => r.type === "lap");
  // Next lap at 8 m/s instead of 10: 25 s slower over 1000 m, so at 500 m about 12.5 s down.
  close(timeAt(lap.trace, 500) + 12.5, 500 / 8, 0.6);
});

// --- best laps -----------------------------------------------------------------

class MemoryStore {
  data = new Map();
  async get(key) {
    return this.data.get(key);
  }
  async put(key, value) {
    this.data.set(key, value);
  }
  async keys() {
    return [...this.data.keys()];
  }
}

const lap = (durationS) => ({ type: "lap", routeId: "square", durationS, trace: { points: [0, 0, 1, durationS, 1000, 1] } });

test("the first lap on a route is its best", async () => {
  const ghosts = new GhostStore({ store: new MemoryStore(), now: () => 1234 });
  const outcome = await ghosts.offer(lap(120));
  assert.deepEqual(outcome, { best: true, previousS: null });
  const best = await ghosts.best("square");
  assert.equal(best.durationS, 120);
  assert.equal(best.recordedAt, 1234);
});

test("only a faster lap replaces the best", async () => {
  const ghosts = new GhostStore({ store: new MemoryStore() });
  await ghosts.offer(lap(120));
  assert.deepEqual(await ghosts.offer(lap(130)), { best: false, previousS: 120 });
  assert.deepEqual(await ghosts.offer(lap(110)), { best: true, previousS: 120 });
  assert.equal((await ghosts.best("square")).durationS, 110);
});

test("no best lap yet is null", async () => {
  assert.equal(await new GhostStore({ store: new MemoryStore() }).best("square"), null);
});

test("a broken store is logged once and the ride goes on without ghosts", async () => {
  const logged = [];
  const broken = { get: () => Promise.reject(new Error("nope")), put: () => Promise.reject(new Error("nope")), keys: () => Promise.reject(new Error("nope")) };
  const ghosts = new GhostStore({ store: broken, log: (...args) => logged.push(args) });
  assert.equal(await ghosts.best("square"), null);
  assert.deepEqual(await ghosts.offer(lap(100)), { best: false, previousS: null });
  assert.equal(logged.length, 1);
});

test("all lists the best lap per route without traces", async () => {
  const ghosts = new GhostStore({ store: new MemoryStore(), now: () => 5 });
  await ghosts.offer({ ...lap(300), routeId: "b" });
  await ghosts.offer({ ...lap(200), routeId: "a" });
  assert.deepEqual(await ghosts.all(), [{ routeId: "a", durationS: 200, recordedAt: 5 }, { routeId: "b", durationS: 300, recordedAt: 5 }]);
});

test("all is empty when storage fails", async () => {
  const broken = { get: () => Promise.reject(new Error("nope")), put: () => Promise.reject(new Error("nope")), keys: () => Promise.reject(new Error("nope")) };
  assert.deepEqual(await new GhostStore({ store: broken, log: () => {} }).all(), []);
});

test("the gap reads as behind (+) or ahead (−), in minutes from a minute on", () => {
  assert.equal(formatLapGap(4.24), "+4.2 s");
  assert.equal(formatLapGap(-4.24), "−4.2 s");
  assert.equal(formatLapGap(0.01), "±0.0 s");
  assert.equal(formatLapGap(65), "+1:05");
});
