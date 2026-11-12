/**
 * Which riders of a road `state` belong to my route. The studio's mirrored
 * seats come without a route (like riders on their own road) but sit in the
 * building, so road panels, maps and drafting leave them out.
 */

/** True for riders on route `routeId` or on their own road; never for a studio seat. */
export function onRoute(rider, routeId) {
  return !rider.studio && (!rider.route || rider.route === routeId);
}

/** True for humans on another route, listed under that route's name. */
export function ridesElsewhere(rider, routeId) {
  return !rider.is_bot && !rider.studio && !onRoute(rider, routeId);
}
