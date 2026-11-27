/**
 * Where the puffy clouds float: a seeded scatter of low-poly puff clusters high above the island, shaped by the
 * biome's sky (`sky.clouds`: how many, how wide they spread, how high, how puffy). Plain data for the worker to
 * hand over; the view builds the geometry from it.
 */
import { seededRandom } from "./noise.js";

/** Salt that keeps the cloud scatter apart from the other things seeded by the map. */
const SALT = 0xc10d;

/**
 * @typedef {object} Puff one ellipsoid of a cloud
 * @property {number[]} at its centre, world metres
 * @property {number[]} radii half extents along x, y and z before the turn
 * @property {number} turn radians about the vertical
 *
 * @typedef {object} CloudPlan
 * @property {number[]} color base colour, RGBA 0..1 (the view tints it by the time of day)
 * @property {number[]} segments rings and segments of each puff's sphere
 * @property {{puffs: Puff[]}[]} shapes
 */

/**
 * @param {{seed: number, center: number[], meanElevation: number, style: object, count?: number, spread?: number}} options
 *   `center` the map's [x, z]; `meanElevation` the road's mean height, which the altitude is above; `style` the biome's `sky.clouds`
 * @returns {CloudPlan}
 */
export function planClouds({ seed, center, meanElevation, style, count, spread }) {
  const random = seededRandom((seed ^ SALT) >>> 0);
  const [cx, cz] = center;
  const total = count ?? style.count;
  const span = spread ?? style.spread;
  const shapes = [];
  for (let i = 0; i < total; i += 1) {
    const x = cx + (random() - 0.5) * 2 * span;
    const z = cz + (random() - 0.5) * 2 * span;
    const y = meanElevation + style.altitude[0] + random() * style.altitude[1];
    const count = style.puffs[0] + Math.floor(random() * style.puffs[1]);
    const size = style.radius[0] + random() * style.radius[1];
    const puffs = [];
    for (let p = 0; p < count; p += 1) {
      const at = [x + (random() - 0.5) * size * style.offset[0], y + random() * size * style.offset[1], z + (random() - 0.5) * size * style.offset[2]];
      const r = size * (style.puffRadius[0] + random() * style.puffRadius[1]);
      puffs.push({ at, radii: [r, r * style.squash[0], r * style.squash[1]], turn: random() * Math.PI });
    }
    shapes.push({ puffs });
  }
  return { color: [...style.color], segments: [...style.segments], shapes };
}
