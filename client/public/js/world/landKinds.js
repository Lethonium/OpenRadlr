/**
 * What the island's land is used for: the kinds of parcel, how each looks from
 * the air in every season, and how likely each is at a place given its region,
 * distance to the sea, slope, height and nearest village. Data and one pure
 * function; the parcel planner and the ground paint read it.
 */
import { REGION_STYLE } from "./regionKinds.js";

export const LAND_KINDS = Object.freeze(["arable", "pasture", "orchard", "vineyard", "scrub", "dune", "fallow"]);

/** Metres from the shore with no arable, orchard or vineyard. */
export const COAST_BAND = 220;
/** Steeper than this (rise/run): no arable. */
export const PLOUGH_SLOPE = 0.12;
/** Steeper than this: no parcel at all. */
export const TERRACE_SLOPE = 0.3;
/** Distance to a village (m) at which farmland is half as likely. */
export const VILLAGE_HALF = 1500;

const rgb = (r, g, b) => Object.freeze([r, g, b]);
const paint = (spring, summer, autumn, winter) => Object.freeze({ spring, summer, autumn, winter });

/**
 * paint: sRGB ground colour per season (arable's is ignored, its crop decides);
 * edge: what borders a parcel; size: parcel side range in metres.
 */
export const LAND_STYLE = Object.freeze({
  arable: Object.freeze({ paint: paint(rgb(0.62, 0.66, 0.3), rgb(0.67, 0.59, 0.31), rgb(0.7, 0.6, 0.38), rgb(0.35, 0.27, 0.2)), edge: "hedge", size: Object.freeze([120, 420]) }),
  pasture: Object.freeze({ paint: paint(rgb(0.42, 0.62, 0.26), rgb(0.5, 0.62, 0.27), rgb(0.55, 0.55, 0.3), rgb(0.55, 0.6, 0.5)), edge: "hedge", size: Object.freeze([100, 320]) }),
  orchard: Object.freeze({ paint: paint(rgb(0.4, 0.55, 0.25), rgb(0.45, 0.55, 0.26), rgb(0.55, 0.5, 0.28), rgb(0.5, 0.45, 0.35)), edge: "wall", size: Object.freeze([70, 200]) }),
  vineyard: Object.freeze({ paint: paint(rgb(0.45, 0.5, 0.25), rgb(0.4, 0.5, 0.22), rgb(0.62, 0.42, 0.2), rgb(0.42, 0.34, 0.26)), edge: "none", size: Object.freeze([70, 220]) }),
  scrub: Object.freeze({ paint: paint(rgb(0.45, 0.5, 0.3), rgb(0.5, 0.48, 0.3), rgb(0.5, 0.44, 0.3), rgb(0.45, 0.42, 0.35)), edge: "none", size: Object.freeze([80, 300]) }),
  dune: Object.freeze({ paint: paint(rgb(0.8, 0.75, 0.55), rgb(0.77, 0.7, 0.5), rgb(0.82, 0.74, 0.54), rgb(0.78, 0.74, 0.62)), edge: "none", size: Object.freeze([60, 200]) }),
  fallow: Object.freeze({ paint: paint(rgb(0.5, 0.58, 0.28), rgb(0.56, 0.52, 0.29), rgb(0.6, 0.5, 0.32), rgb(0.5, 0.45, 0.36)), edge: "hedge", size: Object.freeze([100, 300]) }),
});

/** Ground colour of each crop, matched by eye to what `assets/nature/crops.js` draws. */
export const CROP_PAINT = Object.freeze({
  rapeseed: rgb(0.8, 0.72, 0.2),
  wheat: rgb(0.7, 0.585, 0.3),
  sunflower: rgb(0.7, 0.62, 0.18),
  corn: rgb(0.45, 0.6, 0.22),
  stubble: rgb(0.7, 0.63, 0.41),
  ploughed: rgb(0.32, 0.22, 0.15),
  pumpkin: rgb(0.38, 0.33, 0.2),
  lavender: rgb(0.52, 0.4, 0.66),
});

const MEDITERRANEAN = new Set(["pineCoast", "oliveTerraces", "almondValley", "lavenderFields"]);
/** Field edge by region kind: walls in the Mediterranean regions, hedges elsewhere. */
export const regionEdge = (regionKind) => (MEDITERRANEAN.has(regionKind) ? "wall" : "hedge");

/**
 * Base share of each parcel kind per region kind; what is left is wild land.
 * Arable is the region's `fieldShare`.
 */
const BASE = Object.freeze({
  meadow: { pasture: 0.55, fallow: 0.08, orchard: 0.03, scrub: 0.05 },
  farmBelt: { pasture: 0.08, fallow: 0.03, orchard: 0.03, scrub: 0.03 },
  deepWood: { pasture: 0.2, fallow: 0.04, scrub: 0.25 },
  wetland: { pasture: 0.55, fallow: 0.03, scrub: 0.2 },
  highCountry: { pasture: 0.45, scrub: 0.3 },
  pineCoast: { scrub: 0.35, orchard: 0.1, vineyard: 0.05, pasture: 0.05 },
  oliveTerraces: { orchard: 0.4, scrub: 0.15, vineyard: 0.05, pasture: 0.05, fallow: 0.03 },
  lavenderFields: { pasture: 0.1, vineyard: 0.1, orchard: 0.1, scrub: 0.15, fallow: 0.05 },
  almondValley: { orchard: 0.4, vineyard: 0.1, scrub: 0.1, pasture: 0.05, fallow: 0.03 },
});

/** Scales some base shares: the regions' farm shares alone leave most of the island wild. */
const FILL = Object.freeze({ arable: 1.5, pasture: 1.6, fallow: 1.6, scrub: 1.6 });
const COAST_DUNE = 0.4;
const COAST_SCRUB = 0.3;
const FARM = ["arable", "orchard", "vineyard"];

/**
 * Likelihood of each land kind at a place; sums to 1. `wild` is land no parcel takes.
 * @param {{mix: {kind: string, weight: number}[], shore: number, slope: number, height: number, village: number}} at
 * @returns {Record<string, number>}
 */
export function landKindWeights({ mix, shore, slope, height, village }) {
  const out = { wild: 0 };
  for (const kind of LAND_KINDS) out[kind] = 0;
  if (slope > TERRACE_SLOPE) {
    out.wild = 1;
    return out;
  }
  const farmland = 0.25 + 0.75 * 2 ** (-Math.max(0, village) / VILLAGE_HALF);
  const uphill = Math.min(1, Math.max(0, (700 - height) / 400));
  for (const { kind: region, weight } of mix) {
    const base = { arable: REGION_STYLE[region]?.fieldShare ?? 0.2, ...BASE[region] };
    for (const kind of LAND_KINDS) {
      const share = (base[kind] ?? 0) * (FILL[kind] ?? 1);
      if (share === 0) continue;
      const near = kind === "scrub" || kind === "dune" || kind === "pasture" ? 1 : farmland;
      out[kind] += weight * share * near * (kind === "arable" ? uphill : 1);
    }
  }
  if (slope > PLOUGH_SLOPE) out.arable = 0;
  const coastal = shore < COAST_BAND;
  if (coastal) for (const kind of FARM) out[kind] = 0;
  let taken = LAND_KINDS.reduce((s, kind) => s + out[kind], 0);
  if (coastal) {
    const room = 1 - COAST_DUNE - COAST_SCRUB;
    if (taken > room) for (const kind of LAND_KINDS) out[kind] *= room / taken;
    out.dune += COAST_DUNE;
    out.scrub += COAST_SCRUB;
    taken = LAND_KINDS.reduce((s, kind) => s + out[kind], 0);
  } else if (taken > 1) {
    for (const kind of LAND_KINDS) out[kind] /= taken;
    taken = 1;
  }
  out.wild = Math.max(0, 1 - taken);
  return out;
}
