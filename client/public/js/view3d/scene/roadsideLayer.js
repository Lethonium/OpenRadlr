/**
 * The verge: clumps, rocks, bales and props (fences, walls, benches, mailboxes
 * and so on) beside the road, drawn within `settings.roadsideReach`. Props
 * follow the plant contract, so they are instanced like clumps.
 */
import { NATURE } from "../assets/nature/index.js";
import { PROPS } from "../assets/props/index.js";
import { createOwner } from "./tracker.js";
import { createPlantChunks } from "./plantChunks.js";

/**
 * @param {{roadside: Record<string, Float32Array>}} plan
 * @param {{assets?: Record<string, {parts: Function}>, season?: string, settings: import("../quality.js").QualitySettings,
 *   uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createRoadsideLayer(plan, { assets = { ...NATURE, ...PROPS }, season = "summer", settings, uniforms, track }) {
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
