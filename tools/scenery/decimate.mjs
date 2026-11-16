// Vertex-cluster decimation for a kit's models (#117).
//
// A pack's trees are authored for a hero shot: 1,400-2,900 triangles each, most
// of it branch tubes hidden inside the canopy. The renderer draws a thousand of
// them, so each model needs a cheaper version for distance.
//
// Grid-clustering merges every vertex within a cell into one, which keeps the
// silhouette and the material colours while dropping the detail that does not
// show at range. Pure geometry: it knows nothing about trees.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { importObj } from "./import.mjs";

/**
 * The most triangles one face may cost in the distance model.
 *
 * @param {{triangles: number[][]}} model an imported model
 * @param {number} cell the cluster cell, as a fraction of the model's size
 * @returns {{triangles: number[][], bounds: object}} a cheaper model, same shape
 */
export function decimate(model, cell = 0.06) {
  const t = model.triangles;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const corner of t) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], corner[k]);
      max[k] = Math.max(max[k], corner[k]);
    }
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const step = size * cell;

  // Every corner lands in a cell; the cell's corners average to one vertex.
  const cells = new Map();
  const keyOf = (corner) => `${Math.round(corner[0] / step)},${Math.round(corner[1] / step)},${Math.round(corner[2] / step)}`;
  for (const corner of t) {
    const key = keyOf(corner);
    const cell = cells.get(key);
    if (!cell) cells.set(key, { sum: [corner[0], corner[1], corner[2]], n: 1, colour: [corner[3], corner[4], corner[5]] });
    else {
      cell.sum[0] += corner[0];
      cell.sum[1] += corner[1];
      cell.sum[2] += corner[2];
      cell.n += 1;
    }
  }
  const at = (key) => {
    const c = cells.get(key);
    return [c.sum[0] / c.n, c.sum[1] / c.n, c.sum[2] / c.n, ...c.colour];
  };

  const out = [];
  for (let i = 0; i + 2 < t.length; i += 3) {
    const keys = [keyOf(t[i]), keyOf(t[i + 1]), keyOf(t[i + 2])];
    // A face whose corners shared a cell has no area left.
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue;
    out.push(at(keys[0]), at(keys[1]), at(keys[2]));
  }
  return { ...model, triangles: out, decimated: cell };
}

/** `node decimate.mjs <model.obj> --out <dir> [--cell 0.06] [--name n]` */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (key, fallback) => {
    const i = args.indexOf(`--${key}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const source = args[0];
  const name = flag("name", basename(source, extname(source)));
  const out = flag("out", ".");
  const cell = Number(flag("cell", 0.06));
  const mtlBeside = `${source.slice(0, source.length - extname(source).length)}.mtl`;
  let mtl = "";
  try {
    mtl = readFileSync(mtlBeside, "utf8");
  } catch {
    // A model without an MTL keeps its own palette from the OBJ (rare).
  }
  const full = importObj(readFileSync(source, "utf8"), { name, mtl });
  const cheap = decimate(full, cell);
  writeFileSync(join(out, `${name}.geo.json`), `${JSON.stringify(cheap)}\n`);
  console.log(`${name}: ${full.triangles.length / 3} -> ${cheap.triangles.length / 3} triangles (cell ${cell})`);
}
