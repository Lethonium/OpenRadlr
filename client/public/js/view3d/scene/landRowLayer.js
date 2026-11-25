/**
 * The orchards' and vineyards' plants in rows, drawn within `settings.landUse.rows`
 * of the camera. The rows are planned in the worker (`plan.landRows`).
 */
import { NATURE } from "../assets/nature/index.js";
import { createOwner } from "./tracker.js";
import { createPlantChunks } from "./plantChunks.js";

/**
 * @param {{landRows?: Record<string, Float32Array>}} plan
 * @param {{assets?: Record<string, {parts: Function}>, season?: string, settings: import("../quality.js").QualitySettings,
 *   uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createLandRowLayer(plan, { assets = NATURE, season = "summer", settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const reach = { near: settings.landUse.rows, far: 0 };
  const plants = createPlantChunks(plan.landRows ?? {}, { assets, season, detail: settings.detail, leafShadows: settings.leafShadows, reach, uniforms, own, name: "landRows" });
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
