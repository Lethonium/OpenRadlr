import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorGoalBoards, planGoalBoards, resolvePending } from "../public/js/ride/goalBoards.js";

const week = (extra) => ({ step: 80_000, soFar: 0, done: false, finished: false, reached: false, ...extra });
const total = (extra, goal) => ({ goal: { kind: "total", metric: "distance", routeId: null, ...goal }, week: week(extra) });
const route = { routeId: "hills", routeLength: 20_000, loop: false };
const ats = (boards) => boards.map((b) => b.at.rideM);

test("a week of 80 km with 62 km ridden gets boards at 18000 m and 16000 m", () => {
  const boards = planGoalBoards([total({ soFar: 62_000 })], route);
  assert.deepEqual(ats(boards).sort((a, b) => a - b), [16_000, 18_000]);
});

test("with 1200 m left only the finishing board is planned", () => {
  const boards = planGoalBoards([total({ soFar: 78_800 })], route);
  assert.deepEqual(ats(boards), [1200]);
});

test("a long ride of 50 km gets boards 5 km before and at the step", () => {
  const entries = [{ goal: { kind: "long", metric: "distance" }, week: week({ step: 50_000 }) }];
  assert.deepEqual(ats(planGoalBoards(entries, route)).sort((a, b) => a - b), [45_000, 50_000]);
});

test("a long ride of 20 km leads by a tenth of the step", () => {
  const entries = [{ goal: { kind: "long", metric: "distance" }, week: week({ step: 20_000 }) }];
  assert.deepEqual(ats(planGoalBoards(entries, route)).sort((a, b) => a - b), [18_000, 20_000]);
});

test("a lap goal on another route gets no board, on this route one near the lap's end", () => {
  const lap = { goal: { kind: "lap", metric: "time", routeId: "other" }, week: week({ step: 1200 }) };
  assert.deepEqual(planGoalBoards([lap], route), []);
  const mine = { goal: { ...lap.goal, routeId: "hills" }, week: lap.week };
  const boards = planGoalBoards([mine], route);
  assert.equal(boards.length, 1);
  assert.equal(boards[0].at.lapM, 19_600);
});

test("no board for a reached step", () => {
  for (const extra of [{ done: true }, { reached: true }, { finished: true }, { step: null }]) {
    assert.deepEqual(planGoalBoards([total({ soFar: 62_000, ...extra })], route), [], JSON.stringify(extra));
  }
});

test("a time goal is a pending board with the seconds left", () => {
  const entries = [{ goal: { kind: "total", metric: "time" }, week: week({ step: 7200, soFar: 5400 }) }];
  const [board] = planGoalBoards(entries, route);
  assert.deepEqual(board.at, { pending: { metric: "time", remaining: 1800 } });
});

test("a pending time board resolves to the distance at the current speed", () => {
  const board = { at: { pending: { metric: "time", remaining: 1800 } } };
  assert.equal(resolvePending(board, { distanceM: 10_000, durationS: 600, elevationGainM: 0, speedMps: 8 }), 19_600);
});

test("no projection while stopped", () => {
  const board = { at: { pending: { metric: "time", remaining: 1800 } } };
  assert.equal(resolvePending(board, { distanceM: 10_000, durationS: 600, elevationGainM: 0, speedMps: 0.5 }), null);
});

test("a climb board projects from the climbing rate and gives up on flat rides", () => {
  const board = { at: { pending: { metric: "climb", remaining: 300 } } };
  assert.equal(resolvePending(board, { distanceM: 10_000, durationS: 1000, elevationGainM: 100, speedMps: 8 }), 10_000 + (300 - 100) / 0.01);
  assert.equal(resolvePending(board, { distanceM: 10_000, durationS: 1000, elevationGainM: 5, speedMps: 8 }), null);
});

const at = (rideM, id = "a") => ({ id, text: id, at: { rideM } });
const here = (rideM, routeDistance, extra) => ({ rideM, routeId: "hills", routeDistance, routeLength: 20_000, loop: false, ...extra });

test("a board 2000 m ahead is not anchored; at 1400 m it is, then it stays put", () => {
  const anchored = new Map();
  assert.deepEqual(anchorGoalBoards([at(2000)], anchored, here(0, 500)), []);
  const [near] = anchorGoalBoards([at(2000)], anchored, here(600, 1100));
  assert.equal(near.distance, 2500);
  const [later] = anchorGoalBoards([at(2000)], anchored, here(700, 1200));
  assert.equal(later.distance, 2500);
});

test("a board passed by more than 50 m is gone for good", () => {
  const anchored = new Map();
  anchorGoalBoards([at(1000)], anchored, here(900, 900));
  assert.deepEqual(anchorGoalBoards([at(1000)], anchored, here(1049, 1049)).length, 1);
  assert.deepEqual(anchorGoalBoards([at(1000)], anchored, here(1051, 1051)), []);
  assert.deepEqual(anchorGoalBoards([at(1000)], anchored, here(1000, 1000)), []);
});

test("on a loop the anchor wraps around the start", () => {
  const anchored = new Map();
  const [board] = anchorGoalBoards([at(1000)], anchored, { rideM: 0, routeId: "hills", routeDistance: 4500, routeLength: 5000, loop: true });
  assert.equal(board.distance, 500);
});

test("anchors on the current route and drops a board when the rider leaves it", () => {
  const anchored = new Map();
  assert.equal(anchorGoalBoards([at(1000)], anchored, here(0, 0))[0].routeId, "hills");
  assert.deepEqual(anchorGoalBoards([at(1000)], anchored, here(100, 100, { routeId: "other" })), []);
  assert.deepEqual(anchorGoalBoards([at(1000)], anchored, here(200, 200)), []);
});

test("never more than two, nearest first", () => {
  const anchored = new Map();
  const planned = [at(1400, "c"), at(300, "a"), at(900, "b")];
  assert.deepEqual(anchorGoalBoards(planned, anchored, here(0, 0)).map((b) => b.id), ["a", "b"]);
});

test("a lap board anchors every lap", () => {
  const anchored = new Map();
  const lap = { id: "lap", text: "lap", at: { lapM: 4600 } };
  const ctx = (routeDistance) => ({ rideM: 0, routeId: "hills", routeDistance, routeLength: 5000, loop: true });
  assert.equal(anchorGoalBoards([lap], anchored, ctx(3500))[0].distance, 4600);
  assert.deepEqual(anchorGoalBoards([lap], anchored, ctx(4700)), []);
  assert.deepEqual(anchorGoalBoards([lap], anchored, ctx(1000)), []);
  assert.equal(anchorGoalBoards([lap], anchored, ctx(3800))[0].distance, 4600);
});
