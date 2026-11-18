/**
 * Time-of-day lighting presets and the sun's shadow frustum.
 *
 * A preset sets the sun direction (pointing towards the sun), its colour,
 * the sky gradient, the ground bounce colour and how far the haze reaches.
 * `sunScatter` leans the haze to the sun's colour towards the sun; `saturation`
 * lifts the colour after tone mapping (1 = unchanged).
 */
import { lookAt, multiply, normalize, orthographic } from "./math.js";

export const TIME_PRESETS = Object.freeze({
  day: {
    label: "Day", // i18n-ok (English id label; the UI translates by mode)
    sun: normalize([0.55, 0.62, 0.32]),
    sunColor: [1.0, 0.92, 0.78],
    zenith: [0.28, 0.48, 0.86],
    horizon: [0.86, 0.84, 0.82],
    ground: [0.4, 0.38, 0.3],
    cloudTint: [1, 1, 1],
    fog: [260, 4200],
    sunScatter: 0.25,
    saturation: 1.1,
    shadowStrength: 0.62,
  },
  golden: {
    label: "Golden hour", // i18n-ok (English id label; the UI translates by mode)
    sun: normalize([0.8, 0.13, 0.3]),
    sunColor: [1.0, 0.66, 0.38],
    zenith: [0.38, 0.42, 0.7],
    horizon: [1.0, 0.74, 0.52],
    ground: [0.42, 0.33, 0.25],
    cloudTint: [1.0, 0.86, 0.72],
    fog: [220, 3600],
    sunScatter: 0.55,
    saturation: 1.15,
    shadowStrength: 0.68,
  },
  dusk: {
    label: "Dusk", // i18n-ok (English id label; the UI translates by mode)
    sun: normalize([-0.7, 0.16, 0.45]),
    sunColor: [1.0, 0.6, 0.42],
    zenith: [0.3, 0.33, 0.55],
    horizon: [0.9, 0.58, 0.5],
    ground: [0.4, 0.33, 0.36],
    cloudTint: [0.98, 0.72, 0.68],
    fog: [200, 3200],
    sunScatter: 0.45,
    saturation: 1.1,
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
 * A time preset with the biome's optional overrides for that time of day, and
 * the lens's haze applied to the fog. A biome only overrides what it needs:
 * the sun stays where the time of day put it, while the sky, bounce light,
 * tint and visibility can all change with the season.
 */
export function resolvedLight(preset, biome, haze = 1) {
  const merged = { ...preset, ...(biome?.light?.[preset.key] ?? {}) };
  return { ...merged, fog: merged.fog.map((f) => f * haze) };
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
