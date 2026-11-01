import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOSAVE_MAX_AGE_MS, RideAutosave, continueAllowed, unfinishedLabel } from "../public/js/ride/rideAutosave.js";

/** The store contract on a Map. */
function mapStore() {
  const map = new Map();
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
}

const NOW = Date.UTC(2026, 9, 17, 18, 0, 0);

function snapshot(overrides = {}) {
  return {
    version: 1,
    savedAt: NOW,
    serverUrl: "wss://ride.example/ws",
    routeId: "rolling-hills",
    routeName: "Rolling Hills",
    studio: false,
    trainerKind: "trainer",
    rideStartedAt: NOW - 3600_000,
    distance: 23400,
    resumeToken: "t",
    graceS: 60,
    resumePoint: { routeId: "rolling-hills", distanceM: 1234 },
    recorder: { samples: [{ t: NOW - 1000, distance: 23390 }], pauses: [], intervalMs: 1000 },
    ...overrides,
  };
}

test("round trip with photos", async () => {
  const autosave = new RideAutosave({ store: mapStore() });
  await autosave.save(snapshot());
  await autosave.addPhoto({ name: "b.jpg", blob: new Blob(["b"]), takenAt: NOW - 10 });
  await autosave.addPhoto({ name: "a.jpg", blob: new Blob(["a"]), takenAt: NOW - 20 });
  assert.deepEqual(await autosave.load(), snapshot());
  const photos = await autosave.photos();
  assert.deepEqual(
    photos.map((p) => p.name),
    ["a.jpg", "b.jpg"],
  );
  assert.equal(await photos[0].blob.text(), "a");
});

test("load is null without a save", async () => {
  assert.equal(await new RideAutosave({ store: mapStore() }).load(), null);
});

test("clear removes everything", async () => {
  const store = mapStore();
  const autosave = new RideAutosave({ store });
  await autosave.save(snapshot());
  await autosave.addPhoto({ name: "a.jpg", blob: new Blob(["a"]), takenAt: NOW });
  await autosave.clear();
  assert.equal(await autosave.load(), null);
  assert.deepEqual(await autosave.photos(), []);
  assert.equal(store.map.size, 0);
});

test("continue needs same server and fresh save", () => {
  const options = { now: NOW, serverUrl: "wss://ride.example/ws" };
  assert.equal(continueAllowed(snapshot(), options), true);
  assert.equal(continueAllowed(snapshot(), { ...options, serverUrl: "wss://other.example/ws" }), false);
  assert.equal(continueAllowed(snapshot({ savedAt: NOW - AUTOSAVE_MAX_AGE_MS - 1 }), options), false);
  assert.equal(AUTOSAVE_MAX_AGE_MS, 43_200_000);
});

test("storage errors are reported once", async () => {
  const logged = [];
  const store = { ...mapStore(), put: async () => { throw new Error("QuotaExceededError"); }, get: async () => { throw new Error("blocked"); } };
  const autosave = new RideAutosave({ store, log: (...args) => logged.push(args) });
  await autosave.save(snapshot());
  await autosave.save(snapshot());
  await autosave.save(snapshot());
  assert.equal(await autosave.load(), null);
  assert.equal(logged.length, 1);
});

test("label reads well", () => {
  const formatDistance = (m) => `${(m / 1000).toFixed(1)} km`;
  assert.equal(
    unfinishedLabel(snapshot({ savedAt: NOW - 41 * 60_000 }), { now: NOW, formatDistance }),
    "Unfinished ride · Rolling Hills · 23.4 km · 41 min ago",
  );
  assert.ok(unfinishedLabel(snapshot({ savedAt: NOW - 3 * 3600_000 }), { now: NOW, formatDistance }).endsWith("· 3 h ago"));
});

test("a finished snapshot is never continuable even when recent and from this server", () => {
  const options = { now: NOW, serverUrl: "wss://ride.example/ws" };
  assert.equal(continueAllowed(snapshot({ finished: true }), options), false);
});

test("the label of a finished ride says Finished ride", () => {
  const formatDistance = (m) => `${(m / 1000).toFixed(1)} km`;
  assert.equal(
    unfinishedLabel(snapshot({ finished: true, savedAt: NOW - 41 * 60_000 }), { now: NOW, formatDistance }),
    "Finished ride · Rolling Hills · 23.4 km · 41 min ago",
  );
});

test("an unfinished snapshot behaves as before", () => {
  const options = { now: NOW, serverUrl: "wss://ride.example/ws" };
  const formatDistance = (m) => `${(m / 1000).toFixed(1)} km`;
  assert.equal(continueAllowed(snapshot({ finished: false }), options), true);
  assert.ok(unfinishedLabel(snapshot({ finished: false }), { now: NOW, formatDistance }).startsWith("Unfinished ride · "));
});
