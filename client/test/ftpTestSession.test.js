import { test } from "node:test";
import assert from "node:assert/strict";
import { FtpTestSession } from "../public/js/ride/ftpTestSession.js";
import { rampTargetAt } from "../public/js/ride/ftpTest.js";
import { Emitter } from "../public/js/util/emitter.js";

class FakeTraining extends Emitter {
  ftp = 200;
  workout = null;
  options = null;
  stopped = 0;
  elapsedS = 0;
  mode = "erg";
  held = false;
  player = null;
  setMode(mode) {
    this.mode = mode;
  }
  startWorkout(workout, options) {
    this.workout = workout;
    this.options = options;
    this.player = { paused: false };
    this.emit("change");
  }
  stopWorkout() {
    if (!this.workout) return;
    this.workout = null;
    this.player = null;
    this.stopped += 1;
    this.emit("change");
  }
  workoutState() {
    return this.workout ? { elapsedS: this.elapsedS } : null;
  }
}

function setup() {
  const training = new FakeTraining();
  const clock = { ms: 0 };
  const samples = [];
  const session = new FtpTestSession({ training, getSamples: () => samples, now: () => clock.ms });
  const results = [];
  session.on("result", (r) => results.push(r));
  const ride = (seconds, power) => {
    for (let i = 0; i < seconds; i += 1) {
      clock.ms += 1000;
      samples.push({ t: clock.ms, power: typeof power === "function" ? power(i) : power });
    }
  };
  return { training, clock, samples, session, results, ride };
}

function toRamp(ctx) {
  const { session, ride, clock } = ctx;
  session.begin();
  ride(300, 150);
  session.proceed();
  session.start();
  clock.ms += 3000;
  session.tick(0, { power: 0 });
}

test("happy path: warmup, settings, countdown, ramp to the best minute, result", () => {
  const ctx = setup();
  const { session, training, results, clock } = ctx;
  session.begin();
  ctx.ride(300, 150);
  session.proceed();
  assert.equal(session.state, "settings");
  assert.equal(session.startW, 90);
  assert.equal(session.stepW, 10);
  session.start();
  assert.equal(session.state, "countdown");
  clock.ms += 2000;
  session.tick(0, { power: 0 });
  assert.equal(session.state, "countdown");
  clock.ms += 1000;
  session.tick(0, { power: 0 });
  assert.equal(session.state, "ramp");
  assert.equal(session.testFlag, "ramp");
  assert.equal(training.options.locked, true);
  assert.equal(training.workout.name, "FTP ramp test");

  for (let s = 1; s <= 600 && session.state === "ramp"; s += 1) {
    training.elapsedS = s;
    session.tick(s, { power: rampTargetAt(90, 10, s - 1) });
  }
  assert.equal(session.state, "ramp");
  for (let s = 601; s <= 700 && session.state === "ramp"; s += 1) {
    training.elapsedS = s;
    session.tick(s, { power: 100 });
  }
  assert.equal(session.state, "result");
  assert.equal(results.length, 1);
  // the best rolling minute is the one just before the drop
  assert.equal(session.result.ftp, Math.round(0.75 * session.result.bestMinuteW));
  assert.ok(session.result.bestMinuteW > 140);
  assert.ok(training.stopped >= 1);
});

test("one sample per whole workout second, no duplicates or gaps", () => {
  const ctx = setup();
  toRamp(ctx);
  ctx.training.elapsedS = 0.4;
  ctx.session.tick(0, { power: 100 });
  ctx.training.elapsedS = 3.2;
  ctx.session.tick(1, { power: 100 });
  ctx.session.tick(2, { power: 100 });
  ctx.training.elapsedS = 400;
  for (let s = 4; s <= 400; s += 1) ctx.session.tick(s, { power: 200 });
  ctx.session.done();
  assert.equal(ctx.session.result.durationS, 400);
});

test("done() after three minutes is too short", () => {
  const ctx = setup();
  toRamp(ctx);
  for (let s = 1; s <= 180; s += 1) {
    ctx.training.elapsedS = s;
    ctx.session.tick(s, { power: 100 });
  }
  ctx.session.done();
  assert.equal(ctx.session.state, "result");
  assert.deepEqual(ctx.session.result, { tooShort: true });
  assert.deepEqual(ctx.results, [{ tooShort: true }]);
});

test("cancel in warmup and in the ramp goes idle without a result", () => {
  const a = setup();
  a.session.begin();
  a.session.cancel();
  assert.equal(a.session.state, "idle");
  const b = setup();
  toRamp(b);
  b.session.cancel();
  assert.equal(b.session.state, "idle");
  assert.equal(b.training.workout, null);
  assert.equal(b.results.length, 0);
});

test("settings are clamped and back() returns to the warmup", () => {
  const { session, ride } = setup();
  session.begin();
  ride(60, 150);
  session.proceed();
  session.setStart(10);
  session.setStep(100);
  assert.equal(session.startW, 50);
  assert.equal(session.stepW, 40);
  session.setStart(1000);
  session.setStep(1);
  assert.equal(session.startW, 400);
  assert.equal(session.stepW, 5);
  session.back();
  assert.equal(session.state, "warmup");
});

test("liveMinuteW is null under 15 s, then the mean of the last 60 s", () => {
  const { session, ride } = setup();
  session.begin();
  ride(10, 100);
  assert.equal(session.liveMinuteW(), null);
  ride(50, 100);
  ride(30, 200);
  // last 60 samples: 30 at 100, 30 at 200
  assert.equal(session.liveMinuteW(), 150);
});

test("stopping the workout from outside ends the test with a result", () => {
  const ctx = setup();
  toRamp(ctx);
  for (let s = 1; s <= 120; s += 1) {
    ctx.training.elapsedS = s;
    ctx.session.tick(s, { power: 100 });
  }
  ctx.training.stopWorkout();
  assert.equal(ctx.session.state, "result");
  assert.equal(ctx.results.length, 1);
});

test("reset returns to idle but keeps the test flag", () => {
  const ctx = setup();
  toRamp(ctx);
  ctx.session.done();
  ctx.session.reset();
  assert.equal(ctx.session.state, "idle");
  assert.equal(ctx.session.testFlag, "ramp");
});

test("begin() frees the warmup: no workout, simulation mode", () => {
  const ctx = setup();
  ctx.training.startWorkout({ name: "other" }, {});
  ctx.training.setMode("erg");
  ctx.session.begin();
  assert.equal(ctx.training.workout, null);
  assert.equal(ctx.training.mode, "sim");
});

test("a rider who stops pedalling fails the ramp after the hold time", () => {
  const ctx = setup();
  toRamp(ctx);
  for (let s = 1; s <= 400; s += 1) {
    ctx.training.elapsedS = s;
    ctx.session.tick(s, { power: rampTargetAt(90, 10, s - 1) });
  }
  assert.equal(ctx.session.state, "ramp");
  // the workout clock stands still while the player is paused
  ctx.training.player.paused = true;
  for (let i = 0; i < 10; i += 1) {
    ctx.clock.ms += 1000;
    ctx.session.tick(400, { power: 0 });
  }
  assert.equal(ctx.session.state, "ramp");
  ctx.training.player.paused = false;
  ctx.clock.ms += 1000;
  ctx.session.tick(400, { power: 100 });
  // resuming resets the stop
  ctx.training.player.paused = true;
  for (let i = 0; i < 10; i += 1) {
    ctx.clock.ms += 1000;
    ctx.session.tick(400, { power: 0 });
  }
  assert.equal(ctx.session.state, "ramp");
  ctx.clock.ms += 1000;
  ctx.session.tick(400, { power: 0 });
  assert.equal(ctx.session.state, "result");
  assert.equal(ctx.results.length, 1);
});

test("a paused ride (held) does not fail the ramp", () => {
  const ctx = setup();
  toRamp(ctx);
  ctx.training.elapsedS = 120;
  ctx.session.tick(120, { power: 150 });
  ctx.training.player.paused = true;
  ctx.training.held = true;
  for (let i = 0; i < 30; i += 1) {
    ctx.clock.ms += 1000;
    ctx.session.tick(120, { power: 0 });
  }
  assert.equal(ctx.session.state, "ramp");
});
