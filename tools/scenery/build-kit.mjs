// Imports a pack's models into a kit, with a cheaper far version of each (#117).
//
//   node build-kit.mjs <source dir> <assets dir> [--kit <name>] [--far 0.08] [--lod <model> ...]
//
// Every model in the source folder is imported at full detail. The ones named
// by `--lod` (or, with none named, every model) also get a decimated twin for
// distance, written as `<name>-far.geo.json`; a model whose twin is too heavy
// to be worth it is left without one, so the kit can say which range it needs.
import { basename, extname, join, relative, dirname } from "node:path";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { importGlb, readObj, writeModel } from "./import.mjs";
import { decimate } from "./decimate.mjs";

/** Every model file under `dir`, by stem, keyed by its path relative to `root`. */
function modelFiles(dir, root = dir) {
  const found = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of modelFiles(full, root)) found.set(key, value);
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    if (ext !== ".glb" && ext !== ".obj") continue;
    found.set(basename(entry.name, ext), { path: full, group: dirname(relative(root, full)) });
  }
  return found;
}

/**
 * A model as the kit holds it: the importer's geometry, plus the size of the
 * box it fills, so a manifest can be written without reading the file again.
 */
export function modelOf(source, name = basename(source, extname(source))) {
  return extname(source).toLowerCase() === ".glb" ? importGlb(readFileSync(source), { name, baseDir: dirname(source) }) : readObj(source, { name });
}

/** Writes `<name>.geo.json` and, for a model with one, `<name>-far.geo.json`. */
export function writeLod(model, out, { far = 0.08 } = {}) {
  writeModel(model, join(out, `${model.name}.geo.json`));
  const cheap = decimate(model, far);
  // A twin that is barely cheaper is not worth the download: leave it out.
  const worthIt = cheap.triangles.length < model.triangles.length * 0.7;
  if (worthIt) writeModel(cheap, join(out, `${model.name}-far.geo.json`));
  return { full: model.triangles.length / 3, far: worthIt ? cheap.triangles.length / 3 : null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (key, fallback) => {
    const at = args.indexOf(`--${key}`);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      i += 1;
      continue;
    }
    if (i > 0 && args[i - 1].startsWith("--")) continue;
    positional.push(args[i]);
  }
  const [source, out] = positional;
  if (!source || !out) {
    console.error("usage: node build-kit.mjs <source dir> <assets dir> [--far 0.08] [--lod a --lod b]");
    process.exit(1);
  }
  const far = Number(flag("far", 0.08));
  const lods = args.flatMap((a, i) => (a === "--lod" ? [args[i + 1]] : []));
  mkdirSync(out, { recursive: true });
  const files = modelFiles(source);
  const names = [...files.keys()].sort();
  for (const name of names) {
    const { path, group } = files.get(name);
    const model = modelOf(path, name);
    const wantTwin = lods.length === 0 || lods.includes(name) || lods.includes(group);
    if (!wantTwin) {
      writeModel(model, join(out, `${name}.geo.json`));
      console.log(`${name}: ${model.triangles.length / 3} triangles`);
      continue;
    }
    const counts = writeLod(model, out, { far });
    console.log(`${name}: ${counts.full} triangles, ${counts.far === null ? "no cheap twin" : `${counts.far} far`}`);
  }
}
