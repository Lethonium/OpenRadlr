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
  name: "racing",
  licence: "CC0-1.0",
  models: { treeLarge: { role: "trees", file: "treeLarge" }, treeSmall: { role: "trees", file: "treeSmall" } },
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
    "assets/scenery/racing/manifest.json": MANIFEST,
    "assets/scenery/racing/treeLarge.geo.json": MODEL,
    "assets/scenery/racing/treeSmall.geo.json": MODEL,
  });
  const kit = await loadKit("racing", { fetchJson });
  assert.equal(kit.name, "racing");
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
  assert.ok(KITS_OF.normal.length > 0);
});

test("a kit that cannot be loaded gives no scenery, rather than a broken world", async () => {
  const { fetchJson } = fakeFetch({}); // everything 404s
  assert.equal(await loadScenery("normal", { fetchJson }), null);
});

test("a kit is downloaded once and reused", async () => {
  forgetScenery();
  const { fetchJson, asked } = fakeFetch({
    "assets/scenery/racing/manifest.json": MANIFEST,
    "assets/scenery/racing/treeLarge.geo.json": MODEL,
    "assets/scenery/racing/treeSmall.geo.json": MODEL,
  });
  const first = await loadScenery("normal", { fetchJson });
  const before = asked.length;
  const second = await loadScenery("normal", { fetchJson });
  assert.ok(first && second);
  assert.equal(asked.length, before, "nothing was fetched again");
  assert.equal(second.kits, first.kits, "and the same kits are handed over");
  forgetScenery();
});
