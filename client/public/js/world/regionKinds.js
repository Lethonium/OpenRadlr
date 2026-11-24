/**
 * What each region kind looks like: ground tint per season, tree and verge
 * mixes, roadside props, how much of the land is farmed and which crops grow
 * in each season. Data only. Plant ids are the asset ids of the plant kit.
 */

/** @typedef {"spring"|"summer"|"autumn"|"winter"} Season */

export const REGION_KINDS = Object.freeze([
  "meadow",
  "farmBelt",
  "deepWood",
  "wetland",
  "highCountry",
  "pineCoast",
  "oliveTerraces",
  "lavenderFields",
  "almondValley",
]);

const rgb = (r, g, b) => Object.freeze([r, g, b]);
const list = (...items) => Object.freeze(items);
const ground = (spring, summer, autumn, winter) => Object.freeze({ spring, summer, autumn, winter });
const frozen = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) frozen(inner);
  }
  return value;
};

const ARABLE = { spring: list("rapeseed"), summer: list("wheat", "sunflower"), autumn: list("stubble", "pumpkin"), winter: list("ploughed") };
const DRY = { spring: list("wheat"), summer: list("wheat"), autumn: list("stubble"), winter: list("ploughed") };

/**
 * @typedef {object} RegionStyle
 * @property {Record<Season, number[]>} ground linear tint per season
 * @property {{mix: Record<string, number>, density: number}} trees shares sum to 1; density per hectare
 * @property {{mix: Record<string, number>, perMetre: number}} verge
 * @property {{kinds: readonly string[], every: number}} props roadside props, one per `every` metres
 * @property {number} fieldShare share of the land that is farmed
 * @property {Record<Season, readonly string[]>} crops
 */

/** @type {Readonly<Record<string, Readonly<RegionStyle>>>} */
export const REGION_STYLE = frozen({
  meadow: {
    ground: ground(rgb(0.95, 1.02, 0.93), rgb(0.98, 1, 0.91), rgb(1.02, 0.94, 0.78), rgb(0.94, 0.96, 0.98)),
    trees: { mix: { broadleaf: 0.6, birch: 0.2, poplar: 0.1, bush: 0.1 }, density: 14 },
    verge: { mix: { bush: 0.5, broadleaf: 0.3, birch: 0.2 }, perMetre: 0.14 },
    props: { kinds: list("picketFence", "hayBale"), every: 60 },
    fieldShare: 0.36,
    crops: ARABLE,
  },
  farmBelt: {
    ground: ground(rgb(0.96, 1.02, 0.9), rgb(1, 1, 0.88), rgb(1.06, 0.94, 0.72), rgb(0.94, 0.95, 0.96)),
    trees: { mix: { poplar: 0.4, broadleaf: 0.4, bush: 0.2 }, density: 8 },
    verge: { mix: { bush: 0.5, poplar: 0.3, broadleaf: 0.2 }, perMetre: 0.12 },
    props: { kinds: list("hayBale", "picketFence"), every: 36 },
    fieldShare: 0.55,
    crops: ARABLE,
  },
  deepWood: {
    ground: ground(rgb(0.85, 0.95, 0.85), rgb(0.83, 0.92, 0.83), rgb(0.82, 0.78, 0.6), rgb(0.82, 0.88, 0.9)),
    trees: { mix: { broadleaf: 0.45, pine: 0.3, birch: 0.25 }, density: 40 },
    verge: { mix: { bush: 0.6, birch: 0.2, pine: 0.2 }, perMetre: 0.18 },
    props: { kinds: list("logPile"), every: 56 },
    fieldShare: 0.05,
    crops: ARABLE,
  },
  wetland: {
    ground: ground(rgb(0.92, 1, 0.9), rgb(0.93, 0.98, 0.88), rgb(0.96, 0.9, 0.72), rgb(0.88, 0.92, 0.94)),
    trees: { mix: { poplar: 0.5, broadleaf: 0.2, bush: 0.3 }, density: 9 },
    verge: { mix: { bush: 0.7, poplar: 0.3 }, perMetre: 0.16 },
    props: { kinds: list("boardwalk"), every: 50 },
    fieldShare: 0.1,
    crops: ARABLE,
  },
  highCountry: {
    ground: ground(rgb(0.93, 0.97, 0.91), rgb(0.95, 0.96, 0.9), rgb(0.96, 0.9, 0.78), rgb(0.96, 0.97, 1)),
    trees: { mix: { pine: 0.7, birch: 0.2, rock: 0.1 }, density: 5 },
    verge: { mix: { bush: 0.4, rock: 0.4, pine: 0.2 }, perMetre: 0.1 },
    props: { kinds: list("cairn", "snowPole"), every: 64 },
    fieldShare: 0.05,
    crops: ARABLE,
  },
  pineCoast: {
    ground: ground(rgb(1, 1, 0.9), rgb(1.04, 1, 0.89), rgb(1.08, 0.96, 0.74), rgb(0.98, 0.97, 0.94)),
    trees: { mix: { umbrellaPine: 0.7, pine: 0.15, bush: 0.15 }, density: 12 },
    verge: { mix: { bush: 0.5, umbrellaPine: 0.4, rock: 0.1 }, perMetre: 0.16 },
    props: { kinds: list("stoneWall", "boardwalk"), every: 40 },
    fieldShare: 0.15,
    crops: DRY,
  },
  oliveTerraces: {
    ground: ground(rgb(1, 1, 0.88), rgb(1.07, 1.01, 0.86), rgb(1.1, 0.96, 0.7), rgb(0.98, 0.96, 0.92)),
    trees: { mix: { olive: 0.75, cypress: 0.1, bush: 0.15 }, density: 16 },
    verge: { mix: { bush: 0.5, olive: 0.3, cypress: 0.2 }, perMetre: 0.16 },
    props: { kinds: list("stoneWall", "cart"), every: 30 },
    fieldShare: 0.15,
    crops: DRY,
  },
  lavenderFields: {
    ground: ground(rgb(1, 1, 0.9), rgb(1.05, 1, 0.89), rgb(1.06, 0.94, 0.74), rgb(0.97, 0.96, 0.96)),
    trees: { mix: { olive: 0.5, cypress: 0.3, bush: 0.2 }, density: 3 },
    verge: { mix: { lavender: 0.6, bush: 0.4 }, perMetre: 0.2 },
    props: { kinds: list("picketFence", "bench"), every: 32 },
    fieldShare: 0.15,
    crops: { spring: list("lavender"), summer: list("lavender"), autumn: list("stubble"), winter: list("ploughed") },
  },
  almondValley: {
    ground: ground(rgb(0.98, 1.03, 0.92), rgb(0.98, 1.01, 0.9), rgb(1.04, 0.95, 0.76), rgb(0.95, 0.96, 0.97)),
    trees: { mix: { almond: 0.75, olive: 0.1, bush: 0.15 }, density: 14 },
    verge: { mix: { almond: 0.4, bush: 0.6 }, perMetre: 0.18 },
    props: { kinds: list("picketFence", "mailbox", "beehive"), every: 28 },
    fieldShare: 0.15,
    crops: DRY,
  },
});
