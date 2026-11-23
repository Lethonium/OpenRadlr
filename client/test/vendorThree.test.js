import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BufferGeometry, REVISION } from "../public/js/three.js";

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(CLIENT, "public", "vendor", "three");

test("the vendored Three.js is r170", () => {
  assert.equal(REVISION, "170");
});

test("package.json pins the same Three.js version", () => {
  const pkg = JSON.parse(readFileSync(join(CLIENT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies?.three, "0.170.0");
});

test("Three.js core works in node without a DOM", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferGeometry().attributes.position);
  assert.ok(geometry.isBufferGeometry);
});

test("the vendored Three.js keeps its MIT licence", () => {
  const licence = join(VENDOR, "LICENSE");
  assert.ok(existsSync(licence));
  assert.match(readFileSync(licence, "utf8"), /MIT/);
});
