/**
 * Golden lemons: a few lemons float over the road, each in one lane. Riding
 * through one in its lane collects it. Where they lie follows from the route
 * and the UTC day only, so every rider sees the same lemons without the
 * server, and they move every day. They grow back on every lap.
 * See docs/superpowers/specs/2026-11-10-golden-lemons-design.md.
 */
import { seededRandom } from "../view3d/noise.js";

export const LEMONS = Object.freeze({
  /** About one lemon per this many metres of route. */
  spacingM: 1500,
  min: 3,
  max: 24,
  /** No lemons this close to the start/finish line (the café, the arch). */
  clearM: 150,
  /** How far (in lanes) the rider may be from a lemon's lane and still catch it. */
  reach: 0.55,
  /** A move further than this between two updates is a jump, not riding. */
  maxStepM: 60,
});

const DAY_MS = 86_400_000;

/** The UTC day number of a time (ms since the epoch): lemons move at midnight UTC for everyone. */
export function lemonDay(ms) {
  return Math.floor(ms / DAY_MS);
}

/**
 * The day's lemons on a route, in riding order: one in each of `n` equal
 * stretches between the start and the finish, each on a whole lane.
 * @param {{id: string, seed: number, length: number, lanes: number}} route
 * @returns {{id: string, distance: number, lane: number}[]}
 */
export function lemonsFor(route, day) {
  const random = seededRandom(((route.seed >>> 0) ^ Math.imul(day + 1, 0x9e3779b1)) >>> 0);
  const usable = Math.max(0, route.length - 2 * LEMONS.clearM);
  const count = Math.min(LEMONS.max, Math.max(LEMONS.min, Math.round(route.length / LEMONS.spacingM)));
  const stretch = usable / count;
  const lemons = [];
  for (let i = 0; i < count; i += 1) {
    const distance = LEMONS.clearM + (i + 0.15 + random() * 0.7) * stretch;
    const lane = Math.min(route.lanes - 1, Math.floor(random() * route.lanes));
    lemons.push({ id: `${route.id}:${day}:${i}`, distance, lane });
  }
  return lemons;
}

/** The lemons of one route during a ride: which are collected, how many so far. */
export class LemonHunt {
  #last = null;

  /**
   * @param {{route: {id: string, length: number, loop: boolean, signedGap: Function, wrap: Function}, lemons: {id: string, distance: number, lane: number}[], total?: number}} options
   *        `total`: the rider's lemons from earlier rides.
   */
  constructor({ route, lemons, total = 0 }) {
    this.route = route;
    this.lemons = lemons.map((lemon) => ({ ...lemon, collected: false }));
    /** Collected on this route in this ride. */
    this.collected = 0;
    this.total = total;
  }

  /**
   * My rider's position; returns the lemons collected by this move.
   * @param {{routeId: ?string, distance: number, lane: number}} me
   */
  update({ routeId, distance, lane }) {
    const route = this.route;
    if (routeId !== route.id || !Number.isFinite(distance) || !Number.isFinite(lane)) {
      this.#last = null;
      return [];
    }
    const last = this.#last;
    this.#last = distance;
    if (last === null) return [];
    const step = route.signedGap(last, distance);
    if (step <= 0 || step > LEMONS.maxStepM) return [];

    // Over the line: the lemons are back for the new lap.
    if (route.loop && distance < last) for (const lemon of this.lemons) lemon.collected = false;

    const picked = [];
    for (const lemon of this.lemons) {
      if (lemon.collected || Math.abs(lane - lemon.lane) > LEMONS.reach) continue;
      // Ahead before the move, reached or passed after it.
      if (route.signedGap(last, lemon.distance) > 0 && route.signedGap(distance, lemon.distance) <= 0) {
        lemon.collected = true;
        picked.push(lemon);
      }
    }
    this.collected += picked.length;
    this.total += picked.length;
    return picked;
  }
}
