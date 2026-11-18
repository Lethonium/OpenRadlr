/**
 * Regions (#117): named stretches of the island with their own character
 * (pine coast, olive terraces, ...). Hand-placed circles in the map file whose
 * edges blend over ~150 m and wander with ~300 m noise, so no circle shows.
 * Pure functions of the map data and seed.
 */
import { fbm } from "../view3d/noise.js";

export const REGION_KIND = Object.freeze({
  pineCoast: "pineCoast",
  oliveTerraces: "oliveTerraces",
  blossomValley: "blossomValley",
  lavenderFields: "lavenderFields",
  farmBelt: "farmBelt",
  deepWood: "deepWood",
  wetland: "wetland",
  highCountry: "highCountry",
});

const BLEND = 75; // half the blend band, metres
const WOBBLE_SCALE = 300;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Every region with weight > 0 at world (x, z), strongest first.
 * @param {{kind: string, center: number[], radius: number}[]} regions
 * @returns {{kind: string, weight: number}[]}
 */
export function regionAt(x, z, regions, seed) {
  if (!regions?.length) return [];
  const wobble = (fbm(x / WOBBLE_SCALE, z / WOBBLE_SCALE, seed + 0x5e9) - 0.5) * 0.35;
  const found = [];
  for (const region of regions) {
    const distance = Math.hypot(x - region.center[0], z - region.center[1]);
    const shift = wobble * region.radius;
    const weight = 1 - smoothstep(region.radius - BLEND + shift, region.radius + BLEND + shift, distance);
    if (weight > 0) found.push({ kind: region.kind, weight });
  }
  return found.sort((a, b) => b.weight - a.weight);
}
