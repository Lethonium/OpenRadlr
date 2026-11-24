/**
 * Plants as instanced meshes in spatial chunks. Every plant id gets, per
 * 300 m cell, one instanced mesh per part: the near parts (hull and leaf
 * cards) and the far parts (a light hull). Per frame a chunk shows its near
 * parts within `reach.near` of the camera, its far parts out to `reach.far`,
 * and nothing beyond; three.js frustum-culls each chunk on its own. Restyled
 * from the reference's `addChunked` / `updateChunks`.
 */
import * as THREE from "../../three.js";

/** Metres per chunk edge. */
export const CHUNK_SIZE = 300;
/** Numbers per planted item: x, y, z, yaw, scale. */
export const STRIDE = 5;

/**
 * @typedef {object} PlantChunk
 * @property {string} id plant id
 * @property {number} count items in the chunk
 * @property {import("../../three.js").Group} near
 * @property {import("../../three.js").Group} far
 * @property {number} x0 @property {number} z0 @property {number} x1 @property {number} z1 extent of the items
 */

/** Writes item `i` of `data` as the column-major matrix of instance `n`. */
function setInstance(array, n, data, i) {
  const o = i * STRIDE;
  const s = data[o + 4];
  const c = Math.cos(data[o + 3]) * s;
  const sn = Math.sin(data[o + 3]) * s;
  array.set([c, 0, -sn, 0, 0, s, 0, 0, sn, 0, c, 0, data[o], data[o + 1], data[o + 2], 1], n * 16);
}

/**
 * Builds the chunks of a set of planted items.
 * @param {Record<string, Float32Array>} items per plant id, `STRIDE` numbers each
 * @param {object} options
 * @param {Record<string, {parts: Function}>} options.assets plants by id; ids without one are skipped
 * @param {string} options.season
 * @param {boolean} options.detail trims leaf cards (low graphics)
 * @param {boolean} options.leafShadows whether leaf cards cast shadows
 * @param {{near: number, far: number}} options.reach metres; `far` 0 draws no far parts
 * @param {object} options.uniforms shared shader uniforms
 * @param {<T>(resource: T) => T} options.own registers every resource made
 * @param {string} [options.name] name of the group
 */
export function createPlantChunks(items, { assets, season, detail, leafShadows, reach, uniforms, own, name = "plants" }) {
  const object = new THREE.Group();
  object.name = name;
  /** @type {PlantChunk[]} */
  const chunks = [];
  for (const [id, data] of Object.entries(items)) {
    const asset = assets[id];
    const total = Math.floor((data?.length ?? 0) / STRIDE);
    if (!asset || total === 0) continue;
    const parts = asset.parts({ season, detail, uniforms, own });
    const cells = new Map();
    for (let i = 0; i < total; i += 1) {
      const key = `${Math.floor(data[i * STRIDE] / CHUNK_SIZE)},${Math.floor(data[i * STRIDE + 2] / CHUNK_SIZE)}`;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }
    for (const list of cells.values()) {
      const chunk = { id, count: list.length, near: new THREE.Group(), far: new THREE.Group(), x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (const i of list) {
        chunk.x0 = Math.min(chunk.x0, data[i * STRIDE]);
        chunk.x1 = Math.max(chunk.x1, data[i * STRIDE]);
        chunk.z0 = Math.min(chunk.z0, data[i * STRIDE + 2]);
        chunk.z1 = Math.max(chunk.z1, data[i * STRIDE + 2]);
      }
      for (const lod of ["near", "far"]) {
        if (reach[lod] <= 0 && lod === "far") continue;
        chunk[lod].name = `${id}-${lod}`;
        for (const part of parts[lod]) {
          const mesh = own(new THREE.InstancedMesh(part.geometry, part.material, list.length));
          list.forEach((item, n) => setInstance(mesh.instanceMatrix.array, n, data, item));
          const card = Boolean(part.material.alphaTest);
          mesh.castShadow = lod === "near" && (card ? leafShadows : true);
          mesh.receiveShadow = true;
          if (part.depth) mesh.customDepthMaterial = part.depth;
          mesh.computeBoundingSphere();
          chunk[lod].add(mesh);
        }
        chunk[lod].visible = false;
        object.add(chunk[lod]);
      }
      chunks.push(chunk);
    }
  }
  return {
    object,
    chunks,
    /** Shows each chunk's near or far parts by its distance from the camera, allocating nothing. */
    update(frame) {
      const { x, z } = frame.camera.position;
      for (const chunk of chunks) {
        const dx = Math.max(chunk.x0 - x, 0, x - chunk.x1);
        const dz = Math.max(chunk.z0 - z, 0, z - chunk.z1);
        const d = Math.sqrt(dx * dx + dz * dz);
        chunk.near.visible = d < reach.near;
        chunk.far.visible = d >= reach.near && d < reach.far;
      }
    },
  };
}
