/**
 * The profile dialog's pages (Overview, Rides, Your data): pure builders of
 * the lines shown, from the ride history, the best laps and the profile.
 * main.js reads the stores and writes these into the markup with textContent.
 */

import { t, tn } from "../i18n/i18n.js";
import { formatDistanceWithUnit, formatDuration, formatElevation } from "../util/format.js";
import { levelLabel } from "../profile/level.js";
import { ftpProvenance } from "./ftpProvenance.js";

export const PROFILE_PAGES = ["overview", "rides", "data"];

/** The server's name of a route, Studio for studio rides, else the id (a route this server doesn't offer). */
export function routeName(routeId, routes) {
  if (routeId === null || routeId === undefined) return t("profilePage.studio");
  return routes.find((route) => route.id === routeId)?.name ?? routeId;
}

/** "62.0 km", or without decimals from 100 km on. */
function distance(metres) {
  return formatDistanceWithUnit(metres, metres < 100000 ? 1 : 0);
}

function totalsValue(sum) {
  return [tn("profilePage.rideCount", sum.rides), distance(sum.distanceM), formatDuration(sum.durationS), formatElevation(sum.elevationGainM)].join(" · ");
}

/**
 * The Overview page's lines.
 * @param {{profile: object, totals: ReturnType<import("../profile/stats.js").periodTotals>, bests: {routeId: string, durationS: number}[], routes: {id: string, name: string}[], locale?: string}} input
 */
export function overviewLines({ profile, totals, bests, routes, locale }) {
  const name = profile.name || t("profilePage.noName");
  const level = Number.isFinite(profile.levelW) && profile.weightKg > 0 ? levelLabel(profile.levelW, profile.weightKg) : null;
  return {
    rider: level ? `${name} · ${level}` : name,
    ftp: `${t("profilePage.ftp", { watts: Math.round(profile.ftp) })} · ${ftpProvenance(profile, { locale })}`,
    totals: [
      { label: t("profilePage.week"), value: totalsValue(totals.week) },
      { label: t("profilePage.month"), value: totalsValue(totals.month) },
      { label: t("profilePage.all"), value: totalsValue(totals.all) },
    ],
    bests: bests.map((best) => `${routeName(best.routeId, routes)} · ${formatDuration(best.durationS)}`),
    empty: totals.all.rides === 0 ? t("profilePage.overview.empty") : null,
  };
}
