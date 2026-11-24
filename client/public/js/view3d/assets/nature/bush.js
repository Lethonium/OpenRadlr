/**
 * Shrub: three lumpy hull blobs with leaf cards. Restyled from the
 * reference's `bush.js`; tinted per season.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";
import { defineAsset } from "./asset.js";
import { bodyMaterial, foliageDepth, foliageMaterial, leafCards } from "./foliage.js";
import { leafTexture } from "./foliageTextures.js";
import { colour, deepFreeze, groundAll, ico, merge, shadeY } from "./geom.js";

const CLUSTERS = deepFreeze([{ x: 0, y: 0.6, z: 0, r: 1 }, { x: 0.7, y: 0.45, z: 0.2, r: 0.75 }, { x: -0.6, y: 0.4, z: -0.2, r: 0.7 }]);
const COLOURS = deepFreeze({
  spring: ["#4a7f32", "#58903a"],
  summer: ["#5f8434", "#6e8f3a"],
  autumn: ["#b8642a", "#9e4527", "#c99a36"],
  winter: ["#5d6b4c", "#6a7558"],
});
const SNOW = colour("#eef2f7");

export const bush = defineAsset({ id: "bush", name: "Bush", description: "Shrub with leaf cards, tinted by season; dull and frosted in winter." }, ({ season, detail, uniforms, own }) => { // i18n-ok
  const palette = COLOURS[season].map((hex) => (season === "winter" ? colour(hex).lerp(SNOW, 0.25) : colour(hex)));
  const hull = (blobDetail) => shadeY(merge(CLUSTERS.map((c) => ico(c.r * 0.85, blobDetail, palette[0], c.x, c.y, c.z))), 0.45, 0.85, 0, 1.5);
  const material = own(bodyMaterial(uniforms, 0.04));
  const cards = leafCards(seededRandom(51), CLUSTERS.map((c) => ({ ...c, n: Math.round(c.r * (detail ? 12 : 6)) })), { size: [0.6, 0.9], center: new THREE.Vector3(0, 0.3, 0), up: 0.6, palette });
  const map = own(leafTexture(128, 51));
  const [nearHull] = groundAll([hull(1), cards]);
  const [farHull] = groundAll([hull(0)]);
  return {
    near: [{ geometry: own(nearHull), material }, { geometry: own(cards), material: own(foliageMaterial(map, { wind: 0.04, uniforms })), depth: own(foliageDepth(map)) }],
    far: [{ geometry: own(farHull), material }],
  };
});
