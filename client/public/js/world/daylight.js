/**
 * Time-of-day presets and the environment (sun, moon, sky, fog, exposure)
 * they make for a season. Pure: colours in, colours out.
 *
 * A preset's `sun` points towards the key light the adapter lights riders
 * and scenery with. At night that key is the moon; the real sun is below
 * the horizon (see `environmentAt`).
 */

const normalize = (v) => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
};

export const TIME_PRESETS = Object.freeze({
  day: {
    label: "Day", // i18n-ok (English id label; the UI translates by mode)
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
    label: "Golden hour", // i18n-ok (English id label; the UI translates by mode)
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
    label: "Dusk", // i18n-ok (English id label; the UI translates by mode)
    sun: normalize([-0.7, 0.16, 0.45]),
    sunColor: [1.0, 0.6, 0.42],
    zenith: [0.3, 0.33, 0.55],
    horizon: [0.9, 0.58, 0.5],
    ground: [0.4, 0.33, 0.36],
    cloudTint: [0.98, 0.72, 0.68],
    fog: [200, 3200],
    shadowStrength: 0.5,
  },
  night: {
    label: "Night", // i18n-ok (English id label; the UI translates by mode)
    // The key light is the moon, high in the south-west.
    sun: normalize([-0.4, 0.7, 0.35]),
    sunColor: [0.32, 0.4, 0.62],
    zenith: [0.02, 0.04, 0.12],
    horizon: [0.07, 0.1, 0.2],
    ground: [0.05, 0.07, 0.13],
    cloudTint: [0.18, 0.22, 0.34],
    fog: [120, 2400],
    shadowStrength: 0.3,
  },
});

export const TIME_MODES = Object.freeze(["auto", "day", "golden", "dusk", "night"]);

/** Picks a preset for a local hour (0–24) when the mode is "auto". */
export function presetForHour(hour) {
  if (hour >= 6.5 && hour < 8.5) return "golden";
  if (hour >= 8.5 && hour < 17.5) return "day";
  if (hour >= 17.5 && hour < 19.5) return "golden";
  if (hour >= 19.5 && hour < 21) return "dusk";
  return "night";
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

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (rgb) => Object.freeze(rgb.map(toLinear));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** The reference's exposure for each look: night is lifted, day is not. */
const EXPOSURE = Object.freeze({ day: 1.05, golden: 1.05, dusk: 1.1, night: 1.5 });

/**
 * @typedef {object} Environment
 * @property {string} key time-of-day preset key
 * @property {number[]} sun unit vector towards the sun, y up
 * @property {number[]} moon unit vector towards the moon, y up
 * @property {number} night 0 by day, 1 at night
 * @property {number[]} sunColor linear RGB
 * @property {number[]} skyTop linear RGB
 * @property {number[]} skyHorizon linear RGB
 * @property {number[]} skyBottom linear RGB
 * @property {number[]} hemiSky linear RGB
 * @property {number[]} hemiGround linear RGB
 * @property {number[]} fogColor linear RGB
 * @property {number} sunIntensity
 * @property {number} hemiIntensity
 * @property {number} fogDensity
 * @property {number} exposure
 * @property {number} stars 0..1
 * @property {number} snow 0..1
 */

/**
 * The environment for a resolved preset in a season, in linear colours.
 * @param {{key: string, sun: number[], sunColor: number[], zenith: number[], horizon: number[], ground: number[], fog: number[]}} preset
 * @param {string} season
 * @param {{haze?: number}} [options] `haze` above 1 thickens the air
 * @returns {Readonly<Environment>}
 */
export function environmentAt(preset, season, { haze = 1 } = {}) {
  const night = preset.key === "night" ? 1 : 0;
  const key = preset.sun;
  // At night `key` is the moon; the sun sits opposite, below the horizon.
  const sun = night ? [-key[0], -key[1], -key[2]] : [...key];
  const moon = night ? [...key] : [-key[0], -key[1], -key[2]];
  const horizon = linear(preset.horizon);
  const far = preset.fog[1];
  // Exponential-squared fog: density that reaches ~2% at the far distance.
  const fogDensity = Math.sqrt(-Math.log(0.02)) / ((far * haze));
  return Object.freeze({
    key: preset.key,
    sun: Object.freeze(sun),
    moon: Object.freeze(moon),
    night,
    sunColor: linear(preset.sunColor),
    skyTop: linear(preset.zenith),
    skyHorizon: horizon,
    skyBottom: Object.freeze(mix(horizon, linear(preset.ground), 0.6)),
    hemiSky: linear(preset.zenith),
    hemiGround: linear(preset.ground),
    fogColor: horizon,
    sunIntensity: night ? 0.9 : 2.6,
    hemiIntensity: night ? 0.55 : 0.7,
    fogDensity,
    exposure: EXPOSURE[preset.key] ?? 1.05,
    stars: night,
    snow: season === "winter" ? 1 : 0,
  });
}
