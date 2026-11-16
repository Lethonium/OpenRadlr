/**
 * The licence gate for imported scenery kits (#117).
 *
 * These tests guard a legal boundary, not a feature: the repository is public,
 * so a model committed here is a model everybody can download. Only CC0 packs
 * may be, and a pack that claims anything else must not get past the gate.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ALLOWED_LICENCE, checkKits, manifestProblems } from "../../tools/scenery/check.mjs";

const provenance = Object.freeze({
  pack: "https://quaternius.com/packs/ultimatenature.html",
  licence: "https://creativecommons.org/publicdomain/zero/1.0/",
  taken: "2026-11-16",
});
const kit = (overrides = {}) => ({ licence: ALLOWED_LICENCE, provenance, models: { tree: {} }, ...overrides });

/** A kits directory holding one kit with `manifest` (as text when given a string). */
function kitsDir(name, manifest) {
  const root = mkdtempSync(join(tmpdir(), "scenery-"));
  const dir = join(root, "client/public/assets/scenery", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  return root;
}

test("a CC0 kit with provenance may be committed", () => {
  assert.deepEqual(manifestProblems("nature", kit()), []);
});

test("a kit under any other licence is refused, and says which", () => {
  const problems = manifestProblems("farm", kit({ licence: "Quaternius-Asset-License-1.0" }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /farm/);
  assert.match(problems[0], /Quaternius-Asset-License-1\.0/);
  assert.match(problems[0], /CC0-1\.0/);
});

test("a kit with no licence at all is refused", () => {
  assert.match(manifestProblems("x", kit({ licence: undefined }))[0], /licence/);
});

test("a kit with no provenance is refused", () => {
  assert.match(manifestProblems("x", kit({ provenance: undefined }))[0], /provenance/);
});

test("provenance without a source URL is refused", () => {
  const problems = manifestProblems("x", kit({ provenance: { ...provenance, pack: "Ultimate Nature" } }));
  assert.match(problems[0], /not a URL/);
});

test("provenance without a date is refused, so the licence can be checked again", () => {
  const problems = manifestProblems("x", kit({ provenance: { ...provenance, taken: "" } }));
  assert.match(problems[0], /taken/);
});

test("a kit with no models is refused", () => {
  assert.match(manifestProblems("x", kit({ models: {} }))[0], /no models/);
});

test("a directory with no kits passes, so the target works before the first import", () => {
  assert.deepEqual(checkKits("client/public/assets/scenery", { root: mkdtempSync(join(tmpdir(), "empty-")) }), { kits: [], problems: [] });
});

test("the committed kits are read with their model count", () => {
  const root = kitsDir("nature", kit({ models: { oak: {}, fir: {} } }));
  assert.deepEqual(checkKits("client/public/assets/scenery", { root }), {
    kits: [{ name: "nature", models: 2, licence: ALLOWED_LICENCE }],
    problems: [],
  });
});

test("a kit that is not CC0 never reaches the good list", () => {
  const root = kitsDir("farm", kit({ licence: "OGA-BY-3.0" }));
  const { kits, problems } = checkKits("client/public/assets/scenery", { root });
  assert.deepEqual(kits, []);
  assert.equal(problems.length, 1);
});

test("a manifest that is not JSON is reported rather than crashing", () => {
  const root = kitsDir("broken", "{ nope");
  const { problems } = checkKits("client/public/assets/scenery", { root });
  assert.match(problems[0], /broken: manifest is not valid JSON/);
});

test("a kit directory without a manifest is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "scenery-"));
  mkdirSync(join(root, "client/public/assets/scenery/stray"), { recursive: true });
  const { problems } = checkKits("client/public/assets/scenery", { root });
  assert.match(problems[0], /stray: no manifest/);
});
