import { test } from "node:test";
import assert from "node:assert/strict";
import { PADDLE, PaddleModel, comboBonus, paddleFraction } from "../public/js/ride/paddleModel.js";
import { meterPercent, paddleHint, swipeDirection } from "../public/js/view/paddleView.js";

/** Alternating taps every `intervalMs` from `start` for `durationMs`; returns the time after the last tap. */
function paddle(model, { start = 0, intervalMs, durationMs, firstSide = "left" }) {
  let t = start;
  let side = model.lastSide ? (model.lastSide === "left" ? "right" : "left") : firstSide;
  for (; t < start + durationMs; t += intervalMs) {
    model.tap(side, t);
    model.update(t);
    side = side === "left" ? "right" : "left";
  }
  return t;
}

test("a steady rhythm in the sweet spot rides at about three quarters of FTP", () => {
  const model = new PaddleModel({ ftp: 200 });
  // 120 strokes per minute: a tap every 500 ms.
  const t = paddle(model, { intervalMs: 500, durationMs: 10000 });
  const reading = model.reading(t);
  assert.ok(Math.abs(reading.power - 150) <= 12, `power ${reading.power}`);
  assert.equal(reading.zone, "sweet");
  assert.equal(reading.spm, 120);
  assert.equal(reading.cadence, 90);
});

test("tapping slower is easier and gives less power", () => {
  const model = new PaddleModel({ ftp: 200 });
  const t = paddle(model, { intervalMs: 1000, durationMs: 10000 });
  const reading = model.reading(t);
  assert.equal(reading.zone, "easy");
  assert.ok(reading.power > 40 && reading.power < 90, `power ${reading.power}`);
});

test("the same side twice is a stumble: no stroke and the combo restarts", () => {
  const model = new PaddleModel({ ftp: 200 });
  const t = paddle(model, { intervalMs: 500, durationMs: 5000 });
  assert.ok(model.combo >= 10);
  const side = model.lastSide;
  assert.equal(model.tap(side, t), "stumble");
  assert.equal(model.combo, 0);
  assert.equal(model.reading(t + 100).stumbling, true);
  assert.equal(model.reading(t + PADDLE.stumbleMs + 1).stumbling, false);
  // Mashing one side never gets going.
  const masher = new PaddleModel({ ftp: 200 });
  for (let i = 0; i < 40; i += 1) masher.tap("left", i * 100);
  assert.equal(masher.reading(4000).power, 0);
});

test("two thumbs at once count as one stroke", () => {
  const model = new PaddleModel({ ftp: 200 });
  model.tap("left", 0);
  assert.equal(model.tap("right", 20), "ignored");
});

test("sprinting goes above FTP, drains the tank and is then held at FTP", () => {
  const model = new PaddleModel({ ftp: 200 });
  // A tap every 150 ms (400 spm): flat out.
  let t = paddle(model, { intervalMs: 150, durationMs: 5000 });
  const early = model.reading(t);
  assert.equal(early.zone, "sprint");
  assert.equal(early.cadence, PADDLE.maxRpm);
  assert.ok(early.power > 270, `sprint power ${early.power}`);
  assert.ok(early.energy < 1);
  t = paddle(model, { start: t, intervalMs: 150, durationMs: 60000 });
  const late = model.reading(t);
  assert.equal(late.tired, true);
  assert.ok(late.power <= 200 * comboBonus(late.combo) + 1 && late.power >= 190, `tired power ${late.power}`);
});

test("riding easy refills the tank", () => {
  const model = new PaddleModel({ ftp: 200 });
  let t = paddle(model, { intervalMs: 150, durationMs: 30000 });
  const drained = model.reading(t).energy;
  t = paddle(model, { start: t, intervalMs: 1000, durationMs: 20000 });
  assert.ok(model.reading(t).energy > drained + 0.1);
});

test("power fades to nothing a couple of seconds after the last tap", () => {
  const model = new PaddleModel({ ftp: 200 });
  const t = paddle(model, { intervalMs: 500, durationMs: 8000 });
  const riding = model.reading(t).power;
  assert.ok(model.reading(t + 900).power < riding);
  const stopped = model.reading(t + PADDLE.idleMs + 3000);
  assert.equal(stopped.power, 0);
  assert.equal(stopped.cadence, 0);
  assert.equal(stopped.zone, "idle");
  assert.equal(stopped.combo, 0);
});

test("climbs move the sweet spot to slower strokes", () => {
  const model = new PaddleModel({ ftp: 200 });
  const flat = model.sweetSpot;
  model.setGrade(8);
  const climb = model.sweetSpot;
  assert.ok(climb.high < flat.high && climb.low < flat.low);
  assert.equal(model.reading(0).climbing, true);
  model.setGrade(-6);
  assert.deepEqual(model.sweetSpot, flat);
});

test("a clean combo earns a small bonus", () => {
  assert.equal(comboBonus(5), 1);
  assert.equal(comboBonus(20), 1.05);
  assert.equal(comboBonus(80), 1.1);
  assert.equal(paddleFraction(0), 0);
  assert.equal(paddleFraction(1), PADDLE.sweetFraction);
  assert.equal(paddleFraction(10), PADDLE.maxFraction);
});

test("shows which paddle comes next", () => {
  const model = new PaddleModel();
  assert.equal(model.reading(0).nextSide, null);
  model.tap("left", 0);
  assert.equal(model.reading(10).nextSide, "right");
});

test("the paddle hint coaches the rhythm", () => {
  const base = { zone: "idle", combo: 0, energy: 1, tired: false, stumbling: false, climbing: false };
  assert.match(paddleHint(base), /left, then right/);
  assert.match(paddleHint({ ...base, zone: "easy" }), /faster/i);
  assert.match(paddleHint({ ...base, zone: "sweet" }), /Nice/);
  assert.match(paddleHint({ ...base, zone: "sprint", energy: 0.1 }), /running low/);
  assert.match(paddleHint({ ...base, zone: "sprint", tired: true }), /Out of energy/);
  assert.match(paddleHint({ ...base, zone: "sweet", stumbling: true }), /Oops/);
  assert.match(paddleHint({ ...base, zone: "easy", climbing: true }), /Climb/);
});

test("the rhythm meter places the sweet spot and the current rate", () => {
  const spot = { low: 108, high: 132 };
  assert.equal(meterPercent(0, spot), 0);
  assert.ok(meterPercent(120, spot) > meterPercent(108, spot));
  assert.equal(meterPercent(10000, spot), 100);
});

test("a quick sideways swipe changes lanes; taps and scrolls don't", () => {
  const start = { x: 200, y: 300, t: 0 };
  assert.equal(swipeDirection(start, { x: 100, y: 310, t: 200 }), "left");
  assert.equal(swipeDirection(start, { x: 300, y: 290, t: 200 }), "right");
  assert.equal(swipeDirection(start, { x: 210, y: 300, t: 100 }), null);
  assert.equal(swipeDirection(start, { x: 280, y: 450, t: 200 }), null);
  assert.equal(swipeDirection(start, { x: 300, y: 300, t: 2000 }), null);
});
