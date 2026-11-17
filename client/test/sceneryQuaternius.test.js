/**
 * The Quaternius kit builder (#117): a pack's OBJ folder into the kit format
 * the world reads, with a cheap twin per model and a manifest that records the
 * licence.
 *
 * The two packs are CC0, but their folder layouts differ from Kenney's, so the
 * selection of what plays which role lives here, not in a hand-written
 * manifest.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PACKS, buildKit, manifestOf } from "../../tools/scenery/assemble-quaternius.mjs";

const ROLES = (pack) => new Set(Object.values(pack.models).map((m) => m.role));

test("the nature selection covers the roles the woods ask for, and no ground detail", () => {
  const roles = ROLES(PACKS.nature);
  for (const role of ["firs", "leafy", "bushes", "rocks"]) assert.ok(roles.has(role), `nature has ${role}`);
  assert.ok(!roles.has("tufts"), "the plants are too heavy for the tuft budget");
  assert.ok(!roles.has("flowers"), "the pack has no flowers");
  const files = Object.values(PACKS.nature.models).map((m) => m.file);
  assert.equal(new Set(files).size, files.length, "every model is named once");
});

test("the farm selection has its own roles, so it cannot steal the village's", () => {
  const roles = ROLES(PACKS.farm);
  for (const role of ["farmBarns", "farmSilos", "farmWindmills", "farmWells", "farmFences", "farmCoops"]) assert.ok(roles.has(role), `farm has ${role}`);
  for (const role of ["houses", "windmills", "fences", "stalls", "church"]) assert.ok(!roles.has(role), `farm must not claim ${role}`);
});

test("a manifest is CC0 and says where the models came from", () => {
  const manifest = manifestOf(PACKS.farm, { barn: 100 });
  assert.equal(manifest.name, "quaternius-farm");
  assert.equal(manifest.licence, "CC0-1.0");
  assert.match(manifest.provenance.pack, /^https?:\/\//);
  assert.equal(manifest.provenance.taken, "2026-11-17");
  assert.equal(manifest.models.barn.triangles, 100);
});

test("the builder writes the model, a cheaper far twin, and the manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "quaternius-"));
  try {
    writeFileSync(join(root, "Thing.obj"), ["v 0 0 0", "v 2 0 0", "v 0 4 0", "v 2 0 0", "v 2 4 0", "v 0 4 0", "usemtl Green", "f 1 2 3", "f 4 5 6"].join("\n"));
    writeFileSync(join(root, "Thing.mtl"), "newmtl Green\nKd 0.2 0.6 0.3\n");
    const pack = {
      ...PACKS.farm,
      models: { thing: { file: "Thing", role: "farmBarns" } },
    };
    const manifest = buildKit({ pack, source: root, out: join(root, "out"), far: 0.5 });
    const model = JSON.parse(readFileSync(join(root, "out", "Thing.geo.json"), "utf8"));
    assert.equal(model.triangles.length, 6);
    assert.equal(manifest.models.thing.triangles, 2);
    assert.equal(manifest.models.thing.role, "farmBarns");
    assert.equal(manifest.models.thing.file, "Thing");
    assert.equal(JSON.parse(readFileSync(join(root, "out", "manifest.json"), "utf8")).licence, "CC0-1.0");
    // Two triangles at a 50% cell collapse to nothing: no far file is written.
    assert.equal(manifest.models.thing.far, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
