/**
 * Where the café workouts happen: each café has an outdoor gym with statues of its figures.
 *
 * Pure functions and data only; no import of plan.js (plan.js imports VENUES).
 */

/** The gyms by café node id. `category` picks the figures, `material` the statues. */
export const VENUES = Object.freeze({
  "valley-cafe": Object.freeze({ category: "fullBody", material: "marble" }),
  "hill-cafe": Object.freeze({ category: "hiit", material: "bronze" }),
  "beach-cafe": Object.freeze({ category: "yoga", material: "sandstone" }),
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

/**
 * The statue rows to show: one per gym with a known café and at least one figure.
 * `override` shows a plan's figures (and its venue's material) at one gym instead.
 * @param {{cafeId: string | null, statueRow: object | null}[]} gyms
 * @param {{venue: string | null, blocks: {kind: string, exercise?: string}[]}[]} presets
 * @param {{gym: object, plan: {venue: string | null, blocks: {kind: string, exercise?: string}[]}} | null} [override]
 * @returns {{gym: object, figures: string[], material: string}[]}
 */
export function statueRows(gyms, presets, override = null) {
  const rows = [];
  for (const gym of gyms) {
    if (!gym.statueRow) continue;
    let figures;
    let venue;
    if (override && override.gym === gym) {
      venue = override.plan.venue;
      figures = [...new Set(override.plan.blocks.filter((b) => b.kind === "exercise").map((b) => b.exercise))];
    } else {
      venue = gym.cafeId;
      figures = Object.hasOwn(VENUES, venue) ? figuresAt(venue, presets) : [];
    }
    if (!Object.hasOwn(VENUES, venue) || figures.length === 0) continue;
    rows.push({ gym, figures, material: VENUES[venue].material });
  }
  return rows;
}
