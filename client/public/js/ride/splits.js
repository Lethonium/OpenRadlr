/**
 * Splits and laps from recorded samples, the way a bike computer shows them.
 * Pure functions over `RideRecorder` samples and pauses; see
 * docs/superpowers/specs/2026-10-18-splits-laps-ride-history-design.md.
 *
 * A split closes at the first sample at or past its boundary (no
 * interpolation, at most one sample interval of error). Neighbouring splits
 * share that boundary sample.
 */

export const SPLIT_SETTINGS = ["auto", "lap", "1", "5", "10", "off"];

/** A stretch that left its route is cut after this many metres. */
export const FREE_CUT_M = 10_000;
/** A last stretch shorter than this merges into the split before it. */
export const MIN_TAIL_M = 200;
/** A ride that begins within this many metres past the line starts its first lap there. */
export const START_LINE_M = 50;

const AUTO_LAP_BELOW_M = 20_000;
const AUTO_TEN_ABOVE_M = 60_000;

/** The concrete mode ("lap", "1", "5", "10" or "off") for a profile setting and the route's loop length. */
export function resolveSplitMode(setting, routeLengthM) {
  if (setting !== "auto") return SPLIT_SETTINGS.includes(setting) ? setting : "5";
  if (!Number.isFinite(routeLengthM) || routeLengthM <= 0) return "5";
  if (routeLengthM < AUTO_LAP_BELOW_M) return "lap";
  if (routeLengthM > AUTO_TEN_ABOVE_M) return "10";
  return "5";
}

const routeOf = (sample) => sample.route ?? null;

/**
 * The splits of a ride.
 * @param {object[]} samples recorder samples
 * @param {{from: number, to: ?number}[]} pauses
 * @param {{mode: string, unitM?: number, routeLength?: (id: string) => ?number, final?: boolean}} options
 *        `final: false` is for a ride in progress: no tail merge, and the last
 *        element is the split still going on (shown only once it closes).
 */
export function computeSplits(samples, pauses, { mode, unitM = 1000, routeLength = () => null, final = true }) {
  if (mode === "off" || samples.length < 2) return [];
  const closed = (pauses ?? []).filter((pause) => pause.to !== null);
  const spans = (a, b) => closed.some((pause) => a.t <= pause.from && b.t >= pause.to);
  const lapMode = mode === "lap";
  const everyM = lapMode ? 0 : Number(mode) * unitM;
  if (!lapMode && !(everyM > 0)) return [];

  const crossing = (a, b) => {
    // After a pause (a rejoin) the rider may be anywhere: that is no line crossing.
    if (spans(a, b)) return false;
    const route = routeOf(a);
    if (route === null || route !== routeOf(b) || !Number.isFinite(a.routeM) || !Number.isFinite(b.routeM)) return false;
    const length = routeLength(route);
    if (!(length > 0)) return false;
    return b.routeM % length < (a.routeM % length) - length / 2;
  };

  const build = (startIndex, endIndex) => {
    const first = samples[startIndex];
    const last = samples[endIndex];
    let durationS = 0;
    let joules = 0;
    let gain = 0;
    let maxPower = 0;
    let hrSum = 0;
    let hrCount = 0;
    for (let i = startIndex; i <= endIndex; i += 1) {
      const sample = samples[i];
      maxPower = Math.max(maxPower, sample.power);
      if (sample.heartRate !== null && sample.heartRate !== undefined) {
        hrSum += sample.heartRate;
        hrCount += 1;
      }
      if (i === startIndex) continue;
      const prev = samples[i - 1];
      if (!spans(prev, sample)) {
        const dt = (sample.t - prev.t) / 1000;
        durationS += dt;
        joules += sample.power * dt;
      }
      if (sample.elevation !== null && prev.elevation !== null) gain += Math.max(0, sample.elevation - prev.elevation);
    }
    const distanceM = last.distance - first.distance;
    return {
      index: 0,
      kind: "free",
      route: null,
      lap: null,
      startIndex,
      endIndex,
      fromM: first.distance,
      toM: last.distance,
      startT: first.t,
      endT: last.t,
      durationS,
      distanceM,
      avgSpeed: durationS > 0 ? distanceM / durationS : 0,
      avgPower: durationS > 0 ? joules / durationS : 0,
      maxPower,
      avgHeartRate: hrCount ? hrSum / hrCount : null,
      elevationGainM: gain,
      partial: false,
    };
  };

  /** The route all samples startIndex..endIndex share, or null. */
  const sharedRoute = (startIndex, endIndex) => {
    const route = routeOf(samples[startIndex]);
    if (route === null) return null;
    for (let i = startIndex + 1; i <= endIndex; i += 1) if (routeOf(samples[i]) !== route) return null;
    return route;
  };

  const splits = [];
  let start = 0;
  // The ride starts at the line (within START_LINE_M) or joins mid-loop.
  const firstLength = routeLength(routeOf(samples[0]));
  let startedAtCrossing = firstLength > 0 && Number.isFinite(samples[0].routeM) && samples[0].routeM % firstLength <= START_LINE_M;
  let startRoute = routeOf(samples[0]);
  let left = startRoute === null; // the split has samples off its first route
  let nextBoundary = lapMode ? 0 : (Math.floor(samples[0].distance / everyM) + 1) * everyM;

  const close = (end, atCrossing) => {
    const split = build(start, end);
    if (lapMode) {
      const route = sharedRoute(start, end);
      if (startedAtCrossing && atCrossing && route !== null) {
        split.kind = "lap";
        split.route = route;
      }
    } else {
      split.kind = "distance";
    }
    splits.push(split);
    start = end;
    startedAtCrossing = atCrossing;
    startRoute = routeOf(samples[end]);
    left = startRoute === null;
  };

  for (let i = 1; i < samples.length; i += 1) {
    if (routeOf(samples[i]) !== startRoute) left = true;
    if (lapMode) {
      if (crossing(samples[i - 1], samples[i])) {
        close(i, true);
      } else if (
        left &&
        samples[i].distance - samples[start].distance >= FREE_CUT_M
      ) {
        close(i, false);
      }
    } else if (samples[i].distance >= nextBoundary) {
      close(i, false);
      nextBoundary = (Math.floor(samples[i].distance / everyM) + 1) * everyM;
    }
  }

  const last = samples.length - 1;
  if (start < last || !final) {
    const tail = build(start, last);
    const small = tail.distanceM < MIN_TAIL_M;
    if (final && small && splits.length > 0) {
      // Merge into the split before; a lap stays a lap only while the tail stays on its route.
      const previous = splits.pop();
      const merged = build(previous.startIndex, last);
      merged.kind = previous.kind;
      merged.partial = previous.partial;
      if (previous.kind === "lap") {
        if (sharedRoute(previous.endIndex, last) === previous.route) merged.route = previous.route;
        else merged.kind = "free";
      }
      if (!lapMode) merged.partial = merged.distanceM < everyM - 1e-6;
      splits.push(merged);
    } else {
      tail.kind = lapMode ? "free" : "distance";
      tail.partial = lapMode ? true : tail.distanceM < everyM - 1e-6;
      splits.push(tail);
    }
  }

  const laps = new Map();
  splits.forEach((split, i) => {
    split.index = i + 1;
    if (split.kind === "lap") {
      const n = (laps.get(split.route) ?? 0) + 1;
      laps.set(split.route, n);
      split.lap = n;
    }
  });
  return splits;
}

/**
 * How each split compares with the others: only laps and full distance splits
 * are comparable; the fastest is `best` (needs two to compare).
 * @returns {{comparable: boolean, best: boolean, speedDelta: ?number}[]}
 */
export function compareSplits(splits) {
  const comparable = splits.map((split) => split.kind === "lap" || (split.kind === "distance" && !split.partial));
  const speeds = splits.filter((_, i) => comparable[i]).map((split) => split.avgSpeed);
  const mean = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const top = speeds.length >= 2 ? Math.max(...speeds) : null;
  return splits.map((split, i) => ({
    comparable: comparable[i],
    best: comparable[i] && top !== null && split.avgSpeed === top,
    speedDelta: comparable[i] && mean > 0 ? split.avgSpeed / mean - 1 : null,
  }));
}
