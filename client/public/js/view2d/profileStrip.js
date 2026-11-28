/**
 * The side view's route strip: the whole route's elevation profile along the bottom of the screen, the
 * stretch the view shows as a band, and the riders as dots (mine larger, ringed). Canvas 2D; deterministic.
 */
import { RIDER_AT } from "./sideCamera.js";

const PANEL = "rgba(10, 14, 20, 0.5)";
const PANEL_PAD_PX = 6;
const PANEL_RADIUS_PX = 10;
const INSET_PX = 6;
const BAND = "rgba(255, 255, 255, 0.18)";
const BAND_MIN_PX = 3;
const DOT_ME_PX = 6;
const DOT_PX = 3.5;
const DEFAULT_DOT = "#e8473f";

/**
 * @param {{length: number, elevationAt: (d: number) => number}} route
 * @returns {{points: number[], lo: number, hi: number, length: number}} elevations at `samples + 1` even steps
 */
export function profileStrip(route, { samples = 300 } = {}) {
  const points = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k <= samples; k += 1) {
    const e = route.elevationAt((k / samples) * route.length);
    points.push(e);
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  return { points, lo, hi, length: route.length };
}

/**
 * @param {object} ctx
 * @param {{points: number[], lo: number, hi: number, length: number}} strip
 * @param {{rect: {x: number, y: number, width: number, height: number}, me: {d: number}, riders?: {d: number, mine?: boolean, look?: {primary?: string}}[], viewM: number}} frame
 *   `viewM`: metres of road the main view shows, drawn as a band round `me`
 */
export function drawProfileStrip(ctx, strip, { rect, me, riders = [], viewM }) {
  const { points, lo, hi, length } = strip;
  const [left, top, w, h] = [rect.x, rect.y, rect.width, rect.height];
  const last = points.length - 1;
  const at = (d) => left + (Math.max(0, Math.min(length, d)) / length) * w;
  const elevation = (d) => {
    const u = Math.max(0, Math.min(1, d / length)) * last;
    const i = Math.min(last - 1, Math.floor(u));
    return points[i] + (points[i + 1] - points[i]) * (u - i);
  };
  const py = (e) => top + h - INSET_PX - ((e - lo) / (hi - lo || 1)) * (h - 2 * INSET_PX - 2);
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(left - PANEL_PAD_PX, top - PANEL_PAD_PX / 1.5, w + 2 * PANEL_PAD_PX, h + 2 * PANEL_PAD_PX / 1.5, PANEL_RADIUS_PX);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(left, top + h);
  points.forEach((e, k) => ctx.lineTo(left + (k / last) * w, py(e)));
  ctx.lineTo(left + w, top + h);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, top, 0, top + h);
  gradient.addColorStop(0, "rgba(255, 160, 80, 0.85)");
  gradient.addColorStop(1, "rgba(255, 160, 80, 0.15)");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.fillStyle = BAND;
  ctx.fillRect(at(me.d - viewM * RIDER_AT), top, Math.max(BAND_MIN_PX, (viewM / length) * w), h);
  for (const r of riders) {
    ctx.fillStyle = r.look?.primary ?? DEFAULT_DOT;
    ctx.beginPath();
    ctx.arc(at(r.d), py(elevation(r.d)), r.mine ? DOT_ME_PX : DOT_PX, 0, Math.PI * 2);
    ctx.fill();
    if (r.mine) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
