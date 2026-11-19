/**
 * What each region kind looks like (#117): data only, a temperate default per
 * kind that a biome may override piece by piece (`biome.regions[kind]`, merged
 * deep; arrays such as colours replace). Later tasks read these tables for the
 * ground colour, tree mix, canopy colour, the colour mass, near-only cover and
 * roadside props. Plant and prop ids are the ones the plant and prop builders
 * define; a style only names them.
 */
import { REGION_KIND } from "../../land/regions.js";

const rgb = (r, g, b) => Object.freeze([r, g, b]);
const list = (...items) => Object.freeze(items);
const frozen = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) frozen(inner);
  }
  return value;
};

/** Cover plants that bloom: they have no place under snow. */
const FLOWERING = new Set(["lavender", "wildflower", "alpineFlower"]);

export const REGION_STYLES = frozen({
  [REGION_KIND.pineCoast]: {
    ground: { open: rgb(0.5, 0.52, 0.3), field: rgb(0.54, 0.54, 0.3), forest: rgb(0.3, 0.38, 0.2) },
    trees: { plants: list("umbrellaPine"), density: 0.7 },
    mass: { kind: "patches", colour: rgb(0.78, 0.7, 0.5), cover: 0.14, scale: 60 },
    cover: { plants: list("broom", "shrub", "grass"), strip: list("grass", "wildflower"), perMetre: 0.16, colours: { grass: rgb(0.52, 0.54, 0.28), flowers: list(rgb(0.95, 0.85, 0.3), rgb(0.95, 0.95, 0.9)) } },
    props: { kinds: list("stoneWall", "boardwalk"), every: 40 },
  },
  [REGION_KIND.oliveTerraces]: {
    ground: { open: rgb(0.76, 0.66, 0.38), field: rgb(0.7, 0.62, 0.36), forest: rgb(0.4, 0.44, 0.24) },
    trees: { plants: list("olive"), density: 0.55 },
    mass: { kind: "stripes", colour: rgb(0.52, 0.58, 0.4), cover: 0.45, scale: 40, angle: 0.5 },
    cover: { plants: list("grass", "wildflower", "shrub"), strip: list("grass", "wildflower"), perMetre: 0.16, colours: { grass: rgb(0.66, 0.6, 0.32), flowers: list(rgb(0.95, 0.85, 0.3), rgb(0.95, 0.95, 0.9), rgb(0.7, 0.5, 0.85)) } },
    props: { kinds: list("stoneWall", "cart"), every: 30 },
  },
  [REGION_KIND.blossomValley]: {
    ground: { open: rgb(0.52, 0.68, 0.36), field: rgb(0.58, 0.7, 0.36), forest: rgb(0.34, 0.5, 0.26) },
    trees: { plants: list("almond"), density: 0.6, canopy: rgb(0.95, 0.72, 0.78) },
    mass: { kind: "patches", colour: rgb(0.96, 0.78, 0.84), cover: 0.4, scale: 60 },
    cover: { plants: list("wildflower", "grass"), strip: list("wildflower", "grass"), perMetre: 0.2, colours: { flowers: list(rgb(0.96, 0.7, 0.78), rgb(0.98, 0.9, 0.92), rgb(0.9, 0.5, 0.65), rgb(0.95, 0.95, 0.9)) } },
    props: { kinds: list("picketFence", "mailbox", "beehive"), every: 28 },
  },
  [REGION_KIND.lavenderFields]: {
    ground: { open: rgb(0.6, 0.56, 0.5), field: rgb(0.55, 0.5, 0.52), forest: rgb(0.38, 0.5, 0.28) },
    trees: { plants: list("olive"), density: 0.1 },
    mass: { kind: "stripes", colour: rgb(0.62, 0.48, 0.76), cover: 0.5, scale: 40, angle: 0.3 },
    cover: { plants: list("lavender"), strip: list("grass", "wildflower"), perMetre: 0.2 },
    props: { kinds: list("picketFence", "bench"), every: 32 },
  },
  [REGION_KIND.farmBelt]: {
    ground: { open: rgb(0.7, 0.66, 0.38), field: rgb(0.86, 0.72, 0.34), forest: rgb(0.36, 0.48, 0.24) },
    trees: { plants: list("olive", "almond"), density: 0.4 },
    mass: { kind: "stripes", colour: rgb(0.86, 0.72, 0.34), cover: 0.55, scale: 48, angle: 1.2 },
    cover: { plants: list("wheat", "wildflower"), strip: list("wheat", "grass"), perMetre: 0.16, colours: { grass: rgb(0.62, 0.58, 0.3) } },
    props: { kinds: list("hayBale", "picketFence"), every: 36 },
  },
  [REGION_KIND.deepWood]: {
    ground: { open: rgb(0.34, 0.46, 0.26), field: rgb(0.36, 0.46, 0.28), forest: rgb(0.2, 0.3, 0.16) },
    trees: { plants: list("umbrellaPine", "willow"), density: 1, canopy: rgb(0.16, 0.34, 0.2) },
    mass: { kind: null, colour: rgb(0.2, 0.3, 0.16), cover: 0, scale: 120 },
    cover: { plants: list("shrub", "grass"), strip: list("grass"), perMetre: 0.1, colours: { shrub: rgb(0.2, 0.36, 0.18), grass: rgb(0.28, 0.44, 0.2) } },
    props: { kinds: list("logPile"), every: 56 },
  },
  [REGION_KIND.wetland]: {
    ground: { open: rgb(0.5, 0.56, 0.34), field: rgb(0.52, 0.58, 0.34), forest: rgb(0.3, 0.42, 0.24) },
    trees: { plants: list("willow"), density: 0.4 },
    mass: { kind: "patches", colour: rgb(0.72, 0.64, 0.38), cover: 0.5, scale: 40 },
    cover: { plants: list("reeds", "grass"), strip: list("grass", "reeds"), perMetre: 0.2 },
    props: { kinds: list("boardwalk"), every: 50 },
  },
  [REGION_KIND.highCountry]: {
    ground: { open: rgb(0.52, 0.5, 0.44), field: rgb(0.5, 0.5, 0.42), forest: rgb(0.3, 0.38, 0.24) },
    trees: { plants: list("umbrellaPine"), density: 0.15 },
    mass: { kind: "patches", colour: rgb(0.9, 0.85, 0.5), cover: 0.2, scale: 50 },
    cover: { plants: list("alpineFlower", "grass"), strip: list("alpineFlower", "grass"), perMetre: 0.16, colours: { grass: rgb(0.46, 0.5, 0.3) } },
    props: { kinds: list("cairn", "snowPole"), every: 64 },
  },
});

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** `base` with `override` laid over it: objects merge, arrays and values replace. */
function merge(base, override) {
  if (!isPlain(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = isPlain(base?.[key]) ? merge(base[key], value) : value;
  return out;
}

/** The style of a region kind in a biome, or null for an unknown kind. */
export function regionStyle(kind, biome) {
  const base = REGION_STYLES[kind];
  if (!base) return null;
  const style = merge(base, biome?.regions?.[kind]);
  // A biome with no flowers (snow) leaves the flowering plants out of the cover.
  if (style.cover && biome?.flora?.density?.flowers === 0) {
    const bare = (plants) => plants && Object.freeze(plants.filter((name) => !FLOWERING.has(name)));
    return { ...style, cover: { ...style.cover, plants: bare(style.cover.plants), strip: bare(style.cover.strip) } };
  }
  return style;
}
