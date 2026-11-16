/**
 * Imported models as drawable meshes (#117).
 *
 * A `.geo.json` file is the importer's output: a flat list of triangle corners,
 * each `[x, y, z, r, g, b]`. This turns one into a `MeshBuilder`, which is what
 * the rest of the world already knows how to draw, chunk and shadow.
 */
import { MeshBuilder } from "../meshBuilder.js";

/** Checks the shape of an imported model, so a bad file names itself. */
export function readModel(model, name = model?.name ?? "model") {
  if (!model || !Array.isArray(model.triangles) || model.triangles.length === 0) {
    throw new Error(`${name}: no triangles, so there is nothing to draw`);
  }
  if (model.triangles.length % 3 !== 0) {
    throw new Error(`${name}: ${model.triangles.length} corners, which is not a whole number of triangles`);
  }
  return model;
}

/**
 * A model as a mesh. Corners are written straight through: normals come from
 * the winding (`MeshBuilder.triangle`), which is how a flat-shaded face gets
 * its own normal and the model keeps the look it was modelled with.
 */
export function buildMesh(model, name = model?.name ?? "model") {
  const source = readModel(model, name);
  const mesh = new MeshBuilder();
  const t = source.triangles;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    mesh.triangle([a[0], a[1], a[2]], [b[0], b[1], b[2]], [c[0], c[1], c[2]], [a[3], a[4], a[5], 0]);
  }
  return mesh;
}
