import { test } from "node:test";
import assert from "node:assert/strict";
import { addTile, hiddenTiles, loadLayout, moveTile, removeTile, resizeTile, saveLayout } from "../../public/js/cockpit/layout.js";
import { DEFAULT_LAYOUT, TILES } from "../../public/js/cockpit/tiles.js";

const KEY = "openradlr.cockpit.layout";

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const ids = (layout) => layout.map((entry) => entry.id);

test("a first start gets the default layout", () => {
  assert.deepEqual(loadLayout(fakeStorage()), DEFAULT_LAYOUT);
});

test("the default layout is a copy that can be changed without touching the catalogue", () => {
  const layout = loadLayout(fakeStorage());
  layout[0].size = "half";
  assert.equal(DEFAULT_LAYOUT[0].size, "big");
});

test("a saved layout loads back the same", () => {
  const storage = fakeStorage();
  const layout = [{ id: "speed", size: "wide" }, { id: "power3s", size: "half" }];
  saveLayout(storage, layout);
  assert.deepEqual(loadLayout(storage), layout);
});

test("saving to unavailable storage does not throw", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.doesNotThrow(() => saveLayout(storage, [{ id: "speed", size: "half" }]));
});

test("unknown ids and bad sizes are dropped", () => {
  const stored = [{ id: "speed", size: "half" }, { id: "gone", size: "half" }, { id: "cadence", size: "big" }, { id: "np", size: "wide" }];
  assert.deepEqual(loadLayout(fakeStorage({ [KEY]: JSON.stringify(stored) })), [{ id: "speed", size: "half" }, { id: "np", size: "wide" }]);
});

test("duplicates keep their first entry", () => {
  const stored = [{ id: "speed", size: "wide" }, { id: "speed", size: "half" }];
  assert.deepEqual(loadLayout(fakeStorage({ [KEY]: JSON.stringify(stored) })), [{ id: "speed", size: "wide" }]);
});

test("entries that are not objects are dropped", () => {
  const stored = [null, 7, "speed", [], { id: "speed", size: "half" }, { id: 5, size: "half" }];
  assert.deepEqual(loadLayout(fakeStorage({ [KEY]: JSON.stringify(stored) })), [{ id: "speed", size: "half" }]);
});

test("corrupt storage gives the default", () => {
  for (const bad of ["{not json", "null", "42", '"speed"', "{}", "[]", '[{"id":"gone","size":"half"}]']) {
    assert.deepEqual(loadLayout(fakeStorage({ [KEY]: bad })), DEFAULT_LAYOUT, bad);
  }
});

test("storage that throws gives the default", () => {
  const storage = { getItem: () => { throw new Error("denied"); } };
  assert.deepEqual(loadLayout(storage), DEFAULT_LAYOUT);
});

test("moving a tile puts it at the target slot", () => {
  const layout = [{ id: "speed", size: "half" }, { id: "grade", size: "half" }, { id: "np", size: "half" }];
  assert.deepEqual(ids(moveTile(layout, 0, 2)), ["grade", "np", "speed"]);
  assert.deepEqual(ids(moveTile(layout, 2, 0)), ["np", "speed", "grade"]);
  assert.deepEqual(ids(layout), ["speed", "grade", "np"]);
  assert.deepEqual(moveTile(layout, 1, 1), layout);
  assert.deepEqual(moveTile(layout, 5, 0), layout);
});

test("adding appends with the first size and ignores a tile already shown", () => {
  const layout = [{ id: "speed", size: "wide" }];
  assert.deepEqual(addTile(layout, "laps"), [...layout, { id: "laps", size: "half" }]);
  assert.deepEqual(addTile(layout, "speed"), layout);
  assert.deepEqual(addTile(layout, "nope"), layout);
});

test("removing drops the tile at the index", () => {
  const layout = [{ id: "speed", size: "half" }, { id: "grade", size: "half" }];
  assert.deepEqual(removeTile(layout, 0), [{ id: "grade", size: "half" }]);
  assert.deepEqual(removeTile(layout, 9), layout);
  assert.equal(layout.length, 2);
});

test("resizing cycles through the sizes the tile allows", () => {
  let layout = [{ id: "power3s", size: "big" }];
  layout = resizeTile(layout, 0);
  assert.equal(layout[0].size, "half");
  layout = resizeTile(layout, 0);
  assert.equal(layout[0].size, "wide");
  layout = resizeTile(layout, 0);
  assert.equal(layout[0].size, "big");
});

test("hidden tiles are the ones not shown, in catalogue order", () => {
  const layout = TILES.filter((tile) => tile.id !== "np" && tile.id !== "speed").map((tile) => ({ id: tile.id, size: tile.sizes[0] }));
  assert.deepEqual(hiddenTiles(layout).map((tile) => tile.id), ["speed", "np"]);
  assert.deepEqual(hiddenTiles([]), [...TILES]);
});
