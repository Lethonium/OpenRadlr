/**
 * Plans the map's landmarks: where each one stands, on what ground, and which members it has (a row of
 * windmills, a flock of balloons). Pure and seeded; each apron is stamped built so no tree, field or verge item
 * grows there. The models come later and are built from this data.
 */
import { seededRandom } from "../noise.js";
import { MASK, stampDisc } from "./masks.js";

/** Windmill spacing along a row, in metres. */
export const MILL_SPACING = 75;

const MAX_MILLS = 9;
const MAX_BALLOONS = 8;
const FOOTPRINT = Object.freeze({ lighthouse: 7, castle: 27, seaArch: 0, windmills: 3.4 });

/** FNV-1a of a string: a stable seed per landmark id. */
function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The lowest terrain under a round footprint (centre and eight points on its rim). */
function lowestUnder(terrain, x, z, radius) {
  let low = terrain.height(x, z);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    low = Math.min(low, terrain.height(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  return low;
}

/** A single landmark: one member at its spot. */
function single(entry, { terrain, water }) {
  const [x, z] = entry.center;
  const y = entry.kind === "seaArch" ? water : lowestUnder(terrain, x, z, FOOTPRINT[entry.kind]);
  return { x, y, z, members: [{ x, y, z, yaw: entry.yaw }], keeps: [[x, z, entry.apron]] };
}

/** A row of windmills along `yaw`, each on its own ground with its own patch kept clear. */
function windmills(entry, { terrain }) {
  const n = Math.max(1, Math.min(Math.floor(entry.count), MAX_MILLS));
  const [cx, cz] = entry.center;
  const cos = Math.cos(entry.yaw);
  const sin = Math.sin(entry.yaw);
  const members = Array.from({ length: n }, (_, i) => {
    const along = (i - (n - 1) / 2) * MILL_SPACING;
    const [x, z] = [cx + cos * along, cz - sin * along];
    return { x, y: lowestUnder(terrain, x, z, FOOTPRINT.windmills), z, yaw: entry.yaw };
  });
  return { x: cx, y: Math.min(...members.map((m) => m.y)), z: cz, members, keeps: members.map((m) => [m.x, m.z, entry.apron]) };
}

/** Balloons on loops round the centre: radius 600 to 1500 m, height 250 to 450 m, a quarter of an hour a lap. */
function balloons(entry, { random }) {
  const n = Math.max(1, Math.min(Math.floor(entry.count), MAX_BALLOONS));
  const [x, z] = entry.center;
  const members = Array.from({ length: n }, (_, i) => {
    const radius = Math.round(600 + (n === 1 ? 0.5 : i / (n - 1)) * 900);
    const metresPerSecond = 6.5 + random() * 2.5;
    return {
      x, z, y: Math.round(250 + ((i * 0.37 + random() * 0.15) % 1) * 200), yaw: 0,
      radius, phase: random() * Math.PI * 2, speed: ((i % 2 === 0 ? 1 : -1) * metresPerSecond) / radius, palette: i % 4,
    };
  });
  return { x, y: 0, z, members, keeps: [] };
}

const PLACERS = Object.freeze({ lighthouse: single, castle: single, seaArch: single, windmills, balloons });

/**
 * @typedef {object} Landmark
 * @property {string} id
 * @property {string} kind
 * @property {number} x
 * @property {number} y lowest ground under the footprint (the water line for a sea arch)
 * @property {number} z
 * @property {number} yaw
 * @property {number} apron metres kept clear round each stand point
 * @property {Array<{x: number, y: number, z: number, yaw: number}>} members one per mill; a balloon also has `radius`, `phase`, `speed`, `palette` and its altitude as `y`
 */

/**
 * Places the landmarks and stamps their aprons as built on `masks`; unknown kinds are skipped.
 * @param {{landmarks: Array<{id: string, kind: string, center: number[], yaw: number, apron: number, count: number}>, terrain: {height: (x: number, z: number) => number}, roads?: object, seed: number, masks: import("./masks.js").Masks, water: number}} input
 * @returns {Landmark[]}
 */
export function planLandmarks({ landmarks, terrain, seed, masks, water }) {
  const placed = [];
  for (const entry of landmarks) {
    const place = PLACERS[entry.kind];
    if (!place) continue;
    const { keeps, ...rest } = place(entry, { terrain, water, random: seededRandom((seed ^ hashOf(entry.id ?? entry.kind)) >>> 0) });
    for (const [x, z, r] of keeps) if (r > 0) stampDisc(masks, x, z, r, MASK.built);
    placed.push({ id: entry.id, kind: entry.kind, yaw: entry.yaw, apron: entry.apron, ...rest });
  }
  return placed;
}
