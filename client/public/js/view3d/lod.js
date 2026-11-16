/**
 * Levels of detail for whole chunk groups (#117).
 *
 * Modelled trees and village buildings are built twice: properly, and as a
 * cheap twin. The view draws each chunk from one copy or the other by how far
 * the chunk is, split at one distance per pair so a chunk is never drawn twice
 * or not at all.
 */

/** Each near group and the group holding its cheap twins. */
export const LOD_PAIRS = Object.freeze({ scenery: "sceneryFar", village: "villageFar" });

const NEAR_OF = Object.freeze(Object.fromEntries(Object.entries(LOD_PAIRS).map(([near, far]) => [far, near])));

/**
 * Whether `group` draws a chunk `distance` metres away. `splits` holds the
 * split for each near group, or null when it has no cheap twin: the near copy
 * is then drawn at every distance and the far one never.
 */
export function drawnAt(group, distance, splits) {
  if (group in LOD_PAIRS) {
    const split = splits[group] ?? null;
    return split === null || distance <= split;
  }
  if (group in NEAR_OF) {
    const split = splits[NEAR_OF[group]] ?? null;
    return split !== null && distance > split;
  }
  return true;
}
