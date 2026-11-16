/**
 * The optional frame-rate read-out (#117).
 *
 * Its job is to make a scene's cost measurable on real hardware, so the
 * numbers in a bug report or a pull request are the rider's, not a guess.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FpsMeter, formatFps } from "../public/js/view/fpsMeter.js";

/** Feeds `count` frames a fixed `delta` apart, starting after `start`. */
function run(meter, count, delta, start = 0) {
  let now = start;
  for (let i = 0; i < count; i += 1) {
    meter.frame(now);
    now += delta;
  }
  return now;
}

test("it says nothing until it has seen a few frames", () => {
  const meter = new FpsMeter();
  assert.equal(meter.read(), null);
  meter.frame(0);
  assert.equal(meter.read(), null, "the first frame has no interval yet");
  meter.frame(1 / 60);
  assert.equal(meter.read(), null, "one interval is not a rate worth showing");
  meter.frame(2 / 60);
  assert.notEqual(meter.read(), null);
});

test("steady frames report their rate", () => {
  const meter = new FpsMeter();
  run(meter, 120, 1 / 60);
  const { fps } = meter.read();
  assert.ok(Math.abs(fps - 60) < 0.5, `expected 60 fps, got ${fps}`);
});

test("a slow stretch lowers the mean", () => {
  const meter = new FpsMeter();
  run(meter, 60, 1 / 60);
  run(meter, 60, 1 / 30, 60 / 60);
  const { fps } = meter.read();
  assert.ok(fps < 55 && fps > 35, `expected something between 35 and 55, got ${fps}`);
});

test("the 1% low reports the stutters the mean hides", () => {
  const meter = new FpsMeter();
  run(meter, 200, 1 / 60);
  // A short stall: a few frames at 10 fps.
  let now = 200 / 60;
  for (let i = 0; i < 3; i += 1) {
    meter.frame(now);
    now += 0.1;
  }
  run(meter, 100, 1 / 60, now);
  const { fps, low } = meter.read();
  assert.ok(fps > 40, `the mean stays high (${fps})`);
  assert.ok(low < 20, `the low catches the stall (${low})`);
});

test("a pause longer than two seconds resets rather than counting as a stutter", () => {
  const meter = new FpsMeter();
  run(meter, 60, 1 / 60);
  meter.frame(60 / 60 + 30); // the tab was in the background
  assert.equal(meter.read(), null, "the window starts again");
  run(meter, 60, 1 / 60, 60 / 60 + 30 + 1 / 60);
  assert.ok(meter.read().fps > 59, "and reports cleanly afterwards");
});

test("a device that only manages a couple of frames a second still gets a reading", () => {
  // At 2 fps every frame is half a second. Treating that as a pause would
  // leave the read-out permanently empty on exactly the hardware that needs
  // it: the slowest machines are the ones worth measuring.
  const meter = new FpsMeter();
  run(meter, 20, 0.5);
  const reading = meter.read();
  assert.ok(reading, "a reading, not nothing");
  assert.ok(reading.fps > 1.9 && reading.fps < 2.1, `expected about 2 fps, got ${reading.fps}`);
});

test("a frame at the same instant, or a clock going backwards, is ignored", () => {
  const meter = new FpsMeter();
  meter.frame(0);
  meter.frame(0);
  meter.frame(-1);
  assert.equal(meter.read(), null);
});

test("reset forgets the window, for a switch between views", () => {
  const meter = new FpsMeter();
  run(meter, 60, 1 / 60);
  meter.reset();
  assert.equal(meter.read(), null);
});

test("the read-out reads the way a rider would say it", () => {
  assert.equal(formatFps({ fps: 58.4, low: 43.6 }), "58 fps · low 44");
});
