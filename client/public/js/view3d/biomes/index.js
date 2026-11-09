/**
 * The biomes a rider can pick: each is a set of colours, models and rules for
 * drawing the same world. Pure data, so the registry resolves by id on either
 * side of the worker boundary.
 */
import { temperate } from "./temperate.js";
import { winter } from "./winter/index.js";

export { temperate, winter };

export const BIOMES = Object.freeze({ [temperate.id]: temperate, [winter.id]: winter });
export const BIOME_IDS = Object.freeze(Object.keys(BIOMES));
export const DEFAULT_BIOME = "temperate";

/** The biome with this id, or the default one for an unknown or missing id. */
export function resolveBiome(id) {
  return BIOMES[id] ?? BIOMES[DEFAULT_BIOME];
}

/** `[{ id, label, preview }]` for the picker, in a stable order. */
export function biomeChoices() {
  return BIOME_IDS.map((id) => ({ id, label: BIOMES[id].label, preview: BIOMES[id].preview }));
}
