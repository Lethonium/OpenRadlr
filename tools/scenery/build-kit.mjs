// Imports a pack's models into a kit, with a cheaper far version of each (#117).
//
//   node build-kit.mjs <pack dir> <assets dir> <name> [name...] [--far 0.08]
//
// Every model is imported at full detail and again decimated, so the kit can
// draw it properly up close and cheaply at distance.
import { basename, extname, join } from "node:path";
import { readObj, writeModel } from "./import.mjs";
import { decimate } from "./decimate.mjs";

/**
 * Writes `<name>.geo.json` and `<name>-far.geo.json` for one model.
 *
 * @returns {{full: number, far: number}} the triangles each one holds
 */
export function writeLod(model, out, { far = 0.08 } = {}) {
  writeModel(model, join(out, `${model.name}.geo.json`));
  const cheap = decimate(model, far);
  writeModel(cheap, join(out, `${model.name}-far.geo.json`));
  return { full: model.triangles.length / 3, far: cheap.triangles.length / 3 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--far");
  const far = at >= 0 ? Number(args[at + 1]) : 0.08;
  // `--far 0.08` is a flag and its value, not a name to import.
  const positional = at >= 0 ? [...args.slice(0, at), ...args.slice(at + 2)] : args;
  const [pack, out, ...names] = positional;
  if (!pack || !out || names.length === 0) {
    console.error("usage: node build-kit.mjs <pack dir> <assets dir> <name> [name...] [--far 0.08]");
    process.exit(1);
  }
  for (const name of names) {
    const model = readObj(join(pack, `${name}.obj`), { name });
    const counts = writeLod(model, out, { far });
    console.log(`${basename(name)}: ${counts.full} / ${counts.far} triangles`);
  }
}
