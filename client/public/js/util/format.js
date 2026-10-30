/**
 * Display formatting helpers.
 *
 * Data, protocol and files are always metric (metres, m/s, kg); only what the
 * rider sees follows the units setting (#66). The current system is module
 * state, set once from the profile with `setUnits`.
 */

import { getLocale } from "../i18n/i18n.js";

export const UNIT_SYSTEMS = Object.freeze(["metric", "imperial"]);

const M_PER_MILE = 1609.344;
const M_PER_FOOT = 0.3048;
const LB_PER_KG = 2.2046226218;
/** Below this, imperial distances read in feet instead of miles. */
const SHORT_LIMIT_M = M_PER_MILE / 10;

let units = "metric";

/** Switches the display system; anything but "imperial" is metric. */
export function setUnits(system) {
  units = system === "imperial" ? "imperial" : "metric";
}

export const getUnits = () => units;

const imperial = () => units === "imperial";

/** Imperial for the US, Liberia and Myanmar, metric for everyone else. */
export function defaultUnits(locale) {
  const region = String(locale ?? "").split(/[-_]/)[1]?.toUpperCase();
  return ["US", "LR", "MM"].includes(region) ? "imperial" : "metric";
}

export const speedUnit = () => (imperial() ? "mph" : "km/h");
/** Metres in one distance unit (a kilometre or a mile). */
export const unitMetres = () => (imperial() ? M_PER_MILE : 1000);
export const distanceUnit = () => (imperial() ? "mi" : "km");
export const elevationUnit = () => (imperial() ? "ft" : "m");
export const weightUnit = () => (imperial() ? "lb" : "kg");

const numberFormats = new Map();

/** A number with `digits` decimals in the active language ("36.0" / "36,0"). Display only: never for inputs, protocol or files. */
export function formatNumber(value, digits) {
  const key = `${getLocale()}|${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** m/s → "36.0" (km/h or mph, see `speedUnit`). */
export const formatSpeed = (metresPerSecond) => formatNumber(metresPerSecond * (imperial() ? 3600 / M_PER_MILE : 3.6), 1);

/** Metres → "12.35" in km or miles (see `distanceUnit`). */
export const formatDistance = (metres, digits = 2) => formatNumber(metres / (imperial() ? M_PER_MILE : 1000), digits);

/** Metres → "12.35 km" / "7.67 mi". */
export const formatDistanceWithUnit = (metres, digits = 2) => `${formatDistance(metres, digits)} ${distanceUnit()}`;

/** Metres of height → "27 m" / "89 ft". */
export const formatElevation = (metres) => `${Math.round(metres / (imperial() ? M_PER_FOOT : 1))} ${elevationUnit()}`;

/** A distance ahead: "120 m", "2.4 km", or "400 ft", "1.3 mi". */
export function formatLength(metres) {
  if (imperial()) {
    return metres < SHORT_LIMIT_M ? `${Math.round(metres / M_PER_FOOT / 10) * 10} ft` : `${formatNumber(metres / M_PER_MILE, 1)} mi`;
  }
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${formatNumber(metres / 1000, 1)} km`;
}

/** Kilograms → the number shown in the weight field (one decimal). */
export const kgToDisplay = (kg) => Math.round(kg * (imperial() ? LB_PER_KG : 1) * 10) / 10;

/** The weight field's number → kilograms, to one decimal. */
export const displayToKg = (value) => Math.round((value / (imperial() ? LB_PER_KG : 1)) * 10) / 10;

export const formatGrade = (percent) => `${percent >= 0 ? "" : "−"}${formatNumber(Math.abs(percent), 1)}`;

/** Seconds → "m:ss" or "h:mm:ss". */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Signed gap in metres → "+12 m" / "−3 m", or "+40 ft" in imperial. */
export function formatGap(metres) {
  const rounded = Math.round(metres / (imperial() ? M_PER_FOOT : 1));
  if (rounded === 0) return `0 ${elevationUnit()}`;
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} ${elevationUnit()}`;
}

export const formatWkg = (watts, kg) => (kg > 0 ? formatNumber(watts / kg, 1) : "–");
