/**
 * Personal milestones shown as a banner while riding: round distances in all
 * (in the rider's unit), every Everest climbed in all, and the first time over
 * the top of a climb. Totals come from the kept rides (ride history); summits
 * already reached are a set kept by the caller. Pure logic.
 * See docs/superpowers/specs/2026-11-10-banners-design.md.
 */

/** Height of Mount Everest in metres. */
export const EVEREST_M = 8849;

const ROUND = [100, 250, 500, 1000, 2500, 5000, 10_000];
/** A move further than this between two updates is a jump, not riding over a top. */
const MAX_STEP_M = 60;

/** Distance milestones (in units) up to `upTo`: round numbers, then every 10,000. */
export function distanceSteps(upTo) {
  const steps = [...ROUND];
  for (let next = 20_000; next <= upTo; next += 10_000) steps.push(next);
  return steps;
}

/** All-time distance and climbing of the kept rides. */
export function lifetimeTotals(records) {
  let distanceM = 0;
  let climbedM = 0;
  for (const record of records) {
    if (Number.isFinite(record.distanceM)) distanceM += record.distanceM;
    if (Number.isFinite(record.elevationGainM)) climbedM += record.elevationGainM;
  }
  return { distanceM, climbedM };
}

/** Watches one ride for milestones. */
export class MilestoneWatch {
  #ride = { distanceM: 0, climbedM: 0 };
  #last = null;

  /**
   * @param {{totals: ?{distanceM: number, climbedM: number}, unitM: number, summits: Set<string>}} options
   *        `totals`: all rides before this one (null until known); `unitM`: metres per km or mile;
   *        `summits`: "routeId:metres" of the tops reached before, updated here.
   */
  constructor({ totals, unitM, summits }) {
    this.totals = totals;
    this.unitM = unitM;
    this.summits = summits;
  }

  /**
   * The ride so far and, while on a route, where on it; returns the milestones reached since the last update.
   * @returns {({kind: "distance" | "everest", value: number} | {kind: "summit", route: string, key: string})[]}
   */
  update({ rideDistanceM, rideClimbedM, route = null, routeM = null }) {
    const reached = [];
    const before = this.#ride;
    this.#ride = { distanceM: rideDistanceM, climbedM: rideClimbedM };
    if (this.totals) {
      const from = (this.totals.distanceM + before.distanceM) / this.unitM;
      const to = (this.totals.distanceM + rideDistanceM) / this.unitM;
      const passed = distanceSteps(to).filter((step) => from < step && step <= to);
      if (passed.length) reached.push({ kind: "distance", value: passed.at(-1) });
      const everests = Math.floor((this.totals.climbedM + rideClimbedM) / EVEREST_M);
      if (everests > Math.floor((this.totals.climbedM + before.climbedM) / EVEREST_M)) reached.push({ kind: "everest", value: everests });
    }
    reached.push(...this.#summits(route, routeM));
    return reached;
  }

  #summits(route, routeM) {
    const last = this.#last;
    this.#last = route && Number.isFinite(routeM) ? { routeId: route.id, routeM } : null;
    if (!route || !last || last.routeId !== route.id || !Number.isFinite(routeM)) return [];
    const step = route.signedGap(last.routeM, routeM);
    if (step <= 0 || step > MAX_STEP_M) return [];
    const reached = [];
    for (const marker of route.markers) {
      if (marker.type !== "climb") continue;
      const top = route.wrap(marker.distance + (marker.length ?? 0));
      if (!(route.signedGap(last.routeM, top) > 0 && route.signedGap(routeM, top) <= 0)) continue;
      const key = `${route.id}:${Math.round(top)}`;
      if (this.summits.has(key)) continue;
      this.summits.add(key);
      reached.push({ kind: "summit", route: route.name, key });
    }
    return reached;
  }
}
