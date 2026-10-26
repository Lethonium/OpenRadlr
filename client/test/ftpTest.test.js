import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAIL_BELOW, FAIL_HOLD_S, FAIL_GRACE_S, MIN_RAMP_S, RAMP_TO_FTP,
  suggestStart, buildRamp, rampTargetAt, detectFailure, rampResult,
} from "../public/js/ride/ftpTest.js";
import { totalDuration } from "../public/js/ride/workout.js";

const T0 = Date.UTC(2026, 9, 14, 13, 30, 0);
const warmup = (watts, seconds) => Array.from({ length: seconds }, (_, i) => ({ t: T0 + i * 1000, power: watts }));

/** 1 Hz ramp samples: the rider's power at second s is `power(s)`. */
const rampRide = (seconds, power) => Array.from({ length: seconds }, (_, s) => ({ elapsedS: s, power: power(s) }));
const follow = (startW, stepW) => (s) => rampTargetAt(startW, stepW, s);

test("constants", () => {
  assert.deepEqual([FAIL_BELOW, FAIL_HOLD_S, FAIL_GRACE_S, MIN_RAMP_S, RAMP_TO_FTP], [0.85, 10, 60, 300, 0.75]);
});

test("suggestStart scales the start and step to the warmup", () => {
  assert.deepEqual(suggestStart(warmup(100, 300)), { startW: 60, stepW: 10 });
  assert.deepEqual(suggestStart(warmup(220, 300)), { startW: 130, stepW: 15 });
  assert.deepEqual(suggestStart(warmup(300, 300)), { startW: 180, stepW: 25 });
});

test("suggestStart never starts below 50 W and defaults without a usable warmup", () => {
  assert.equal(suggestStart(warmup(40, 300)).startW, 50);
  assert.deepEqual(suggestStart(warmup(30, 300)), { startW: 50, stepW: 10 });
  assert.deepEqual(suggestStart([]), { startW: 50, stepW: 10 });
  assert.deepEqual(suggestStart(warmup(200, 30)), { startW: 50, stepW: 10 });
});

test("buildRamp makes one-minute steady blocks as fractions of FTP", () => {
  const workout = buildRamp({ startW: 100, stepW: 20, ftp: 200 });
  assert.equal(workout.name, "FTP ramp test");
  assert.equal(workout.segments[0].from, 0.5);
  assert.equal(workout.segments[1].from, 0.6);
  assert.equal(workout.segments[0].label, "100 W");
  assert.equal(workout.segments.at(-1).label, "600 W");
  assert.ok(workout.segments.every((s) => s.durationS === 60 && s.from === s.to && s.kind === "test"));
  assert.equal(totalDuration(workout), 26 * 60);
});

test("buildRamp stays a valid workout for a low FTP and a small step", () => {
  const workout = buildRamp({ startW: 50, stepW: 10, ftp: 60 });
  assert.ok(workout.segments.every((s) => s.to <= 3));
});

test("rampTargetAt steps up every minute", () => {
  assert.equal(rampTargetAt(100, 20, 59), 100);
  assert.equal(rampTargetAt(100, 20, 60), 120);
  assert.equal(rampTargetAt(100, 20, 600), 300);
});

test("detectFailure finds a sustained drop below the target", () => {
  const samples = rampRide(600, (s) => (s < 480 ? rampTargetAt(100, 20, s) : 150));
  const at = detectFailure(samples, { startW: 100, stepW: 20 });
  assert.ok(at >= 489 && at <= 492, `at ${at}`);
});

test("detectFailure ignores a short dip, the grace period and a rider who keeps up", () => {
  const dip = rampRide(600, (s) => (s >= 300 && s < 305 ? rampTargetAt(100, 20, s) * 0.8 : rampTargetAt(100, 20, s)));
  assert.equal(detectFailure(dip, { startW: 100, stepW: 20 }), null);
  const early = rampRide(600, (s) => (s < 50 ? 0 : rampTargetAt(100, 20, s)));
  assert.equal(detectFailure(early, { startW: 100, stepW: 20 }), null);
  assert.equal(detectFailure(rampRide(600, follow(100, 20)), { startW: 100, stepW: 20 }), null);
});

test("rampResult takes the best minute and scales it to FTP", () => {
  const samples = rampRide(14 * 60, follow(100, 20)); // reaches 360 W in minute 14; last full minute 360
  const result = rampResult(samples);
  const lastMinute = 100 + 13 * 20;
  assert.equal(result.bestMinuteW, lastMinute);
  assert.equal(result.ftp, Math.round(0.75 * lastMinute));
  assert.equal(result.durationS, 14 * 60 - 1);
});

test("rampResult is null for short ramps, too few samples and out-of-range results", () => {
  assert.equal(rampResult(rampRide(200, follow(100, 20))), null);
  assert.equal(rampResult([]), null);
  assert.equal(rampResult(rampRide(600, () => 900)), null);
  assert.equal(rampResult(rampRide(600, () => 40)), null);
});
