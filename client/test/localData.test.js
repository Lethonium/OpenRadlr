import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceStorage, riderStorage } from "../public/js/profile/riderStorage.js";
import { DATA_ITEMS, deleteItem, deleteRider, exportData, exportFileName, inventory, needsReload } from "../public/js/profile/localData.js";

function fakeStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

function mapStore(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
}

const goal = (id) => ({ id, kind: "total", metric: "distance", target: 1e6, routeId: null, startMs: 0, endMs: 1e12, createdAt: 0 });
const stores = () => ({
  history: mapStore({ "ride:1": { id: "1", startedAt: 1 }, "ride:2": { id: "2", startedAt: 2 } }),
  ghosts: mapStore({ "ghost:rolling-hills": { routeId: "rolling-hills", durationS: 1318 } }),
  autosave: mapStore({}),
});
const storage = () => fakeStorage({
  "openride.profile.v1": JSON.stringify({ name: "Ralf", privateKeyJwk: { d: "secret" }, publicKey: "pk" }),
  "openradlr.summits": '["a","b"]',
  "openradlr.lemons": "12",
  "openradlr.achievements": JSON.stringify({ version: 1, earned: { firstRide: 1, century: 2 } }),
  "openradlr.devices": "[]",
  "openradlr.screenKey": "s3cret",
  "openradlr.cockpit": JSON.stringify({ key: "0123456789abcdef0123456789abcdef", url: "x" }),
  "other.app": "x",
  "openradlr.goals": JSON.stringify({ version: 1, rhythmStartMs: 0, goals: [goal("a"), goal("b")] }),
});
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

test("the data items, in order", () => {
  assert.deepEqual(DATA_ITEMS, ["profile", "rides", "bestLaps", "goals", "progress", "unfinished", "settings", "device"]);
});

test("inventory counts each item", async () => {
  const by = byId(await inventory({ storage: storage(), stores: stores() }));
  assert.equal(by.profile.count, 1);
  assert.equal(by.rides.count, 2);
  assert.equal(by.bestLaps.count, 1);
  assert.deepEqual(by.progress.count, { summits: 2, lemons: 12, achievements: 2 });
  assert.equal(by.unfinished.count, 0);
  assert.equal(by.settings.count, 3);
  assert.ok(Object.values(by).every((item) => item.readable));
});

test("inventory: an autosaved ride counts once, with its photos", async () => {
  const s = { ...stores(), autosave: mapStore({ current: {}, "photo:a": {}, "photo:b": {} }) };
  assert.equal(byId(await inventory({ storage: storage(), stores: s })).unfinished.count, 1);
});

test("inventory survives a store that throws", async () => {
  const broken = { ...stores(), history: { keys: async () => { throw new Error("blocked"); } } };
  const by = byId(await inventory({ storage: storage(), stores: broken }));
  assert.equal(by.rides.readable, false);
  assert.equal(by.bestLaps.readable, true);
});

test("inventory survives localStorage that throws", async () => {
  const blocked = { getItem() { throw new Error("denied"); }, key() { throw new Error("denied"); }, get length() { throw new Error("denied"); } };
  const by = byId(await inventory({ storage: blocked, stores: stores() }));
  assert.equal(by.profile.readable, false);
  assert.equal(by.settings.readable, false);
  assert.equal(by.rides.readable, true);
});

test("inventory: broken progress values count as nothing", async () => {
  const s = storage();
  s.setItem("openradlr.summits", "not json");
  s.setItem("openradlr.achievements", "{broken");
  s.setItem("openradlr.lemons", "lots");
  assert.deepEqual(byId(await inventory({ storage: s, stores: stores() })).progress.count, { summits: 0, lemons: 0, achievements: 0 });
});

test("export leaves out the private key and the screen key", async () => {
  const data = await exportData({ storage: storage(), stores: stores(), now: 7 });
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, 7);
  assert.equal(data.profile.name, "Ralf");
  assert.equal(data.profile.privateKeyJwk, undefined);
  assert.equal(data.profile.publicKey, "pk");
  assert.equal(data.settings["openradlr.screenKey"], undefined);
  // A phone used as a cockpit keeps the tablet's pairing secret here.
  assert.equal(data.settings["openradlr.cockpit"], undefined);
  assert.equal(data.settings["openradlr.devices"], "[]");
  assert.equal(data.settings["other.app"], undefined);
  assert.deepEqual(data.rides.map((r) => r.id), ["1", "2"]);
  assert.equal(data.bestLaps.length, 1);
  assert.deepEqual(data.progress, { summits: ["a", "b"], lemons: 12, achievements: { firstRide: 1, century: 2 } });
  assert.equal(data.unfinished, null);
});

test("export keeps the unfinished ride but not its photos", async () => {
  const s = { ...stores(), autosave: mapStore({ current: { startedAt: 3 }, "photo:a": { blob: {} } }) };
  const data = await exportData({ storage: storage(), stores: s, now: 7 });
  assert.deepEqual(data.unfinished, { startedAt: 3 });
});

test("exportFileName uses the local date", () => {
  assert.equal(exportFileName(new Date(2026, 10, 3, 9).getTime()), "openradlr-data-2026-11-03.json");
});

test("deleteItem: rides clears the ride history only", async () => {
  const s = storage();
  const st = stores();
  assert.equal(await deleteItem("rides", { storage: s, stores: st }), true);
  assert.deepEqual(await st.history.keys(), []);
  assert.equal((await st.ghosts.keys()).length, 1);
});

test("deleteItem: settings keeps profile, progress and other apps' keys", async () => {
  const s = storage();
  await deleteItem("settings", { storage: s, stores: stores() });
  assert.equal(s.getItem("openradlr.devices"), null);
  assert.equal(s.getItem("openradlr.screenKey"), null);
  assert.notEqual(s.getItem("openride.profile.v1"), null);
  assert.equal(s.getItem("openradlr.lemons"), "12");
  assert.notEqual(s.getItem("openradlr.achievements"), null);
  assert.equal(s.getItem("other.app"), "x");
});

test("deleteItem: everything clears every item but no other app's keys", async () => {
  const s = storage();
  const st = stores();
  assert.equal(await deleteItem("everything", { storage: s, stores: st }), true);
  assert.deepEqual(await st.history.keys(), []);
  assert.deepEqual(await st.ghosts.keys(), []);
  assert.equal(s.getItem("openride.profile.v1"), null);
  assert.equal(s.getItem("openradlr.summits"), null);
  assert.equal(s.length, 1);
  assert.equal(s.getItem("other.app"), "x");
});

test("deleteItem reports a storage error as false", async () => {
  const st = { ...stores(), history: { ...mapStore(), keys: async () => ["ride:1"], delete: async () => { throw new Error("quota"); } } };
  assert.equal(await deleteItem("rides", { storage: storage(), stores: st }), false);
});

test("deleteItem reports false when the rider-scoped storage refuses", async () => {
  const raw = fakeStorage({ "openride.profile.v1": "{}" });
  raw.removeItem = () => { throw new Error("quota"); };
  assert.equal(await deleteItem("profile", { storage: riderStorage(raw, () => "x"), stores: stores() }), false);
});

test("deleteItem reports false when the device storage refuses", async () => {
  const raw = fakeStorage({ "openradlr.devices": "[]" });
  raw.removeItem = () => { throw new Error("quota"); };
  assert.equal(await deleteItem("device", { storage: riderStorage(raw, () => "x"), deviceStorage: deviceStorage(raw), stores: stores() }), false);
});

test("needsReload: when the profile, settings or the unfinished ride go", () => {
  assert.equal(needsReload("everything"), true);
  assert.equal(needsReload("profile"), true);
  assert.equal(needsReload("settings"), true);
  assert.equal(needsReload("rides"), false);
  // The start menu offers the unfinished ride; a reload drops that offer.
  assert.equal(needsReload("unfinished"), true);
  assert.equal(needsReload("progress"), false);
});

test("deleteItem: everything goes on past a broken store and reports the failure", async () => {
  const s = storage();
  const st = { ...stores(), history: { ...mapStore(), keys: async () => ["ride:1"], delete: async () => { throw new Error("quota"); } } };
  assert.equal(await deleteItem("everything", { storage: s, stores: st }), false);
  assert.deepEqual(await st.ghosts.keys(), []);
  assert.equal(s.getItem("openradlr.summits"), null);
});

test("inventory counts goals, and settings leave them out", async () => {
  const by = byId(await inventory({ storage: storage(), stores: stores() }));
  assert.equal(by.goals.count, 2);
  assert.equal(by.settings.count, 3);
});

test("export has the goals as an item of their own", async () => {
  const data = await exportData({ storage: storage(), stores: stores(), now: 7 });
  assert.deepEqual(data.goals.goals.map((g) => g.id), ["a", "b"]);
  assert.equal(data.settings["openradlr.goals"], undefined);
});

test("deleteItem: goals removes the goals only", async () => {
  const s = storage();
  assert.equal(await deleteItem("goals", { storage: s, stores: stores() }), true);
  assert.equal(s.getItem("openradlr.goals"), null);
  assert.equal(s.getItem("openradlr.devices"), "[]");
});

test("deleteItem: progress clears the achievements too", async () => {
  const s = storage();
  await deleteItem("progress", { storage: s, stores: stores() });
  assert.equal(s.getItem("openradlr.achievements"), null);
});

test("deleteItem: rides keeps the achievements", async () => {
  const s = storage();
  await deleteItem("rides", { storage: s, stores: stores() });
  assert.notEqual(s.getItem("openradlr.achievements"), null);
});

const deviceKeys = () => ({
  "openradlr.riders": JSON.stringify({ active: "main", ids: ["main", "k3x9q2ab"] }),
  "openradlr.devices": "[]",
  "openradlr.screenKey": "s3cret",
  "openride.quality": "high",
  "openradlr.strava-upload.1": "x",
});
const shared = () => fakeStorage({ ...deviceKeys(), "openride.profile.v1": "{}", "openradlr.lemons": "3", "openradlr.rider.k3x9q2ab.openradlr.lemons": "9", "other.app": "x" });

test("inventory counts the device keys but not the roster", async () => {
  const raw = shared();
  const by = byId(await inventory({ storage: riderStorage(raw, () => "main"), deviceStorage: deviceStorage(raw), stores: stores() }));
  assert.equal(by.device.count, 4);
  assert.equal(by.settings.count, 0);
});

test("deleteItem: device removes the device keys but not the roster or any rider key", async () => {
  const raw = shared();
  const sources = { storage: riderStorage(raw, () => "main"), deviceStorage: deviceStorage(raw), stores: stores() };
  assert.equal(await deleteItem("device", sources), true);
  assert.equal(raw.getItem("openradlr.devices"), null);
  assert.equal(raw.getItem("openride.quality"), null);
  assert.equal(raw.getItem("openradlr.strava-upload.1"), null);
  assert.notEqual(raw.getItem("openradlr.riders"), null);
  assert.equal(raw.getItem("openradlr.lemons"), "3");
  assert.equal(raw.getItem("openradlr.rider.k3x9q2ab.openradlr.lemons"), "9");
});

test("deleteItem: everything leaves the device keys alone", async () => {
  const raw = shared();
  await deleteItem("everything", { storage: riderStorage(raw, () => "main"), deviceStorage: deviceStorage(raw), stores: stores() });
  assert.equal(raw.getItem("openradlr.devices"), "[]");
  assert.equal(raw.getItem("openradlr.screenKey"), "s3cret");
  assert.equal(raw.getItem("openride.profile.v1"), null);
  assert.equal(raw.getItem("openradlr.rider.k3x9q2ab.openradlr.lemons"), "9");
});

test("export never has the device keys", async () => {
  const raw = shared();
  const data = await exportData({ storage: riderStorage(raw, () => "main"), stores: stores(), now: 1 });
  assert.deepEqual(data.settings, {});
});

test("needsReload: the device row redraws instead", () => {
  assert.equal(needsReload("device"), false);
});

test("deleteRider removes the rider's keys and its three databases", async () => {
  const raw = shared();
  raw.setItem("openradlr.rider.k3x9q2ab.openride.profile.v1", "{}");
  const names = [];
  const ok = await deleteRider({ storage: riderStorage(raw, () => "k3x9q2ab"), dbNames: ["a.k3x9q2ab", "b.k3x9q2ab", "c.k3x9q2ab"], deleteDb: async (name) => void names.push(name) });
  assert.equal(ok, true);
  assert.deepEqual(names, ["a.k3x9q2ab", "b.k3x9q2ab", "c.k3x9q2ab"]);
  assert.equal(raw.getItem("openradlr.rider.k3x9q2ab.openradlr.lemons"), null);
  assert.equal(raw.getItem("openradlr.rider.k3x9q2ab.openride.profile.v1"), null);
  assert.equal(raw.getItem("openradlr.lemons"), "3");
  assert.equal(raw.getItem("openradlr.devices"), "[]");
});

test("deleteRider goes on past a database that fails and says false", async () => {
  const raw = shared();
  const names = [];
  const ok = await deleteRider({
    storage: riderStorage(raw, () => "k3x9q2ab"),
    dbNames: ["a", "b", "c"],
    deleteDb: async (name) => {
      names.push(name);
      if (name === "a") throw new Error("blocked");
    },
  });
  assert.equal(ok, false);
  assert.deepEqual(names, ["a", "b", "c"]);
  assert.equal(raw.getItem("openradlr.rider.k3x9q2ab.openradlr.lemons"), null);
});
