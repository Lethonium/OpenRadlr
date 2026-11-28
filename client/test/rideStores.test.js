import { test } from "node:test";
import assert from "node:assert/strict";
import { rideStores } from "../public/js/ride/rideStores.js";
import { riderDbName } from "../public/js/profile/riderStorage.js";

/**
 * An in-memory IndexedDB factory: one key-value map per database name, resolved
 * like the browser resolves IDB requests. `holdGet(name, done)` makes the next
 * `get` on that database answer only once `done` resolves.
 */
function fakeIdb() {
  const databases = new Map();
  const held = new Map();
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  return {
    databases,
    holdGet(name, done) {
      held.set(name, done);
    },
    open(name) {
      if (!databases.has(name)) databases.set(name, new Map());
      const entries = databases.get(name);
      const db = {
        close() {},
        createObjectStore() {},
        transaction() {
          return {
            objectStore() {
              return {
                get(key) {
                  if (!held.has(name)) return request(entries.get(key) ?? null);
                  const done = held.get(name);
                  held.delete(name);
                  const req = { result: entries.get(key) ?? null, onsuccess: null, onerror: null };
                  void done.then(() => req.onsuccess?.());
                  return req;
                },
                put(value, key) {
                  entries.set(key, value);
                  return request(undefined);
                },
                delete(key) {
                  entries.delete(key);
                  return request(undefined);
                },
                getAllKeys() {
                  return request([...entries.keys()]);
                },
              };
            },
          };
        },
      };
      return request(db);
    },
  };
}

test("a lap offered before a rider switch lands in the offering rider's ghosts", async () => {
  const idb = fakeIdb();
  const anna = rideStores("anna", { idb });
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  idb.holdGet(riderDbName("openradlr-ghosts", "anna"), pending);
  const offered = anna.ghosts.offer({ routeId: "hills", durationS: 100, trace: [] });
  // The rider returns to the menu and another one becomes active while the read is out.
  rideStores("ben", { idb });
  release();
  assert.deepEqual(await offered, { best: true, previousS: null });
  const ghostsOf = (rider) => idb.databases.get(riderDbName("openradlr-ghosts", rider));
  assert.deepEqual([...(ghostsOf("anna") ?? new Map()).keys()], ["ghost:hills"]);
  assert.equal(ghostsOf("ben"), undefined);
});

test("each rider's stores open that rider's four databases", async () => {
  const idb = fakeIdb();
  const stores = [rideStores("main", { idb }), rideStores("x", { idb })];
  await Promise.all(stores.flatMap(({ autosave, history, ghosts, streams }) => [autosave.load(), history.list(), ghosts.all(), streams.ids()]));
  assert.deepEqual([...idb.databases.keys()].sort(), [
    "openradlr-autosave",
    "openradlr-autosave.x",
    "openradlr-ghosts",
    "openradlr-ghosts.x",
    "openradlr-history",
    "openradlr-history.x",
    "openradlr-streams",
    "openradlr-streams.x",
  ]);
});
