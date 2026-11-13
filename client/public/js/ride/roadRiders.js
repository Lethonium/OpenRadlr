/**
 * Which riders of a road `state` belong to my route. The studio's mirrored
 * seats come without a route (like riders on their own road) but sit in the
 * building, so road panels, maps and drafting leave them out; the Riders
 * drawer lists their humans under the spin studio.
 */
import { t } from "../i18n/i18n.js";

/** True for riders on route `routeId` or on their own road; never for a studio seat. */
export function onRoute(rider, routeId) {
  return !rider.studio && (!rider.route || rider.route === routeId);
}

/** True for humans on another route or in the studio, listed apart in the Riders drawer. */
export function ridesElsewhere(rider, routeId) {
  return !rider.is_bot && !onRoute(rider, routeId);
}

/** What a rider elsewhere is listed under: the spin studio, or their route's name (its id if unknown). */
export function elsewhereName(rider, routes) {
  if (rider.studio) return t("panels.spinStudio");
  return routes.find((route) => route.id === rider.route)?.name ?? rider.route;
}
