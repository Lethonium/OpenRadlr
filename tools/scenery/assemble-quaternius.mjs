// Builds a Quaternius kit from a pack's OBJ folder (#117).
//
//   node tools/scenery/assemble-quaternius.mjs nature <OBJ dir> <out dir> [--far 0.20]
//   node tools/scenery/assemble-quaternius.mjs farm   <OBJ dir> <out dir> [--far 0.20]
//
// Quaternius ships untextured OBJ + MTL models, already at real-world metres.
// A kit needs three things the pack does not: a role per model, a cheap twin
// for distance, and a manifest that records the CC0 provenance. The selection
// below is the only thing a new pack has to add.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readObj, writeModel } from "./import.mjs";
import { decimate } from "./decimate.mjs";

/** The CC0 evidence we can copy beside a kit, from the pack's own page/zip. */
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

/**
 * The models of a pack that play a role in the world, with the scale the
 * scenery builder applies (`height` multiplies the model's own size, and
 * `sizes` multiplies that again).
 *
 * Quaternius nature models are authored 2.3-4 units tall, and `height`
 * multiplies that, not metres: each tree's `height` is 19 over its own
 * height, so a tree is 19 m at size 1 and 10-19 m with `sizes`, in scale
 * with the 6-9 m houses (see `treeHeights.test.js`).
 * The farm models are already the right size and `planFlora.model` does not
 * apply `height`, so they carry none.
 */
export const PACKS = Object.freeze({
  nature: Object.freeze({
    name: "quaternius-nature",
    provenance: Object.freeze({
      pack: "https://quaternius.com/packs/ultimatenature.html",
      licence: CC0,
      taken: "2026-11-17",
      note: "Ultimate Nature Pack by Quaternius. The pack's own License.txt, in its Google Drive folder, says CC0 1.0 Universal. OBJ folder, 19 of the 150 models.",
    }),
    models: Object.freeze({
      pine1: { file: "PineTree_1", role: "firs", height: 7.04, sizes: [0.55, 1] },
      pine2: { file: "PineTree_2", role: "firs", height: 5.34, sizes: [0.55, 1] },
      pine3: { file: "PineTree_3", role: "firs", height: 5.76, sizes: [0.55, 1] },
      common1: { file: "CommonTree_1", role: "leafy", height: 7.66, sizes: [0.55, 1] },
      common2: { file: "CommonTree_2", role: "leafy", height: 6.09, sizes: [0.55, 1] },
      common3: { file: "CommonTree_3", role: "leafy", height: 5.49, sizes: [0.55, 1] },
      common4: { file: "CommonTree_4", role: "leafy", height: 6.83, sizes: [0.55, 1] },
      birch1: { file: "BirchTree_1", role: "leafy", height: 5.32, sizes: [0.55, 1] },
      birch2: { file: "BirchTree_2", role: "leafy", height: 4.71, sizes: [0.55, 1] },
      willow1: { file: "Willow_1", role: "leafy", height: 6.67, sizes: [0.55, 1] },
      willow2: { file: "Willow_2", role: "leafy", height: 5.72, sizes: [0.55, 1] },
      willow3: { file: "Willow_3", role: "leafy", height: 8.09, sizes: [0.55, 1] },
      bush1: { file: "Bush_1", role: "bushes", height: 1.6, sizes: [0.7, 1] },
      bush2: { file: "Bush_2", role: "bushes", height: 1.4, sizes: [0.7, 1] },
      bushBerries: { file: "BushBerries_1", role: "bushes", height: 1.6, sizes: [0.8, 1] },
      rock1: { file: "Rock_1", role: "rocks", height: 1.5, sizes: [0.5, 1.1] },
      rock2: { file: "Rock_2", role: "rocks", height: 1.4, sizes: [0.5, 1.1] },
    }),
    license: [
      "LowPoly Models by @Quaternius",
      "",
      "License:",
      "CC0 1.0 Universal (CC0 1.0)",
      "Public Domain Dedication",
      CC0,
      "",
      "Source: https://quaternius.com/packs/ultimatenature.html",
      "Taken: 2026-11-17",
      "",
    ].join("\n"),
  }),
  farm: Object.freeze({
    name: "quaternius-farm",
    provenance: Object.freeze({
      pack: "https://quaternius.itch.io/lowpoly-farm-buildings",
      licence: CC0,
      taken: "2026-11-17",
      note: "LowPoly Farm Buildings by Quaternius. Its itch.io page states CC0 1.0. The pack has no License.txt of its own.",
    }),
    models: Object.freeze({
      barn: { file: "Barn", role: "farmBarns" },
      bigBarn: { file: "BigBarn", role: "farmBarns" },
      openBarn: { file: "OpenBarn", role: "farmBarns" },
      smallBarn: { file: "SmallBarn", role: "farmBarns" },
      silo: { file: "Silo", role: "farmSilos" },
      siloHouse: { file: "Silo_House", role: "farmSilos" },
      waterTower: { file: "WaterTower", role: "farmSilos" },
      windmill: { file: "Windmill", role: "farmWindmills" },
      towerWindmill: { file: "TowerWindmill", role: "farmWindmills" },
      well: { file: "Well", role: "farmWells" },
      fence: { file: "Fence", role: "farmFences" },
      fence2: { file: "Fence2", role: "farmFences" },
      coop: { file: "ChickenCoop", role: "farmCoops" },
    }),
    license: [
      "LowPoly Farm Buildings by @Quaternius",
      "",
      "License:",
      "CC0 1.0 Universal (CC0 1.0)",
      "Public Domain Dedication",
      CC0,
      "",
      "Source: https://quaternius.itch.io/lowpoly-farm-buildings",
      "Taken: 2026-11-17",
      "",
    ].join("\n"),
  }),
});

/** The manifest for a built pack, given each model's full triangle count. */
export function manifestOf(pack, triangles) {
  const models = {};
  for (const [id, spec] of Object.entries(pack.models)) {
    models[id] = {
      role: spec.role,
      file: spec.file,
      ...(spec.height !== undefined ? { height: spec.height } : {}),
      ...(spec.sizes !== undefined ? { sizes: spec.sizes } : {}),
      ...(spec.far !== undefined ? { far: spec.far } : {}),
      triangles: triangles[id],
    };
  }
  return { name: pack.name, licence: "CC0-1.0", provenance: pack.provenance, models };
}

/**
 * Imports every selected model, writes its `.geo.json`, decimates a far twin
 * when that is worth a file, and writes `manifest.json` + `License.txt`.
 *
 * @param {{pack: object, source: string, out: string, far?: number}} options
 * @returns {object} the manifest
 */
export function buildKit({ pack, source, out, far = 0.2 }) {
  mkdirSync(out, { recursive: true });
  const triangles = {};
  const farNames = {};
  for (const [id, spec] of Object.entries(pack.models)) {
    const model = readObj(join(source, `${spec.file}.obj`), { name: spec.file });
    writeModel(model, join(out, `${spec.file}.geo.json`));
    triangles[id] = model.triangles.length / 3;
    const cheap = decimate(model, far);
    // A twin that is barely cheaper is not worth the download.
    if (cheap.triangles.length < model.triangles.length * 0.7) {
      const farName = `${spec.file}-far`;
      writeModel(cheap, join(out, `${farName}.geo.json`));
      farNames[id] = farName;
    }
  }
  const packWithFar = { ...pack, models: Object.fromEntries(Object.entries(pack.models).map(([id, spec]) => [id, { ...spec, far: farNames[id] }])) };
  const manifest = manifestOf(packWithFar, triangles);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(out, "License.txt"), pack.license);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (key, fallback) => {
    const at = args.indexOf(`--${key}`);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const positional = args.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const [kind, source, out] = positional;
  const pack = PACKS[kind];
  if (!pack || !source || !out) {
    console.error("usage: node tools/scenery/assemble-quaternius.mjs <nature|farm> <OBJ dir> <out dir> [--far 0.20]");
    process.exit(1);
  }
  const manifest = buildKit({ pack, source, out, far: Number(flag("far", 0.2)) });
  for (const [id, model] of Object.entries(manifest.models)) {
    console.log(`${id.padEnd(12)} ${String(model.triangles).padStart(5)} tris${model.far ? " + far" : ""}`);
  }
  console.log(`${manifest.name}: ${Object.keys(manifest.models).length} models, ${manifest.licence}`);
}
