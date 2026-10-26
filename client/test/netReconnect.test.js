import { test } from "node:test";
import assert from "node:assert/strict";
import { Reconnector, reconnectDelay } from "../public/js/net/reconnector.js";

/** Timers on a manual clock: `advance(ms)` fires what is due, in order. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        // Let promise callbacks of the fired timer run.
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      }
      now = until;
    },
  };
}

function reconnector(clock, connect, extra = {}) {
  const events = { connected: [], gaveUp: 0 };
  const r = new Reconnector({
    connect,
    onConnected: (c) => events.connected.push(c),
    onGiveUp: () => (events.gaveUp += 1),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    ...extra,
  });
  return { r, events };
}

test("backoff follows the schedule", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelay(attempt)),
    [1000, 2000, 4000, 8000, 15000, 15000, 15000],
  );
});

test("connects after failures", async () => {
  const clock = fakeClock();
  let calls = 0;
  const { r, events } = reconnector(clock, async () => {
    calls += 1;
    if (calls < 3) throw new Error("down");
    return "c";
  });
  r.start();
  assert.equal(r.running, true);
  await clock.advance(1000);
  assert.equal(calls, 1);
  await clock.advance(2000);
  assert.equal(calls, 2);
  await clock.advance(4000);
  assert.equal(calls, 3);
  assert.deepEqual(events.connected, ["c"]);
  assert.equal(r.running, false);
});

test("gives up after three minutes", async () => {
  const clock = fakeClock();
  let calls = 0;
  const { r, events } = reconnector(clock, async () => {
    calls += 1;
    throw new Error("down");
  });
  r.start();
  await clock.advance(180_000);
  assert.equal(events.gaveUp, 1);
  assert.equal(r.running, false);
  const before = calls;
  await clock.advance(60_000);
  assert.equal(calls, before);
  assert.equal(events.gaveUp, 1);
});

test("hung attempt times out and retries", async () => {
  const clock = fakeClock();
  let calls = 0;
  const { events } = (() => {
    const made = reconnector(clock, () => {
      calls += 1;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve("second");
    });
    made.r.start();
    return made;
  })();
  await clock.advance(1000);
  assert.equal(calls, 1);
  await clock.advance(10_000);
  // Timed out: the next attempt is scheduled 2 s later.
  await clock.advance(2000);
  assert.equal(calls, 2);
  assert.deepEqual(events.connected, ["second"]);
});

test("stop drops a late success", async () => {
  const clock = fakeClock();
  let resolve;
  let closed = 0;
  const { r, events } = reconnector(clock, () => new Promise((done) => (resolve = done)));
  r.start();
  await clock.advance(1000);
  r.stop();
  resolve({ close: () => (closed += 1) });
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.deepEqual(events.connected, []);
  assert.equal(closed, 1);
  assert.equal(r.running, false);
});

test("a success after its own timeout is closed and ignored", async () => {
  const clock = fakeClock();
  const resolvers = [];
  let closed = 0;
  const { r, events } = reconnector(clock, () => new Promise((done) => resolvers.push(done)));
  r.start();
  await clock.advance(1000 + 10_000);
  resolvers[0]({ close: () => (closed += 1) });
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.equal(closed, 1);
  assert.deepEqual(events.connected, []);
  assert.equal(r.running, true);
});

test("default timers work when the browser insists on being called on window", () => {
  const native = globalThis.setTimeout;
  const nativeClear = globalThis.clearTimeout;
  // Browsers throw "Illegal invocation" when setTimeout is called on another object.
  globalThis.setTimeout = function (fn, ms) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return native(fn, ms);
  };
  globalThis.clearTimeout = function (id) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return nativeClear(id);
  };
  try {
    const r = new Reconnector({ connect: () => new Promise(() => {}), onConnected: () => {}, onGiveUp: () => {} });
    r.start();
    r.stop();
  } finally {
    globalThis.setTimeout = native;
    globalThis.clearTimeout = nativeClear;
  }
});
