import { test } from "node:test";
import assert from "node:assert/strict";
import { RideHistory, rideRecord } from "../public/js/ride/rideHistory.js";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";

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

const T0 = Date.UTC(2026, 9, 18, 9, 0, 0);

function recorder(start = T0) {
  const r = new RideRecorder();
  for (let i = 0; i <= 60; i += 1) r.add({ t: start + i * 1000, distance: i * 10, power: 200, heartRate: 140, speed: 10 });
  return r;
}

const record = (start) =>
  rideRecord({ recorder: recorder(start), splits: [], splitMode: "5", routeId: "rolling-hills", measured: true, profile: { ftp: 250, weightKg: 70 } });

test("rideRecord: totals, identity and settings", () => {
  const r = record();
  assert.equal(r.version, 2);
  assert.equal(r.id, String(T0));
  assert.equal(r.startedAt, T0);
  assert.equal(r.endedAt, T0 + 60_000);
  assert.equal(r.routeId, "rolling-hills");
  assert.equal(r.measured, true);
  assert.equal(r.ftp, 250);
  assert.equal(r.weightKg, 70);
  assert.equal(r.durationS, 60);
  assert.equal(r.distanceM, 600);
  assert.equal(r.avgPower, 200);
  assert.equal(r.splitMode, "5");
  assert.deepEqual(r.splits, []);
});

function ride(seconds, watts, extra = {}) {
  const r = new RideRecorder();
  for (let i = 0; i <= seconds; i += 1) r.add({ t: T0 + i * 1000, distance: i * 10, power: watts, heartRate: 140, speed: 10 });
  return rideRecord({ recorder: r, splits: [], splitMode: "5", routeId: null, measured: true, profile: { ftp: 200, weightKg: 70 }, ...extra });
}

test("rideRecord v2: power curve, weighted power and load", () => {
  const r = ride(1200, 200);
  assert.equal(r.version, 2);
  assert.equal(r.curve[1200], 200);
  assert.equal(r.curve[3600], null);
  assert.equal(r.weightedPower, 200);
  assert.ok(Math.abs(r.load - 33.3) < 0.1);
  assert.equal(r.test, null);
  assert.equal(ride(1200, 200, { test: "ramp" }).test, "ramp");
});

test("rideRecord v2: a ride without power has a zero curve and no load", () => {
  const r = ride(120, 0);
  assert.equal(r.curve[60], 0);
  assert.equal(r.load, 0);
});

test("a stored version 1 record still lists and saves unchanged", async () => {
  const history = new RideHistory({ store: mapStore() });
  const old = { version: 1, id: String(T0), startedAt: T0, endedAt: T0 + 1000, splits: [] };
  await history.save(old);
  assert.deepEqual(await history.list(), [old]);
});

test("saving a ride twice keeps one record; the list is newest first", async () => {
  const history = new RideHistory({ store: mapStore() });
  await history.save(record(T0));
  await history.save(record(T0));
  assert.equal((await history.list()).length, 1);
  await history.save(record(T0 + 86_400_000));
  assert.deepEqual((await history.list()).map((r) => r.startedAt), [T0 + 86_400_000, T0]);
});

test("a blocked store never throws and logs once", async () => {
  const logged = [];
  const failing = { get: async () => { throw new Error("no"); }, put: async () => { throw new Error("no"); }, keys: async () => { throw new Error("no"); } };
  const history = new RideHistory({ store: failing, log: (...args) => logged.push(args) });
  await history.save(record());
  await history.save(record());
  assert.equal(logged.length, 1);
  assert.deepEqual(await history.list(), []);
});
