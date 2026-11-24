/**
 * The island's woods: the plan's trees, instanced in chunks, leaf cards and
 * hulls near, a light hull far (`settings.treeLod`).
 */
import { NATURE } from "../assets/nature/index.js";
import { createOwner } from "./tracker.js";
import { createPlantChunks } from "./plantChunks.js";

/**
 * @param {{trees: Record<string, Float32Array>}} plan
 * @param {{assets?: Record<string, {parts: Function}>, season?: string, settings: import("../quality.js").QualitySettings,
 *   uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createForestLayer(plan, { assets = NATURE, season = "summer", settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const reach = { near: settings.treeLod.cards, far: settings.treeLod.hulls };
  const plants = createPlantChunks(plan.trees, { assets, season, detail: settings.detail, leafShadows: settings.leafShadows, reach, uniforms, own, name: "forest" });
  return {
    object: plants.object,
    chunks: plants.chunks,
    update: plants.update,
    setEnvironment() {},
    dispose() {
      plants.object.clear();
      disposeAll();
    },
  };
}
