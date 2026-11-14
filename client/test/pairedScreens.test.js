import { test } from "node:test";
import assert from "node:assert/strict";
import { PairedScreens, liveDevices } from "../public/js/net/pairedScreens.js";

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test("adds with the date", () => {
  const storage = fakeStorage();
  const screens = new PairedScreens(storage);
  screens.add("Quest 3", 1000);
  assert.deepEqual(screens.list(), [{ device: "Quest 3", pairedAt: 1000 }]);
  assert.deepEqual(new PairedScreens(storage).list(), [{ device: "Quest 3", pairedAt: 1000 }]);
});

test("pairing the same device again keeps one entry, the newest, last", () => {
  const screens = new PairedScreens(fakeStorage());
  screens.add("Quest 3", 1);
  screens.add("Pixel 8", 2);
  screens.add("Quest 3", 3);
  assert.deepEqual(screens.list(), [
    { device: "Pixel 8", pairedAt: 2 },
    { device: "Quest 3", pairedAt: 3 },
  ]);
});

test("clear empties it", () => {
  const storage = fakeStorage();
  const screens = new PairedScreens(storage);
  screens.add("Pixel 8", 1);
  screens.clear();
  assert.deepEqual(screens.list(), []);
  assert.deepEqual(new PairedScreens(storage).list(), []);
});

test("keeps 20", () => {
  const screens = new PairedScreens(fakeStorage());
  for (let i = 0; i < 25; i++) screens.add(`d${i}`, i);
  const list = screens.list();
  assert.equal(list.length, 20);
  assert.equal(list[0].device, "d5");
  assert.equal(list.at(-1).device, "d24");
});

test("works without storage and with garbage in it", () => {
  const screens = new PairedScreens(undefined);
  screens.add("x", 1);
  assert.deepEqual(screens.list(), []);
  const storage = fakeStorage();
  storage.setItem("openradlr.pairedScreens", "{nonsense");
  assert.deepEqual(new PairedScreens(storage).list(), []);
});

test("liveDevices marks every entry with a watching name", () => {
  const list = [{ device: "Quest 3" }, { device: "Pixel 8" }, { device: "Quest 3" }];
  assert.deepEqual([...liveDevices(list, ["Quest 3"])], [0, 2]);
  assert.deepEqual([...liveDevices(list, [])], []);
});
