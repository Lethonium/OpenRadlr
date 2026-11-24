import { test } from "node:test";
import assert from "node:assert/strict";
import { Backup, ACCOUNT_RIDER_KEY, BACKED_UP_KEY, BACKED_UP_RIDES_KEY } from "../public/js/profile/backup.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), map };
}

/** An account service in memory, keeping what it was sent. */
function fakeAccount({ failRide = null } = {}) {
  const state = { linked: [], snapshots: [], rides: new Map(), challenges: 0 };
  return {
    state,
    riderChallenge: async () => `c${++state.challenges}`,
    linkRider: async (body) => (state.linked.push(body), "rider-1"),
    putSnapshot: async (rider, snapshot) => void state.snapshots.push({ rider, snapshot }),
    rideIds: async () => [...state.rides.keys()],
    putRide: async (rider, id, ride) => {
      if (id === failRide) throw Object.assign(new Error("too big"), { code: "too_big" });
      state.rides.set(id, ride);
    },
  };
}

function backup({ account = fakeAccount(), records = [], storage = memoryStorage() } = {}) {
  const signed = [];
  const instance = new Backup({
    account,
    storage,
    sign: async (message, publicKey) => (signed.push(message), publicKey === "pk" ? "sig" : null),
    history: { list: async () => records },
    snapshot: async () => ({ profile: { name: "Anna" } }),
    now: () => 1234,
  });
  return { instance, account, storage, signed };
}

test("linking signs the service's challenge with the rider key and remembers the rider", async () => {
  const { instance, account, storage, signed } = backup();
  assert.equal(await instance.link({ name: "Anna", publicKey: "pk" }), "rider-1");
  assert.deepEqual(signed, ["openradlr-link\nc1"]);
  assert.deepEqual(account.state.linked[0], { publicKey: "pk", challenge: "c1", signature: "sig", name: "Anna" });
  assert.equal(storage.getItem(ACCOUNT_RIDER_KEY), "rider-1");
  assert.equal(instance.riderId(), "rider-1");
});

test("a rider without a key can't be linked", async () => {
  const { instance } = backup();
  await assert.rejects(instance.link({ name: "Anna", publicKey: null }), /no_key/);
});

test("a rider whose key won't sign can't be linked", async () => {
  const account = fakeAccount();
  const instance = new Backup({ account, storage: memoryStorage(), sign: async () => null, history: { list: async () => [] }, snapshot: async () => ({}) });
  await assert.rejects(instance.link({ name: "Anna", publicKey: "pk" }), /no_key/);
});

test("a backup sends the snapshot and the rides the account doesn't have", async () => {
  const records = [{ id: "2", km: 2 }, { id: "1", km: 1 }];
  const account = fakeAccount();
  account.state.rides.set("1", { id: "1" });
  const { instance, storage } = backup({ account, records });
  await instance.link({ name: "Anna", publicKey: "pk" });

  const result = await instance.run();

  assert.deepEqual(result, { ok: true, rides: 1 });
  assert.deepEqual(account.state.snapshots, [{ rider: "rider-1", snapshot: { profile: { name: "Anna" } } }]);
  assert.deepEqual([...account.state.rides.keys()].sort(), ["1", "2"]);
  assert.equal(storage.getItem(BACKED_UP_KEY), "1234");
});

test("a backup of an unlinked rider does nothing", async () => {
  const { instance, account } = backup({ records: [{ id: "1" }] });
  assert.deepEqual(await instance.run(), { ok: false, rides: 0, reason: "not_linked" });
  assert.equal(account.state.snapshots.length, 0);
});

test("a ride that fails is skipped and the backup goes on", async () => {
  const account = fakeAccount({ failRide: "2" });
  const { instance, storage } = backup({ account, records: [{ id: "3" }, { id: "2" }, { id: "1" }] });
  await instance.link({ name: "Anna", publicKey: "pk" });
  const result = await instance.run();
  assert.deepEqual(result, { ok: false, rides: 2, reason: "too_big" });
  assert.deepEqual([...account.state.rides.keys()].sort(), ["1", "3"]);
  assert.equal(storage.getItem(BACKED_UP_KEY), null);
});

test("records without an id are not sent", async () => {
  const account = fakeAccount();
  const { instance } = backup({ account, records: [{ km: 1 }, { id: "1" }] });
  await instance.link({ name: "Anna", publicKey: "pk" });
  assert.equal((await instance.run()).rides, 1);
});

test("runs asked for while one is going are folded into one more run", async () => {
  const account = fakeAccount();
  let snapshots = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  account.putSnapshot = async () => {
    snapshots += 1;
    if (snapshots === 1) await gate;
  };
  const { instance } = backup({ account });
  await instance.link({ name: "Anna", publicKey: "pk" });
  const first = instance.run();
  const second = instance.run();
  const third = instance.run();
  release();
  await Promise.all([first, second, third]);
  assert.equal(snapshots, 2);
});

test("a failing service ends the run with its code, never a throw", async () => {
  const account = fakeAccount();
  account.putSnapshot = async () => Promise.reject(Object.assign(new Error("x"), { code: "offline" }));
  const { instance } = backup({ account });
  await instance.link({ name: "Anna", publicKey: "pk" });
  assert.deepEqual(await instance.run(), { ok: false, rides: 0, reason: "offline" });
});

test("forgetting the link leaves the rider unlinked", async () => {
  const { instance, storage } = backup();
  await instance.link({ name: "Anna", publicKey: "pk" });
  instance.forget();
  assert.equal(instance.riderId(), null);
  assert.equal(storage.getItem(BACKED_UP_KEY), null);
});

test("the rider counts as linked only to an account that lists it", async () => {
  const { instance } = backup();
  await instance.link({ name: "Anna", publicKey: "pk" });
  assert.equal(instance.linkedTo({ riders: [{ rider_id: "rider-1" }] }), true);
  assert.equal(instance.linkedTo({ riders: [{ rider_id: "other" }] }), false);
  assert.equal(instance.linkedTo(null), false);
});

test("the rides the account holds are remembered, the ones sent and the ones it had", async () => {
  const account = fakeAccount({ failRide: "3" });
  account.state.rides.set("1", { id: "1" });
  const { instance } = backup({ account, records: [{ id: "3" }, { id: "2" }, { id: "1" }] });
  await instance.link({ name: "Anna", publicKey: "pk" });
  await instance.run();
  assert.deepEqual([...instance.backedUpRides()].sort(), ["1", "2"]);
});

test("no rides count as backed up before a run, after a broken record, or once forgotten", async () => {
  const { instance, storage } = backup({ records: [{ id: "1" }] });
  assert.equal(instance.backedUpRides().size, 0);
  storage.setItem(BACKED_UP_RIDES_KEY, "{broken");
  assert.equal(instance.backedUpRides().size, 0);
  await instance.link({ name: "Anna", publicKey: "pk" });
  await instance.run();
  instance.forget();
  assert.equal(instance.backedUpRides().size, 0);
});

test("a refused snapshot doesn't hold the rides back", async () => {
  const account = fakeAccount();
  account.putSnapshot = async () => Promise.reject(Object.assign(new Error("x"), { code: "quota_exceeded", status: 507 }));
  const { instance } = backup({ account, records: [{ id: "1" }] });
  await instance.link({ name: "Anna", publicKey: "pk" });
  assert.deepEqual(await instance.run(), { ok: false, rides: 1, reason: "quota_exceeded" });
  assert.deepEqual([...account.state.rides.keys()], ["1"]);
});
