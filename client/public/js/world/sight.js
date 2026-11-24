/**
 * Sight lines over the terrain: whether a point can be seen from the road, so a landmark nobody can see is caught
 * by a test instead of in a shot. Pure; no I/O.
 */

const PROBE = 10; // metres between terrain samples along a line
const CLEARANCE = 1; // metres the ground may rise above the line before it blocks

/**
 * True when the line from `from` (x, y, z) to `to` clears the ground, sampled every 10 m.
 * @param {number[]} from
 * @param {number[]} to
 * @param {{height: (x: number, z: number) => number}} terrain
 * @returns {boolean}
 */
export function lineOfSight(from, to, terrain) {
  const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const steps = Math.floor(distance / PROBE);
  for (let i = 1; i < steps; i += 1) {
    const f = i / steps;
    const line = from[1] + (to[1] - from[1]) * f;
    if (terrain.height(from[0] + (to[0] - from[0]) * f, from[2] + (to[2] - from[2]) * f) > line - CLEARANCE) return false;
  }
  return true;
}

/**
 * True when some road sample within `reach` metres (taken every `step` metres of road) has an unblocked line to `point`.
 * @param {number[]} point world `[x, y, z]`
 * @param {{roads: import("./roads.js").RoadIndex, terrain: {height: (x: number, z: number) => number}, step?: number, eye?: number, reach?: number}} input
 * @returns {boolean}
 */
export function seenFromRoad(point, { roads, terrain, step = 40, eye = 1.6, reach = 2500 }) {
  const every = Math.max(1, Math.round(step / 6));
  const { samples } = roads;
  for (let i = 0; i < samples.length; i += every) {
    const s = samples[i];
    if (Math.hypot(s.x - point[0], s.z - point[2]) > reach) continue;
    if (lineOfSight([s.x, terrain.height(s.x, s.z) + eye, s.z], point, terrain)) return true;
  }
  return false;
}
