#!/usr/bin/env node
/**
 * The licence gate for imported scenery models (#117).
 *
 * The repository is public and the code is AGPL, so every model file under
 * `client/public/assets/scenery/` has to be redistributable. That rules out
 * anything conditional — including Quaternius's newer "Quaternius Asset
 * License", which forbids passing the models on "regardless of how much they
 * have been modified". Their CC0-era packs are fine; the newer ones are not.
 *
 * So each kit's `manifest.json` must say, in plain words, what it is and where
 * it came from. This refuses anything else, which means a pack that is not CC0
 * cannot be committed by accident.
 *
 *   node tools/scenery/check.mjs           check the committed kits
 *   node tools/scenery/check.mjs --list    say what was found, always exit 0
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The only licence a kit here may claim. */
export const ALLOWED_LICENCE = "CC0-1.0";

/** Where the kits live, relative to the repository root. */
export const KITS_DIR = "client/public/assets/scenery";

/**
 * What is wrong with this kit manifest, in the rider's terms, or `[]` when it
 * may be committed. `kit` is only used to name the problem.
 */
export function manifestProblems(kit, manifest) {
  if (!manifest || typeof manifest !== "object") return [`${kit}: manifest is not an object`];
  const problems = [];
  if (manifest.licence !== ALLOWED_LICENCE) {
    problems.push(`${kit}: licence is ${JSON.stringify(manifest.licence)}, only "${ALLOWED_LICENCE}" may be committed`);
  }
  const provenance = manifest.provenance;
  if (!provenance || typeof provenance !== "object") {
    problems.push(`${kit}: no provenance, so nobody can tell where the models came from`);
  } else {
    // Where it came from, which licence that was, and when it was taken: the
    // three things needed to check the licence again later or download it again.
    for (const field of ["pack", "licence", "taken"]) {
      if (typeof provenance[field] !== "string" || provenance[field].trim() === "") {
        problems.push(`${kit}: provenance has no ${field}`);
      }
    }
    if (typeof provenance.pack === "string" && !/^https?:\/\//.test(provenance.pack)) {
      problems.push(`${kit}: provenance.pack is not a URL (${provenance.pack})`);
    }
  }
  if (!manifest.models || typeof manifest.models !== "object" || Object.keys(manifest.models).length === 0) {
    problems.push(`${kit}: no models`);
  }
  return problems;
}

/** Every kit directory under `kitsDir` that has a manifest, and every problem found. */
export function checkKits(kitsDir, { root = "." } = {}) {
  const dir = join(root, kitsDir);
  if (!existsSync(dir)) return { kits: [], problems: [] };
  const kits = [];
  const problems = [];
  for (const kit of readdirSync(dir, { withFileTypes: true })) {
    if (!kit.isDirectory()) continue;
    const file = join(dir, kit.name, "manifest.json");
    if (!existsSync(file)) {
      problems.push(`${kit.name}: no manifest.json`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${kit.name}: manifest is not valid JSON (${error.message})`);
      continue;
    }
    const found = manifestProblems(kit.name, manifest);
    problems.push(...found);
    if (found.length === 0) kits.push({ name: kit.name, models: Object.keys(manifest.models).length, licence: manifest.licence });
  }
  return { kits, problems };
}

// The command line: print what was found, and refuse a kit that may not be
// committed. Runs from the repository root, the way make calls it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const list = process.argv.includes("--list");
  const { kits, problems } = checkKits(KITS_DIR);
  for (const kit of kits) console.log(`${kit.name}: ${kit.models} models, ${kit.licence}`);
  if (kits.length === 0) console.log("No scenery kits imported yet.");
  for (const problem of problems) console.error(problem);
  if (problems.length > 0 && !list) process.exit(1);
}
