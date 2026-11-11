/**
 * The modules main.js loads, as <link rel="modulepreload"> in index.html.
 *
 * Without the list a browser finds the client's ~150 modules in five rounds
 * (main.js, then what it imports, then what those import…), one network round
 * trip each. With it, all of them load at once. There is no build step: this
 * script writes the list into index.html (`npm run preload`) and
 * test/modulePreload.test.js fails when it no longer matches the imports.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const INDEX = join(PUBLIC, "index.html");
const START = "<!-- modulepreload: written by `npm run preload` (client/preload.mjs) -->";
const END = "<!-- /modulepreload -->";

// Static imports start a line: `import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`.
// JSDoc's `import("./x.js")` types and strings mentioning imports don't.
const IMPORT = /^(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']|^import\s*["'](\.{1,2}\/[^"']+)["']/gm;

const readPublic = (path) => readFileSync(join(PUBLIC, path), "utf8");

/**
 * Every module `entry` loads through static imports, without `entry` itself:
 * nearest first (the order a browser finds them), sorted within each level.
 * @param {string} [entry] path relative to client/public
 * @param {(path: string) => string} [read]
 * @returns {string[]}
 */
export function moduleGraph(entry = "js/main.js", read = readPublic) {
  const seen = new Set([entry]);
  const found = [];
  let level = [entry];
  while (level.length) {
    const next = new Set();
    for (const file of level) {
      for (const match of read(file).matchAll(IMPORT)) {
        const target = posix.normalize(posix.join(posix.dirname(file), match[1] ?? match[2]));
        if (!seen.has(target)) {
          seen.add(target);
          next.add(target);
        }
      }
    }
    level = [...next].sort();
    found.push(...level);
  }
  return found;
}

/** The modules index.html preloads, in its order. */
export function preloadedModules(html) {
  return [...html.matchAll(/<link rel="modulepreload" href="([^"]+)" \/>/g)].map((match) => match[1]);
}

/** index.html with its preload list replaced by `modules`. */
export function withPreloads(html, modules) {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start < 0 || end < start) throw new Error(`index.html needs the markers ${START} … ${END}`);
  const indent = html.slice(html.lastIndexOf("\n", start) + 1, start);
  const links = modules.map((module) => `${indent}<link rel="modulepreload" href="${module}" />\n`).join("");
  return `${html.slice(0, start)}${START}\n${links}${indent}${html.slice(end)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const modules = moduleGraph();
  writeFileSync(INDEX, withPreloads(readFileSync(INDEX, "utf8"), modules));
  console.log(`index.html preloads ${modules.length} modules`); // i18n-ok (a dev script)
}
