import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlan } from "../public/js/workout/plan.js";
import { WorkoutSession } from "../public/js/workout/workoutSession.js";

// Get ready 0-30, squats 30-40, rest 40-45, pushups 45-55
const plan = () =>
  createPlan({
    id: "p1",
    name: "Test circuit",
    blocks: [
      { kind: "exercise", exercise: "squats", seconds: 10 },
      { kind: "rest", seconds: 5 },
      { kind: "exercise", exercise: "pushups", seconds: 10 },
    ],
  });

function setup(startAt = 0) {
  const clock = { t: startAt };
  const session = new WorkoutSession({ plan: plan(), now: () => clock.t });
  return { clock, session };
}

const sends = (actions) => actions.filter((a) => a[0] === "send");

test("starts with get ready and sends rest", () => {
  const { session } = setup();
  assert.deepEqual(session.tick(), [["send", null]]);
  assert.equal(session.state, "ready");
  assert.equal(session.currentExercise(), null);
});

test("sends each exercise once when its block starts", () => {
  const { clock, session } = setup();
  session.tick();
  clock.t = 30;
  assert.deepEqual(session.tick(), [["send", "squats"]]);
  assert.equal(session.state, "block");
  clock.t = 31;
  assert.deepEqual(sends(session.tick()), []);
});

test("cues each of the last three seconds of a block", () => {
  const { clock, session } = setup();
  session.tick();
  const cuesAt = (t) => {
    clock.t = t;
    return session.tick().filter((a) => a[0] === "cue").length;
  };
  assert.deepEqual([26, 27, 28, 29].map(cuesAt), [0, 1, 1, 1]);
  assert.equal(cuesAt(29.5), 0);
});

test("pause freezes the clock and sends rest", () => {
  const { clock, session } = setup();
  clock.t = 32;
  session.tick();
  assert.deepEqual(session.pause(), [["send", null]]);
  assert.equal(session.state, "paused");
  const before = session.position().elapsedS;
  clock.t += 100;
  assert.deepEqual(session.tick(), []);
  assert.equal(session.position().elapsedS, before);
});

test("resume re-sends the block's exercise", () => {
  const { clock, session } = setup();
  clock.t = 32;
  session.tick();
  session.pause();
  clock.t += 100;
  assert.deepEqual(session.resume(), [["send", "squats"]]);
  assert.equal(session.state, "block");
});

test("a pause at a block's end neither skips nor repeats the next block", () => {
  const { clock, session } = setup();
  clock.t = 39.8;
  session.tick();
  session.pause();
  clock.t += 50;
  session.resume();
  assert.equal(session.currentExercise(), "squats");
  clock.t += 0.1;
  assert.deepEqual(sends(session.tick()), []);
  clock.t += 0.2; // now in the rest block
  assert.deepEqual(sends(session.tick()), [["send", null]]);
  clock.t += 5; // elapsed 45.1: the pushups block
  const pushups = sends(session.tick());
  assert.deepEqual(pushups, [["send", "pushups"]]);
  clock.t += 1;
  assert.deepEqual(sends(session.tick()), []);
});

test("skip ends the block and counts it as skipped", () => {
  const { clock, session } = setup();
  clock.t = 31;
  session.tick();
  const actions = session.skip();
  assert.deepEqual(sends(actions), [["send", null]]);
  assert.equal(session.position().index, 2);
  clock.t = 41;
  session.tick();
  clock.t = 56;
  session.tick();
  assert.deepEqual(
    [session.record().blocksDone, session.record().blocksSkipped],
    [1, 1],
  );
});

test("the end of the plan finishes once", () => {
  const { clock, session } = setup();
  clock.t = 54;
  session.tick();
  clock.t = 55;
  assert.deepEqual(session.tick(), [["send", null], ["finished"]]);
  assert.equal(session.state, "done");
  clock.t = 60;
  assert.deepEqual(session.tick(), []);
  assert.deepEqual(session.end(), []);
});

test("end during get ready leaves no record", () => {
  const { clock, session } = setup();
  session.tick();
  clock.t = 10;
  assert.deepEqual(session.end(), [["finished"]]);
  assert.equal(session.state, "done");
  assert.equal(session.record(), null);
});

test("a record is available without end when an exercise block was done", () => {
  const { clock, session } = setup();
  clock.t = 41;
  session.tick();
  assert.equal(session.record().blocksDone, 1);
});

test("end while an exercise is running sends rest and finishes", () => {
  const { clock, session } = setup();
  clock.t = 35;
  session.tick();
  assert.deepEqual(session.end(), [["send", null], ["finished"]]);
  assert.equal(session.record(), null);
});

test("a finished workout makes a history record", () => {
  const { clock, session } = setup(100);
  session.tick();
  session.heartRate(120);
  session.heartRate(NaN);
  session.heartRate(160);
  clock.t = 140;
  session.tick();
  session.pause();
  clock.t = 150;
  session.resume();
  clock.t = 170;
  session.tick();
  assert.equal(session.state, "done");
  assert.deepEqual(session.record(), {
    version: 2,
    kind: "workout",
    id: "100000",
    planId: "p1",
    planName: "Test circuit",
    startedAt: 100000,
    endedAt: 170000,
    durationS: 70,
    activeS: 20,
    blocksDone: 2,
    blocksSkipped: 0,
    hr: { avg: 140, max: 160 },
    measured: false,
  });
});

test("a record without heart rate has hr null", () => {
  const { clock, session } = setup();
  clock.t = 60;
  session.tick();
  assert.equal(session.record().hr, null);
});

test("skipping lands exactly on the end of the block", () => {
  const { clock, session } = setup();
  clock.t = 30.1;
  session.tick();
  session.skip();
  assert.equal(session.position().remainingS, 15);
});

test("a skipped block counts only the time spent in it as elapsed, while the remaining time drops by the whole block", () => {
  const { clock, session } = setup();
  clock.t = 2;
  session.tick();
  session.skip();
  const position = session.position();
  assert.deepEqual([position.elapsedS, position.remainingS], [2, 55 - 30]);
});

test("time spent keeps counting after a skip and not while paused", () => {
  const { clock, session } = setup();
  clock.t = 2;
  session.tick();
  session.skip();
  clock.t = 5;
  session.tick();
  session.pause();
  clock.t = 50;
  assert.equal(session.position().elapsedS, 5);
});

test("the record is stamped with the wall clock when one is given", () => {
  const clock = { t: 5 };
  const wall = { ms: 1_700_000_000_000 };
  const session = new WorkoutSession({ plan: plan(), now: () => clock.t, wallNow: () => wall.ms });
  clock.t = 46;
  session.tick();
  wall.ms += 41_000;
  session.end();
  const record = session.record();
  assert.deepEqual([record.id, record.startedAt, record.endedAt, record.durationS], ["1700000000000", 1_700_000_000_000, 1_700_000_041_000, 41]);
});

test("a workout is completed when the plan ran out, not when it was ended early", () => {
  const early = setup();
  early.clock.t = 40;
  early.session.tick();
  early.session.end();
  assert.equal(early.session.completed, false);
  const full = setup();
  full.clock.t = 56;
  full.session.tick();
  assert.equal(full.session.completed, true);
});
