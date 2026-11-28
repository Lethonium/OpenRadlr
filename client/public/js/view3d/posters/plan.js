/**
 * The poster atlas for one world's boards: chooses the posters and paints them. `uploads` are the rider's own boards
 * as `{id, text, image}` (image already decoded, or null for text only); a ride view passes them, the menu does not.
 */
import { choosePosters } from "./choose.js";
import { paintAtlas } from "./paint.js";

/**
 * @param {{kind: string, distance: number}[]} boards `world.boards`
 * @param {{routeId: string | null, uploads: {id: string}[], dateKey: string, atlas: number, makeCanvas: Function}} options `atlas` is the quality's atlas edge in texels
 * @returns {{atlas: object, slotOf: number[], slotCount: number}} for `View3D.setBoardPosters`
 */
export function boardPosterPlan(boards, { routeId, uploads, dateKey, atlas, makeCanvas }) {
  const { slots, slotOf } = choosePosters(boards, { routeId, uploads, dateKey });
  const uploadsById = new Map(uploads.map((upload) => [upload.id, upload]));
  const canvas = paintAtlas(makeCanvas, slots, { slotWidth: atlas / 2, slotHeight: atlas / 4, uploadsById });
  return { atlas: canvas, slotOf, slotCount: slots.length };
}

/**
 * The ride view's atlas, with the rider's own boards: `uploads` are the stored `{id, text, blob}`, and only the ones
 * chosen for a board are decoded (`decode(blob)` gives an image with `close()`), then closed once painted. With
 * `previous` (an earlier result) holding the same posters at the same atlas size and language, that one is returned
 * as it is: nothing is decoded or painted again.
 * @returns {Promise<{key: string, atlas: object, slotOf: number[], slotCount: number}>}
 */
export async function ridePosterPlan(boards, { routeId, uploads, dateKey, atlas, makeCanvas, decode, lang, previous = null }) {
  const { slots, slotOf } = choosePosters(boards, { routeId, uploads, dateKey });
  const key = JSON.stringify([atlas, lang, slotOf, slots.map((slot) => `${slot.type}:${slot.id}`)]);
  if (previous?.key === key) return previous;
  const chosen = new Set(slots.filter((slot) => slot.type === "upload").map((slot) => slot.id));
  const decoded = await Promise.all(
    uploads.filter((upload) => chosen.has(upload.id)).map(async ({ id, text, blob }) => ({ id, text, image: blob ? await decode(blob).catch(() => null) : null })),
  );
  try {
    const canvas = paintAtlas(makeCanvas, slots, { slotWidth: atlas / 2, slotHeight: atlas / 4, uploadsById: new Map(decoded.map((upload) => [upload.id, upload])) });
    return { key, atlas: canvas, slotOf, slotCount: slots.length };
  } finally {
    for (const { image } of decoded) image?.close?.();
  }
}
