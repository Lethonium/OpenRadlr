/**
 * Live figures for the in-game menu, computed from the recording so far.
 * Pure: builds on RideRecorder#summary and powerAnalysis.js.
 */
import { bestEfforts, weightedPower, rideLoad } from "./powerAnalysis.js";

/** Durations shown as live efforts, in seconds. */
const EFFORT_WINDOWS_S = [5, 60, 300, 1200];

/**
 * @param {{summary: object, samples: object[], pauses: object[], ftp: ?number}} recording
 * @returns {{elapsedS: number, distanceM: number, climbedM: number, kJ: number, avgHeartRate: ?number,
 *   avgPower: number, weightedPower: number, load: ?number, efforts: {s: number, w: number}[]}}
 */
export function liveStats({ summary, samples, pauses, ftp }) {
  const best = bestEfforts(samples, pauses);
  const wp = weightedPower(samples, pauses);
  return {
    elapsedS: summary.durationS,
    distanceM: summary.distanceM,
    climbedM: summary.elevationGainM,
    kJ: summary.kilojoules,
    avgHeartRate: summary.avgHeartRate,
    avgPower: summary.avgPower,
    weightedPower: wp ?? 0,
    load: rideLoad({ weightedPower: wp, durationS: summary.durationS, ftp }),
    efforts: EFFORT_WINDOWS_S.filter((s) => best[s] !== null).map((s) => ({ s, w: best[s] })),
  };
}

/**
 * Power of the last `windowS` seconds for a chart, oldest first.
 * @returns {{t: number, w: number}[]} t is seconds before the newest sample
 */
export function powerWindow(samples, { windowS = 600 } = {}) {
  if (samples.length === 0) return [];
  const now = samples.at(-1).t;
  return samples.filter((s) => now - s.t <= windowS * 1000).map((s) => ({ t: (now - s.t) / 1000, w: s.power }));
}
