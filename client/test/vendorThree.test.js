import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

const ADDONS_DIR = join(VENDOR, "addons");
const addonFiles = () =>
  readdirSync(ADDONS_DIR, { recursive: true })
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(ADDONS_DIR, name));
const IMPORT_FROM = /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;

test("every vendored addon resolves its relative imports to vendored files", () => {
  const missing = [];
  for (const file of addonFiles()) {
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_FROM)) {
      if (!match[1].startsWith(".")) continue;
      if (!existsSync(resolve(dirname(file), match[1]))) missing.push(`${file} -> ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("no vendored addon imports the bare 'three' specifier", () => {
  const bare = addonFiles().filter((file) => /\bfrom\s*["']three["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(bare, []);
});

test("the post-processing addons load in node", async () => {
  const composer = await import("../public/vendor/three/addons/postprocessing/EffectComposer.js");
  const bloom = await import("../public/vendor/three/addons/postprocessing/UnrealBloomPass.js");
  assert.equal(typeof composer.EffectComposer, "function");
  assert.equal(typeof bloom.UnrealBloomPass, "function");
});
