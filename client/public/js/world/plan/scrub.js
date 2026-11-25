/**
 * The scrub on the hills and the tufts on the dunes: clumps of plants inside
 * their parcels. Pure and seeded per parcel; the height comes from the
 * parcel's corners (see `parcelHeight`), so the worker and a test agree.
 */
import { seededRandom } from "../noise.js";
import { parcelHeight } from "./rows.js";

/** Square metres per plant, the plants per clump, the clump's radius, the plant sizes and the id shares, by parcel kind. */
export const SCRUB = Object.freeze({
  scrub: Object.freeze({ area: 60, clump: Object.freeze([2, 5]), radius: 4, size: Object.freeze([0.7, 1.3]), mix: Object.freeze([["bush", 0.6], ["lavender", 0.2], ["rock", 0.2]]) }),
  // No grass-clump asset exists: small bushes stand in for the dune grass.
  dune: Object.freeze({ area: 200, clump: Object.freeze([2, 5]), radius: 3, size: Object.freeze([0.4, 0.8]), mix: Object.freeze([["bush", 1]]) }),
});

/** The mix id for a roll in [0, 1). */
const pick = (mix, u) => {
  let sum = 0;
  for (const [id, share] of mix) {
    sum += share;
    if (u < sum) return id;
  }
  return mix[mix.length - 1][0];
};

/**
 * @param {Array<{kind: string, x: number, z: number, width: number, depth: number, yaw: number, corners: Float32Array}>} parcels
 * @param {{seed: number}} options
 * @returns {Record<string, Float32Array>} per plant id: x, y, z, yaw, scale per plant
 */
export function scrubPlants(parcels, { seed }) {
  const lists = {};
  parcels.forEach((parcel, index) => {
    const style = SCRUB[parcel.kind];
    if (!style) return;
    const random = seededRandom((seed * 2654435761 + index * 40503 + Math.floor(parcel.x * 7 + parcel.z * 13)) | 0);
    const { x, z, width, depth, yaw } = parcel;
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const mean = (style.clump[0] + style.clump[1]) / 2;
    const expected = (width * depth) / style.area / mean;
    const clumps = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
    for (let k = 0; k < clumps; k += 1) {
      const [cu, cv] = [(random() - 0.5) * width, (random() - 0.5) * depth];
      const members = style.clump[0] + Math.floor(random() * (style.clump[1] - style.clump[0] + 1));
      for (let m = 0; m < members; m += 1) {
        const [angle, reach] = [random() * Math.PI * 2, Math.sqrt(random()) * style.radius];
        const [u, v] = [cu + Math.cos(angle) * reach, cv + Math.sin(angle) * reach];
        const [id, turn, size] = [pick(style.mix, random()), random() * Math.PI * 2, style.size[0] + random() * (style.size[1] - style.size[0])];
        if (Math.abs(u) > width / 2 || Math.abs(v) > depth / 2) continue;
        (lists[id] ??= []).push(x + u * c - v * s, parcelHeight(parcel, u, v), z + u * s + v * c, turn, size);
      }
    }
  });
  return Object.fromEntries(Object.keys(lists).sort().map((id) => [id, Float32Array.from(lists[id])]));
}
