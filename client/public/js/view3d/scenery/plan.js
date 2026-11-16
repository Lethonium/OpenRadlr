/**
 * A kit as scenery the world can draw (#117).
 *
 * `buildScenery` (`world.js`) already decides where trees go — woods along the
 * road, away from buildings, out of the sea, all from the route's seed — and
 * asks the biome to draw one at a point. A kit answers the same question with a
 * styled model instead of cones, so no placement rule changes.
 */
import { placement } from "../math.js";
import { fileOf, pickLod } from "./kits.js";
import { buildMesh } from "./models.js";

/**
 * A face colour under a season. `biome.scenery` maps a model's material role
 * (`bark`, `foliage`, `roof`, …) to the colour that season paints it; a role the
 * season does not name keeps the colour the model was made with, so a season
 * that knows nothing about scenery still looks right.
 */
export function paletteColour(role, colour, biome) {
  const painted = biome?.scenery?.[role];
  return Array.isArray(painted) && painted.length >= 3 ? painted : colour;
}

/**
 * A model matrix that also scales: the placement, then a uniform size. The
 * 3×3 part is column-major in indices 0..2, 4..6, 8..10, and the translation
 * sits in 12..14 — both scale, so a scaled model still stands where placed.
 */
function scaled(matrix, size) {
  const out = Float32Array.from(matrix);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) out[i] *= size;
  return out;
}

/** The meshes of a kit, built once per kit and shared by every instance. */
function meshesOf(kit, readModelFile) {
  if (kit.meshes) return kit.meshes;
  const meshes = {};
  for (const [id, model] of Object.entries(kit.models)) {
    for (const variant of [fileOf(model), model.far]) {
      if (variant === undefined || meshes[variant]) continue;
      // `append` takes a built mesh (plain typed arrays), not a MeshBuilder.
      meshes[variant] = buildMesh(readModelFile(variant), id).build();
    }
  }
  kit.meshes = meshes;
  return meshes;
}

/**
 * A `flora` for `buildScenery`: `tree({ mesh, x, y, z, random, role })` draws a
 * model of that role, turned and sized from the seeded random the world passes
 * in, so the same route always grows the same wood.
 */
/** What the scenery builder asks for: the role that stands in for its trees. */
export const TREE_ROLE = "trees";

export function planFlora(kit, { nearRange = 150, readModelFile, biome = null, role = TREE_ROLE } = {}) {
  return {
    /** The roles this kit can draw, so a caller knows what to ask for. */
    roles: kit.roles,
    tree({ mesh, x, y, z, random, role: asked = role }) {
      const ids = kit.byRole[asked];
      if (!ids || ids.length === 0) return; // a role the kit does not hold draws nothing
      const model = kit.models[ids[Math.floor(random() * ids.length)]];
      const yaw = random() * Math.PI * 2;
      const [minSize = 1, maxSize = minSize] = model.sizes ?? [1];
      const size = (minSize + random() * (maxSize - minSize)) * (model.height ?? 1);
      // One level of detail for now: the far variant is chosen by the view, which
      // knows the distance; the world build places from the map, at one size.
      const variant = model.far !== undefined ? pickLod(model, 0, nearRange) : fileOf(model);
      void biome;
      mesh.append(meshesOf(kit, readModelFile)[variant], scaled(placement([x, y, z], yaw, 0), size));
    },
  };
}
