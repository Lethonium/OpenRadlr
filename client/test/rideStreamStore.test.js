import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";
import { RideStreams } from "../public/js/ride/rideStreamStore.js";

const T0 = Date.UTC(2026, 10, 25, 7, 0, 0);

function recording(seconds = 30) {
  const recorder = new RideRecorder();
  for (let i = 0; i < seconds; i += 1) recorder.add({ t: T0 + i * 1000, distance: i * 8, power: 200 + (i % 7), heartRate: 130, speed: 8 });
  return recorder;
}

/** The key-value store `indexedDbStore` gives, in memory; `fail` makes every call reject. */
function memoryStore() {
  const map = new Map();
  const store = {
    map,
    fail: false,
    get: async (key) => (store.fail ? Promise.reject(new Error("blocked")) : map.get(key)),
    put: async (key, value) => (store.fail ? Promise.reject(new Error("blocked")) : void map.set(key, value)),
    delete: async (key) => (store.fail ? Promise.reject(new Error("blocked")) : void map.delete(key)),
    keys: async () => (store.fail ? Promise.reject(new Error("blocked")) : [...map.keys()]),
  };
  return store;
}

function streams({ store = memoryStore(), persist = async () => true } = {}) {
  const logs = [];
  const persisted = [];
  const instance = new RideStreams({ store, persist: async () => (persisted.push(1), persist()), log: (...args) => logs.push(args) });
  return { instance, store, logs, persisted };
}

test("a saved stream comes back as the same recording", async () => {
  const { instance } = streams();
  const ride = recording();
  assert.equal(await instance.save("r1", ride), true);
  const back = RideRecorder.from(await instance.get("r1"));
  assert.deepEqual(back.samples.map((s) => s.power), ride.samples.map((s) => s.power));
  assert.equal(back.summary().avgPower, ride.summary().avgPower);
});

test("it is kept compressed, under its ride's id", async () => {
  const { instance, store } = streams();
  await instance.save("r1", recording());
  assert.deepEqual([...store.map.keys()], ["stream:r1"]);
  assert.ok(store.map.get("stream:r1") instanceof Uint8Array);
});

test("a ride without a stream gives null", async () => {
  assert.equal(await streams().instance.get("missing"), null);
});

test("it lists the rides with a stream and what they take", async () => {
  const { instance, store } = streams();
  await instance.save("r1", recording(30));
  await instance.save("r2", recording(60));
  store.map.set("something-else", 1);
  assert.deepEqual((await instance.ids()).sort(), ["r1", "r2"]);
  const sizes = [...store.map.entries()].filter(([key]) => key.startsWith("stream:")).reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
  assert.equal(await instance.bytes(), sizes);
});

test("a stream is deleted with its ride", async () => {
  const { instance } = streams();
  await instance.save("r1", recording());
  assert.equal(await instance.delete("r1"), true);
  assert.equal(await instance.get("r1"), null);
});

test("the browser is asked once to keep the streams", async () => {
  const { instance, persisted } = streams();
  await instance.save("r1", recording());
  await instance.save("r2", recording());
  assert.equal(persisted.length, 1);
});

test("a browser that won't keep them is not asked again, and saving goes on", async () => {
  const { instance, persisted } = streams({ persist: async () => Promise.reject(new Error("no")) });
  assert.equal(await instance.save("r1", recording()), true);
  assert.equal(await instance.save("r2", recording()), true);
  assert.equal(persisted.length, 1);
});

test("a store that fails is reported once and never throws", async () => {
  const store = memoryStore();
  store.fail = true;
  const { instance, logs } = streams({ store });
  assert.equal(await instance.save("r1", recording()), false);
  assert.equal(await instance.save("r2", recording()), false);
  assert.equal(await instance.get("r1"), null);
  assert.deepEqual(await instance.ids(), []);
  assert.equal(await instance.bytes(), 0);
  assert.equal(await instance.delete("r1"), false);
  assert.equal(logs.length, 1);
});

test("an empty recording keeps no stream", async () => {
  const { instance, store } = streams();
  assert.equal(await instance.save("r1", new RideRecorder()), false);
  assert.equal(store.map.size, 0);
});
