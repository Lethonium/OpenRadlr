/**
 * A kit: a set of imported models grouped by the job they do (#117).
 *
 * The manifest is the only place that knows where models came from, so it is
 * also where the licence is checked. A kit that is not CC0 never becomes
 * drawable, which is the same rule `tools/scenery/check.mjs` enforces before a
 * commit — here it stops a bad kit from being used even if one slipped in.
 */

/** The only licence a kit may claim (see ASSETS-LICENSE.md). */
export const ALLOWED_LICENCE = "CC0-1.0";

/**
 * Indexes a kit manifest: models by name, and the names of each role, with
 * every variant it names checked to exist. `height` scales a model to metres
 * when a pack's units disagree with the world's (Y-up, one unit is a metre).
 */
export function indexKit(manifest, { name = manifest?.name ?? "kit" } = {}) {
  if (!manifest || typeof manifest !== "object") throw new Error(`${name}: no manifest`);
  if (manifest.licence !== ALLOWED_LICENCE) {
    throw new Error(`${name}: licence is ${JSON.stringify(manifest.licence)}, only "${ALLOWED_LICENCE}" may be drawn`);
  }
  const models = {};
  const declared = manifest.models ?? {};
  for (const [id, model] of Object.entries(declared)) {
    // `near`/`far` name other models of the kit (a cheaper level of detail);
    // `file` is a file name, checked by the loader instead.
    for (const variant of [model.near, model.far]) {
      if (variant !== undefined && !(variant in declared)) {
        throw new Error(`${name}: model "${id}" uses "${variant}", which the kit does not hold`);
      }
    }
    if (fileOf(model) === undefined) throw new Error(`${name}: model "${id}" names no file to draw`);
    models[id] = model;
  }
  const byRole = {};
  for (const [id, model] of Object.entries(models)) {
    const role = model.role ?? "default";
    (byRole[role] ??= []).push(id);
  }
  return { name, licence: manifest.licence, provenance: manifest.provenance ?? null, models, byRole, roles: Object.keys(byRole).sort() };
}

/** Which of a model's variants to draw at `distance`: the near one within range. */
export function pickLod(model, distance, nearRange) {
  return model.far !== undefined && distance > nearRange ? model.far : model.near;
}

/**
 * The file holding a model. A manifest names it `near` (with an optional `far`
 * for distance), or plainly `file` when the kit has only one level of detail.
 */
export function fileOf(model) {
  return model.near ?? model.file;
}
