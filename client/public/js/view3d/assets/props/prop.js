/**
 * What every roadside prop shares: the plant contract (`defineAsset`), with
 * one merged vertex-coloured near part on the shared body material and no far
 * twin (a prop is too small to be seen from where far parts begin). A prop
 * lies along its own x axis, ground at y = 0, and is the same every time.
 */
import { defineAsset } from "../nature/asset.js";
import { bodyMaterial } from "../nature/foliage.js";
import { groundAll, merge } from "../geom.js";
import { seededRandom } from "../../../world/noise.js";
import { dice } from "../buildings/shapes.js";

/** Winter's white on a snow-bearing top (linear, brighter than any summer stone). */
export const SNOW = "#f2f5f7";

/**
 * Defines a prop from a builder of geometries.
 * @param {{id: string, name: string, description: string}} info
 * @param {(options: {season: string, detail: boolean, random: () => number, dice: ReturnType<typeof dice>}) => import("../../../three.js").BufferGeometry[]} build
 */
export function defineProp(info, build) {
  return defineAsset(info, ({ season, detail, uniforms, own }) => {
    const random = seededRandom(0x9e3779b1);
    const geometry = own(merge(groundAll(build({ season, detail, random, dice: dice(random) }))));
    return { near: [{ geometry, material: own(bodyMaterial(uniforms, 0, 0.9)) }], far: [] };
  });
}
