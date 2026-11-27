/**
 * The plants of the orchards and vineyards, in rows. Pure: a parcel in, the
 * plants out as `x, y, z, yaw, scale` per plant (the `plantChunks` stride).
 * The height comes from the parcel's own corners, bilinear, so no terrain is
 * needed and the result is the same in the worker and in a test.
 */

/** Metres between the rows (across the parcel's depth) and between the plants along a row, by parcel kind. */
export const ROW_SPACING = Object.freeze({ orchard: Object.freeze({ row: 7, plant: 6 }), vineyard: Object.freeze({ row: 2.5, plant: 1.4 }) });
/** Metres left bare at the parcel's edge. */
export const ROW_MARGIN = 3;

/** The orchard trees of a region; vineyards grow vines. */
const ORCHARD_TREE = Object.freeze({ oliveTerraces: "olive", pineCoast: "olive", almondValley: "almond" });

/** The plant id of a parcel's rows, or null for a kind without rows. */
export function rowPlant({ kind, region }) {
  if (kind === "vineyard") return "vine";
  if (kind === "orchard") return ORCHARD_TREE[region] ?? "broadleaf";
  return null;
}

/** The ground height at `u, v` metres from the parcel's centre along its own axes, bilinear between the corners. */
export function parcelHeight({ width, depth, corners }, u, v) {
  const [a, b] = [u / width + 0.5, v / depth + 0.5];
  return (1 - a) * (1 - b) * corners[1] + a * (1 - b) * corners[4] + a * b * corners[7] + (1 - a) * b * corners[10];
}

/** Positions `count` rows centred on 0 across `length`, `step` apart; one at 0 if there is room for no more. */
function centred(length, step) {
  const count = Math.max(1, Math.floor(length / step) + 1);
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * step);
}

/**
 * The plants of one parcel: rows along its width every `spacing.row`, a plant every `spacing.plant`
 * along each, `ROW_MARGIN` in from the edges.
 * @param {{kind: string, x: number, z: number, width: number, depth: number, yaw: number, corners: Float32Array}} parcel
 * @param {{spacing?: {row: number, plant: number}}} [options]
 * @returns {Float32Array} x, y, z, yaw, scale per plant
 */
export function parcelRows(parcel, { spacing = ROW_SPACING[parcel.kind] } = {}) {
  if (!spacing) return new Float32Array(0);
  const { x, z, width, depth, yaw } = parcel;
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const us = centred(Math.max(0, width - 2 * ROW_MARGIN), spacing.plant);
  const vs = centred(Math.max(0, depth - 2 * ROW_MARGIN), spacing.row);
  const out = new Float32Array(us.length * vs.length * 5);
  let n = 0;
  for (const v of vs) {
    for (const u of us) {
      const hash = Math.sin((x + u * c - v * s) * 12.9898 + (z + u * s + v * c) * 78.233) * 43758.5453;
      const unit = hash - Math.floor(hash);
      out.set([x + u * c - v * s, parcelHeight(parcel, u, v), z + u * s + v * c, spacing.row > 3 ? unit * Math.PI * 2 : yaw, 0.9 + unit * 0.2], n * 5);
      n += 1;
    }
  }
  return out;
}

/**
 * Every parcel's rows, joined per plant id.
 * @param {Array<{kind: string, region?: string}>} parcels
 * @returns {Record<string, Float32Array>}
 */
export function planLandRows(parcels) {
  const lists = {};
  for (const parcel of parcels) {
    const id = rowPlant(parcel);
    if (id) (lists[id] ??= []).push(parcelRows(parcel));
  }
  return Object.fromEntries(
    Object.keys(lists).sort().map((id) => {
      const joined = new Float32Array(lists[id].reduce((sum, a) => sum + a.length, 0));
      let at = 0;
      for (const a of lists[id]) {
        joined.set(a, at);
        at += a.length;
      }
      return [id, joined];
    }),
  );
}
