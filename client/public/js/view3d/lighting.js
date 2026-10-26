/**
 * Time-of-day lighting presets and the sun's shadow frustum.
 *
 * A preset sets the sun direction (pointing towards the sun), its colour,
 * the sky gradient, the ground bounce colour and how far the haze reaches.
 */
import { lookAt, multiply, normalize, orthographic } from "./math.js";

export const TIME_PRESETS = Object.freeze({
  day: {
    label: "Day",
    sun: normalize([0.55, 0.62, 0.32]),
    sunColor: [1.0, 0.94, 0.82],
    zenith: [0.3, 0.52, 0.84],
    horizon: [0.76, 0.85, 0.93],
    ground: [0.4, 0.38, 0.3],
    cloudTint: [1, 1, 1],
    fog: [260, 4200],
    shadowStrength: 0.62,
  },
  golden: {
    label: "Golden hour",
    sun: normalize([0.8, 0.2, 0.3]),
    sunColor: [1.0, 0.72, 0.45],
    zenith: [0.33, 0.45, 0.72],
    horizon: [0.98, 0.79, 0.6],
    ground: [0.42, 0.33, 0.25],
    cloudTint: [1.0, 0.86, 0.72],
    fog: [220, 3600],
    shadowStrength: 0.68,
  },
  dusk: {
    label: "Dusk",
    sun: normalize([-0.7, 0.16, 0.45]),
    sunColor: [1.0, 0.6, 0.42],
    zenith: [0.3, 0.33, 0.55],
    horizon: [0.9, 0.58, 0.5],
    ground: [0.4, 0.33, 0.36],
    cloudTint: [0.98, 0.72, 0.68],
    fog: [200, 3200],
    shadowStrength: 0.5,
  },
});

export const TIME_MODES = Object.freeze(["auto", "day", "golden", "dusk"]);

/** Picks a preset for a local hour (0–24) when the mode is "auto". */
export function presetForHour(hour) {
  if (hour >= 6.5 && hour < 8.5) return "golden";
  if (hour >= 8.5 && hour < 17.5) return "day";
  if (hour >= 17.5 && hour < 19.5) return "golden";
  return "dusk";
}

export function resolvePreset(mode, date = new Date()) {
  const key = mode === "auto" ? presetForHour(date.getHours() + date.getMinutes() / 60) : mode;
  return { key, ...(TIME_PRESETS[key] ?? TIME_PRESETS.day) };
}

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
