/**
 * The verge: clumps, rocks and bales beside the road, drawn within
 * `settings.roadsideReach`. Prop ids without a plant asset (fences, benches,
 * mailboxes and so on) are skipped until the props arrive.
 */
import { NATURE } from "../assets/nature/index.js";
import { createOwner } from "./tracker.js";
import { createPlantChunks } from "./plantChunks.js";

/**
 * @param {{roadside: Record<string, Float32Array>}} plan
 * @param {{assets?: Record<string, {parts: Function}>, season?: string, settings: import("../quality.js").QualitySettings,
 *   uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createRoadsideLayer(plan, { assets = NATURE, season = "summer", settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const reach = { near: settings.roadsideReach, far: 0 };
  const plants = createPlantChunks(plan.roadside, { assets, season, detail: settings.detail, leafShadows: settings.leafShadows, reach, uniforms, own, name: "roadside" });
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
