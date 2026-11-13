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
export const RIDES_PAGE_SIZE = 20;

const CURVE_KEYS = [5, 60, 300, 1200];

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

/** "Tue 10 Nov" in the rider's language. */
function rideDate(ms, locale) {
  const format = { weekday: "short", day: "numeric", month: "short" };
  const when = new Date(ms);
  try {
    return when.toLocaleDateString(locale, format);
  } catch {
    // A malformed browser locale (e.g. "en-US@posix") throws a RangeError
    return when.toLocaleDateString(undefined, format);
  }
}

/** One row per ride (records come newest first); `device` only marks phone paddles and the simulator. */
export function rideRows(records, routes, { locale } = {}) {
  return records.map((record) => ({
    id: record.id,
    date: rideDate(record.startedAt, locale),
    route: routeName(record.routeId, routes),
    distance: distance(Number.isFinite(record.distanceM) ? record.distanceM : 0),
    time: formatDuration(Number.isFinite(record.durationS) ? record.durationS : 0),
    power: Number.isFinite(record.avgPower) ? `${Math.round(record.avgPower)} W` : "–",
    climbing: formatElevation(Number.isFinite(record.elevationGainM) ? record.elevationGainM : 0),
    device: record.device === "paddle" || record.device === "sim" ? record.device : null,
  }));
}

function curveLabel(seconds) {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}

/** The power curve's key points (5 s, 1, 5 and 20 min) and the longest effort the ride has. */
export function curveRows(curve) {
  if (!curve) return [];
  const known = Object.keys(curve).map(Number).filter((seconds) => Number.isFinite(curve[seconds])).sort((a, b) => a - b);
  const shown = new Set(CURVE_KEYS.filter((seconds) => known.includes(seconds)));
  if (known.length) shown.add(known.at(-1));
  return [...shown].sort((a, b) => a - b).map((seconds) => ({ label: curveLabel(seconds), watts: `${Math.round(curve[seconds])} W` }));
}

const DATA_NAMES = {
  profile: "profilePage.data.profile",
  rides: "profilePage.data.rides",
  bestLaps: "profilePage.data.bestLaps",
  progress: "profilePage.data.progress",
  unfinished: "profilePage.data.unfinished",
  settings: "profilePage.data.settings",
};

const DATA_DETAILS = {
  profile: "profilePage.data.profile.detail",
  rides: "profilePage.data.rides.detail",
  bestLaps: "profilePage.data.bestLaps.detail",
  progress: "profilePage.data.progress.detail",
  unfinished: "profilePage.data.unfinished.detail",
  settings: "profilePage.data.settings.detail",
};

function dataCount({ id, count }) {
  switch (id) {
    case "profile":
      return count ? t("profilePage.data.saved") : t("profilePage.data.none");
    case "rides":
      return tn("profilePage.rideCount", count);
    case "bestLaps":
      return tn("profilePage.data.bestLapCount", count);
    case "progress":
      return t("profilePage.data.progressCount", count);
    case "unfinished":
      return count ? t("profilePage.data.unfinishedOne") : t("profilePage.data.none");
    default:
      return tn("profilePage.data.entries", count);
  }
}

const hasAny = (count) => (typeof count === "object" && count !== null ? count.summits + count.lemons > 0 : count > 0);

/** The "Your data" rows from `inventory` (profile/localData.js). */
export function dataRows(items) {
  return items.map((item) => {
    const name = t(DATA_NAMES[item.id]);
    const action = item.id === "profile" ? t("profilePage.data.reset") : t("profilePage.data.delete");
    return {
      id: item.id,
      name,
      detail: t(DATA_DETAILS[item.id]),
      count: item.readable ? dataCount(item) : t("profilePage.data.unreadable"),
      canDelete: item.readable && hasAny(item.count),
      action,
      actionLabel: `${action} ${name}`,
    };
  });
}
