/**
 * The side view's land in perspective: slices of the real terrain at fixed distances to the far side of the
 * road, drawn as columns of ground. The far slices barely move, so they are one cached image remade after a few
 * pixels of scroll. The middle slices are cached per slice in 256 px chunks of that slice's own scroll, drawn at
 * heights from sea level so a climb moves a chunk but never remakes it. Both are dropped on a resize and when
 * the look changes. Deterministic.
 */
import { css, mix } from "./look2d.js";

export const FAR_LATERALS = Object.freeze([-5200, -3600, -2600, -1900, -1400]);
export const MIDDLE_LATERALS = Object.freeze([-1050, -800, -620, -480, -380, -300, -240, -190, -150, -118, -92, -72, -55, -40]);
export const CHUNK_PX = 256;
/** The far image is remade after the road has scrolled this many pixels. */
export const SCROLL_TOLERANCE_PX = 4;
/** Chunks kept (about the screen's worth of every slice, plus room to scroll). */
export const CHUNK_CACHE = MIDDLE_LATERALS.length * 8;
/** Metres each side of a column's centre line used to find the road's direction. */
const TANGENT_M = 1;
/** Column width in pixels (a slice that shrinks below this factor uses the wide one), and the pixel of overlap that hides seams. */
const STEP_PX = 6;
const WIDE_STEP_PX = 10;
const WIDE_BELOW_F = 0.1;
const OVERLAP_PX = 1;
/** The land fades to the sky's haze with distance: this much at the nearest slice, up to this much more at 4000 m. */
const HAZE_MIN = 0.12;
const HAZE_FAR = 0.75;
const HAZE_FULL_M = 4000;
/** After dark the ground loses colour before the blue tint (as the map's does) so it reads blue-grey. */
const NIGHT_DESATURATE = 0.7;
const NIGHT_BRIGHTEN = 1.5;

/** What the cached images depend on besides the camera size. */
const lookKey = (look) => `${look.season}|${look.time}|${look.night}|${look.sky.horizon.map((v) => v.toFixed(3))}|${look.sun.map((v) => v.toFixed(2))}`;

/**
 * @param {{route: object, sampler: {height: Function, color: Function, water: number}, createCanvas: (w: number, h: number) => object}} deps
 */
export function createSideBands({ route, sampler, createCanvas }) {
  let far = null; // {canvas, d, elev, key, width, height}
  const chunks = new Map(); // "lateral:k" -> {canvas, top}
  let chunkKey = "";

  /** The route position a distance maps to, or null where an open route has no road. */
  const inRoute = (d) => route.loop === false ? d >= 0 && d <= route.length : true;

  /** The ground `lateral` metres right of travel at `d`: its height above the sea (flat at the sea) and colour, haze included. */
  function column(d, lateral, look) {
    const at = route.wrap(d);
    const p = route.positionAt(at);
    const a = route.positionAt(Math.max(0, at - TANGENT_M));
    const b = route.positionAt(Math.min(route.length, at + TANGENT_M));
    const dx = b.x - a.x;
    const dz = -(b.y - a.y);
    const l = Math.hypot(dx, dz) || 1;
    const x = p.x + (-dz / l) * lateral;
    const z = -p.y + (dx / l) * lateral;
    let color = sampler.color(x, z, look.sun);
    if (look.night) {
      const grey = (color[0] + color[1] + color[2]) / 3;
      color = color.map((v) => Math.min(1, (v + (grey - v) * NIGHT_DESATURATE) * NIGHT_BRIGHTEN));
    }
    const haze = HAZE_MIN + Math.min(1, -lateral / HAZE_FULL_M) * HAZE_FAR;
    return { h: Math.max(sampler.height(x, z), sampler.water), color: css(mix(color, look.sky.horizon, haze)) };
  }

  /** Fills the quads between neighbouring columns `{x, y, color}` (null: no road there) down to `bottom`. */
  function paint(ctx, columns, bottom) {
    for (let i = 1; i < columns.length; i += 1) {
      const [a, b] = [columns[i - 1], columns[i]];
      if (!a || !b) continue;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(a.x - OVERLAP_PX, a.y);
      ctx.lineTo(b.x + OVERLAP_PX, b.y);
      ctx.lineTo(b.x + OVERLAP_PX, bottom);
      ctx.lineTo(a.x - OVERLAP_PX, bottom);
      ctx.closePath();
      ctx.fill();
    }
  }

  const stepOf = (f) => (f < WIDE_BELOW_F ? WIDE_STEP_PX : STEP_PX);

  function remakeFar(camera, look) {
    const canvas = createCanvas(camera.width, camera.height);
    canvas.width = camera.width;
    canvas.height = camera.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, camera.width, camera.height);
    for (const lateral of FAR_LATERALS) {
      const f = camera.f(lateral);
      const step = stepOf(f);
      const columns = [];
      for (let sx = -step; sx <= camera.width + step; sx += step) {
        const d = camera.meD + (sx - camera.riderX) / (camera.scale * f);
        if (!inRoute(d)) {
          columns.push(null);
          continue;
        }
        const c = column(d, lateral, look);
        columns.push({ x: sx, y: camera.y(c.h, lateral), color: c.color });
      }
      paint(ctx, columns, camera.height);
    }
    far = { canvas, d: camera.meD, elev: camera.elev, key: `${camera.width}x${camera.height}|${lookKey(look)}`, width: camera.width, height: camera.height };
  }

  /** Draws the five far slices, from one cached image. */
  function drawFar(ctx, camera, look) {
    const key = `${camera.width}x${camera.height}|${lookKey(look)}`;
    const scrolled = far ? Math.abs(route.signedGap(far.d, camera.meD)) * camera.scale : Infinity;
    const lifted = far ? Math.abs(camera.elev - far.elev) * Math.max(...FAR_LATERALS.map((l) => camera.rise(l))) : Infinity;
    if (!far || far.key !== key || scrolled > SCROLL_TOLERANCE_PX || lifted > SCROLL_TOLERANCE_PX) remakeFar(camera, look);
    ctx.drawImage(far.canvas, 0, 0);
  }

  function makeChunk(lateral, k, camera, look) {
    const f = camera.f(lateral);
    const ppm = camera.scale * f;
    const step = stepOf(f);
    const rise = camera.rise(lateral);
    // Heights from sea level: screen y is this chunk's y plus the rider's elevation times `rise`.
    const base = camera.plane(lateral);
    const columns = [];
    let top = camera.height;
    for (let j = Math.floor((k * CHUNK_PX - OVERLAP_PX) / step) - 1; j * step <= (k + 1) * CHUNK_PX + OVERLAP_PX + step; j += 1) {
      const u = j * step;
      const d = u / ppm;
      if (!inRoute(d)) {
        columns.push(null);
        continue;
      }
      const c = column(d, lateral, look);
      const y = base - c.h * rise;
      top = Math.min(top, y);
      columns.push({ x: u - k * CHUNK_PX, y, color: c.color });
    }
    top = Math.floor(top) - 2;
    const bottom = Math.ceil(camera.height);
    const canvas = createCanvas(CHUNK_PX + OVERLAP_PX, Math.max(1, bottom - top));
    canvas.width = CHUNK_PX + OVERLAP_PX;
    canvas.height = Math.max(1, bottom - top);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(0, -top);
    paint(ctx, columns, bottom);
    return { canvas, top };
  }

  /** Draws one middle slice (`lateral` one of MIDDLE_LATERALS) across the screen from its chunks. */
  function drawSlice(ctx, lateral, camera, look) {
    const key = `${camera.width}x${camera.height}|${lookKey(look)}`;
    if (key !== chunkKey) {
      chunks.clear();
      chunkKey = key;
    }
    const f = camera.f(lateral);
    const ppm = camera.scale * f;
    // The slice's own pixel at screen x is u = x - riderX + meD * ppm.
    const origin = camera.meD * ppm - camera.riderX;
    const [first, last] = [Math.floor((origin - OVERLAP_PX) / CHUNK_PX), Math.floor((origin + camera.width) / CHUNK_PX)];
    const lift = camera.elev * camera.rise(lateral);
    for (let k = first; k <= last; k += 1) {
      const id = `${lateral}:${k}`;
      let chunk = chunks.get(id);
      if (chunk) chunks.delete(id);
      else chunk = makeChunk(lateral, k, camera, look);
      chunks.set(id, chunk);
      ctx.drawImage(chunk.canvas, Math.round(k * CHUNK_PX - origin), Math.round(chunk.top + lift));
    }
    while (chunks.size > CHUNK_CACHE) chunks.delete(chunks.keys().next().value);
  }

  return {
    drawFar,
    drawSlice,
    /** The canvas changed size or pixel ratio: the images at the old scale go. */
    resize() {
      far = null;
      chunks.clear();
    },
  };
}
