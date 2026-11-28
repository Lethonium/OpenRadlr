/**
 * Draws a baked sprite with its anchor (the asset's origin) at x, y, scaled from the sprite's baked
 * pixels per metre to the view's. `flip` mirrors it about the anchor; `frame` wraps round the frames.
 */

/**
 * @param {object} ctx a 2D context
 * @param {{frames: {width: number, height: number}[], ox: number, oy: number, ppm: number}} sprite
 * @param {number} x
 * @param {number} y
 * @param {number} pxPerM view pixels per metre
 * @param {{frame?: number, flip?: boolean, alpha?: number}} [options]
 */
export function drawSprite(ctx, sprite, x, y, pxPerM, { frame = 0, flip = false, alpha = 1 } = {}) {
  const image = sprite.frames[((Math.floor(frame) % sprite.frames.length) + sprite.frames.length) % sprite.frames.length];
  const k = pxPerM / sprite.ppm;
  const faded = alpha !== 1;
  if (faded || flip) ctx.save();
  if (faded) ctx.globalAlpha = alpha;
  if (flip) {
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, -sprite.ox * k, -sprite.oy * k, image.width * k, image.height * k);
  } else {
    ctx.drawImage(image, x - sprite.ox * k, y - sprite.oy * k, image.width * k, image.height * k);
  }
  if (faded || flip) ctx.restore();
}
