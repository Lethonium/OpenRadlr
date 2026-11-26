/**
 * How the 2D views look in one frame: sky, the light over the ground and what falls from it.
 * Built from the 3D world's own presets (`world/daylight.js`, `world/weather.js`, `world/seasons.js`),
 * so a season, a time of day or the weather changes both worlds together. Pure; the clock is `date`.
 */
import { environmentAt, resolvePreset } from "../world/daylight.js";
import { SEASON_LOOK, resolveSeason } from "../world/seasons.js";
import { precipitationAt } from "../world/weather.js";

/** Linear to sRGB, 0–1. */
export const toSrgb = (v) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2);
/** An sRGB 0–1 colour as a css `rgba()`. */
export const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** What the time of day multiplies over the lit scene (sRGB): day leaves it, night turns it deep blue. */
const LIGHT = Object.freeze({ day: [1, 1, 1], golden: [1, 0.86, 0.7], dusk: [0.72, 0.6, 0.68], night: [0.3, 0.36, 0.62] });
/** The cool grey that cloud pulls the light towards, and how far a full overcast does by day. */
const OVERCAST_LIGHT = [0.78, 0.8, 0.84];
const OVERCAST_PULL = 0.6;
/** Opacity of the shadows by day, and at night. */
const SHADOW_DAY = 0.28;
const SHADOW_NIGHT = 0.12;

/**
 * @param {{season?: string, timeMode?: string, date?: Date, weather?: {kind: string, strength: number, phase?: number}, precipitation?: number}} input
 *   `season` and `timeMode` may be "auto" (resolved from `date`); `precipitation` (0..1) defaults to what the weather gives
 * @returns {{season: string, time: string, night: boolean, lights: number, sky: {top: number[], horizon: number[]}, tint: string|null, sun: number[], shadow: number, raining: boolean, snowing: boolean, overcast: number, precipitation: number, ground: object}}
 */
export function look2d({ season = "summer", timeMode = "day", date = new Date(0), weather = { kind: "clear", strength: 0 }, precipitation } = {}) {
  const resolved = resolveSeason(season, date);
  const preset = resolvePreset(timeMode, date);
  const falling = Math.min(1, Math.max(0, precipitation ?? precipitationAt(weather, date.getTime() / 1000)));
  const env = environmentAt(preset, resolved, { weather, precipitation: falling });
  const night = preset.key === "night";
  const base = LIGHT[preset.key] ?? LIGHT.day;
  const light = mix(base, OVERCAST_LIGHT, env.overcast * (night ? 0 : OVERCAST_PULL));
  const tinted = light.some((v) => v < 0.999);
  return {
    season: resolved,
    time: preset.key,
    night,
    lights: night ? 1 : preset.key === "dusk" ? 0.5 : 0,
    sky: { top: env.skyTop.map(toSrgb), horizon: env.skyHorizon.map(toSrgb) },
    tint: tinted ? css(light) : null,
    sun: [...preset.sun],
    shadow: night ? SHADOW_NIGHT : SHADOW_DAY * (1 - env.overcast),
    raining: weather.kind !== "snow" && falling > 0,
    snowing: weather.kind === "snow" && falling > 0,
    overcast: env.overcast,
    precipitation: falling,
    ground: SEASON_LOOK[resolved],
  };
}
