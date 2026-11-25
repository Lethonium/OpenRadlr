/**
 * Plants the parcels carry, drawn within a reach of the camera: the orchards'
 * and vineyards' rows (`plan.landRows`, `settings.landUse.rows`) and the
 * scrub (`plan.scrub`, `settings.landUse.scrub`). Both are planned in the worker.
 */
import { NATURE } from "../assets/nature/index.js";
import { createOwner } from "./tracker.js";
import { createPlantChunks } from "./plantChunks.js";

/**
 * @param {Record<string, Float32Array> | undefined} planted per plant id: x, y, z, yaw, scale
 * @param {{name: string, near: number, assets?: Record<string, {parts: Function}>, season?: string, settings: import("../quality.js").QualitySettings,
 *   uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createLandPlantLayer(planted, { name, near, assets = NATURE, season = "summer", settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const reach = { near, far: 0 };
  const plants = createPlantChunks(planted ?? {}, { assets, season, detail: settings.detail, leafShadows: settings.leafShadows, reach, uniforms, own, name });
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

/** The orchards' and vineyards' plants in rows. */
export function createLandRowLayer(plan, options) {
  return createLandPlantLayer(plan.landRows, { ...options, name: "landRows", near: options.settings.landUse.rows });
}
