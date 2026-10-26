/**
 * Smooth rider motion between server snapshots (4 Hz) for 60 fps rendering.
 *
 * Each rider is dead-reckoned from its last snapshot using its speed, and the
 * error against new snapshots is blended out over a short time instead of
 * snapping. Distances wrap around the loop.
 */
/** Distances of riders off every route (#15) just grow: no loop to wrap around. */
const OPEN_ROAD = Object.freeze({ wrap: (d) => d, signedGap: (a, b) => b - a });

export class RiderSmoother {
  #riders = new Map();

  /**
   * @param {{length: number, signedGap: (a: number, b: number) => number, wrap: (d: number) => number}} route
   * @param {{maxExtrapolationS?: number, correctionRate?: number, routeOf?: (rider: object) => object | undefined}} [options]
   *   `routeOf` finds a rider's own route (riders of other routes on the map, #14); `route` without it
   */
  constructor(route, { maxExtrapolationS = 0.6, correctionRate = 6, routeOf = () => undefined } = {}) {
    this.route = route;
    this.routeOf = routeOf;
    this.maxExtrapolationS = maxExtrapolationS;
    this.correctionRate = correctionRate;
  }

  /**
   * Feeds a state snapshot.
   * @param {Array<{id: number, distance: number, lane: number, speed: number}>} riders
   * @param {number} nowS time in seconds
   */
  update(riders, nowS) {
    const seen = new Set();
    for (const rider of riders) {
      seen.add(rider.id);
      const entry = this.#riders.get(rider.id);
      if (!entry) {
        this.#riders.set(rider.id, { snapshot: rider, receivedAt: nowS, display: rider.distance, lane: rider.lane, sampledAt: nowS });
        continue;
      }
      // Onto another route (or off every route): its distances start afresh.
      if (entry.snapshot.route !== rider.route) entry.display = rider.distance;
      entry.snapshot = rider;
      entry.receivedAt = nowS;
    }
    for (const id of this.#riders.keys()) if (!seen.has(id)) this.#riders.delete(id);
  }

  /**
   * Returns riders with smoothed `distance` and `lane` for the given time.
   * @param {number} nowS
   */
  sample(nowS) {
    const result = [];
    for (const entry of this.#riders.values()) {
      const { snapshot } = entry;
      const route = snapshot.route === null ? OPEN_ROAD : (this.routeOf(snapshot) ?? this.route);
      const age = Math.min(this.maxExtrapolationS, Math.max(0, nowS - entry.receivedAt));
      const target = route.wrap(snapshot.distance + snapshot.speed * age);

      const dt = Math.max(0, nowS - entry.sampledAt);
      const blend = 1 - Math.exp(-this.correctionRate * dt);
      const error = route.signedGap(entry.display, target);
      // Large jumps (e.g. teleport to the race start) are applied immediately.
      entry.display = Math.abs(error) > 50 ? target : route.wrap(entry.display + error * blend);
      entry.lane += (snapshot.lane - entry.lane) * blend;
      entry.sampledAt = nowS;

      const smoothed = { ...snapshot, distance: entry.display, lane: entry.lane };
      // Off every route a rider is placed by road: move them along it the same way.
      if (snapshot.route === null && snapshot.road) smoothed.road = { ...snapshot.road, offset: snapshot.road.offset + (entry.display - snapshot.distance) };
      result.push(smoothed);
    }
    return result;
  }
}
