/** The scrub on the hills and the tufts on the dunes (`plan.scrub`), drawn within `settings.landUse.scrub` of the camera. */
import { createLandPlantLayer } from "./landRowLayer.js";

export function createScrubLayer(plan, options) {
  return createLandPlantLayer(plan.scrub, { ...options, name: "scrub", near: options.settings.landUse.scrub });
}
