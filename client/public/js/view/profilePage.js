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
 * @param {{profile: object, totals: ReturnType<import("../profile/stats.js").periodTotals>, bests: {routeId: string, durationS: number}[], routes: {id: string, name: string}[], locale?: string, unreadable?: boolean}} input `unreadable`: the history couldn't be read
 */
export function overviewLines({ profile, totals, bests, routes, locale, unreadable = false }) {
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
    empty: unreadable ? t("profilePage.unreadable") : totals.all.rides === 0 ? t("profilePage.overview.empty") : null,
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

/**
 * One row per ride (records come newest first); `device` only marks phone
 * paddles and the simulator. Workouts (yoga, bodyweight) share the history:
 * they show their plan and time, no ride figures (those are null).
 */
export function rideRows(records, routes, { locale } = {}) {
  return records.map((record) => (record.kind === "workout" ? workoutRow(record, locale) : {
    id: record.id,
    workout: false,
    date: rideDate(record.startedAt, locale),
    route: routeName(record.routeId, routes),
    distance: distance(Number.isFinite(record.distanceM) ? record.distanceM : 0),
    time: formatDuration(Number.isFinite(record.durationS) ? record.durationS : 0),
    power: Number.isFinite(record.avgPower) ? `${Math.round(record.avgPower)} W` : "–",
    climbing: formatElevation(Number.isFinite(record.elevationGainM) ? record.elevationGainM : 0),
    device: record.device === "paddle" || record.device === "sim" ? record.device : null,
  }));
}

function workoutRow(record, locale) {
  return {
    id: record.id,
    workout: true,
    date: rideDate(record.startedAt, locale),
    route: record.planName || t("profilePage.workout"),
    distance: null,
    time: formatDuration(Number.isFinite(record.durationS) ? record.durationS : 0),
    power: null,
    climbing: null,
    device: null,
  };
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

const CHART_PAD = { top: 8, right: 8, bottom: 20, left: 46 };

function chartDate(ms, locale) {
  const format = { day: "numeric", month: "short" };
  try {
    return new Date(ms).toLocaleDateString(locale, format);
  } catch {
    return new Date(ms).toLocaleDateString(undefined, format);
  }
}

/**
 * Where the FTP lines go on a `width` × `height` chart: set FTP as points
 * (tests marked), the estimate with `null` where a week has none (a gap in
 * the line), one watt axis padded by 10 W and rounded out to 10 W.
 * @param {ReturnType<import("../profile/stats.js").ftpSeries>} series
 */
export function ftpChartModel(series, width, height, { locale } = {}) {
  const points = [...series.set, ...series.estimated.filter((p) => Number.isFinite(p.ftp))];
  const watts = points.map((p) => p.ftp);
  const lo = Math.floor((Math.min(...watts) - 10) / 10) * 10;
  const hi = Math.ceil((Math.max(...watts) + 10) / 10) * 10;
  const times = [...series.set, ...series.estimated].map((p) => p.t);
  const t0 = Math.min(...times);
  const t1 = Math.max(t0 + 1, ...times);
  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;
  const x = (t) => CHART_PAD.left + ((t - t0) / (t1 - t0)) * plotW;
  const y = (w) => CHART_PAD.top + (1 - (w - lo) / (hi - lo)) * plotH;
  const mid = Math.round((lo + hi) / 20) * 10;
  return {
    set: series.set.map((p) => ({ x: x(p.t), y: y(p.ftp), test: Boolean(p.test) })),
    estimated: series.estimated.map((p) => (Number.isFinite(p.ftp) ? { x: x(p.t), y: y(p.ftp) } : null)),
    yTicks: [...new Set([lo, mid, hi])].map((w) => ({ y: y(w), label: `${w} W` })),
    xLabels: [t0, t1].map((t) => ({ x: x(t), label: chartDate(t, locale) })),
    plot: { left: CHART_PAD.left, right: width - CHART_PAD.right, top: CHART_PAD.top, bottom: height - CHART_PAD.bottom },
  };
}

/** The chart in words, for screen readers. */
export function ftpChartLabel(series) {
  const parts = [];
  if (series.set.length) parts.push(t("profilePage.ftp.chartSet", { from: series.set[0].ftp, to: series.set.at(-1).ftp }));
  const last = series.estimated.filter((p) => Number.isFinite(p.ftp)).at(-1);
  if (last) parts.push(t("profilePage.ftp.chartEstimate", { last: last.ftp }));
  return t("profilePage.ftp.chart", { parts: parts.join(", ") });
}

/**
 * Paints the model: recessive grid and labels, set FTP as a solid step line
 * with a ring on each FTP test, the estimate dashed and broken at gaps.
 * @param {{set: string, estimate: string, grid: string, muted: string, surface: string}} colors
 */
export function paintFtpChart(ctx, model, colors) {
  const { plot } = model;
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of model.yTicks) {
    ctx.beginPath();
    ctx.moveTo(plot.left, tick.y);
    ctx.lineTo(plot.right, tick.y);
    ctx.stroke();
    ctx.fillText(tick.label, plot.left - 6, tick.y);
  }
  ctx.textBaseline = "alphabetic";
  model.xLabels.forEach((label, i) => {
    ctx.textAlign = i === 0 ? "left" : "right";
    ctx.fillText(label.label, label.x, plot.bottom + 15);
  });

  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = colors.estimate;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  let drawing = false;
  for (const p of model.estimated) {
    if (!p) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    drawing = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = colors.set;
  ctx.beginPath();
  model.set.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else {
      ctx.lineTo(p.x, model.set[i - 1].y);
      ctx.lineTo(p.x, p.y);
    }
  });
  if (model.set.length) ctx.lineTo(plot.right, model.set.at(-1).y);
  ctx.stroke();
  for (const p of model.set.filter((point) => point.test)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.set;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.surface;
    ctx.stroke();
  }
}
