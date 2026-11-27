/**
 * Crop fields: the arable parcels of the island's land use. Crops, stalks, farms and fauna take them as `Field`s.
 */

/** Metres from a road within which an arable parcel is drawn as a 3D field: all of them. */
export const FIELD_REACH = Infinity;

/**
 * @typedef {object} Field
 * @property {number} x centre
 * @property {number} z
 * @property {number} width along `yaw`
 * @property {number} depth across it
 * @property {number} yaw angle of the width axis: (cos yaw, sin yaw) in world x/z
 * @property {string} crop a plant id of the region's crops for the season
 * @property {Float32Array} corners x, y, z of the four corners (-w -d, +w -d, +w +d, -w +d), terrain heights
 */


/**
 * @param {import("./landUse.js").Parcel[]} parcels
 * @param {import("../roads.js").RoadIndex} roads
 * @param {{reach?: number}} [options] `reach` limits the fields to those this near a road (metres; default all)
 * @returns {Field[]}
 */
export function fieldsFromParcels(parcels, roads, { reach = FIELD_REACH } = {}) {
  const fields = [];
  for (const { kind, x, z, width, depth, yaw, crop, corners } of parcels) {
    if (kind !== "arable") continue;
    if (reach < Infinity) {
      const near = roads.nearest(x, z, Math.ceil(reach / roads.cell));
      if (!near || near.distance > reach) continue;
    }
    fields.push({ x, z, width, depth, yaw, crop, corners });
  }
  return fields;
}

export function cornersOf({ x, z, width, depth, yaw }, terrain) {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const corners = new Float32Array(12);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => {
    const px = x + (u * width * c) / 2 - (v * depth * s) / 2;
    const pz = z + (u * width * s) / 2 + (v * depth * c) / 2;
    corners.set([px, terrain.height(px, pz), pz], k * 3);
  });
  return corners;
}
