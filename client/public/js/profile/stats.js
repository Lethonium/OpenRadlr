/**
 * Numbers for the profile page from the ride history: totals per week, month
 * and all rides, and how the FTP moved. Pure; the clock comes in as `nowMs`.
 * Weeks start on Monday 00:00 local time.
 */

import { estimateFtp } from "../ride/ftpEstimate.js";

/** Monday 00:00 local time of the week `nowMs` is in. */
export function weekStart(nowMs) {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  // Stepping by calendar days keeps a DST week at 7 local days.
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

/** The first of the month `nowMs` is in, 00:00 local time. */
export function monthStart(nowMs) {
  const date = new Date(nowMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

const finite = (value) => (Number.isFinite(value) ? value : 0);

function totals(records) {
  const sum = { rides: 0, distanceM: 0, durationS: 0, elevationGainM: 0 };
  for (const record of records) {
    sum.rides += 1;
    sum.distanceM += finite(record.distanceM);
    sum.durationS += finite(record.durationS);
    sum.elevationGainM += finite(record.elevationGainM);
  }
  return sum;
}

/** Totals of this week, this month and all rides. */
export function periodTotals(records, nowMs) {
  const week = weekStart(nowMs);
  const month = monthStart(nowMs);
  return {
    week: totals(records.filter((record) => record.startedAt >= week)),
    month: totals(records.filter((record) => record.startedAt >= month)),
    all: totals(records),
  };
}

/** The end of the week `t` is in: next Monday 00:00 local, minus 1 ms. */
function weekEnd(t) {
  const date = new Date(weekStart(t));
  date.setDate(date.getDate() + 7);
  return date.getTime() - 1;
}

/**
 * The FTP each ride was ridden with (tests marked), and the FTP estimated from
 * the rides at the end of every week that has one; both oldest first. A week
 * without a measured hard effort has `ftp: null`, a gap rather than a zero.
 */
export function ftpSeries(records, nowMs) {
  const oldestFirst = [...records].sort((a, b) => a.startedAt - b.startedAt);
  const set = oldestFirst
    .filter((record) => Number.isFinite(record.ftp))
    .map((record) => ({ t: record.startedAt, ftp: record.ftp, test: Boolean(record.test) }));
  const weeks = [...new Set(oldestFirst.map((record) => weekEnd(record.startedAt)))];
  const estimated = weeks.map((end) => {
    const t = Math.min(end, nowMs);
    const sofar = oldestFirst.filter((record) => record.startedAt <= t);
    return { t, ftp: estimateFtp(sofar, t)?.ftp ?? null };
  });
  return { set, estimated };
}

/** Whether there is enough to chart: FTP points in at least two different weeks. */
export function hasFtpChart({ set, estimated }) {
  const weeks = new Set([...set, ...estimated].filter((point) => Number.isFinite(point.ftp)).map((point) => weekStart(point.t)));
  return weeks.size >= 2;
}
