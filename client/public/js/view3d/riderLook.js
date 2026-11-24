/**
 * The look of a road rider, derived from the rider id alone, so every client
 * draws the same rider the same way. Pure: no Three.js, no DOM.
 */

import { seededRandom } from "../world/noise.js";

/**
 * @typedef {object} RiderLook
 * @property {number} height Standing height in metres.
 * @property {number} weight Body mass in kilograms.
 * @property {keyof typeof RIDER_SKINS} skin
 * @property {string} hair Hair colour, `#rrggbb`.
 * @property {typeof RIDER_KITS[number]} kit
 * @property {typeof RIDER_PATTERNS[number]} pattern
 * @property {string} primary Jersey base colour, `#rrggbb` (overridden by the colour code).
 * @property {string} secondary Jersey pattern colour, `#rrggbb`.
 * @property {string} accent Jersey trim colour, `#rrggbb`.
 * @property {string} shorts Shorts colour, `#rrggbb`.
 * @property {string} socks Sock colour, `#rrggbb`.
 * @property {string} shoes Shoe colour, `#rrggbb`.
 * @property {string} helmet Helmet colour, `#rrggbb`.
 * @property {boolean} glasses Whether the rider wears sunglasses.
 * @property {boolean} gloves Whether the rider wears gloves.
 * @property {string} gloveColor Glove colour, `#rrggbb`.
 * @property {typeof BIKE_TYPES_FOR_LOOKS[number]} bike
 * @property {string} frame Frame colour, `#rrggbb`.
 * @property {string} frameAccent Frame trim colour, `#rrggbb`.
 */

/** Skin tones, sRGB hex as the reference's `SKIN`. */
export const RIDER_SKINS = Object.freeze({
  light: "#f3d2b8",
  fair: "#eac3a0",
  tan: "#cf9f78",
  olive: "#b88660",
  brown: "#8d5a3c",
  dark: "#5e3b28",
});

/** Jersey patterns; `solid` is the plain colour. */
export const RIDER_PATTERNS = Object.freeze(["solid", "hoops", "band", "sash", "panels", "chevron", "dots", "fade"]);

/** Kit cuts: road jersey and bibs, long sleeves, skinsuit, casual top. */
export const RIDER_KITS = Object.freeze(["road", "long", "skinsuit", "casual"]);

/** Bike types a look may be given. */
export const BIKE_TYPES_FOR_LOOKS = Object.freeze(["road", "gravel", "city"]);

/** Share of each kit in the weighted draw, by cumulative weight. */
const KIT_WEIGHTS = Object.freeze([
  ["road", 0.72],
  ["skinsuit", 0.84],
  ["long", 0.92],
  ["casual", 1],
]);

/** Share of each bike type, by cumulative weight. */
const BIKE_WEIGHTS = Object.freeze([
  ["road", 0.75],
  ["gravel", 0.88],
  ["city", 1],
]);

const HEIGHT_MEAN = 1.76;
const HEIGHT_SPREAD = 0.07;
const HEIGHT_MIN = 1.5;
const HEIGHT_MAX = 2.05;
const WEIGHT_MIN = 45;
const WEIGHT_MAX = 120;
const BMI_MIN = 19;
const BMI_SPAN = 11;

const JERSEY_PAIRS = Object.freeze([
  ["#c8102e", "#ffffff", "#1d1d1b"],
  ["#0b3d91", "#f2c200", "#ffffff"],
  ["#1b7a3d", "#ffffff", "#0d2b18"],
  ["#f28c17", "#1d1d1b", "#ffffff"],
  ["#6a1b9a", "#ffd23f", "#ffffff"],
  ["#00a3c7", "#0b2545", "#ffffff"],
  ["#e8e8e8", "#c8102e", "#1d1d1b"],
  ["#222222", "#ff5a1f", "#ffffff"],
]);

const SHORTS = Object.freeze(["#15161a", "#1b2a41", "#222222", "#2b2d42", "#0f1b2d", "#ffffff"]);
const SOCKS = Object.freeze(["#ffffff", "#15161a", "#c8102e", "#0b3d91", "#f2c200"]);
const SHOES = Object.freeze(["#15161a", "#ffffff", "#c8102e", "#f2c200", "#8d8f94"]);
const HELMETS = Object.freeze(["#ffffff", "#15161a", "#c8102e", "#0b3d91", "#f2c200", "#e8e8e8"]);
const HAIRS = Object.freeze(["#1d1410", "#3b2a1f", "#6b4a2b", "#b8893d", "#d9b56b", "#8a8a8a", "#2a2a2a"]);
const FRAMES = Object.freeze(["#15161a", "#e8e8e8", "#c8102e", "#0b3d91", "#1b7a3d", "#f28c17", "#8d8f94"]);
const FRAME_ACCENTS = Object.freeze(["#ffffff", "#f2c200", "#15161a", "#c8102e"]);

const PATTERN_CHANCE_SOLID = 0.3;
const SHORTS_DARK_CHANCE = 0.8;
const GLASSES_CHANCE = 0.25;
const GLOVES_CHANCE = 0.6;
const MIX_MULTIPLIER = 2654435761;

const pick = (list, roll) => list[Math.min(list.length - 1, Math.floor(roll * list.length))];

/** The first key whose cumulative weight covers the roll. */
const pickWeighted = (table, roll) => (table.find(([, weight]) => roll < weight) ?? table[table.length - 1])[0];

/** Box-Muller normal draw with mean 0 and sd 1. */
function normal(rng) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * The look of the rider with this id. Any integer works; the same id always
 * gives the same look.
 * @param {number} id
 * @returns {RiderLook}
 */
export function lookOf(id) {
  const rng = seededRandom(Math.imul(id, MIX_MULTIPLIER) >>> 0);

  const height = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, HEIGHT_MEAN + HEIGHT_SPREAD * normal(rng)));
  const bmi = BMI_MIN + BMI_SPAN * rng();
  const weight = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, bmi * height * height));

  const skin = pick(Object.keys(RIDER_SKINS), rng());
  const hair = pick(HAIRS, rng());
  const kit = pickWeighted(KIT_WEIGHTS, rng());
  const pattern = rng() < PATTERN_CHANCE_SOLID ? "solid" : pick(RIDER_PATTERNS.slice(1), rng());
  const [primary, secondary, accent] = pick(JERSEY_PAIRS, rng());
  const shorts = rng() < SHORTS_DARK_CHANCE ? pick(SHORTS.slice(0, 5), rng()) : pick(SHORTS, rng());
  const socks = pick(SOCKS, rng());
  const shoes = pick(SHOES, rng());
  const helmet = pick(HELMETS, rng());
  const glasses = rng() < GLASSES_CHANCE;
  const gloves = rng() < GLOVES_CHANCE;
  const gloveColor = rng() < 0.5 ? "#15161a" : pick(SOCKS, rng());
  const bike = pickWeighted(BIKE_WEIGHTS, rng());
  const frame = pick(FRAMES, rng());
  const frameAccent = pick(FRAME_ACCENTS, rng());

  return {
    height,
    weight,
    skin,
    hair,
    kit,
    pattern,
    primary,
    secondary,
    accent,
    shorts,
    socks,
    shoes,
    helmet,
    glasses,
    gloves,
    gloveColor,
    bike,
    frame,
    frameAccent,
  };
}
