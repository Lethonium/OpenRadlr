/**
 * The small vector helpers the pure world code needs. The same functions live
 * in view3d/math.js beside the matrix code the renderer needs; world/ may not
 * import from view3d/, so they are kept here as well.
 */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** Unit vector, or [0, 0, 0] for a zero vector. */
export function normalize(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 0 ? scale(a, 1 / len) : [0, 0, 0];
}

/** One number for a pair of cell indices (|i|, |j| below 32768). */
export const cellKey = (i, j) => (i + 0x8000) * 0x10000 + (j + 0x8000);
