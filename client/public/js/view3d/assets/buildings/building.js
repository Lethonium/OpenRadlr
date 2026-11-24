/**
 * What every building asset shares: the `parts` / `create` contract. A
 * builder returns plain geometry lists; `parts` merges them into one
 * vertex-coloured near part, one far part and one glow part (window panes,
 * lamp heads) in local space, ground at y = 0, door facing +z. `create`
 * wraps them for the workbench. Whatever is made goes through `own`.
 */
import * as THREE from "../../../three.js";
import { merge } from "../geom.js";
import { createOwner } from "../owner.js";
import { seededRandom } from "../../../world/noise.js";
import { dice } from "./shapes.js";

export const SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);

/**
 * @typedef {object} BuildingOptions
 * @property {string} [style] the look (each asset names its own)
 * @property {"spring"|"summer"|"autumn"|"winter"} [season] winter puts snow on roofs
 * @property {boolean} [detail] false drops window frames, chimneys and sills
 * @property {number} [seed] picks colours and sizes
 * @property {boolean} [big] a larger house (the farmhouse)
 * @property {<T>(resource: T) => T} [own] registers every resource made
 */

/**
 * @typedef {object} BuildingParts
 * @property {{geometry: import("../../../three.js").BufferGeometry}[]} near
 * @property {{geometry: import("../../../three.js").BufferGeometry}[]} far
 * @property {import("../../../three.js").BufferGeometry[]} glows pane geometry the world lights at night
 * @property {number} width footprint along x
 * @property {number} depth footprint along z
 * @property {number} eaves height of the walls' top
 * @property {{x: number, y: number, z: number}} door where the main door stands
 */

/**
 * The options with their defaults.
 * @param {BuildingOptions} [options]
 */
export function buildingOptions({ style, season = "summer", detail = true, seed = 1, big = false, own = (resource) => resource } = {}) {
  return { style, season, detail, seed, big, own };
}

const mergedPart = (list, own) => (list.length ? [{ geometry: own(merge(list)) }] : []);

/**
 * Builds a building asset from its description and builder.
 * @param {{id: string, name: string, description: string, options?: object}} info
 * @param {(options: ReturnType<typeof buildingOptions> & {random: () => number, dice: ReturnType<typeof dice>}) => {near: import("../../../three.js").BufferGeometry[], far: import("../../../three.js").BufferGeometry[], glows: import("../../../three.js").BufferGeometry[], width: number, depth: number, eaves: number, door: {x: number, y: number, z: number}}} build
 * @returns {Readonly<{meta: object, parts: (options?: BuildingOptions) => BuildingParts, create: (options?: BuildingOptions & {track?: (resource: any) => any}) => {object: import("../../../three.js").Group, dispose: () => void}}>}
 */
export function defineBuilding({ id, name, description, options = {} }, build) {
  const meta = Object.freeze({
    id,
    name,
    category: "Buildings", // i18n-ok
    description,
    options: Object.freeze({ season: Object.freeze({ type: "select", values: SEASONS, default: "summer" }), ...options }),
  });
  const parts = (given) => {
    const opts = buildingOptions(given);
    const random = seededRandom(opts.seed);
    const made = build({ ...opts, random, dice: dice(random) });
    return {
      near: mergedPart(made.near, opts.own),
      far: mergedPart(made.far, opts.own),
      glows: made.glows.length ? [opts.own(merge(made.glows))] : [],
      width: made.width,
      depth: made.depth,
      eaves: made.eaves,
      door: made.door,
    };
  };
  const create = ({ track, ...options } = {}) => {
    const owner = createOwner(track);
    const { near, glows } = parts({ ...options, own: owner.own });
    const object = new THREE.Group();
    const material = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    for (const part of near) {
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      object.add(mesh);
    }
    if (glows.length) object.add(new THREE.Mesh(glows[0], owner.own(new THREE.MeshBasicMaterial({ color: 0xffe2a0 }))));
    return { object, dispose: () => owner.disposeAll() };
  };
  return Object.freeze({ meta, parts, create });
}
