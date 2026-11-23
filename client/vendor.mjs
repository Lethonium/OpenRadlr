// Copies Three.js from node_modules into public/vendor, pinned and with its
// licence, so the client loads it as a plain file (no CDN, no build step, and
// the CSP's `script-src 'self'` stays as it is).
//
// Three.js addons import the bare specifier `three`, which a page without an
// import map cannot resolve, so the copies we take get that import rewritten to
// a relative path to the vendored core. The list is empty today; step 3 of the
// Three.js world adds the addons it needs.
//
//   npm install three@<version>
//   npm run vendor
//
// test/vendorThree.test.js fails when the copy and package.json drift apart.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "node_modules", "three");
const TARGET = join(HERE, "public", "vendor", "three");
const CORE = "three.module.min.js";

/** Addons to copy, relative to `three/examples/jsm`. Empty until step 3 needs one. */
export const ADDONS = Object.freeze([]);

/**
 * An addon's source with its `from 'three'` imports pointed at the vendored core.
 * @param {string} source
 * @param {string} file path relative to the vendor folder, e.g. "addons/controls/OrbitControls.js"
 * @returns {string}
 */
export function rewriteThreeImports(source, file) {
  const relative = posix.relative(posix.dirname(file), CORE);
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  return source.replace(/(\bfrom\s*)(["'])three\2/g, (_match, lead, quote) => `${lead}${quote}${specifier}${quote}`);
}

/** Copies the core, its licence and the addons into public/vendor/three. */
export function vendorThree(addons = ADDONS) {
  mkdirSync(TARGET, { recursive: true });
  copyFileSync(join(SOURCE, "build", CORE), join(TARGET, CORE));
  copyFileSync(join(SOURCE, "LICENSE"), join(TARGET, "LICENSE"));
  for (const addon of addons) {
    const out = posix.join("addons", addon);
    const target = join(TARGET, out);
    mkdirSync(dirname(target), { recursive: true });
    const source = readFileSync(join(SOURCE, "examples", "jsm", addon), "utf8");
    writeFileSync(target, rewriteThreeImports(source, out));
  }
  return [CORE, "LICENSE", ...addons.map((addon) => posix.join("addons", addon))];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = vendorThree();
  console.log(`vendored ${files.length} files into public/vendor/three`); // i18n-ok (a dev script)
}
