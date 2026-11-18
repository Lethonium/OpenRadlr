/**
 * The trees of every kit stand 10-20 m (#117). A kit's `height` multiplies the
 * model's own size, so it has to be read against the model's real bounds: the
 * Quaternius trees are 2-4 units tall, and a `height` written as metres made
 * them 15-59 m next to 6-9 m houses.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const ROOT = new URL("../public/assets/scenery/", import.meta.url);
const TREE_ROLES = new Set(["firs", "leafy"]);

const kits = readdirSync(ROOT).filter((name) => existsSync(new URL(`${name}/manifest.json`, ROOT)));
const read = (path) => JSON.parse(readFileSync(new URL(path, ROOT)));

for (const kit of kits) {
  const manifest = read(`${kit}/manifest.json`);
  const trees = Object.entries(manifest.models).filter(([, m]) => TREE_ROLES.has(m.role));
  for (const [id, model] of trees) {
    test(`${kit}/${id} is a 10-20 m tree`, () => {
      const { min, max } = read(`${kit}/${model.file}.geo.json`).bounds;
      const native = max[1] - min[1];
      const [small, large = small] = model.sizes ?? [1];
      const lowest = native * (model.height ?? 1) * small;
      const highest = native * (model.height ?? 1) * large;
      assert.ok(lowest >= 9, `smallest ${lowest.toFixed(1)} m`);
      assert.ok(highest <= 21, `largest ${highest.toFixed(1)} m`);
    });
  }
}

test("some kit has trees to check", () => {
  assert.ok(kits.some((kit) => Object.values(read(`${kit}/manifest.json`).models).some((m) => TREE_ROLES.has(m.role))));
});
