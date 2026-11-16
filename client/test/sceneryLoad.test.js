/**
 * Loading the scenery kits (#117).
 *
 * The rule these guard: scenery is an extra, never a requirement. A missing or
 * broken kit must leave the ride exactly as it was, not break it and not leave
 * a half-empty world.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { KITS_OF, forgetScenery, loadKit, loadScenery } from "../public/js/view3d/scenery/load.js";

const MANIFEST = {
  name: "nature",
  licence: "CC0-1.0",
  models: { treeLarge: { role: "firs", file: "treeLarge" }, treeSmall: { role: "leafy", file: "treeSmall" } },
};
const MODEL = { name: "treeLarge", triangles: [[0, 0, 0, 1, 1, 1], [1, 0, 0, 1, 1, 1], [0, 1, 0, 1, 1, 1]] };

/** A fetch stand-in that serves `files` by URL and records what was asked for. */
function fakeFetch(files) {
  const asked = [];
  const fetchJson = async (url) => {
    asked.push(url);
    if (!(url in files)) throw new Error(`${url}: 404`);
    return files[url];
  };
  return { fetchJson, asked };
}

test("a kit arrives with its models inlined for the worker", async () => {
  const { fetchJson } = fakeFetch({
    "assets/scenery/nature/manifest.json": MANIFEST,
    "assets/scenery/nature/treeLarge.geo.json": MODEL,
    "assets/scenery/nature/treeSmall.geo.json": MODEL,
  });
  const kit = await loadKit("nature", { fetchJson });
  assert.equal(kit.name, "nature");
  assert.deepEqual(Object.keys(kit.files).sort(), ["treeLarge", "treeSmall"]);
  assert.equal(kit.files.treeLarge.triangles.length, 3);
});

test("scenery off asks for nothing at all", async () => {
  const { fetchJson, asked } = fakeFetch({});
  assert.equal(await loadScenery("off", { fetchJson }), null);
  assert.deepEqual(asked, []);
});

test("a level names the kits it wants", () => {
  assert.deepEqual(KITS_OF.off, []);
  // The modelled island: Kenney's trees, and its villages built from the town kit.
  assert.deepEqual(KITS_OF.models, ["nature", "fantasy-town"]);
  assert.deepEqual(KITS_OF.racing, ["racing"]);
});

test("a kit that cannot be loaded gives no scenery, rather than a broken world", async () => {
  forgetScenery();
  const { fetchJson } = fakeFetch({}); // everything 404s
  assert.equal(await loadScenery("models", { fetchJson }), null);
});

test("a model's cheap twin is downloaded with it", async () => {
  const { fetchJson } = fakeFetch({
    "assets/scenery/town/manifest.json": { name: "town", licence: "CC0-1.0", models: { house: { role: "houses", file: "house", far: "house-far" } } },
    "assets/scenery/town/house.geo.json": MODEL,
    "assets/scenery/town/house-far.geo.json": MODEL,
  });
  const kit = await loadKit("town", { fetchJson });
  assert.deepEqual(Object.keys(kit.files).sort(), ["house", "house-far"]);
});

test("a level keeps the kits that loaded when one of them fails", async () => {
  forgetScenery();
  const { fetchJson } = fakeFetch({
    "assets/scenery/nature/manifest.json": MANIFEST,
    "assets/scenery/nature/treeLarge.geo.json": MODEL,
    "assets/scenery/nature/treeSmall.geo.json": MODEL,
  });
  const scenery = await loadScenery("models", { fetchJson });
  assert.deepEqual(scenery.kits.map((kit) => kit.name), ["nature"]);
  forgetScenery();
});

test("a kit is downloaded once and reused", async () => {
  forgetScenery();
  const { fetchJson, asked } = fakeFetch({
    "assets/scenery/nature/manifest.json": MANIFEST,
    "assets/scenery/nature/treeLarge.geo.json": MODEL,
    "assets/scenery/nature/treeSmall.geo.json": MODEL,
  });
  const first = await loadScenery("models", { fetchJson });
  const before = asked.length;
  const second = await loadScenery("models", { fetchJson });
  assert.ok(first && second);
  assert.equal(asked.length, before, "nothing was fetched again");
  assert.equal(second.kits, first.kits, "and the same kits are handed over");
  forgetScenery();
});
