import { test } from "node:test";
import assert from "node:assert/strict";
import { RidePause, PAUSE } from "../public/js/ride/ridePause.js";

const DT = 0.25;

/** Drives `pause.update` every 0.25 s from `from` for `seconds`; returns the non-empty results with their time. */
function run(pause, from, seconds, input) {
  const out = [];
  for (let t = from + DT; t <= from + seconds + 1e-9; t += DT) {
    const actions = pause.update({ now: t, offline: false, speed: 0, power: 0, ...input });
    if (actions.length) out.push({ t, actions });
  }
  return out;
}

/** A pause that has seen the rider move, so auto-pause is armed. */
function moving(options = {}) {
  const pause = new RidePause(options);
  assert.deepEqual(run(pause, 0, 2, { speed: 6, power: 150 }), []);
  return pause;
}

test("toggle while riding parks and stops the timer", () => {
  const pause = new RidePause();
  assert.deepEqual(pause.toggle(10), ["pauseTimer", "park"]);
  assert.equal(pause.state, "parked");
  assert.equal(pause.pausedAt, 10);
});

test("toggle while parked resumes", () => {
  const pause = new RidePause();
  pause.toggle(10);
  assert.deepEqual(pause.toggle(20), ["resumeTimer", "unpark"]);
  assert.equal(pause.state, "riding");
  assert.equal(pause.pausedAt, null);
});

test("toggle while auto-paused only parks", () => {
  const pause = moving({ autoPause: true });
  run(pause, 2, 3.5, { speed: 0 });
  assert.equal(pause.state, "stopped");
  assert.deepEqual(pause.toggle(6), ["park"]);
  assert.equal(pause.state, "parked");
});

test("auto-pause after 3 s under 1 km/h", () => {
  const pause = moving({ autoPause: true });
  // The first slow sample is at 2.25 s: 2.75 s later still no pause, at 3 s it is.
  const early = run(pause, 2, 3, { speed: 0.1 });
  assert.deepEqual(early, []);
  const result = run(pause, 5, 0.25, { speed: 0.1 });
  assert.deepEqual(result.map((r) => r.actions), [["pauseTimer"]]);
  assert.equal(pause.state, "stopped");
});

test("a 2 s stop is no pause", () => {
  const pause = moving({ autoPause: true });
  assert.deepEqual(run(pause, 2, 2, { speed: 0.1 }), []);
  assert.deepEqual(run(pause, 4, 10, { speed: 5 }), []);
  assert.deepEqual(run(pause, 14, 2.5, { speed: 0.1 }), []);
  assert.equal(pause.state, "riding");
});

test("auto-pause is off by default", () => {
  const pause = moving();
  assert.deepEqual(run(pause, 2, 60, { speed: 0 }), []);
});

test("standing at the start of a ride is no stop", () => {
  const pause = new RidePause({ autoPause: true });
  assert.deepEqual(run(pause, 0, 60, { speed: 0 }), []);
});

test("riding off from stopped resumes", () => {
  const pause = moving({ autoPause: true });
  run(pause, 2, 3.5, { speed: 0 });
  assert.equal(pause.state, "stopped");
  assert.deepEqual(pause.update({ now: 6, speed: 0.5, power: 0, offline: false }), ["resumeTimer"]);
  assert.equal(pause.state, "riding");
});

test("stopped parks 10 s after the timer stopped", () => {
  const pause = moving({ autoPause: true });
  const result = run(pause, 2, 14, { speed: 0 });
  const stoppedAt = pause.pausedAt;
  assert.deepEqual(result.map((r) => r.actions), [["pauseTimer"], ["park"]]);
  assert.equal(result[1].t - stoppedAt, PAUSE.parkAfterS);
  assert.equal(pause.state, "parked");
});

test("a descent at 0 W never auto-pauses", () => {
  const pause = moving({ autoPause: true });
  assert.deepEqual(run(pause, 2, 120, { speed: 12, power: 0 }), []);
});

test("pedalling resumes a parked ride after 2 s at 30 W", () => {
  const pause = new RidePause();
  pause.toggle(0);
  assert.deepEqual(run(pause, 0, 5, { speed: 0, power: 29 }), []);
  const result = run(pause, 5, 3, { speed: 0, power: 30 });
  assert.deepEqual(result.map((r) => r.actions), [["resumeTimer", "unpark"]]);
  assert.equal(result[0].t - (5 + DT), PAUSE.resumeS);
  assert.equal(pause.state, "riding");
});

test("pausing mid-stroke sticks: pedalling resumes only after the rider stopped once", () => {
  const pause = new RidePause();
  pause.toggle(0);
  assert.deepEqual(run(pause, 0, 30, { speed: 5, power: 150 }), []);
  assert.equal(pause.state, "parked");
  run(pause, 30, 1, { speed: 5, power: 0 });
  const result = run(pause, 31, 3, { speed: 5, power: 150 });
  assert.deepEqual(result.map((r) => r.actions), [["resumeTimer", "unpark"]]);
});

test("pedalling that stops again starts the 2 s over", () => {
  const pause = new RidePause();
  pause.toggle(0);
  run(pause, 0, 1.5, { power: 100 });
  run(pause, 1.5, 0.5, { power: 0 });
  assert.deepEqual(run(pause, 2, 1.75, { power: 100 }), []);
});

test("riding off after a resume does not auto-pause before the first pedal stroke", () => {
  const pause = moving({ autoPause: true });
  pause.toggle(5);
  pause.toggle(6);
  assert.deepEqual(run(pause, 6, 30, { speed: 0 }), []);
});

test("leave after 30 min paused, once", () => {
  const pause = new RidePause();
  pause.toggle(100);
  assert.deepEqual(pause.update({ now: 100 + PAUSE.leaveAfterS - 1, speed: 0, power: 0, offline: false }), []);
  assert.deepEqual(pause.update({ now: 100 + PAUSE.leaveAfterS, speed: 0, power: 0, offline: false }), ["leave"]);
  assert.deepEqual(pause.update({ now: 100 + PAUSE.leaveAfterS + 1, speed: 0, power: 0, offline: false }), []);
});

test("offline freezes", () => {
  const pause = moving({ autoPause: true });
  assert.deepEqual(run(pause, 2, 30, { speed: 0, offline: true }), []);
  assert.equal(pause.state, "riding");
  pause.toggle(40);
  assert.deepEqual(run(pause, 40, 60, { speed: 0, power: 200, offline: true }), []);
  assert.equal(pause.state, "parked");
});

test("allowed false forces riding", () => {
  const pause = new RidePause({ autoPause: true });
  pause.toggle(10);
  pause.allowed = false;
  assert.deepEqual(pause.update({ now: 11, speed: 0, power: 0, offline: false }), ["resumeTimer", "unpark"]);
  assert.equal(pause.state, "riding");
  assert.deepEqual(pause.toggle(12), []);
  assert.deepEqual(run(pause, 12, 20, { speed: 0 }), []);
});

test("allowed false while auto-paused only resumes the timer", () => {
  const pause = moving({ autoPause: true });
  run(pause, 2, 3.5, { speed: 0 });
  pause.allowed = false;
  assert.deepEqual(pause.update({ now: 6, speed: 0, power: 0, offline: false }), ["resumeTimer"]);
});

test("rejected drops back to riding", () => {
  const pause = new RidePause();
  pause.toggle(10);
  assert.deepEqual(pause.rejected(11), ["resumeTimer"]);
  assert.equal(pause.state, "riding");
  assert.deepEqual(pause.rejected(12), []);
});
