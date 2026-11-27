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
