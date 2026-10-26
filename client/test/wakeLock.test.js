import { test } from "node:test";
import assert from "node:assert/strict";
import { ScreenWakeLock } from "../public/js/util/wakeLock.js";

function fakes() {
  const requests = [];
  const listeners = new Map();
  const nav = {
    wakeLock: {
      request: async (type) => {
        const sentinel = { type, released: false, release: async () => void (sentinel.released = true) };
        requests.push(sentinel);
        return sentinel;
      },
    },
  };
  const doc = {
    visibilityState: "visible",
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  return { nav, doc, requests, listeners };
}

test("keeps the screen on while riding and lets it go afterwards", async () => {
  const { nav, doc, requests } = fakes();
  const lock = new ScreenWakeLock({ navigator: nav, document: doc });
  await lock.acquire();
  assert.equal(lock.held, true);
  assert.equal(requests[0].type, "screen");
  await lock.release();
  assert.equal(lock.held, false);
  assert.equal(requests[0].released, true);
});

test("takes the lock again when the page comes back", async () => {
  const { nav, doc, requests, listeners } = fakes();
  const lock = new ScreenWakeLock({ navigator: nav, document: doc });
  await lock.acquire();
  // The browser drops the lock while the page is hidden.
  requests[0].released = true;
  await listeners.get("visibilitychange")();
  assert.equal(requests.length, 2);
  assert.equal(lock.held, true);
  await lock.release();
  assert.equal(listeners.has("visibilitychange"), false);
});

test("does nothing without the Screen Wake Lock API or when denied", async () => {
  const quiet = new ScreenWakeLock({ navigator: {}, document: fakes().doc });
  assert.equal(quiet.supported, false);
  await quiet.acquire();
  assert.equal(quiet.held, false);

  const denied = new ScreenWakeLock({ navigator: { wakeLock: { request: async () => Promise.reject(new Error("NotAllowed")) } }, document: fakes().doc });
  await denied.acquire();
  assert.equal(denied.held, false);
});
