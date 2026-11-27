/**
 * The My boards page's crop frame: pure moves of a crop in the model profile/myBoards.js
 * cuts with (`{x, y, scale}`: x and y in 0..1 across the room the window has left over, scale 1..8).
 * The source rectangle itself is `cropWindow` there, so the preview and the stored picture agree.
 */

import { cropWindow } from "../profile/myBoards.js";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** A crop that just covers the frame, centred. */
export function initialCrop() {
  return { x: 0.5, y: 0.5, scale: MIN_SCALE };
}

/** Where the window's position `v` lands after moving it by `delta` source pixels, with `room` pixels to move in. */
function shifted(v, delta, room) {
  return room > 0 ? clamp(v + delta / room, 0, 1) : v;
}

/**
 * The crop after dragging the picture by `dx`, `dy` pixels of a frame `frameW` wide:
 * the picture follows the pointer, so the window moves the other way. Stays inside the picture.
 * @param {{x: number, y: number, scale: number}} crop
 * @param {{imageW: number, imageH: number, frameW: number}} size
 */
export function dragCrop(crop, dx, dy, { imageW, imageH, frameW }) {
  const { sw, sh } = cropWindow(imageW, imageH, crop);
  const perPixel = sw / frameW;
  return { ...crop, x: shifted(crop.x, -dx * perPixel, imageW - sw), y: shifted(crop.y, -dy * perPixel, imageH - sh) };
}

/**
 * The crop at zoom `scale` (1..8) around the window's centre.
 * @param {{x: number, y: number, scale: number}} crop
 * @param {number} scale
 * @param {{imageW: number, imageH: number}} size
 */
export function zoomCrop(crop, scale, { imageW, imageH }) {
  const before = cropWindow(imageW, imageH, crop);
  const next = clamp(scale, MIN_SCALE, MAX_SCALE);
  const after = cropWindow(imageW, imageH, { ...crop, scale: next });
  const place = (centre, size, whole) => (whole > size ? clamp((centre - size / 2) / (whole - size), 0, 1) : 0.5);
  return {
    x: place(before.sx + before.sw / 2, after.sw, imageW),
    y: place(before.sy + before.sh / 2, after.sh, imageH),
    scale: next,
  };
}
