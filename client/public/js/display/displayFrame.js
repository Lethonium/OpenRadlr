/**
 * What the tablet tells paired screens about the ride (opaque `display` frames).
 * Pure: the server relays these without reading them, so the shape is agreed
 * only with the cockpit page.
 */
import { liveStats } from "../ride/liveStats.js";
import { powerZone } from "../view/hud.js";

/** The server drops a `display` frame larger than this many bytes serialised. */
export const DISPLAY_LIMIT_BYTES = 2048;

const ZONES = 6;
const NAME_MAX_CHARS = 60;

/** Seconds in power zones 1–6, one second per sample; samples without a known zone count nowhere. */
function zoneSeconds(samples, ftp) {
  const zones = Array(ZONES).fill(0);
  for (const { power } of samples) {
    const zone = powerZone(power, ftp);
    if (zone > 0) zones[zone - 1] += 1;
  }
  return zones;
}

/**
 * @param {object} input
 * @param {?number} [input.heartRate] bpm
 * @param {?number} [input.grade] percent
 * @param {number} input.ftp watts
 * @param {?number} [input.cadence] rpm, sent with the workout step
 * @param {{summary: object, samples: object[], pauses: object[]}} input.recording
 * @param {?{workout: {name: string, segments: object[]}, state: object}} [input.workout]
 *   the running workout and its position (`TrainingControl#workoutState`, target adjusted)
 */
export function displayFrame({ heartRate, grade, ftp, cadence, recording, workout }) {
  const frame = {};
  if (Number.isFinite(heartRate)) frame.hr = heartRate;
  if (Number.isFinite(grade)) frame.grade = grade;
  frame.ftp = ftp;
  frame.stats = liveStats({ ...recording, ftp });
  frame.zones_s = zoneSeconds(recording.samples, ftp);
  const state = workout?.state;
  if (state && !state.finished && state.segment) {
    const step = { id: workout.workout.name, step: state.index, step_elapsed_s: Math.round(state.segment.durationS - state.segmentRemainingS), target_w: state.targetWatts };
    if (Number.isFinite(cadence)) step.cadence = cadence;
    frame.workout = step;
  }
  return frame;
}

/**
 * The step list of a workout, sent once per workout. Steps that would not fit
 * the frame limit are left off the end.
 */
export function workoutPlanFrame(workout, ftp) {
  const plan = { id: workout.name, name: workout.name.slice(0, NAME_MAX_CHARS), steps: [] };
  const frame = { workout_plan: plan };
  let bytes = JSON.stringify(frame).length;
  for (const segment of workout.segments) {
    const step = { s: segment.durationS, from_w: Math.round(segment.from * ftp), to_w: Math.round(segment.to * ftp) };
    bytes += JSON.stringify(step).length + 1;
    if (bytes > DISPLAY_LIMIT_BYTES) break;
    plan.steps.push(step);
  }
  return frame;
}
