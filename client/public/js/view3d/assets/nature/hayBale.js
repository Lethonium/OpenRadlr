/** A round bale on its side, the prop of stubble fields and farm verges. Restyled from the reference's `hay-bale.js`. */
import { defineAsset } from "./asset.js";
import { bodyMaterial } from "./foliage.js";
import { baleGeometry } from "./crops.js";
import { groundAll } from "../geom.js";

export const hayBale = defineAsset({ id: "hayBale", name: "Hay bale", description: "Round bale for stubble fields and farm verges." }, ({ uniforms, own }) => { // i18n-ok
  const material = own(bodyMaterial(uniforms, 0, 0.9));
  return { near: [{ geometry: own(groundAll([baleGeometry(12)])[0]), material }], far: [{ geometry: own(groundAll([baleGeometry(6)])[0]), material }] };
});
