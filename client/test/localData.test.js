import { test } from "node:test";
import assert from "node:assert/strict";
import { DATA_ITEMS, deleteItem, exportData, exportFileName, inventory, needsReload } from "../public/js/profile/localData.js";

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

const stores = () => ({
  history: mapStore({ "ride:1": { id: "1", startedAt: 1 }, "ride:2": { id: "2", startedAt: 2 } }),
  ghosts: mapStore({ "ghost:rolling-hills": { routeId: "rolling-hills", durationS: 1318 } }),
  autosave: mapStore({}),
});
const storage = () => fakeStorage({
  "openride.profile.v1": JSON.stringify({ name: "Ralf", privateKeyJwk: { d: "secret" }, publicKey: "pk" }),
  "openradlr.summits": '["a","b"]',
  "openradlr.lemons": "12",
  "openradlr.devices": "[]",
  "openradlr.screenKey": "s3cret",
  "other.app": "x",
});
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

test("the data items, in order", () => {
  assert.deepEqual(DATA_ITEMS, ["profile", "rides", "bestLaps", "progress", "unfinished", "settings"]);
});

test("inventory counts each item", async () => {
  const by = byId(await inventory({ storage: storage(), stores: stores() }));
  assert.equal(by.profile.count, 1);
  assert.equal(by.rides.count, 2);
  assert.equal(by.bestLaps.count, 1);
  assert.deepEqual(by.progress.count, { summits: 2, lemons: 12 });
  assert.equal(by.unfinished.count, 0);
  assert.equal(by.settings.count, 2);
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
  s.setItem("openradlr.lemons", "lots");
  assert.deepEqual(byId(await inventory({ storage: s, stores: stores() })).progress.count, { summits: 0, lemons: 0 });
});

test("export leaves out the private key and the screen key", async () => {
  const data = await exportData({ storage: storage(), stores: stores(), now: 7 });
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, 7);
  assert.equal(data.profile.name, "Ralf");
  assert.equal(data.profile.privateKeyJwk, undefined);
  assert.equal(data.profile.publicKey, "pk");
  assert.equal(data.settings["openradlr.screenKey"], undefined);
  assert.equal(data.settings["openradlr.devices"], "[]");
  assert.equal(data.settings["other.app"], undefined);
  assert.deepEqual(data.rides.map((r) => r.id), ["1", "2"]);
  assert.equal(data.bestLaps.length, 1);
  assert.deepEqual(data.progress, { summits: ["a", "b"], lemons: 12 });
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

test("needsReload: when the profile, settings or the unfinished ride go", () => {
  assert.equal(needsReload("everything"), true);
  assert.equal(needsReload("profile"), true);
  assert.equal(needsReload("settings"), true);
  assert.equal(needsReload("rides"), false);
  // The start menu offers the unfinished ride; a reload drops that offer.
  assert.equal(needsReload("unfinished"), true);
  assert.equal(needsReload("progress"), false);
});
