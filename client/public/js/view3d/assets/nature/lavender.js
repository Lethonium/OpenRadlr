/**
 * A clump of lavender: a grey-green mound with stems and purple flower
 * spikes in summer. New in this renderer (no reference file); the same
 * low-poly vertex-colour style as the bush.
 */
import { seededRandom } from "../../../world/noise.js";
import { defineAsset } from "./asset.js";
import { bodyMaterial } from "./foliage.js";
import { colour, cone, ico, merge, rod, shadeY } from "./geom.js";

const LEAF = Object.freeze({ spring: "#7d9a64", summer: "#6f8a5a", autumn: "#8a8760", winter: "#8d9484" });
const SPIKE = Object.freeze({ spring: null, summer: "#8a63b8", autumn: "#7a6a78", winter: null });
const STEMS = 9;

/** A flattened icosahedron `scale` times a clump's size, its lowest vertex on y = 0. */
function mound(color, scale) {
  const g = ico(0.22 * scale, 0, color);
  g.scale(1, 0.75, 1);
  return g.translate(0, 0.1404 * scale, 0);
}

export const lavender = defineAsset({ id: "lavender", name: "Lavender", description: "Clump of lavender with purple flower spikes in summer." }, ({ season, uniforms, own }) => { // i18n-ok
  const random = seededRandom(61);
  const leaf = colour(LEAF[season]);
  const stem = colour("#6b8a52");
  const flower = SPIKE[season] ? colour(SPIKE[season]) : null;
  const near = [mound(leaf, 1.3), mound(leaf, 1).translate(0.16, 0, 0.08), mound(leaf, 1).translate(-0.15, 0, -0.1)];
  for (let i = 0; i < STEMS; i += 1) {
    const a = (i / STEMS) * Math.PI * 2 + random();
    const d = 0.06 + random() * 0.16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const top = 0.55 + random() * 0.2;
    near.push(rod([x, 0.1, z], [x * 1.4, top, z * 1.4], 0.008, stem, 3, true));
    if (flower) near.push(cone(0.035, 0.2, 5, flower, x * 1.4, top + 0.07, z * 1.4));
  }
  const material = own(bodyMaterial(uniforms, 0.03));
  const far = merge([mound(flower ?? leaf, 1.6), mound(leaf, 1.2).translate(0.12, 0, 0.06)]);
  return { near: [{ geometry: own(shadeY(merge(near), 0.7, 1, 0, 0.7)), material }], far: [{ geometry: own(far), material }] };
});
