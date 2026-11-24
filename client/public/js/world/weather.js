/**
 * The island's weather: a pure rule from the season, the map's seed and the UTC
 * day (so every rider on the same map sees the same sky), plus when showers
 * fall within the day. Nothing here reads a clock.
 */

import { WEATHER_ODDS } from "./seasons.js";

export { WEATHER_ODDS };

/** @typedef {{kind: string, strength: number, phase?: number}} Weather `phase` (0..1) offsets where in its cycle a day of showers starts */

export const WEATHER_KINDS = Object.freeze(["clear", "showers", "rain", "storm", "snow"]);

/** Showers: one period, the share of it that is wet, and the ramp at each edge (seconds). */
const SHOWER_PERIOD = 1200;
const SHOWER_WET = 1 / 3;
const SHOWER_RAMP = 120;

/** FNV-1a over the text, then a finishing mix; returns a uint32. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const unit = (seed, day, salt) => hash(`${salt}|${seed}|${day}`) / 4294967296;

/**
 * The weather of a map on a UTC day.
 * @param {{season: string, seed: string|number, date: Date}} input
 * @returns {Weather}
 */
export function weatherFor({ season, seed, date }) {
  const day = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
  const odds = WEATHER_ODDS[season] ?? WEATHER_ODDS.summer;
  const roll = unit(seed, day, "kind");
  let kind = "clear";
  let edge = 0;
  for (const [candidate, chance] of Object.entries(odds)) {
    edge += chance;
    kind = candidate;
    if (roll < edge) break;
  }
  return { kind, strength: 0.5 + 0.5 * unit(seed, day, "strength"), phase: unit(seed, day, "phase") };
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * How hard it falls at a UTC time, 0..1.
 * @param {Weather} weather
 * @param {number} utcSeconds
 * @returns {number}
 */
export function precipitationAt(weather, utcSeconds) {
  const { kind, strength } = weather;
  if (kind === "rain" || kind === "snow" || kind === "storm") return strength;
  if (kind !== "showers") return 0;
  const phase = (weather.phase ?? 0) * SHOWER_PERIOD;
  const t = (((utcSeconds + phase) % SHOWER_PERIOD) + SHOWER_PERIOD) % SHOWER_PERIOD;
  const wet = SHOWER_PERIOD * SHOWER_WET;
  // Wet for `wet` seconds including a ramp up and a ramp down at its edges.
  if (t >= wet) return 0;
  const edge = Math.min(t, wet - t) / SHOWER_RAMP;
  return strength * smoothstep(Math.min(1, edge));
}

/**
 * The weather to show from the page address: `?weather=storm` previews without saving.
 * @param {string} search `location.search`
 * @param {Weather} fallback
 * @returns {Weather}
 */
export function weatherFromLocation(search, fallback) {
  const asked = new URLSearchParams(search).get("weather") ?? "";
  return WEATHER_KINDS.includes(asked) ? { kind: asked, strength: 1 } : fallback;
}
