import { test } from "node:test";
import assert from "node:assert/strict";
import { classPosition, classWorkout, targetWatts } from "../public/js/studio/classClock.js";
import { studioBoard } from "../public/js/studio/board.js";
import { StudioSession } from "../public/js/studio/studioSession.js";

const plan = {
  id: "demo",
  name: "Demo",
  duration_s: 300,
  segments: [
    { duration_s: 100, from: 0.5, to: 0.7, cadence: [85, 95], cue: "Warm up" },
    { duration_s: 60, from: 1.2, to: 1.2, cadence: [95, 110], cue: "Go!" },
    { duration_s: 140, from: 0.5, to: 0.5, cadence: null, cue: "Easy" },
  ],
};

test("before the class: lobby with a countdown and the first block ahead", () => {
  const lobby = classPosition(plan, -42.3);
  assert.equal(lobby.phase, "lobby");
  assert.equal(lobby.startsInS, 43);
  assert.equal(lobby.target, null);
  assert.equal(lobby.next.cue, "Warm up");
});

test("during the class: block, ramped target, cadence cue, countdowns and what's next", () => {
  const at = classPosition(plan, 50);
  assert.equal(at.phase, "class");
  assert.equal(at.index, 0);
  assert.ok(Math.abs(at.target - 0.6) < 1e-9, "half-way up the ramp");
  assert.deepEqual(at.cadence, [85, 95]);
  assert.equal(at.cue, "Warm up");
  assert.equal(at.blockRemainingS, 50);
  assert.equal(at.classRemainingS, 250);
  assert.equal(at.next.cue, "Go!");

  const last = classPosition(plan, 200);
  assert.equal(last.index, 2);
  assert.equal(last.cadence, null);
  assert.equal(last.next, null);
});

test("after the class: done", () => {
  assert.equal(classPosition(plan, 300).phase, "done");
  assert.equal(classPosition(plan, 300).target, null);
});

test("targets turn into watts from the rider's FTP and intensity", () => {
  assert.equal(targetWatts(0.75, 240), 180);
  assert.equal(targetWatts(0.75, 240, 1.1), 198);
  assert.equal(targetWatts(null, 240), null);
});

test("a class plan becomes a workout for the block chart", () => {
  const workout = classWorkout(plan);
  assert.equal(workout.name, "Demo");
  assert.deepEqual(
    workout.segments.map((s) => [s.durationS, s.from, s.to, s.kind]),
    [
      [100, 0.5, 0.7, "ramp"],
      [60, 1.2, 1.2, "on"],
      [140, 0.5, 0.5, "off"],
    ],
  );
});

test("the room board ranks by time on target, then work", () => {
  const riders = [
    { id: 1, name: "Anna", is_bot: false, on_target_pct: 80, class_kj: 90 },
    { id: 2, name: "Swift Fox", is_bot: true, on_target_pct: 92, class_kj: 70 },
    { id: 3, name: "Ben", is_bot: false, on_target_pct: 80, class_kj: 120 },
    { id: 4, name: "Late", is_bot: false, on_target_pct: null, class_kj: 0 },
  ];
  const board = studioBoard(riders, 1);
  assert.deepEqual(
    board.map((r) => [r.rank, r.name, r.onTarget, r.me]),
    [
      [1, "Swift Fox", "92 %", false],
      [2, "Ben", "80 %", false],
      [3, "Anna", "80 %", true],
      [4, "Late", "–", false],
    ],
  );
  assert.equal(board[1].kj, "120 kJ");
});

const catalog = { classes: [plan, { ...plan, id: "other", name: "Other" }] };
const state = (elapsed, riders = []) => ({ type: "studio_state", room: 0, rooms: 1, class: { id: "demo", name: "Demo", starts_at_s: 1000, elapsed_s: elapsed }, riders });

test("the session follows the server clock between updates", () => {
  const session = new StudioSession({ catalog, ftp: 200, canControl: true });
  assert.equal(session.position(5), null, "nothing before the first state");
  session.update(state(40), 10);
  assert.equal(session.elapsed(10), 40);
  assert.equal(session.elapsed(12.5), 42.5, "runs on between server updates");
  assert.equal(session.plan.id, "demo");
  assert.equal(session.position(20).index, 0);
});

test("ERG holds the class target times intensity; the lobby spins easy", () => {
  const session = new StudioSession({ catalog, ftp: 200, canControl: true });
  session.update(state(-30), 0);
  assert.equal(session.targetWatts(0), 100, "lobby: 50 % FTP");
  session.update(state(120), 0);
  assert.equal(session.targetWatts(0), 240, "the 120 % block");
  session.adjust(+1);
  assert.equal(session.intensity, 1.05);
  assert.equal(session.targetWatts(0), 252);
  assert.deepEqual(session.command(() => ({ grade: 0 }), 0), { power: 252 });
  session.setErg(false);
  assert.deepEqual(session.command(() => ({ grade: 0 }), 0), { grade: 0 }, "free riding: the rider shifts");
});

test("power-only trainers can't do ERG but still get targets", () => {
  const session = new StudioSession({ catalog, ftp: 200, canControl: false });
  assert.equal(session.erg, false);
  assert.equal(session.setErg(true), false);
  session.update(state(120), 0);
  assert.equal(session.targetWatts(0), 240);
  assert.deepEqual(session.command(() => 1.5, 0), 1.5);
});

test("a new block is announced once", () => {
  const session = new StudioSession({ catalog, ftp: 200, canControl: true });
  session.update(state(98), 0);
  assert.equal(session.newCue(0)?.cue, "Warm up", "the first block on joining");
  assert.equal(session.newCue(1), null);
  assert.equal(session.newCue(2.5)?.cue, "Go!");
  assert.equal(session.newCue(3), null);
});
