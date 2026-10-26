/**
 * Power curve, weighted power and load from recorded samples.
 * Pure functions over `RideRecorder` samples and pauses; see
 * docs/superpowers/specs/2026-10-19-ftp-estimation-design.md.
 *
 * Each stretch between pauses is resampled to 1 Hz so windows are counted in
 * seconds whatever the sample interval was.
 */

/** Durations of the power curve, in seconds. */
export const CURVE_DURATIONS = [5, 15, 60, 180, 300, 480, 720, 1200, 1800, 3600];
/** Power spikes (a bad sensor reading) count as at most this many watts. */
export const POWER_CAP_W = 2000;
/** A gap between samples longer than this splits the stretch. */
const MAX_GAP_S = 5;
/** Rolling window of weighted power, in seconds. */
const WEIGHTED_WINDOW_S = 30;

/** Whether the interval between two samples spans a closed pause (as in RideRecorder#spansPause). */
const spansPause = (a, b, pauses) => pauses.some((pause) => pause.to !== null && a.t <= pause.from && b.t >= pause.to);

/** The samples split at closed pauses and at gaps over MAX_GAP_S. */
function stretches(samples, pauses) {
  const result = [];
  let current = [];
  for (const sample of samples) {
    const last = current.at(-1);
    if (last && (sample.t - last.t > MAX_GAP_S * 1000 || spansPause(last, sample, pauses))) {
      result.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length) result.push(current);
  return result;
}

/** One stretch as 1 Hz watts, holding the last value between samples. */
function resample(stretch) {
  const seconds = Math.floor((stretch.at(-1).t - stretch[0].t) / 1000) + 1;
  const watts = [];
  let next = 0;
  for (let s = 0; s < seconds; s += 1) {
    const t = stretch[0].t + s * 1000;
    while (next + 1 < stretch.length && stretch[next + 1].t <= t) next += 1;
    watts.push(Math.min(POWER_CAP_W, stretch[next].power));
  }
  return watts;
}

/**
 * 1 Hz power in watts for each stretch between pauses.
 * @param {{t: number, power: number}[]} samples
 * @param {{from: number, to: ?number}[]} pauses
 * @returns {number[][]}
 */
export function powerSeries(samples, pauses) {
  return stretches(samples, pauses).map(resample);
}

/** Running totals, so any window sum is two lookups. */
function prefixSums(values) {
  const sums = [0];
  for (const v of values) sums.push(sums.at(-1) + v);
  return sums;
}

/**
 * Best average power for each of CURVE_DURATIONS, in whole watts; null when no stretch is that long.
 * @returns {Object<number, ?number>}
 */
export function bestEfforts(samples, pauses) {
  const best = Object.fromEntries(CURVE_DURATIONS.map((d) => [d, null]));
  for (const series of powerSeries(samples, pauses)) {
    const sums = prefixSums(series);
    for (const d of CURVE_DURATIONS) {
      for (let end = d; end <= series.length; end += 1) {
        const mean = (sums[end] - sums[end - d]) / d;
        if (best[d] === null || mean > best[d]) best[d] = mean;
      }
    }
  }
  for (const d of CURVE_DURATIONS) if (best[d] !== null) best[d] = Math.round(best[d]);
  return best;
}

/**
 * Weighted power: the 4th root of the mean 4th power of the 30 s rolling mean,
 * so hard surges count for more than easy riding. Null under 30 s of riding.
 * @returns {?number}
 */
export function weightedPower(samples, pauses) {
  let total = 0;
  let count = 0;
  for (const series of powerSeries(samples, pauses)) {
    const sums = prefixSums(series);
    for (let end = WEIGHTED_WINDOW_S; end <= series.length; end += 1) {
      total += ((sums[end] - sums[end - WEIGHTED_WINDOW_S]) / WEIGHTED_WINDOW_S) ** 4;
      count += 1;
    }
  }
  return count ? Math.round((total / count) ** 0.25) : null;
}

/**
 * How hard a ride was relative to FTP: 100 for an hour at FTP. One decimal; null when an input is missing.
 * @param {{weightedPower: ?number, durationS: ?number, ftp: ?number}} ride
 * @returns {?number}
 */
export function rideLoad({ weightedPower: wp, durationS, ftp }) {
  if (!Number.isFinite(wp) || !Number.isFinite(durationS) || !Number.isFinite(ftp) || ftp === 0) return null;
  return Math.round((durationS / 3600) * (wp / ftp) ** 2 * 1000) / 10;
}
