/**
 * What every plant asset shares: the `parts` / `create` contract. `parts`
 * returns plain geometry and materials the world instances or merges (leaf
 * cards near, hulls far); `create` wraps them in an object for the workbench.
 * Whatever is made goes through `own`, so whoever called can dispose of it.
 */
import * as THREE from "../../../three.js";
import { createSharedUniforms } from "../materials.js";

/**
 * @typedef {object} PlantPart
 * @property {import("../../../three.js").BufferGeometry} geometry
 * @property {import("../../../three.js").Material} material
 * @property {import("../../../three.js").Material} [depth] shadow material of leaf cards
 */

/**
 * @typedef {object} PlantOptions
 * @property {"spring"|"summer"|"autumn"|"winter"} [season]
 * @property {boolean} [detail] false trims cards (low graphics)
 * @property {ReturnType<typeof createSharedUniforms>} [uniforms] shared shader uniforms
 * @property {<T>(resource: T) => T} [own] registers every resource made
 */

/**
 * Collects what a plant makes, so it can be disposed of together. `track`, if
 * given, is called on every resource first (a scene's tracker registers them).
 * @param {(resource: any) => any} [track]
 * @returns {{own: <T>(resource: T) => T, disposeAll: () => void}}
 */
export function createOwner(track = (resource) => resource) {
  const owned = [];
  return {
    own(resource) {
      owned.push(track(resource));
      return resource;
    },
    disposeAll() {
      for (const resource of owned.splice(0)) resource.dispose();
    },
  };
}

/**
 * The options with their defaults.
 * @param {PlantOptions} [options]
 * @returns {Required<PlantOptions>}
 */
export function plantOptions({ season = "summer", detail = true, uniforms = createSharedUniforms(), own = (resource) => resource } = {}) {
  return { season, detail, uniforms, own };
}

/**
 * Builds a plant asset from its description and parts function.
 * @param {{id: string, name: string, description: string}} info
 * @param {(options: Required<PlantOptions>) => {near: PlantPart[], far: PlantPart[]}} build
 */
export function defineAsset({ id, name, description }, build) {
  const meta = Object.freeze({
    id,
    name,
    category: "nature",
    description,
    options: Object.freeze({ season: Object.freeze({ type: "select", values: Object.freeze(["spring", "summer", "autumn", "winter"]), default: "summer" }) }),
  });
  const parts = (options) => build(plantOptions(options));
  const create = ({ track, ...options } = {}) => {
    const owner = createOwner(track);
    const { near } = parts({ ...options, own: owner.own });
    const object = new THREE.Group();
    for (const part of near) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (part.depth) mesh.customDepthMaterial = part.depth;
      object.add(mesh);
    }
    return { object, dispose: () => owner.disposeAll() };
  };
  return Object.freeze({ meta, parts, create });
}
