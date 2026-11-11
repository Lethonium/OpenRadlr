/**
 * The 2D map's colours: the season's ground, water, road and scenery, tinted by
 * the time of day like the 3D world.
 *
 * The map has its own palette because it draws symbols instead of meshes, but
 * it takes the same inputs as the world: the biome registry supplies the season
 * (its `map` and `flora.mapColors` are the single source of the season's map
 * colours, in 0–1 RGB arrays like every other biome colour) and the lighting
 * presets supply the light. Pure data and pure functions, so a render and a
 * test can agree on exactly what a winter dusk looks like.
 */
import { resolveBiome } from "../view3d/biomes/index.js";
import { TIME_MODES, resolvePreset, resolvedLight } from "../view3d/lighting.js";

/** The start menu's map palette, kept from the original top-down map. */
export const MAP_COLORS = Object.freeze({
  sea: "#163a4e",
  land: "#2d5b3b",
  sand: "#cdb98a",
  road: "rgba(232, 236, 241, 0.5)",
  accent: "#ff7a1a",
  climb: "#ff5d5d",
  sprint: "#4cc3ff",
  start: "#ffd21f",
});

/** How strongly each time of day does what to the map. */
const TIME_TINT = Object.freeze({
  golden: Object.freeze({ amount: 0.18, dim: 0.96 }),
  dusk: Object.freeze({ amount: 0.34, dim: 0.74 }),
});

/** Reads a hex, `rgb()`/`rgba()` string or 0–1 RGB array into channels. */
function parseColor(value) {
  if (Array.isArray(value)) return { r: value[0] * 255, g: value[1] * 255, b: value[2] * 255, a: value[3] ?? 1 };
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const number = Number.parseInt(hex[1], 16);
    return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255, a: 1 };
  }
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
}

function formatColor({ r, g, b, a }) {
  if (a >= 1) return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 100) / 100})`;
}

/** Blends a colour towards the light's tint and dims it; day leaves the channels. */
function lit(color, tint, { amount, dim }, alpha = 1) {
  const base = parseColor(color);
  if (!amount) return formatColor({ ...base, a: base.a * alpha });
  return formatColor({
    r: (base.r * (1 - amount) + tint[0] * 255 * amount) * dim,
    g: (base.g * (1 - amount) + tint[1] * 255 * amount) * dim,
    b: (base.b * (1 - amount) + tint[2] * 255 * amount) * dim,
    a: base.a * alpha,
  });
}

/**
 * The palette for one frame of the 2D map.
 * @param {{biome?: string, timeMode?: string, date?: Date, colors?: object}} options
 *   `colors` are the HUD's theme colours, used for the road and lane markings
 *   when the biome does not paint its own.
 * @returns {object} CSS colours for the ground, water, roads, scenery and buildings
 */
export function rideMapTheme({ biome = "temperate", timeMode = "day", date, colors = {} } = {}) {
  const season = resolveBiome(biome);
  const map = season.map ?? {};
  const mode = TIME_MODES.includes(timeMode) ? timeMode : "day";
  const preset = resolvePreset(mode, date);
  const light = resolvedLight(preset, season);
  const tint = preset.key === "dusk" ? light.horizon : light.sunColor;
  const tinting = TIME_TINT[preset.key] ?? { amount: 0, dim: 1 };

  const building = (kind) => {
    const spec = map[kind];
    return {
      fill: lit(spec.fill, tint, tinting, spec.fillAlpha),
      edge: lit(spec.edge, tint, tinting, spec.edgeAlpha),
      ridge: lit(spec.ridge, tint, tinting, spec.ridgeAlpha),
    };
  };
  const house = building("house");
  const cafe = building("cafe");

  return {
    land: lit(map.land ?? MAP_COLORS.land, tint, tinting),
    sea: lit(map.sea ?? MAP_COLORS.sea, tint, tinting),
    sand: lit(map.sand ?? MAP_COLORS.sand, tint, tinting),
    road: lit(map.road ?? colors.road ?? MAP_COLORS.road, tint, tinting),
    contextRoad: lit(map.contextRoad ?? colors.muted ?? MAP_COLORS.road, tint, tinting),
    marking: lit(map.marking ?? colors.text ?? MAP_COLORS.road, tint, tinting),
    edge: lit(map.edge ?? colors.text ?? MAP_COLORS.road, tint, tinting),
    trees: (season.flora?.mapColors ?? []).map((tree) => lit(tree, tint, tinting)),
    houseFill: house.fill,
    houseEdge: house.edge,
    houseRidge: house.ridge,
    cafeFill: cafe.fill,
    cafeEdge: cafe.edge,
    cafeRidge: cafe.ridge,
    time: preset.key,
  };
}
