/**
 * Where individual crop plants stand on a field: a band along the field's
 * edges (so the crop's silhouette is plants, not a rectangle) and, close to
 * the camera, the interior. Plants stand in the painted rows (rows run along
 * the field's width axis), pulled in from the border and jittered. Pure and
 * seeded by the field's own position, so a field always gets the same plants.
 */
import { seededRandom } from "../noise.js";

/**
 * Crops that grow stalks. `row` metres between rows, `along` between plants
 * in a row (both at spacing 1), `height` the range of the plants' scale.
 */
export const STALK_CROPS = Object.freeze({
  wheat: Object.freeze({ row: 0.44, along: 0.4, height: Object.freeze([0.85, 1.25]) }),
  rapeseed: Object.freeze({ row: 0.45, along: 0.45, height: Object.freeze([0.8, 1.2]) }),
  sunflower: Object.freeze({ row: 0.7, along: 0.55, height: Object.freeze([0.8, 1.2]) }),
  corn: Object.freeze({ row: 0.75, along: 0.5, height: Object.freeze([0.85, 1.2]) }),
  stubble: Object.freeze({ row: 0.5, along: 0.5, height: Object.freeze([0.6, 1.3]) }),
  lavender: Object.freeze({ row: 0.9, along: 0.6, height: Object.freeze([0.85, 1.3]) }),
});

/** Metres kept between a plant and the field's border, and the most plants one field gets in each set. */
const INSET = 0.2;
const MOST_EDGE = 9000;
const MOST_INTERIOR = 22000;
/** Plants at the border are almost all kept; deeper in the band the stand thins into the painted canopy. */
const BORDER_KEEP = 0.95;
const INNER_KEEP = 0.6;

/** Floats per planted stalk: x, z (world), yaw, scale. */
export const STALK_STRIDE = 4;

/**
 * @typedef {object} StalkParams
 * @property {number} edgeBand metres of plants along every edge
 * @property {number} spacing 1 = the crop's natural spacing, larger is sparser
 * @property {{spacing: number} | null} [interior] also plant the interior at this spacing
 */

/** A deterministic seed for a field. */
const seedOf = ({ x, z }) => (Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663)) >>> 0;

/** The plants of one set, as a typed array of `STALK_STRIDE` floats each. */
function scatter(field, spec, { step, rowStep, keep, random, most }) {
  const { x, z, width: w, depth: d, yaw } = field;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out = [];
  const [lo, hi] = spec.height;
  for (let lz = -d / 2 + INSET; lz <= d / 2 - INSET && out.length < most * STALK_STRIDE; lz += rowStep) {
    for (let lx = -w / 2 + INSET; lx <= w / 2 - INSET; lx += step) {
      const jx = Math.min(w / 2 - INSET, Math.max(-w / 2 + INSET, lx + (random() - 0.5) * step * 0.7));
      const jz = Math.min(d / 2 - INSET, Math.max(-d / 2 + INSET, lz + (random() - 0.5) * rowStep * 0.3));
      const edge = Math.min(w / 2 + jx, w / 2 - jx, d / 2 + jz, d / 2 - jz);
      const [wanted, tall] = [keep(edge), random()];
      if (random() >= wanted) continue;
      // the border plants vary most in height: a ragged top line instead of a ruled one
      const ragged = edge < 1.5 ? 0.12 : 0;
      const scale = lo + (hi - lo) * tall + (random() - 0.5) * ragged * 2;
      out.push(x + jx * c - jz * s, z + jx * s + jz * c, random() * Math.PI * 2, scale);
    }
  }
  return Float32Array.from(out);
}

/**
 * The stalks of a field.
 * @param {import("./fields.js").Field} field
 * @param {StalkParams} params
 * @returns {{edge: Float32Array, interior: Float32Array}} world x, z, yaw, scale; none for crops without stalks
 */
export function planStalks(field, { edgeBand, spacing, interior = null }) {
  const spec = STALK_CROPS[field.crop];
  const none = new Float32Array(0);
  if (!spec || edgeBand <= 0) return { edge: none, interior: none };
  const random = seededRandom(seedOf(field));
  const edge = scatter(field, spec, {
    step: spec.along * spacing,
    rowStep: spec.row * spacing,
    keep: (e) => (e >= edgeBand ? 0 : BORDER_KEEP + (INNER_KEEP - BORDER_KEEP) * Math.min(1, e / edgeBand)),
    random,
    most: MOST_EDGE,
  });
  const inner = interior
    ? scatter(field, spec, { step: spec.along * interior.spacing, rowStep: spec.row * interior.spacing, keep: (e) => (e >= edgeBand ? 1 : 0), random, most: MOST_INTERIOR })
    : none;
  return { edge, interior: inner };
}
