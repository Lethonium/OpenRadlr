/**
 * The tablet's workout as the VR page knows it: a plan (steps in watts, sent
 * once per workout) and a position (step and seconds into it, 1 Hz). These
 * turn them back into the shapes the workout chart and the ride HUD read.
 */

/**
 * @param {{id: string, steps: {s: number, from_w: number, to_w: number}[]}} plan a `workout_plan` display frame's plan
 * @param {number} ftp the watts the plan was made at
 * @returns {{name: string, segments: {durationS: number, from: number, to: number, label: string, kind: string}[]}}
 */
export function workoutFromPlan(plan, ftp) {
  const fraction = (watts) => (ftp > 0 ? watts / ftp : 0);
  return { name: plan.id, segments: plan.steps.map((step) => ({ durationS: step.s, from: fraction(step.from_w), to: fraction(step.to_w), label: "", kind: "steady" })) };
}

/**
 * Where the workout is, in the shape of `TrainingControl#workoutState`, or
 * null if the plan has no such step (it was cut to fit a frame).
 * @param {{segments: {durationS: number}[]}} workout from `workoutFromPlan`
 * @param {{step: number, step_elapsed_s: number}} frameWorkout the display frame's `workout`
 */
export function workoutState(workout, { step, step_elapsed_s: stepElapsedS }) {
  const segment = workout.segments[step];
  if (!segment) return null;
  const before = workout.segments.slice(0, step).reduce((sum, s) => sum + s.durationS, 0);
  const total = workout.segments.reduce((sum, s) => sum + s.durationS, 0);
  const elapsedS = before + stepElapsedS;
  return { index: step, segment, elapsedS, remainingS: total - elapsedS, segmentRemainingS: segment.durationS - stepElapsedS, finished: false };
}
