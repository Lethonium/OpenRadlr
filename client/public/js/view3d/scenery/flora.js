/**
 * Builds the flora from what the main thread posted (#117).
 *
 * A worker can receive data, not functions, so the page sends the kit
 * manifests and their model files as plain JSON and this side turns them into
 * the `flora` that `buildScenery` draws with.
 */
import { resolveBiome } from "../biomes/index.js";
import { indexKit } from "./kits.js";
import { planFlora } from "./plan.js";

/**
 * @param {{kits?: object[], nearRange?: number}|null} scenes scenery settings
 * @param {object|null} [biome] the season, whose own flora fills any role the
 *   kit does not hold
 * @returns {object|null} a flora, or null to keep the biome's own trees
 */
export function floraOf(scenes, biome = null) {
  if (!scenes || !Array.isArray(scenes.kits) || scenes.kits.length === 0) return null;
  // A level may name several kits: the nature kit draws the woods and the town
  // kit the village. The first kit that holds a role answers for it, and a role
  // no kit holds falls back to the season's own models.
  const { kit, files } = mergeKits(scenes.kits);
  const own = resolveBiome(biome)?.flora ?? null;
  return planFlora(kit, {
    fallback: own,
    // Beyond this distance the world draws the cheap twins instead (#117).
    nearRange: scenes.nearRange ?? null,
    // A kit's leaves and bark are painted in the season's colours, so they match
    // the island's.
    painted: own?.scenery ?? null,
    readModelFile: (id) => {
      const model = files.get(id);
      if (!model) throw new Error(`${kit.name}: no data for model "${id}"`);
      return model;
    },
  });
}

/**
 * Several loaded kits as one indexed kit, and the files its models read. Packs
 * do not coordinate their names, so every kit after the first has its model
 * ids and file names prefixed with its own name; a single kit is unchanged.
 */
export function mergeKits(manifests) {
  const models = {};
  const byRole = {};
  const files = new Map();
  manifests.forEach((manifest, i) => {
    const indexed = indexKit(manifest, { name: manifest.name ?? "scenery" });
    const prefix = (id) => (i === 0 ? id : `${indexed.name}:${id}`);
    for (const [id, file] of Object.entries(manifest.files ?? {})) files.set(prefix(id), file);
    for (const [id, model] of Object.entries(indexed.models)) {
      const renamed = { ...model };
      for (const field of ["file", "near", "far"]) if (renamed[field] !== undefined) renamed[field] = prefix(renamed[field]);
      models[prefix(id)] = renamed;
    }
    for (const [role, ids] of Object.entries(indexed.byRole)) byRole[role] ??= ids.map(prefix);
  });
  const first = manifests[0];
  const kit = { name: manifests.map((m) => m.name ?? "scenery").join("+"), licence: first.licence, provenance: first.provenance ?? null, models, byRole, roles: Object.keys(byRole).sort() };
  return { kit, files };
}
