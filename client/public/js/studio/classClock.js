/**
 * Where a spin class stands. The server sends the class id and the seconds
 * since it started (negative during the lobby); the plan comes from
 * `/api/studio`. Targets are fractions of the rider's FTP.
 */

/**
 * @typedef {{duration_s: number, from: number, to: number, cadence: ?number[], cue: string}} ClassSegment
 * @typedef {{id: string, name: string, duration_s: number, segments: ClassSegment[]}} ClassPlan
 */

const totalOf = (plan) => plan.segments.reduce((sum, s) => sum + s.duration_s, 0);

/**
 * @param {ClassPlan} plan
 * @param {number} elapsedS seconds since the class started
 */
export function classPosition(plan, elapsedS) {
  const total = totalOf(plan);
  if (elapsedS < 0) {
    return { phase: "lobby", startsInS: Math.ceil(-elapsedS), target: null, cadence: null, cue: "Free spin: the class starts soon", next: plan.segments[0] ?? null };
  }
  if (elapsedS >= total) return { phase: "done", target: null, cadence: null, cue: "Class over: well done!", next: null };
  let start = 0;
  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index];
    if (elapsedS < start + segment.duration_s) {
      const t = (elapsedS - start) / segment.duration_s;
      return {
        phase: "class",
        index,
        segment,
        target: segment.from + (segment.to - segment.from) * t,
        cadence: segment.cadence ?? null,
        cue: segment.cue,
        blockRemainingS: Math.ceil(start + segment.duration_s - elapsedS),
        classRemainingS: Math.ceil(total - elapsedS),
        next: plan.segments[index + 1] ?? null,
      };
    }
    start += segment.duration_s;
  }
  return { phase: "done", target: null, cadence: null, cue: "Class over: well done!", next: null };
}

/** Target in watts, or null outside the class. */
export function targetWatts(target, ftp, intensity = 1) {
  return target === null || target === undefined ? null : Math.round(target * ftp * intensity);
}

const kindOf = (segment) => {
  if (segment.from !== segment.to) return "ramp";
  if (segment.from >= 1.05) return "on";
  if (segment.from <= 0.6) return "off";
  return "steady";
};

/** The plan as a workout, so the block chart (`drawWorkout`) can draw it. */
export function classWorkout(plan) {
  return {
    name: plan.name,
    segments: plan.segments.map((s) => ({ durationS: s.duration_s, from: s.from, to: s.to, label: s.cue, kind: kindOf(s) })),
  };
}
