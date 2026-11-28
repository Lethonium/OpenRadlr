import { test } from "node:test";
import assert from "node:assert/strict";

import { PreviewTicker, Turntable } from "../public/js/view3d/lookTurntable.js";

test("the stand turns on its own", () => {
  const stand = new Turntable({ angle: 0, speed: 0.5 });
  stand.update(2);
  assert.equal(stand.angle, 1);
});

test("dragging turns the stand with the pointer and holds the auto-turn", () => {
  const stand = new Turntable({ angle: 0, speed: 0.5, radiansPerPixel: 0.01, holdS: 3 });
  stand.grab();
  stand.drag(50);
  assert.equal(stand.angle, 0.5);
  stand.update(1);
  assert.equal(stand.angle, 0.5, "no auto-turn while held");
  stand.release();
  stand.update(2.9);
  assert.equal(stand.angle, 0.5, "it waits after letting go");
  stand.update(0.2);
  assert.ok(stand.angle > 0.5, "then turns on again");
});

test("with reduced motion it only turns by hand", () => {
  const stand = new Turntable({ angle: 1, speed: 0.5, still: true, radiansPerPixel: 0.01 });
  stand.update(5);
  assert.equal(stand.angle, 1);
  stand.grab();
  stand.drag(-100);
  assert.equal(stand.angle, 0);
});

/** A requestAnimationFrame that runs frames by hand, at `now` ms. */
function fakeFrames() {
  let queued = null;
  return {
    raf: (callback) => ((queued = callback), 1),
    caf: () => (queued = null),
    get pending() {
      return queued !== null;
    },
    run(now) {
      const callback = queued;
      queued = null;
      callback?.(now);
    },
  };
}

test("with reduced motion the ticker schedules no frames at all", () => {
  const frames = fakeFrames();
  const ticks = [];
  const ticker = new PreviewTicker({ still: true, raf: frames.raf, caf: frames.caf, now: () => 0, onFrame: (dt) => ticks.push(dt) });
  ticker.start();
  assert.equal(frames.pending, false);
  assert.equal(ticker.running, false);
  assert.deepEqual(ticks, []);
});

test("the animated ticker draws at most 30 frames a second on a 60 Hz display", () => {
  const frames = fakeFrames();
  const ticks = [];
  const ticker = new PreviewTicker({ maxFps: 30, raf: frames.raf, caf: frames.caf, now: () => 0, onFrame: (dt) => ticks.push(dt) });
  ticker.start();
  for (let i = 1; i <= 60; i += 1) frames.run((i * 1000) / 60);
  assert.equal(ticks.length, 30);
  // Each frame carries the time since the last one drawn, so the stand turns at the same speed.
  for (const dt of ticks) assert.ok(Math.abs(dt - 1 / 30) < 1e-9, `dt ${dt}`);
  ticker.stop();
  assert.equal(frames.pending, false);
  assert.equal(ticker.running, false);
});
