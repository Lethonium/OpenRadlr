import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moduleGraph, preloadedModules } from "../preload.mjs";

const files = (map) => (path) => {
  if (!(path in map)) throw new Error(`no ${path}`);
  return map[path];
};

test("follows static imports of every shape, nearest first, each module once", () => {
  const read = files({
    "js/main.js": 'import { a } from "./a.js";\nimport {\n  b,\n  c,\n} from "./lib/b.js";\nimport "./side.js";\nexport { d } from "./d.js";\n',
    "js/a.js": 'import { b } from "./lib/b.js";\nimport { main } from "./main.js";\n',
    "js/lib/b.js": 'export * from "../deep.js";\n',
    "js/side.js": "",
    "js/d.js": "",
    "js/deep.js": "",
  });
  assert.deepEqual(moduleGraph("js/main.js", read), ["js/a.js", "js/d.js", "js/lib/b.js", "js/side.js", "js/deep.js"]);
});

test("type imports in comments and strings that merely mention imports are not modules", () => {
  const read = files({
    "js/main.js": '/** @param {import("./types.js").T} t */\nconst text = "import x from ./nowhere.js";\nimport { a } from "./a.js";\n',
    "js/a.js": "",
  });
  assert.deepEqual(moduleGraph("js/main.js", read), ["js/a.js"]);
});

test("index.html preloads exactly the modules main.js loads (npm run preload writes the list)", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.deepEqual(preloadedModules(html), moduleGraph());
});
