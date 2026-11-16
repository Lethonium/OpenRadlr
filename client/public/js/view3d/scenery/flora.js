/**
 * Builds the flora from what the main thread posted (#117).
 *
 * A worker can receive data, not functions, so the page sends the kit
 * manifests and their model files as plain JSON and this side turns them into
 * the `flora` that `buildScenery` draws with.
 */
import { indexKit } from "./kits.js";
import { planFlora } from "./plan.js";

/**
 * @param {{kits?: object[], nearRange?: number}|null} scenes scenery settings
 * @returns {object|null} a flora, or null to keep the biome's own trees
 */
export function floraOf(scenes) {
  if (!scenes || !Array.isArray(scenes.kits) || scenes.kits.length === 0) return null;
  // One kit for now: the roles of several would have to be merged, and the
  // first kit that can draw a role should answer for it.
  const [manifest] = scenes.kits;
  const kit = indexKit(manifest, { name: manifest.name ?? "scenery" });
  const files = manifest.files ?? {};
  return planFlora(kit, {
    nearRange: scenes.nearRange ?? 150,
    readModelFile: (id) => {
      const model = files[id];
      if (!model) throw new Error(`${kit.name}: no data for model "${id}"`);
      return model;
    },
  });
}
