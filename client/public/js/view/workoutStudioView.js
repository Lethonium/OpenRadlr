/**
 * The workout screen: what the HUD and the summary say (pure text functions)
 * and the view that writes it into `#workout-hud`. Only textContent is used.
 */
import { formatDuration } from "../util/format.js";
import { t } from "../i18n/i18n.js";
import { EXERCISES, flowStep } from "../workout/plan.js";

/** The planned exercise time (rests excluded): what a workout's active time is measured against. */
const exerciseDuration = (plan) => plan.blocks.reduce((sum, block) => sum + (block.kind === "exercise" ? block.seconds : 0), 0);

/**
 * The view a screen opens in: the workout is the 3D gym whatever 2D/3D
 * preference was saved (its HUD sits on the world, the 2D map has nothing
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
    ...guideText(position, state),
    next: next ? t("workout.hud.next", { label: next.label, s: next.seconds }) : t("workout.hud.last"),
    block: t("workout.hud.block", { n: Math.min(position.index + 1, position.count), count: position.count }),
    // Elapsed rounds down and remaining up, like the ring: the first frame reads 0:00 and the full length.
    elapsed: formatDuration(Math.floor(position.elapsedS)),
    remaining: formatDuration(Math.ceil(position.remainingS)),
    hr: Number.isFinite(heartRate) ? `${Math.round(heartRate)} bpm` : "",
  };
}

/**
 * The instructions card: how to do the exercise under way, or during a rest
 * (and Get ready) the one coming up, so the steps can be read before it
 * starts. A flow marks the movement of the breath in progress; a sided pose
 * names the side.
 */
function guideText(position, state) {
  const block = position.block;
  const now = block?.kind === "exercise";
  const id = now ? block.exercise : block?.kind === "rest" && position.next?.kind === "exercise" ? position.next.exercise : null;
  const exercise = id ? EXERCISES[id] : null;
  if (!exercise) return { guideTitle: "", guideSide: "", steps: [], step: -1, cue: "" };
  const side = !exercise.sided ? "" : now && position.side === "left" ? t("workout.side.left") : t("workout.side.right");
  return {
    guideTitle: now ? t("workout.guide.howTo") : t("workout.guide.comingUp", { label: exercise.name }),
    guideSide: side,
    steps: exercise.steps,
    step: now && state !== "paused" ? flowStep(id, block.seconds - position.blockRemainingS) : -1,
    cue: exercise.cue,
  };
}

/**
 * The index in `figures` (the gym's statue row) of the exercise a rest leads
 * into, or null: during an exercise, after the plan, or without a statue.
 * @param {ReturnType<import("../workout/plan.js").planPositionAt>} position
 * @param {string[]} figures exercise ids in the plinth order of the gym's row
 */
export function highlightedFigure(position, figures) {
  if (position.finished || position.block?.kind !== "rest") return null;
  const next = position.next;
  if (next?.kind !== "exercise") return null;
  const index = figures.indexOf(next.exercise);
  return index < 0 ? null : index;
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

/** Writes HUD text into the `[data-w]` elements of the workout HUD, the steps into its guide card, and drives the ring. */
export class WorkoutStudioView {
  #root;
  #steps = "";

  constructor(root) {
    this.#root = root;
  }

  /**
   * @param {{exercise: string, paused: string, time: string, next: string, block: string, elapsed: string, remaining: string, hr: string,
   *          guideTitle: string, guideSide: string, cue: string, steps: string[], step: number}} text
   * @param {number} [progress] block progress 0..1
   */
  render(text, progress = 0) {
    const { steps = [], step = -1, ...lines } = text;
    for (const [key, value] of Object.entries(lines)) {
      const element = this.#root.querySelector(`[data-w="${key}"]`);
      if (element && element.textContent !== value) element.textContent = value;
    }
    this.#renderSteps(steps, step);
    const ring = this.#root.querySelector(".workout-ring");
    ring?.style.setProperty("--progress", String(Math.min(1, Math.max(0, progress))));
    const hr = this.#root.querySelector('[data-w="hr"]');
    // The caption goes with the value.
    if (hr) hr.parentElement.hidden = text.hr === "";
  }

  /** The list is rebuilt only when the steps change; the mark on the step in progress moves every frame. */
  #renderSteps(steps, step) {
    const guide = this.#root.querySelector(".workout-guide");
    if (guide) guide.hidden = steps.length === 0;
    const list = this.#root.querySelector('[data-w-list="steps"]');
    if (!list) return;
    const key = steps.join("\n");
    if (key !== this.#steps) {
      this.#steps = key;
      list.replaceChildren(
        ...steps.map((line) => {
          const item = list.ownerDocument.createElement("li");
          item.textContent = line;
          return item;
        }),
      );
    }
    Array.from(list.children).forEach((item, index) => {
      const mark = index === step ? "current" : "";
      if (item.className === mark) return;
      item.className = mark;
      // On a short screen the card scrolls: keep the step under way in sight.
      if (mark) item.scrollIntoView?.({ block: "nearest" });
    });
  }

  dispose() {
    this.#root = { querySelector: () => null };
  }
}
