/**
 * Riding level: the power the rider can really hold, estimated from rides.
 * It starts at FTP, creeps up with hard 20-minute efforts and follows races.
 * The server uses it to size bots and groups (`level_w` in "join").
 */

import { t } from "../i18n/i18n.js";
import { formatNumber } from "../util/format.js";

export const LEVEL_STEP = 0.05;
const WINDOW_MS = 20 * 60 * 1000;
const SAMPLE_MS = 1000;
const RIDE_FACTOR = 0.95;

/** The level a profile rides at: the estimate if there is one, else FTP. */
export function levelOf(profile) {
  return profile.levelW ?? profile.ftp;
}

/**
 * Best average power over any 20 minutes.
 * @param {{t: number, power: number}[]} samples about 1 Hz, `t` in ms
 * @returns {number | null} null when the ride covers less than 20 minutes
 */
export function best20MinPower(samples) {
  const n = samples.length;
  if (n === 0 || samples[n - 1].t - samples[0].t + SAMPLE_MS < WINDOW_MS) return null;
  let best = null;
  let sum = 0;
  let start = 0;
  for (let end = 0; end < n; end++) {
    sum += samples[end].power || 0;
    while (samples[end].t - samples[start].t >= WINDOW_MS) sum -= samples[start++].power || 0;
    if (samples[end].t - samples[0].t + SAMPLE_MS < WINDOW_MS) continue;
    const average = sum / (end - start + 1);
    if (best === null || average > best) best = average;
  }
  return best;
}

/** After a ride: up toward 95 % of the best 20 minutes, by at most 5 %, never down. */
export function levelAfterRide(level, samples) {
  const best = best20MinPower(samples);
  if (best === null) return level;
  const target = best * RIDE_FACTOR;
  return target <= level ? level : Math.min(target, level * (1 + LEVEL_STEP));
}

/** After a race: toward the race average, by at most 5 % either way. */
export function levelAfterRace(level, avgPower) {
  if (!Number.isFinite(avgPower) || avgPower <= 0) return level;
  return Math.min(level * (1 + LEVEL_STEP), Math.max(level * (1 - LEVEL_STEP), avgPower));
}

export function levelLabel(levelW, weightKg) {
  return t("rider.level", { wkg: formatNumber(levelW / weightKg, 1) });
}
