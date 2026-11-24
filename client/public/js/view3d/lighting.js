/**
 * The sun's shadow frustum. Time-of-day presets live in `world/daylight.js`.
 */
import { lookAt, multiply, orthographic } from "./math.js";

/**
 * Light view-projection for the shadow map: an orthographic box of
 * ±`halfSize` metres around `focus`, looking along the sun. The focus is
 * snapped to whole shadow-map texels so shadows do not shimmer as you ride.
 */
export function sunShadowMatrix(sun, focus, { halfSize = 60, depth = 400, mapSize = 2048 } = {}) {
  const texel = (2 * halfSize) / mapSize;
  const snapped = focus.map((v) => Math.round(v / texel) * texel);
  const up = Math.abs(sun[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const eye = [snapped[0] + sun[0] * depth * 0.5, snapped[1] + sun[1] * depth * 0.5, snapped[2] + sun[2] * depth * 0.5];
  const view = lookAt(eye, snapped, up);
  return multiply(orthographic(-halfSize, halfSize, -halfSize, halfSize, 1, depth), view);
}
