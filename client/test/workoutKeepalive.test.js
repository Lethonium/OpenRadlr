import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPALIVE_MS, startKeepalive } from "../public/js/workout/keepalive.js";

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setInterval: (fn, ms) => (timers.set(next, { fn, ms }), next++),
    clearInterval: (id) => timers.delete(id),
  };
}

test("the keepalive sends the current exercise every 30 s", () => {
  const fake = fakeTimers();
  const sent = [];
  let exercise = "squats";
  startKeepalive({ send: (value) => sent.push(value), current: () => exercise, ...fake });
  assert.equal(KEEPALIVE_MS, 30000);
  assert.deepEqual([...fake.timers.values()].map((t) => t.ms), [30000]);
  [...fake.timers.values()][0].fn();
  exercise = null;
  [...fake.timers.values()][0].fn();
  assert.deepEqual(sent, ["squats", null]);
});

test("stopping the keepalive clears the timer", () => {
  const fake = fakeTimers();
  const stop = startKeepalive({ send: () => {}, current: () => null, ...fake });
  stop();
  assert.equal(fake.timers.size, 0);
});
