/**
 * What the 2D views lay over the finished picture: the light of the time of day, lamps and windows glowing
 * after dark, and rain or snow. Canvas 2D only; deterministic (particles derive from `t` and their index).
 */
import { css } from "./look2d.js";

/** Multiplies the time of day's light over `rect` (`{x, y, width, height}`); nothing by clear day. */
export function drawTint(ctx, look, rect) {
  if (!look.tint) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = look.tint;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/**
 * Additive glows in the context's current transform; `rgb` is sRGB 0–1, `a` the peak opacity at full dark
 * (scaled by `look.lights`, so none by day).
 * @param {{x: number, y: number, r: number, rgb: number[], a: number}[]} glows
 */
export function drawGlows(ctx, look, glows) {
  if (look.lights <= 0 || glows.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const { x, y, r, rgb, a } of glows) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(rgb, a * look.lights));
    g.addColorStop(1, css(rgb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/**
 * Light beams after dark: each a wedge from (x, y) toward `angle` (radians, canvas convention), `spread` either side,
 * `length` long, brightest (`a`) at the lamp and fading to nothing at its end. Added over the scene like the glows
 * (scaled by `look.lights`, so none by day).
 * @param {{x: number, y: number, angle: number, length: number, spread: number, rgb: number[], a: number}[]} beams
 */
export function drawBeams(ctx, look, beams) {
  if (look.lights <= 0 || beams.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const { x, y, angle, length, spread, rgb, a } of beams) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, length);
    g.addColorStop(0, css(rgb, a * look.lights));
    g.addColorStop(1, css(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, length, angle - spread, angle + spread);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const RAIN_DROPS = 260;
const SNOW_FLAKES = 220;

/** Rain streaks or snow flakes over a `width` × `height` screen, fewer when it falls lightly; `t` in seconds. */
export function drawWeather(ctx, look, { width, height, t }) {
  const amount = look.precipitation ?? 1;
  if (look.raining) {
    const drops = Math.round(RAIN_DROPS * amount);
    ctx.strokeStyle = "rgba(200, 215, 235, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < drops; k += 1) {
      const x = ((k * 97.3 + t * 40) % (width + 40)) - 20;
      const y = ((k * 53.1 + t * 900) % (height + 40)) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 14);
    }
    ctx.stroke();
    // A faint cool sheen of wet ground.
    ctx.fillStyle = "rgba(120, 140, 170, 0.1)";
    ctx.fillRect(0, 0, width, height);
  }
  if (look.snowing) {
    const flakes = Math.round(SNOW_FLAKES * amount);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    for (let k = 0; k < flakes; k += 1) {
      const x = (k * 131.7 + Math.sin(t + k) * 20 + width) % width;
      const y = (k * 71.3 + t * 60 * (1 + (k % 3))) % height;
      ctx.beginPath();
      ctx.arc(x, y, 1 + (k % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
