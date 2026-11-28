/**
 * The two goal posters on one canvas, side by side (slot 0 the left half, slot 1 the right), repainted per slot
 * when the text it shows changes.
 */
import { paintPoster } from "./paint.js";

export const GOAL_POSTER = Object.freeze({ width: 1024, height: 512 });

/** `makeCanvas(width, height)` gives the canvas; `paint(slot, text)` writes one poster and returns the canvas. */
export function createGoalSheet(makeCanvas) {
  const canvas = makeCanvas(GOAL_POSTER.width * 2, GOAL_POSTER.height);
  const ctx = canvas.getContext("2d");
  const shown = [null, null];
  return {
    canvas,
    paint(slot, text) {
      if (shown[slot] === text) return false;
      shown[slot] = text;
      ctx.save();
      ctx.translate(slot * GOAL_POSTER.width, 0);
      ctx.beginPath();
      ctx.rect(0, 0, GOAL_POSTER.width, GOAL_POSTER.height);
      ctx.clip();
      paintPoster(ctx, { type: "goal", text }, GOAL_POSTER);
      ctx.restore();
      return true;
    },
  };
}
