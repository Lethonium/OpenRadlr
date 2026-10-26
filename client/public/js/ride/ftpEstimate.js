/**
 * FTP estimated from the rider's own ride history (#48): the best mean power
 * per duration over the last 90 days gives a critical-power fit, or the
 * 20 minute rule when only that effort is known. Pure functions on ride
 * records (see rideHistory.js).
 */

export const CP_TO_FTP = 0.97;
export const TWENTY_MIN_TO_FTP = 0.95;
export const ESTIMATE_WINDOW_DAYS = 90;
export const MIN_RISE_W = 5;
export const MIN_RISE_FRACTION = 0.03;

const FIT_DURATIONS = [180, 300, 480, 720, 1200];
const TWENTY_MIN_S = 1200;
const MIN_SPAN = 2;
const FTP_RANGE = [50, 600];
const DAY_MS = 86400000;

/** Best value per fit duration over the measured records of the window, as [seconds, watts][]. */
function pooledEfforts(records, nowMs, sinceMs) {
  const since = Math.max(nowMs - ESTIMATE_WINDOW_DAYS * DAY_MS, sinceMs);
  const best = new Map();
  for (const record of records) {
    if (!record?.curve || !record.measured || !(record.startedAt >= since)) continue;
    for (const seconds of FIT_DURATIONS) {
      const watts = record.curve[seconds];
      if (Number.isFinite(watts) && watts > (best.get(seconds) ?? 0)) best.set(seconds, watts);
    }
  }
  return [...best];
}

/** Least squares of work (P · t) against t: slope is CP, intercept W'. */
function fitCriticalPower(efforts) {
  const n = efforts.length;
  let sumT = 0;
  let sumW = 0;
  let sumTT = 0;
  let sumTW = 0;
  for (const [t, p] of efforts) {
    sumT += t;
    sumW += p * t;
    sumTT += t * t;
    sumTW += t * p * t;
  }
  const slope = (n * sumTW - sumT * sumW) / (n * sumTT - sumT * sumT);
  return { cp: slope, wPrime: (sumW - slope * sumT) / n };
}

/**
 * @param {object[]} records ride records
 * @param {number} nowMs
 * @param {{since?: number}} [options] since: ignore rides started before this time (ms)
 * @returns {?{ftp: number, cp?: number, wPrime?: number, basis: "cp" | "twenty"}}
 */
export function estimateFtp(records, nowMs, { since = 0 } = {}) {
  const efforts = pooledEfforts(records, nowMs, since);
  if (efforts.length >= 2) {
    const seconds = efforts.map(([t]) => t);
    if (Math.max(...seconds) >= MIN_SPAN * Math.min(...seconds)) {
      const { cp, wPrime } = fitCriticalPower(efforts);
      if (cp > 0 && wPrime >= 0) return { ftp: Math.round(cp * CP_TO_FTP), cp, wPrime, basis: "cp" };
    }
  }
  const twenty = efforts.find(([t]) => t === TWENTY_MIN_S);
  if (twenty) return { ftp: Math.round(twenty[1] * TWENTY_MIN_TO_FTP), basis: "twenty" };
  return null;
}

/**
 * The estimate as an offer to raise the profile FTP; never lowers it, and
 * stays quiet about an estimate the rider already dismissed. `since` keeps rides from
 * before the current FTP was set out of the estimate.
 * @returns {?{ftp: number, delta: number, basis: "cp" | "twenty"}}
 */
export function suggestFtp(records, { ftp, dismissed = null, since = 0 }, nowMs) {
  const result = estimateFtp(records, nowMs, { since });
  if (!result) return null;
  if (result.ftp < ftp + Math.max(MIN_RISE_W, ftp * MIN_RISE_FRACTION)) return null;
  if (result.ftp < FTP_RANGE[0] || result.ftp > FTP_RANGE[1]) return null;
  if (!(result.ftp > (dismissed ?? 0))) return null;
  return { ftp: result.ftp, delta: result.ftp - ftp, basis: result.basis };
}
