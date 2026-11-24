/**
 * The four seasons of the world: which one is showing, and how the ground
 * looks in it. Pure data and rules; nothing here knows about drawing.
 */

/** @typedef {"spring"|"summer"|"autumn"|"winter"} Season */
/** @typedef {[number, number, number]} Rgb sRGB, 0–1 per channel */
/**
 * @typedef {object} SeasonLook
 * @property {Rgb} grass
 * @property {Rgb} grassDry
 * @property {Rgb} soil
 * @property {Rgb} rock
 * @property {Rgb} sand
 * @property {number} snowCover 0..1, how much of the ground is white
 * @property {number} snowLine metres above sea level where the snow starts
 */

export const SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);
export const SEASON_MODES = Object.freeze(["auto", ...SEASONS]);

/** Above the island's highest point, so a snow-free season never reaches it. */
const NO_SNOW_LINE = 10000;

const rgb = (r, g, b) => Object.freeze([r, g, b]);

/** @type {Readonly<Record<Season, Readonly<SeasonLook>>>} */
export const SEASON_LOOK = Object.freeze({
  // The reference's palettes (sRGB): spring #4c8231, summer #98a752 with its greener third entry #86a04a (a sunlit olive; the grass sits towards the green one),
  // autumn #ab8a3c, winter #e8edf3; the dry colour is the palette's second entry. The soil is its `dirt`
  // (#9a8360), the rock #7b756c, the sand #d8c592.
  spring: Object.freeze({
    grass: rgb(0.3, 0.51, 0.19),
    grassDry: rgb(0.42, 0.61, 0.26),
    soil: rgb(0.6, 0.51, 0.38),
    rock: rgb(0.48, 0.46, 0.42),
    sand: rgb(0.85, 0.77, 0.57),
    snowCover: 0,
    snowLine: NO_SNOW_LINE,
  }),
  summer: Object.freeze({
    grass: rgb(0.5, 0.62, 0.28),
    grassDry: rgb(0.6, 0.66, 0.31),
    soil: rgb(0.6, 0.51, 0.38),
    rock: rgb(0.48, 0.46, 0.42),
    sand: rgb(0.85, 0.77, 0.57),
    snowCover: 0,
    snowLine: NO_SNOW_LINE,
  }),
  autumn: Object.freeze({
    grass: rgb(0.67, 0.54, 0.24),
    grassDry: rgb(0.63, 0.38, 0.18),
    soil: rgb(0.56, 0.46, 0.34),
    rock: rgb(0.48, 0.46, 0.42),
    sand: rgb(0.82, 0.74, 0.54),
    snowCover: 0,
    snowLine: NO_SNOW_LINE,
  }),
  winter: Object.freeze({
    grass: rgb(0.8, 0.84, 0.88),
    grassDry: rgb(0.7, 0.74, 0.78),
    soil: rgb(0.45, 0.42, 0.4),
    rock: rgb(0.5, 0.5, 0.52),
    sand: rgb(0.84, 0.85, 0.86),
    snowCover: 1,
    snowLine: 0,
  }),
});

/**
 * The season for a season mode: "auto" follows the month (Mar–May spring,
 * Jun–Aug summer, Sep–Nov autumn, Dec–Feb winter); an unknown mode is "auto".
 * @param {string} mode
 * @param {Date} date
 * @returns {Season}
 */
export function resolveSeason(mode, date) {
  if (SEASONS.includes(mode)) return /** @type {Season} */ (mode);
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

/**
 * The season mode to open with, from what the browser saved: a valid saved
 * season wins; before seasons existed the choice was a biome, and "winter"
 * stays winter; anything else follows the calendar.
 * @param {{season?: string|null, biome?: string|null}} [saved]
 * @returns {string}
 */
export function seasonSetting({ season, biome } = {}) {
  if (SEASON_MODES.includes(season ?? "")) return /** @type {string} */ (season);
  return biome === "winter" ? "winter" : "auto";
}

/**
 * The old biome that matches a season, for the scenery and the 2D map until
 * the new world replaces them.
 * @param {Season} season
 * @returns {"winter"|"temperate"}
 */
export function biomeForSeason(season) {
  return season === "winter" ? "winter" : "temperate";
}

/**
 * The season to show from the page address and the saved settings:
 * `?season=autumn` (or the old `?biome=winter`) previews without saving.
 * @param {string} search `location.search`
 * @param {{season?: string|null, biome?: string|null}} stored
 * @param {Date} date
 * @returns {{mode: string, season: Season, preview: boolean}}
 */
export function seasonFromLocation(search, stored, date) {
  const params = new URLSearchParams(search);
  const asked = params.get("season") ?? params.get("biome") ?? "";
  const mode = SEASON_MODES.includes(asked) ? asked : seasonSetting(stored);
  return { mode, season: resolveSeason(mode, date), preview: mode === asked };
}
