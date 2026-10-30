/**
 * Ramp test: a step-up ramp ridden in ERG mode, one minute per step, until the
 * rider can no longer hold the target. FTP is estimated from the best minute.
 * Pure functions; the caller owns the clock and the ride.
 */

import { bestEfforts } from "./powerAnalysis.js";
import { createWorkout, steady } from "./workout.js";
import { ERG_LIMITS } from "./trainingControl.js";
import { t } from "../i18n/i18n.js";

export const RAMP_TO_FTP = 0.75;
export const FAIL_BELOW = 0.85;
export const FAIL_HOLD_S = 10;
export const FAIL_GRACE_S = 60;
export const MIN_RAMP_S = 300;

const STEP_S = 60;
const RAMP_MAX_W = 600;
const MIN_FTP_W = 50;
const MAX_FTP_W = 600;
const MIN_WARMUP_BEST_W = 40;
const DEFAULT_START = Object.freeze({ startW: ERG_LIMITS.min, stepW: 10 });
const MAX_FRACTION = 3; // createWorkout rejects anything above 300 % FTP

const roundTo = (value, step) => Math.round(value / step) * step;

/**
 * Start power and step size from the best minute of the warmup: start at
 * about 60 % of it, step so the ramp spans roughly eight minutes of rise.
 * @param {{t: number, power: number}[]} warmupSamples
 * @returns {{startW: number, stepW: number}}
 */
export function suggestStart(warmupSamples) {
  const best = bestEfforts(warmupSamples, [])[60];
  if (best === null || best < MIN_WARMUP_BEST_W) return { ...DEFAULT_START };
  const startW = Math.max(ERG_LIMITS.min, roundTo(0.6 * best, 5));
  const stepW = Math.min(30, Math.max(10, roundTo(startW / 8, 5)));
  return { startW, stepW };
}

/** One-minute steady blocks from `startW` in `stepW` steps up to 600 W, as fractions of `ftp`. */
export function buildRamp({ startW, stepW, ftp }) {
  const segments = [];
  for (let watts = startW; watts <= RAMP_MAX_W && watts / ftp <= MAX_FRACTION; watts += stepW) {
    segments.push(steady(STEP_S, watts / ftp, `${watts} W`));
  }
  for (const segment of segments) segment.kind = "test";
  return createWorkout({ name: t("ftp.ramp.name"), segments });
}

/** The ERG target `elapsedS` seconds into the ramp. */
export const rampTargetAt = (startW, stepW, elapsedS) => startW + Math.floor(elapsedS / STEP_S) * stepW;

/**
 * Seconds into the ramp at which the rider had been below FAIL_BELOW of the
 * target for FAIL_HOLD_S in a row (ignoring the first FAIL_GRACE_S); null if never.
 * @param {{elapsedS: number, power: number}[]} rampSamples
 */
export function detectFailure(rampSamples, { startW, stepW }) {
  let belowSince = null;
  for (const { elapsedS, power } of rampSamples) {
    if (elapsedS < FAIL_GRACE_S) continue;
    if (power < FAIL_BELOW * rampTargetAt(startW, stepW, elapsedS)) {
      belowSince ??= elapsedS;
      if (elapsedS - belowSince >= FAIL_HOLD_S) return elapsedS;
    } else {
      belowSince = null;
    }
  }
  return null;
}

/**
 * FTP from the best rolling minute of the ramp; null when the ramp was too
 * short or the result is outside the range a profile accepts.
 * @param {{elapsedS: number, power: number}[]} rampSamples
 * @returns {?{ftp: number, bestMinuteW: number, durationS: number}}
 */
export function rampResult(rampSamples) {
  if (rampSamples.length < STEP_S) return null;
  const durationS = rampSamples.at(-1).elapsedS;
  if (durationS < MIN_RAMP_S) return null;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < rampSamples.length; i += 1) {
    sum += rampSamples[i].power;
    if (i >= STEP_S) sum -= rampSamples[i - STEP_S].power;
    if (i >= STEP_S - 1) best = Math.max(best, sum / STEP_S);
  }
  const bestMinuteW = Math.round(best);
  const ftp = Math.round(RAMP_TO_FTP * bestMinuteW);
  if (ftp < MIN_FTP_W || ftp > MAX_FTP_W) return null;
  return { ftp, bestMinuteW, durationS };
}
