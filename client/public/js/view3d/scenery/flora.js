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
  // One kit for now: the roles of several would have to be merged, and the
  // first kit that can draw a role should answer for it.
  const [manifest] = scenes.kits;
  const kit = indexKit(manifest, { name: manifest.name ?? "scenery" });
  const files = manifest.files ?? {};
  const own = resolveBiome(biome)?.flora ?? null;
  return planFlora(kit, {
    fallback: own,
    // Beyond this distance the world draws the cheap twins instead (#117).
    nearRange: scenes.nearRange ?? null,
    // The season's colours for each role, so a pack's own palette is painted to
    // the island's.
    painted: own?.scenery ?? null,
    readModelFile: (id) => {
      const model = files[id];
      if (!model) throw new Error(`${kit.name}: no data for model "${id}"`);
      return model;
    },
  });
}
