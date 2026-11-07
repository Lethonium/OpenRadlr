/**
 * The 2D map's colours: the season's ground, water, road and scenery, tinted by
 * the time of day like the 3D world.
 *
 * The map has its own palette because it draws symbols instead of meshes, but
 * it takes the same inputs as the world: the biome registry supplies the season
 * and the lighting presets supply the light. Pure data and pure functions, so a
 * render and a test can agree on exactly what a winter dusk looks like.
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

const TEMPERATE_TREES = Object.freeze([
  Object.freeze([0.302, 0.49, 0.227]),
  Object.freeze([0.376, 0.561, 0.271]),
]);

const DEFAULT_BUILDINGS = Object.freeze({
  house: Object.freeze({
    fill: "rgba(116, 76, 56, 0.46)",
    edge: "rgba(216, 199, 155, 0.85)",
    ridge: "rgba(232, 214, 172, 0.45)",
  }),
  cafe: Object.freeze({
    fill: "rgba(142, 92, 62, 0.52)",
    edge: "rgba(232, 214, 172, 0.95)",
    ridge: "rgba(242, 224, 182, 0.6)",
  }),
});

/** How strongly each time of day does what to the map. */
const TIME_TINT = Object.freeze({
  golden: Object.freeze({ amount: 0.18, dim: 0.96 }),
  dusk: Object.freeze({ amount: 0.34, dim: 0.74 }),
});

const rgb = (color) => `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;

const rgba = (color, alpha = 1) =>
  `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${Math.round(alpha * 100) / 100})`;

/** A CSS colour for palette data; arrays are RGB in 0–1, strings pass through. */
const colorCss = (color, alpha = 1) => (Array.isArray(color) ? (alpha >= 1 ? rgb(color) : rgba(color, alpha)) : color);

/** Reads a hex, `rgb()` or `rgba()` colour into 0–255 channels and an alpha. */
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

/** Blends a colour towards the light's tint and dims it; day leaves it untouched. */
function lit(color, tint, { amount, dim }) {
  if (!amount) return color;
  const base = parseColor(color);
  return formatColor({
    r: (base.r * (1 - amount) + tint[0] * 255 * amount) * dim,
    g: (base.g * (1 - amount) + tint[1] * 255 * amount) * dim,
    b: (base.b * (1 - amount) + tint[2] * 255 * amount) * dim,
    a: base.a,
  });
}

/**
 * The palette for one frame of the 2D map.
 * @param {{biome?: string, timeMode?: string, date?: Date, colors?: object}} options
 *   `colors` are the HUD's theme colours, used for the road and lane markings
 *   when a biome does not paint its own.
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

  const buildings = (kind) => {
    const spec = map[kind] ?? DEFAULT_BUILDINGS[kind];
    return {
      fill: colorCss(spec.fill, spec.fillAlpha),
      edge: colorCss(spec.edge, spec.edgeAlpha),
      ridge: colorCss(spec.ridge, spec.ridgeAlpha),
    };
  };
  const house = buildings("house");
  const cafe = buildings("cafe");

  const base = {
    land: colorCss(map.land ?? MAP_COLORS.land),
    sea: colorCss(map.sea ?? MAP_COLORS.sea),
    sand: colorCss(map.sand ?? MAP_COLORS.sand),
    road: colorCss(map.road ?? colors.road ?? MAP_COLORS.road),
    contextRoad: colorCss(map.contextRoad ?? colors.muted ?? MAP_COLORS.road),
    marking: colorCss(map.marking ?? colors.text ?? MAP_COLORS.road),
    edge: colorCss(map.edge ?? colors.text ?? MAP_COLORS.road),
    trees: (season.flora?.mapColors ?? TEMPERATE_TREES).map((tree) => colorCss(tree)),
    houseFill: house.fill,
    houseEdge: house.edge,
    houseRidge: house.ridge,
    cafeFill: cafe.fill,
    cafeEdge: cafe.edge,
    cafeRidge: cafe.ridge,
  };

  const theme = {};
  for (const [key, color] of Object.entries(base)) {
    theme[key] = Array.isArray(color) ? color.map((entry) => lit(entry, tint, tinting)) : lit(color, tint, tinting);
  }
  const land = parseColor(theme.land);
  theme.landRgb = [land.r, land.g, land.b];
  theme.time = preset.key;
  return theme;
}
