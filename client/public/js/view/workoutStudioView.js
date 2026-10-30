/**
 * The workout screen: what the HUD and the summary say (pure text functions)
 * and the view that writes it into `#workout-hud`. Only textContent is used.
 */
import { formatDuration } from "../util/format.js";
import { t } from "../i18n/i18n.js";

/** The planned exercise time (rests excluded): what a workout's active time is measured against. */
const exerciseDuration = (plan) => plan.blocks.reduce((sum, block) => sum + (block.kind === "exercise" ? block.seconds : 0), 0);

/**
 * The view a screen opens in: the workout is the 3D gym whatever 2D/3D
 * preference was saved (its HUD sits on the world, the 2D peloton has nothing
 * to show), the ride follows the saved preference.
 */
export function startingViewMode(saved, { workout = false } = {}) {
  return workout || saved !== "2d" ? "3d" : "2d";
}

/**
 * The HUD lines for a position of a running workout.
 * @param {ReturnType<import("../workout/plan.js").planPositionAt>} position the plan with its get-ready block
 * @param {{state: string, heartRate: ?number}} status
 */
export function workoutHudText(position, { state, heartRate }) {
  const next = position.next;
  return {
    exercise: position.block?.label ?? "",
    paused: state === "paused" ? t("workout.hud.paused") : "",
    time: formatDuration(Math.ceil(position.blockRemainingS)),
    next: next ? t("workout.hud.next", { label: next.label, s: next.seconds }) : t("workout.hud.last"),
    block: t("workout.hud.block", { n: Math.min(position.index + 1, position.count), count: position.count }),
    // Elapsed rounds down and remaining up, like the ring: the first frame reads 0:00 and the full length.
    elapsed: formatDuration(Math.floor(position.elapsedS)),
    remaining: formatDuration(Math.ceil(position.remainingS)),
    hr: Number.isFinite(heartRate) ? `${Math.round(heartRate)} bpm` : "",
  };
}

/** How much of the current block is over, 0..1 (the ring). */
export function blockProgress(position) {
  if (!position.block) return 1;
  return Math.min(1, Math.max(0, 1 - position.blockRemainingS / position.block.seconds));
}

/** The summary card lines for a history record of a workout and the plan that was run; `finished` is true when the plan ran out. */
export function summaryText(record, plan, { finished = false } = {}) {
  return {
    title: finished ? t("workout.summary.complete") : t("workout.ended"),
    plan: record.planName,
    worked: t("workout.summary.worked", { active: formatDuration(record.activeS), planned: formatDuration(exerciseDuration(plan)) }),
    blocks: record.blocksSkipped > 0 ? t("workout.summary.blocksSkipped", { done: record.blocksDone, skipped: record.blocksSkipped }) : t("workout.summary.blocks", { done: record.blocksDone }),
    hr: record.hr ? t("workout.summary.hr", { avg: record.hr.avg, max: record.hr.max }) : "",
  };
}

/**
 * After a reconnect the server may hold a fresh rider: say again what the
 * avatar is doing. Nothing to do without a workout.
 */
export function resyncWorkout(workout, connection) {
  if (workout) connection.workout(workout.currentExercise());
}

/** Writes HUD text into the `[data-w]` elements of the workout HUD and drives the ring. */
export class WorkoutStudioView {
  #root;

  constructor(root) {
    this.#root = root;
  }

  /** @param {{exercise: string, paused: string, time: string, next: string, block: string, elapsed: string, remaining: string, hr: string}} text @param {number} [progress] block progress 0..1 */
  render(text, progress = 0) {
    for (const [key, value] of Object.entries(text)) {
      const element = this.#root.querySelector(`[data-w="${key}"]`);
      if (element && element.textContent !== value) element.textContent = value;
    }
    const ring = this.#root.querySelector(".workout-ring");
    ring?.style.setProperty("--progress", String(Math.min(1, Math.max(0, progress))));
    const hr = this.#root.querySelector('[data-w="hr"]');
    // The caption goes with the value.
    if (hr) hr.parentElement.hidden = text.hr === "";
  }

  dispose() {
    this.#root = { querySelector: () => null };
  }
}
