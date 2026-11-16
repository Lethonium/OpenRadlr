/**
 * A kit as scenery the world can draw (#117).
 *
 * `buildScenery` (`world.js`) already decides where a tree goes — woods along the
 * road, away from buildings, out of the sea, all from the route's seed — and
 * asks the biome to draw one at a point, saying what kind it is. A kit answers
 * the same question with a styled model instead of cones, so no placement rule
 * changes: the wood is in the same places, each tree is just modelled.
 */
import { placement } from "../math.js";
import { appendInstance } from "../meshBuilder.js";
import { cheapestWithin, ROLE_BUDGET } from "./budget.js";
import { fileOf } from "./kits.js";
import { buildMesh } from "./models.js";

/** The role a kit needs for each kind of tree the world asks for. */
export const ROLES_BY_KIND = Object.freeze({
  rock: "rocks",
  bush: "bushes",
  fir: "firs",
  leafy: "leafy",
});

/** The roles the ground detail asks for: tufts of grass, and flowers. */
export const TUFT_ROLE = "tufts";
export const FLOWER_ROLE = "flowers";

/**
 * How much of the ground detail a kit asks for, against the biome's own. A
 * modelled tuft is ~36 faces where three blades are 3, so a dense verge of
 * models would cost twelve times what it did; fewer, bigger modelled tufts read
 * the same from the saddle for a fraction of that.
 */
export const DENSE_DETAIL_DENSITY = Object.freeze({ tufts: 0.12, flowers: 0.5 });

/**
 * The kind of tree `plantTree` would draw for a random draw in [0, 1), with the
 * same thresholds, so a kit's wood has the same mix of firs, leafies, bushes and
 * rocks as the biome's own. Keeping the mix is what stops a kit from turning a
 * wood into a field of identical posts.
 */
export function kindOf(kind) {
  if (kind < 0.1) return "rock";
  if (kind < 0.28) return "bush";
  if (kind < 0.62) return "fir";
  return "leafy";
}

/** A face colour under a season (see `recolour`). Kept for callers. */
export function paletteColour(role, colour, biome) {
  const painted = biome?.scenery?.[role];
  return Array.isArray(painted) && painted.length >= 3 ? painted : colour;
}

/**
 * A model's face colours under a season (#117). A kit is authored in its own
 * palette — Kenney's nature kit uses a tropical teal for leaves and a bright
 * orange bark — and this world has its own greens and browns. Each face keeps
 * the model's own shading and moves towards the season's colour: foliage by how
 * green it is, bark by how much it is a warm brown. Everything else (rock, stone)
 * is left as the model made it, so a tree still reads as bark and leaves rather
 * than one flat shape.
 *
 * `painted` is `{ foliage, bark }` for the model's role, or absent to keep the
 * colours the model was made with.
 */
export function recolour(faceColour, painted) {
  const [r, g, b] = faceColour;
  if (!painted || painted.length === 0) return [r, g, b];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const saturation = hi > 0 ? (hi - lo) / hi : 0;
  // Foliage: the green channel leads red, strongly and colourfully. A leaf is
  // not dull, and packs differ on whether it is green or teal.
  const greenness = Math.min(1, Math.max(0, (g - r) / 0.3)) * saturation;
  // Bark: a warm, dull brown — red leads green leads blue, without being vivid.
  const warm = r > g && g >= b && r - b > 0.15 ? 1 - saturation * 0.5 : 0;
  const colours = [];
  if (painted.foliage) colours.push({ weight: Math.min(1, greenness * 1.8), colour: painted.foliage });
  if (painted.bark) colours.push({ weight: Math.min(1, warm * 1.4), colour: painted.bark });
  if (colours.length === 0) return [r, g, b];
  // Keep the face's own light and shade against the painted colour.
  const light = 0.75 + 0.45 * (g - 0.35);
  const mixed = [r, g, b];
  for (const { weight, colour } of colours) {
    for (let i = 0; i < 3; i += 1) mixed[i] = mixed[i] * (1 - weight) + colour[i] * light * weight;
  }
  return mixed;
}


/**
 * A model matrix that also scales: the placement, then a uniform size. The
 * 3×3 part is column-major in indices 0..2, 4..6, 8..10. The translation in
 * 12..14 is left alone: scaling it would move the tree to `size` times its
 * distance from the origin, which is how a wood ends up scattered over the sea.
 */
function scaled(matrix, size) {
  const out = Float32Array.from(matrix);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) out[i] *= size;
  return out;
}

/** The meshes of a kit, built once and shared by every instance. */
function meshesOf(kit, readModelFile, painted = null, far = false) {
  // Paint changes geometry colours; the file id already distinguishes a near
  // model from its far twin. Sharing this cache also deduplicates a far fallback
  // that resolves to the near file.
  kit.meshes ??= {};
  const key = painted ? JSON.stringify(painted) : "own";
  const byKey = (kit.meshes[key] ??= {});
  for (const [id, model] of Object.entries(kit.models)) {
    const file = fileOf(model, far);
    if (byKey[file]) continue;
    const paint = rolePalette(kit, model, painted);
    byKey[file] = buildMesh(readModelFile(file), id, { painted: paint ? (a) => recolour([a[3], a[4], a[5]], paint) : null }).build();
  }
  return byKey;
}

/** The season's colour for the role a model plays, or null to keep its own. */
function rolePalette(kit, model, painted) {
  return painted?.[model.role] ?? null;
}

/**
 * A `flora` for `buildScenery` and `buildGroundDetail`: place a model of the
 * asked-for role, turned and sized from the seeded random the world passes in,
 * so the same route always grows the same wood.
 *
 * `fallback` is the biome's own flora. A role the kit does not hold falls back
 * to it, so a kit is never expected to cover everything: a pack with trees but
 * no flowers gives modelled trees and procedural flowers rather than bare ground.
 */
export function planFlora(kit, { readModelFile, fallback = null, painted = null, far = false, nearRange = null } = {}) {
  /** Draws one model of `role` at a point, or hands the spot to the biome. */
  const draw = (mesh, x, y, z, random, role, fallbackAt) => {
    const ids = kit.byRole[role];
    if (!ids || ids.length === 0) {
      fallbackAt?.(mesh, x, y, z, random);
      return;
    }
    // A budgeted role always takes the cheapest model it is allowed: thousands
    // of tufts are drawn, and variety there costs more than it shows.
    const budget = ROLE_BUDGET[role];
    const pick = budget === undefined ? ids[Math.floor(random() * ids.length)] : cheapestWithin(kit, role, budget);
    const model = kit.models[pick];
    const yaw = random() * Math.PI * 2;
    const [minSize = 1, maxSize = minSize] = model.sizes ?? [1];
    const size = (minSize + random() * (maxSize - minSize)) * (model.height ?? 1);
    // The same tree, drawn from its cheap twin when the caller asked for far
    // ones: the random draws above are taken either way, so a wood and its far
    // copy put every tree in the same spot.
    const mesh0 = meshesOf(kit, readModelFile, painted, far)[fileOf(model, far)];
    appendInstance(mesh, mesh0, scaled(placement([x, y, z], yaw, 0), size));
  };

  return {
    /** The roles this kit can draw, so a caller knows what to ask for. */
    roles: kit.roles,
    /** The indexed kit, for callers that ask for a model by role (a village's houses). */
    kit,
    /** How much of the ground detail to ask for, against the biome's own. */
    detailDensity: DENSE_DETAIL_DENSITY,
    /** Beyond this distance the world draws `far()` instead (#117). */
    nearRange,
    /**
     * The same flora, drawing each model's cheap twin where the kit has one
     * (#117). Empty when it has none, since the near wood already covers them.
     */
    far() {
      // A town's cheap houses do not justify drawing the whole wood a second
      // time. Only the roles this wood actually plants take part in this LOD.
      const hasFar = Object.values(ROLES_BY_KIND).some((role) => (kit.byRole[role] ?? []).some((id) => kit.models[id].far !== undefined));
      return hasFar ? planFlora(kit, { readModelFile, fallback, painted, far: true, nearRange }) : null;
    },
    /**
     * A tree, as the kind the world asked for. An explicit `role` overrides the
     * kind, which is how the studio and the tests draw one particular model.
     */
    tree({ mesh, x, y, z, kind = 0.5, random, role = null }) {
      const asked = role ?? ROLES_BY_KIND[kindOf(kind)];
      draw(mesh, x, y, z, random, asked, (m, cx, cy, cz, r) => fallback?.tree({ mesh: m, x: cx, y: cy, z: cz, kind, random: r }));
    },
    tuft({ mesh, x, y, z, random }) {
      draw(mesh, x, y, z, random, TUFT_ROLE, (m, cx, cy, cz, r) => fallback?.tuft({ mesh: m, x: cx, y: cy, z: cz, random: r }));
    },
    flower({ mesh, x, y, z, random }) {
      draw(mesh, x, y, z, random, FLOWER_ROLE, (m, cx, cy, cz, r) => fallback?.flower({ mesh: m, x: cx, y: cy, z: cz, random: r }));
    },
    /**
     * A building or a prop of `role`, picked by one draw of `random` so a
     * village is furnished the same way on every client (#117). `near` is the
     * model, `far` its cheap twin or null when the kit ships none, and
     * `bounds` its size in metres. Null when no kit holds the role, so the
     * world keeps its own.
     */
    model(role, random) {
      const ids = kit.byRole[role];
      if (!ids || ids.length === 0) return null;
      const model = kit.models[ids[Math.min(ids.length - 1, Math.floor(random() * ids.length))]];
      return {
        near: meshesOf(kit, readModelFile, painted, false)[fileOf(model)],
        far: model.far === undefined ? null : meshesOf(kit, readModelFile, painted, true)[fileOf(model, true)],
        bounds: readModelFile(fileOf(model)).bounds,
      };
    },
    /** Whether a kit holds `role`. */
    has(role) {
      return (kit.byRole[role]?.length ?? 0) > 0;
    },
  };
}
