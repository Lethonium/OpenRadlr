import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { layerViolations } from "../layering.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const LAYERS = ["js/world", "js/view3d/assets", "js/view3d/scene", "js/view3d/engine"];

/** Every .js file under a folder of public/, as paths relative to public/ (none if the folder is missing). */
function jsFiles(folder) {
  const root = join(PUBLIC, folder);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .filter((name) => name.endsWith(".js"))
    .map((name) => relative(PUBLIC, join(root, name)).split("\\").join("/"));
}

const files = LAYERS.flatMap(jsFiles);
const read = (path) => readFileSync(join(PUBLIC, path), "utf8");
const violationsIn = (folder) => layerViolations(files.filter((file) => file.startsWith(`${folder}/`)), read);

test("layering: world imports nothing from view3d, view, the DOM layer or three", () => {
  assert.deepEqual(violationsIn("js/world"), []);
});

test("layering: assets import only world, three and other assets", () => {
  assert.deepEqual(violationsIn("js/view3d/assets"), []);
});

test("layering: scene imports no engine", () => {
  assert.deepEqual(violationsIn("js/view3d/scene"), []);
});

test("layering: an import against the arrows is reported with both file names", () => {
  const sources = { "js/world/a.js": 'import { b } from "../view3d/scene/b.js";\n' };
  const violations = layerViolations(["js/world/a.js"], (path) => sources[path]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /js\/world\/a\.js/);
  assert.match(violations[0], /js\/view3d\/scene\/b\.js/);
});

test("layering: world may import world and the seeded noise, scene may import three and assets", () => {
  const sources = {
    "js/world/a.js": 'import { x } from "./b.js";\nimport { n } from "../view3d/noise.js";\n',
    "js/view3d/scene/s.js": 'import { T } from "../../three.js";\nimport { m } from "../assets/m.js";\n',
  };
  assert.deepEqual(layerViolations(Object.keys(sources), (path) => sources[path]), []);
});
