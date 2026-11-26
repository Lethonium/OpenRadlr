/**
 * The 3D ground as the 2D views read it: height, and the colour of a point as it looks lit by the sun.
 * Bilinear on the world worker's `ground.near` grid (linear colours, converted here), the land-use `ground.paint`
 * (6 m sRGB rgba) over it by its alpha, then hill shading from the normals. Outside the grid the nearest edge is used.
 * Pure.
 */
import { mix, toSrgb } from "./look2d.js";

const SHALLOW = [0.35, 0.68, 0.72];
const DEEP = [0.08, 0.3, 0.45];
const FOAM = [0.95, 0.95, 0.9];
/** Metres of depth at which the sea is fully deep. */
const DEEP_AT = 18;
/** Land this far above the sea already counts as its edge; the first metre below is foam. */
const EDGE = 0.3;
const FOAM_DEPTH = 0.8;
/** A touch of grain so flat land is not plastic. */
const GRAIN = 0.035;

/**
 * @param {{near: {x0: number, z0: number, cell: number, columns: number, rows: number, heights: Float32Array, normals: Float32Array, colors: Float32Array, water: number}, paint: {x0: number, z0: number, cell: number, columns: number, rows: number, rgba: Uint8ClampedArray}}} ground
 */
export function groundSampler(ground) {
  const { near, paint } = ground;
  const { x0, z0, cell, columns, rows } = near;
  const water = near.water;

  const bilinear = (array, stride, channel, x, z) => {
    const u = Math.max(0, Math.min(columns - 1.001, (x - x0) / cell));
    const v = Math.max(0, Math.min(rows - 1.001, (z - z0) / cell));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const at = (a, b) => array[(b * columns + a) * stride + channel];
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  };

  const height = (x, z) => bilinear(near.heights, 1, 0, x, z);

  const sea = (h) => {
    const colour = mix(SHALLOW, DEEP, Math.min(1, (water - h) / DEEP_AT));
    return h > water - FOAM_DEPTH ? mix(colour, FOAM, 0.5) : colour;
  };

  /** sRGB 0–1 of the ground at (x, z) lit from `sun` (a unit vector towards the light, y up); `grain` is the share of random brightness. */
  const color = (x, z, sun, grain = GRAIN) => {
    const h = height(x, z);
    if (h < water + EDGE) return sea(h);
    let r = toSrgb(bilinear(near.colors, 3, 0, x, z));
    let g = toSrgb(bilinear(near.colors, 3, 1, x, z));
    let b = toSrgb(bilinear(near.colors, 3, 2, x, z));
    const pi = Math.floor((x - paint.x0) / paint.cell);
    const pj = Math.floor((z - paint.z0) / paint.cell);
    if (pi >= 0 && pj >= 0 && pi < paint.columns && pj < paint.rows) {
      const k = (pj * paint.columns + pi) * 4;
      const a = paint.rgba[k + 3] / 255;
      if (a > 0) {
        r += (paint.rgba[k] / 255 - r) * a;
        g += (paint.rgba[k + 1] / 255 - g) * a;
        b += (paint.rgba[k + 2] / 255 - b) * a;
      }
    }
    const nx = bilinear(near.normals, 3, 0, x, z);
    const ny = bilinear(near.normals, 3, 1, x, z);
    const nz = bilinear(near.normals, 3, 2, x, z);
    // The 3D scene's z points the other way from the sun vector's.
    const lit = 0.72 + 0.5 * Math.max(0, nx * sun[0] + ny * sun[1] - nz * sun[2]) - 0.25 * (1 - ny);
    const noise = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    const k = lit * (1 + noise * grain);
    return [Math.min(1, r * k), Math.min(1, g * k), Math.min(1, b * k)];
  };

  return { height, color, water };
}
