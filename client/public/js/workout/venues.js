/**
 * Where the café workouts happen: each café has an outdoor gym with statues of its figures.
 *
 * Pure functions and data only; no import of plan.js (plan.js imports VENUES).
 */

/** The gyms by café node id. `category` picks the figures, `material` the statues. */
export const VENUES = Object.freeze({
  "valley-cafe": Object.freeze({ category: "fullBody", material: "marble" }),
  "hill-cafe": Object.freeze({ category: "hiit", material: "bronze" }),
  "beach-cafe": Object.freeze({ category: "core", material: "sandstone" }), // core moves to forge-hut with yoga
  "forge-hut": Object.freeze({ category: "strength", material: "granite" }),
});

/** A route start this close to a café counts as starting at it. */
const VENUE_RADIUS_M = 30;

/**
 * The distinct exercise ids of the presets held at a venue, in order of first appearance.
 * @param {string} venueId
 * @param {{venue: string | null, blocks: {kind: string, exercise?: string}[]}[]} presets
 * @returns {string[]}
 */
export function figuresAt(venueId, presets) {
  const figures = new Set();
  for (const preset of presets) {
    if (preset.venue !== venueId) continue;
    for (const block of preset.blocks) if (block.kind === "exercise") figures.add(block.exercise);
  }
  return [...figures];
}

/**
 * The first route (in the given order) whose start lies within 30 m of the café, or null.
 * @param {string} venueId
 * @param {{id: string, start: {x: number, y: number}}[]} routes
 * @param {{id: string, x: number, y: number}[]} cafes
 * @returns {string | null}
 */
export function venueRoute(venueId, routes, cafes) {
  const cafe = cafes.find((node) => node.id === venueId);
  if (!cafe) return null;
  const route = routes.find((r) => Math.hypot(r.start.x - cafe.x, r.start.y - cafe.y) <= VENUE_RADIUS_M);
  return route ? route.id : null;
}
