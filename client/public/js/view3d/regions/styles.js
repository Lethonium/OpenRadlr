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

export const REGION_STYLES = frozen({
  [REGION_KIND.pineCoast]: {
    ground: { open: rgb(0.74, 0.66, 0.46), field: rgb(0.7, 0.64, 0.42), forest: rgb(0.34, 0.4, 0.22) },
    trees: { plants: list("umbrellaPine"), density: 0.7 },
    mass: { kind: null, colour: rgb(0.74, 0.66, 0.46), cover: 0, scale: 120 },
    cover: { plants: list("broom"), perMetre: 0.05 },
    props: { kinds: list("stoneWall", "boardwalk"), every: 60 },
  },
  [REGION_KIND.oliveTerraces]: {
    ground: { open: rgb(0.76, 0.66, 0.38), field: rgb(0.7, 0.62, 0.36), forest: rgb(0.4, 0.44, 0.24) },
    trees: { plants: list("olive"), density: 0.55 },
    mass: { kind: "stripes", colour: rgb(0.52, 0.58, 0.4), cover: 0.45, scale: 14, angle: 0.5 },
    cover: { plants: list("wildflower"), perMetre: 0.08 },
    props: { kinds: list("stoneWall", "cart"), every: 45 },
  },
  [REGION_KIND.blossomValley]: {
    ground: { open: rgb(0.52, 0.68, 0.36), field: rgb(0.58, 0.7, 0.36), forest: rgb(0.34, 0.5, 0.26) },
    trees: { plants: list("almond"), density: 0.6, canopy: rgb(0.95, 0.72, 0.78) },
    mass: { kind: "patches", colour: rgb(0.96, 0.78, 0.84), cover: 0.4, scale: 60 },
    cover: { plants: list("wildflower"), perMetre: 0.1 },
    props: { kinds: list("picketFence", "mailbox", "beehive"), every: 40 },
  },
  [REGION_KIND.lavenderFields]: {
    ground: { open: rgb(0.6, 0.56, 0.5), field: rgb(0.55, 0.5, 0.52), forest: rgb(0.38, 0.5, 0.28) },
    trees: { plants: list("olive"), density: 0.1 },
    mass: { kind: "stripes", colour: rgb(0.55, 0.42, 0.75), cover: 0.6, scale: 9, angle: 0.3 },
    cover: { plants: list("lavender"), perMetre: 0.2 },
    props: { kinds: list("picketFence", "bench"), every: 45 },
  },
  [REGION_KIND.farmBelt]: {
    ground: { open: rgb(0.7, 0.66, 0.38), field: rgb(0.86, 0.72, 0.34), forest: rgb(0.36, 0.48, 0.24) },
    trees: { plants: list("olive", "almond"), density: 0.4 },
    mass: { kind: "stripes", colour: rgb(0.86, 0.72, 0.34), cover: 0.55, scale: 22, angle: 1.2 },
    cover: { plants: list("wildflower"), perMetre: 0.06 },
    props: { kinds: list("hayBale", "picketFence"), every: 50 },
  },
  [REGION_KIND.deepWood]: {
    ground: { open: rgb(0.34, 0.46, 0.26), field: rgb(0.36, 0.46, 0.28), forest: rgb(0.2, 0.3, 0.16) },
    trees: { plants: list("umbrellaPine", "willow"), density: 1, canopy: rgb(0.16, 0.34, 0.2) },
    mass: { kind: null, colour: rgb(0.2, 0.3, 0.16), cover: 0, scale: 120 },
    cover: { plants: list("broom"), perMetre: 0.04 },
    props: { kinds: list("logPile"), every: 80 },
  },
  [REGION_KIND.wetland]: {
    ground: { open: rgb(0.5, 0.56, 0.34), field: rgb(0.52, 0.58, 0.34), forest: rgb(0.3, 0.42, 0.24) },
    trees: { plants: list("willow"), density: 0.4 },
    mass: { kind: "patches", colour: rgb(0.72, 0.64, 0.38), cover: 0.5, scale: 40 },
    cover: { plants: list("reeds"), perMetre: 0.2 },
    props: { kinds: list("boardwalk"), every: 70 },
  },
  [REGION_KIND.highCountry]: {
    ground: { open: rgb(0.52, 0.5, 0.44), field: rgb(0.5, 0.5, 0.42), forest: rgb(0.3, 0.38, 0.24) },
    trees: { plants: list("umbrellaPine"), density: 0.15 },
    mass: { kind: "patches", colour: rgb(0.9, 0.85, 0.5), cover: 0.2, scale: 50 },
    cover: { plants: list("alpineFlower"), perMetre: 0.08 },
    props: { kinds: list("cairn", "snowPole"), every: 90 },
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
  return merge(base, biome?.regions?.[kind]);
}
