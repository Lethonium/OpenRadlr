/**
 * Structured workouts for ERG mode.
 *
 * A workout is a list of segments. Each segment lasts `durationS` and ramps
 * its target linearly from `from` to `to`, both as a fraction of FTP
 * (1.0 = 100 % FTP). Steady blocks have from === to. Intervals are expanded
 * into alternating on/off segments when the workout is created.
 */

/**
 * @typedef {{durationS: number, from: number, to: number, label: string, kind: string}} Segment
 * @typedef {{name: string, description?: string, segments: Segment[]}} Workout
 */

const MAX_SEGMENTS = 500;
const MAX_DURATION_S = 6 * 3600;

export const steady = (durationS, power, label = "Steady") => ({ durationS, from: power, to: power, label, kind: "steady" });
export const ramp = (durationS, from, to, label = "Ramp", kind = "ramp") => ({ durationS, from, to, label, kind });

/** `repeat` times (on, off), labelled "Interval 1/5" etc. */
export function intervals(repeat, onS, onPower, offS, offPower) {
  const segments = [];
  for (let i = 1; i <= repeat; i += 1) {
    segments.push({ durationS: onS, from: onPower, to: onPower, label: `Interval ${i}/${repeat}`, kind: "on" });
    if (offS > 0) segments.push({ durationS: offS, from: offPower, to: offPower, label: `Recovery ${i}/${repeat}`, kind: "off" });
  }
  return segments;
}

/** Validates and normalises a workout; throws with a readable message. */
export function createWorkout({ name, description = "", segments }) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("A workout needs at least one block.");
  if (segments.length > MAX_SEGMENTS) throw new Error(`A workout may have at most ${MAX_SEGMENTS} blocks.`);
  const clean = segments.map((segment, index) => {
    const durationS = Math.round(Number(segment.durationS));
    const from = Number(segment.from);
    const to = Number(segment.to ?? segment.from);
    if (!(durationS > 0)) throw new Error(`Block ${index + 1} has no duration.`);
    if (![from, to].every((p) => Number.isFinite(p) && p >= 0 && p <= 3)) throw new Error(`Block ${index + 1} has an invalid power.`);
    return { durationS, from, to, label: String(segment.label ?? "Block"), kind: String(segment.kind ?? "steady") };
  });
  const total = clean.reduce((sum, s) => sum + s.durationS, 0);
  if (total > MAX_DURATION_S) throw new Error("Workouts may be at most 6 hours long.");
  return { name: String(name || "Workout").slice(0, 80), description: String(description).slice(0, 500), segments: clean };
}

export const totalDuration = (workout) => workout.segments.reduce((sum, s) => sum + s.durationS, 0);

/**
 * Where we are in a workout after `elapsedS` seconds.
 * @returns {{finished: boolean, index: number, segment: Segment | null, fraction: number,
 *            segmentRemainingS: number, remainingS: number}}
 */
export function positionAt(workout, elapsedS) {
  let start = 0;
  const total = totalDuration(workout);
  for (let index = 0; index < workout.segments.length; index += 1) {
    const segment = workout.segments[index];
    if (elapsedS < start + segment.durationS) {
      const into = Math.max(0, elapsedS - start);
      const progress = into / segment.durationS;
      return {
        finished: false,
        index,
        segment,
        fraction: segment.from + (segment.to - segment.from) * progress,
        segmentRemainingS: segment.durationS - into,
        remainingS: total - Math.max(0, elapsedS),
      };
    }
    start += segment.durationS;
  }
  return { finished: true, index: workout.segments.length, segment: null, fraction: 0, segmentRemainingS: 0, remainingS: 0 };
}

/**
 * Runs a workout against a clock. Pausing (e.g. when the rider stops
 * pedalling) freezes the workout time.
 */
export class WorkoutPlayer {
  #elapsed = 0;
  #lastTick = null;
  paused = false;

  /** @param {Workout} workout @param {number} ftp watts */
  constructor(workout, ftp) {
    this.workout = workout;
    this.ftp = ftp;
  }

  get elapsedS() {
    return this.#elapsed;
  }

  /** Advances the workout clock to `nowS`. */
  tick(nowS) {
    if (this.#lastTick !== null && !this.paused) this.#elapsed += Math.max(0, nowS - this.#lastTick);
    this.#lastTick = nowS;
    return this.state();
  }

  skipSegment() {
    const position = positionAt(this.workout, this.#elapsed);
    if (!position.finished) this.#elapsed += position.segmentRemainingS;
  }

  state() {
    const position = positionAt(this.workout, this.#elapsed);
    return { ...position, targetWatts: Math.round(position.fraction * this.ftp), elapsedS: this.#elapsed };
  }
}

// ------------------------------------------------------------------ .zwo ---

const decodeEntities = (text) =>
  text.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[entity]);

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g)) result[match[1].toLowerCase()] = decodeEntities(match[2]);
  return result;
}

const number = (value, fallback = NaN) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Parses the subset of the Zwift workout format (.zwo) that matters for ERG:
 * Warmup, Cooldown, Ramp, SteadyState, IntervalsT, FreeRide, MaxEffort.
 * Unknown elements (text events, cadence hints) are ignored.
 * @param {string} xml
 * @returns {Workout}
 */
export function parseZwo(xml) {
  if (typeof xml !== "string" || !/<workout_file[\s>]/i.test(xml)) throw new Error("This is not a .zwo workout file.");
  const name = decodeEntities(/<name>([\s\S]*?)<\/name>/i.exec(xml)?.[1]?.trim() ?? "Imported workout");
  const description = decodeEntities(/<description>([\s\S]*?)<\/description>/i.exec(xml)?.[1]?.trim() ?? "");
  const body = /<workout>([\s\S]*?)<\/workout>/i.exec(xml)?.[1];
  if (!body) throw new Error("The workout file has no <workout> section.");

  const segments = [];
  for (const match of body.matchAll(/<(\w+)([^>]*?)\/?>/g)) {
    const tag = match[1].toLowerCase();
    const a = attributes(match[2]);
    const duration = number(a.duration);
    switch (tag) {
      case "warmup":
        segments.push(ramp(duration, number(a.powerlow), number(a.powerhigh), "Warm-up", "warmup"));
        break;
      case "cooldown":
        segments.push(ramp(duration, number(a.powerlow), number(a.powerhigh), "Cool-down", "cooldown"));
        break;
      case "ramp":
        segments.push(ramp(duration, number(a.powerlow), number(a.powerhigh)));
        break;
      case "steadystate":
        segments.push(steady(duration, number(a.power)));
        break;
      case "intervalst":
        segments.push(...intervals(Math.max(1, Math.round(number(a.repeat, 1))), number(a.onduration), number(a.onpower), number(a.offduration, 0), number(a.offpower, 0.5)));
        break;
      case "freeride":
      case "maxeffort":
        // No fixed target: ride easy in ERG terms; the rider can override manually.
        segments.push(steady(duration, 0.5, tag === "maxeffort" ? "Max effort" : "Free ride"));
        break;
      default:
        break;
    }
  }
  return createWorkout({ name, description, segments });
}

// --------------------------------------------------------------- presets ---

export const PRESET_WORKOUTS = Object.freeze([
  createWorkout({
    name: "Endurance 45",
    description: "Steady aerobic ride with a short build.",
    segments: [ramp(600, 0.45, 0.65, "Warm-up", "warmup"), steady(1500, 0.68, "Endurance"), steady(300, 0.75, "Tempo"), ramp(300, 0.6, 0.45, "Cool-down", "cooldown")],
  }),
  createWorkout({
    name: "Sweet Spot 3×8",
    description: "Three 8-minute blocks just below threshold.",
    segments: [ramp(600, 0.45, 0.7, "Warm-up", "warmup"), ...intervals(3, 480, 0.9, 240, 0.55), ramp(300, 0.6, 0.45, "Cool-down", "cooldown")],
  }),
  createWorkout({
    name: "VO2max 5×3",
    description: "Five hard 3-minute efforts with equal recovery.",
    segments: [ramp(600, 0.45, 0.75, "Warm-up", "warmup"), ...intervals(5, 180, 1.15, 180, 0.5), ramp(300, 0.6, 0.45, "Cool-down", "cooldown")],
  }),
  createWorkout({
    name: "ERG check 10",
    description: "Short steps to see how your trainer holds power.",
    segments: [steady(120, 0.5, "Easy"), steady(120, 0.7, "Step 1"), steady(120, 0.85, "Step 2"), steady(120, 1.0, "Step 3"), steady(120, 0.5, "Easy")],
  }),
]);

/** Training zone (1–6, Coggan-style) for a fraction of FTP, used for colours. */
export function zoneFor(fraction) {
  if (fraction < 0.56) return 1;
  if (fraction < 0.76) return 2;
  if (fraction < 0.91) return 3;
  if (fraction < 1.06) return 4;
  if (fraction < 1.21) return 5;
  return 6;
}
