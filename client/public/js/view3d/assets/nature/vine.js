/**
 * A vine stock on a wire post, for the vineyards' rows: a short trunk, a
 * leafy cloud and canes in the growing seasons, a bare brown stock in winter.
 * New in this renderer (no reference file); low poly, vertex colours.
 */
import { defineAsset } from "./asset.js";
import { bodyMaterial } from "./foliage.js";
import { box, colour, ico, merge, rod, shadeY } from "../geom.js";

const LEAF = Object.freeze({ spring: "#a3c46a", summer: "#5f8c3e", autumn: "#b9552e", winter: null });
const LEAF_2 = Object.freeze({ spring: "#8fb85c", summer: "#6f9a46", autumn: "#d09a35", winter: null });

/** A flattened leafy lump whose lowest point is `y`. */
function lump(color, radius, x, y, z) {
  const g = ico(radius, 0, color);
  g.scale(1.1, 0.8, 1);
  return g.translate(x, y + radius * 0.8, z);
}

export const vine = defineAsset({ id: "vine", name: "Vine", description: "Vine stock on a wire post, leafy in the growing seasons and bare in winter." }, ({ season, uniforms, own }) => { // i18n-ok
  const wood = colour("#6b5238");
  const post = () => box(0.07, 1.5, 0.07, colour("#7d6a4f"), 0.3, 0.75, 0);
  const stock = () => rod([0, 0, 0], [0, 0.75, 0], 0.035, wood, 4, true);
  const leaf = LEAF[season] ? colour(LEAF[season]) : null;
  const leaf2 = LEAF_2[season] ? colour(LEAF_2[season]) : null;
  const near = [post(), stock()];
  const far = [post(), stock()];
  if (leaf) {
    near.push(lump(leaf, 0.42, 0, 0.5, 0), lump(leaf2, 0.34, 0.2, 0.75, 0.05));
    far.length = 0;
    far.push(post(), lump(leaf, 0.5, 0.1, 0.4, 0));
  } else {
    near.push(rod([0, 0.7, 0], [0.3, 1.25, 0], 0.02, wood, 3, true), rod([0, 0.7, 0], [-0.25, 1.15, 0.05], 0.02, wood, 3, true));
  }
  const material = own(bodyMaterial(uniforms, 0.03));
  return { near: [{ geometry: own(shadeY(merge(near), 0.75, 1, 0, 1.5)), material }], far: [{ geometry: own(merge(far)), material }] };
});
