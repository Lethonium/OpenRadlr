/**
 * Where workout riders stand at a café's outdoor gym (#77).
 *
 * Every client works the layout out on its own from the riders' ids, so all
 * see the same: ids in ascending order take the mat's eight spots, and the
 * ninth and later stand in further rows behind the mat. Nobody moves unless
 * someone with a lower id leaves.
 */

/** Metres between neighbouring spots (and rows). */
export const GYM_SPOT_GAP = 1.8;
/** A gym further than this from a rider (metres) is not theirs. */
export const GYM_REACH = 120;

const COLUMNS = 4;

/**
 * @param {number[]} riderIds the workout riders at this gym
 * @param {{spots: {position: number[], yaw: number}[]}} gym two rows of four, front row first
 * @returns {Map<number, {position: number[], yaw: number}>}
 */
export function assignSpots(riderIds, gym) {
  const spots = new Map();
  const sorted = [...riderIds].sort((a, b) => a - b);
  // One row further back: from the front row to the second.
  const row = [0, 1, 2].map((k) => gym.spots[COLUMNS].position[k] - gym.spots[0].position[k]);
  sorted.forEach((id, index) => {
    if (index < gym.spots.length) {
      spots.set(id, gym.spots[index]);
      return;
    }
    const extra = index - gym.spots.length;
    const column = gym.spots[extra % COLUMNS];
    const rows = gym.spots.length / COLUMNS + Math.floor(extra / COLUMNS);
    spots.set(id, { position: column.position.map((v, k) => v + row[k] * rows), yaw: column.yaw });
  });
  return spots;
}

/** The gym closest to `[x, z]` within reach, or null. */
export function nearestGym(gyms, [x, z]) {
  let best = null;
  let bestDistance = GYM_REACH;
  for (const gym of gyms ?? []) {
    const distance = Math.hypot(gym.center[0] - x, gym.center[2] - z);
    if (distance < bestDistance) {
      best = gym;
      bestDistance = distance;
    }
  }
  return best;
}

/** The gym at the start of `route` (a RouteGeometry), where its workout riders train. */
export function gymOfRoute(gyms, route) {
  const { x, y } = route.positionAt(0);
  return nearestGym(gyms, [x, -y]);
}
