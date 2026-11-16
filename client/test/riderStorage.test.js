import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceStorage, isDeviceKey, riderDbName, riderIdsInStorage, riderKey, riderStorage } from "../public/js/profile/riderStorage.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const listed = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();

test("another rider's keys are prefixed in the raw storage", () => {
  const raw = fakeStorage();
  riderStorage(raw, () => "x").setItem("openradlr.goals", "v");
  assert.equal(raw.getItem("openradlr.rider.x.openradlr.goals"), "v");
});

test("rider main uses the unprefixed key", () => {
  const raw = fakeStorage();
  riderStorage(raw, () => "main").setItem("openradlr.goals", "v");
  assert.equal(raw.getItem("openradlr.goals"), "v");
});

test("a device key goes to the raw key unchanged", () => {
  const raw = fakeStorage();
  riderStorage(raw, () => "x").setItem("openradlr.devices", "v");
  assert.equal(raw.getItem("openradlr.devices"), "v");
});

test("Strava upload keys are device keys", () => {
  assert.equal(isDeviceKey("openradlr.strava-upload.abc"), true);
});

test("a rider key is not a device key", () => {
  assert.equal(isDeviceKey("openradlr.goals"), false);
});

test("a rider lists exactly its own keys with the prefix stripped", () => {
  const raw = fakeStorage({
    "openradlr.rider.x.openradlr.goals": "1",
    "openradlr.rider.x.openride.view": "2",
    "openradlr.rider.xy.openradlr.goals": "3",
    "openradlr.goals": "4",
    "openradlr.devices": "5",
  });
  assert.deepEqual(listed(riderStorage(raw, () => "x")), ["openradlr.goals", "openride.view"]);
});

test("rider main never lists other riders' or device keys", () => {
  const raw = fakeStorage({
    "openradlr.goals": "1",
    "openradlr.devices": "2",
    "openradlr.riders": "3",
    "openradlr.rider.x.openradlr.goals": "4",
    "openradlr.strava-upload.abc": "5",
  });
  assert.deepEqual(listed(riderStorage(raw, () => "main")), ["openradlr.goals"]);
});

test("the length counts only the rider's keys", () => {
  const raw = fakeStorage({ "openradlr.goals": "1", "openradlr.riders": "2" });
  assert.equal(riderStorage(raw, () => "main").length, 1);
});

test("the rider is resolved on every call", () => {
  const raw = fakeStorage({ "openradlr.goals": "main", "openradlr.rider.x.openradlr.goals": "x" });
  let rider = "main";
  const storage = riderStorage(raw, () => rider);
  const before = storage.getItem("openradlr.goals");
  rider = "x";
  assert.deepEqual([before, storage.getItem("openradlr.goals")], ["main", "x"]);
});

test("removeItem removes the rider's key only", () => {
  const raw = fakeStorage({ "openradlr.goals": "main", "openradlr.rider.x.openradlr.goals": "x" });
  riderStorage(raw, () => "x").removeItem("openradlr.goals");
  assert.deepEqual([...raw.map.keys()], ["openradlr.goals"]);
});

test("undefined storage reads as empty", () => {
  const storage = riderStorage(undefined, () => "main");
  assert.deepEqual([storage.getItem("openradlr.goals"), storage.length, storage.key(0)], [null, 0, null]);
});

test("writing to undefined storage does not throw", () => {
  assert.doesNotThrow(() => riderStorage(undefined, () => "main").setItem("openradlr.goals", "v"));
});

const throwing = () => {
  throw new Error("blocked");
};
const brokenStorage = {
  getItem: throwing,
  setItem: throwing,
  removeItem: throwing,
  key: throwing,
  get length() {
    return throwing();
  },
};

test("storage whose reads throw reads as empty", () => {
  const storage = riderStorage(brokenStorage, () => "main");
  assert.deepEqual([storage.getItem("openradlr.goals"), storage.length], [null, 0]);
});

test("storage whose writes throw does not throw", () => {
  const storage = riderStorage(brokenStorage, () => "main");
  assert.doesNotThrow(() => {
    storage.setItem("openradlr.goals", "v");
    storage.removeItem("openradlr.goals");
  });
});

test("the device view lists only device keys", () => {
  const raw = fakeStorage({ "openradlr.goals": "1", "openradlr.devices": "2", "openradlr.strava-upload.a": "3" });
  assert.deepEqual(listed(deviceStorage(raw)), ["openradlr.devices", "openradlr.strava-upload.a"]);
});

test("riderIdsInStorage finds the distinct prefixed riders", () => {
  const raw = fakeStorage({
    "openradlr.goals": "1",
    "openradlr.rider.x.openradlr.goals": "2",
    "openradlr.rider.x.openride.view": "3",
  });
  assert.deepEqual(riderIdsInStorage(raw), ["x"]);
});

test("riderKey leaves main's keys alone", () => {
  assert.equal(riderKey("main", "openradlr.goals"), "openradlr.goals");
});

test("riderDbName keeps main's name", () => {
  assert.equal(riderDbName("openradlr-history", "main"), "openradlr-history");
});

test("riderDbName suffixes another rider's id", () => {
  assert.equal(riderDbName("openradlr-history", "x"), "openradlr-history.x");
});
