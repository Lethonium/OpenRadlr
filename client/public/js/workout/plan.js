/**
 * Bodyweight circuit plans: a list of timed exercise and rest blocks.
 *
 * Pure functions only; the client runs the clock and the server never sees a plan.
 */

import { t } from "../i18n/i18n.js";
import { VENUES } from "./venues.js";

/**
 * The exercise ids the server and the 3D gym know about, with display names, a
 * one-line cue, the steps into the pose and whether a pose is sided (right
 * half, then left). A flow (`sun_salutation`) moves on every `stepS` seconds of
 * its clip; `order` says which step each of those movements is.
 */
const exercise = ([name, cue, steps], extra = {}) =>
  Object.freeze({
    get name() { return t(name); },
    get cue() { return t(cue); },
    get steps() { return t(steps).split("\n"); },
    ...extra,
  });
export const EXERCISES = Object.freeze({
  squats: exercise(["workout.exercise.squats", "workout.cue.squats", "workout.steps.squats"]),
  situps: exercise(["workout.exercise.situps", "workout.cue.situps", "workout.steps.situps"]),
  pushups: exercise(["workout.exercise.pushups", "workout.cue.pushups", "workout.steps.pushups"]),
  jumping_jacks: exercise(["workout.exercise.jumpingJacks", "workout.cue.jumpingJacks", "workout.steps.jumpingJacks"]),
  plank: exercise(["workout.exercise.plank", "workout.cue.plank", "workout.steps.plank"]),
  burpees: exercise(["workout.exercise.burpees", "workout.cue.burpees", "workout.steps.burpees"]),
  // Fold, half lift, step back and lower (two clip keys, one breath), up dog, down dog, half lift, fold, arms up.
  sun_salutation: exercise(["workout.exercise.sunSalutation", "workout.cue.sunSalutation", "workout.steps.sunSalutation"], { flow: Object.freeze({ stepS: 4, order: Object.freeze([0, 1, 2, 2, 3, 4, 5, 6, 7]) }) }),
  forward_fold: exercise(["workout.exercise.forwardFold", "workout.cue.forwardFold", "workout.steps.forwardFold"]),
  downward_dog: exercise(["workout.exercise.downwardDog", "workout.cue.downwardDog", "workout.steps.downwardDog"]),
  cobra: exercise(["workout.exercise.cobra", "workout.cue.cobra", "workout.steps.cobra"]),
  child_pose: exercise(["workout.exercise.childPose", "workout.cue.childPose", "workout.steps.childPose"]),
  low_lunge: exercise(["workout.exercise.lowLunge", "workout.cue.lowLunge", "workout.steps.lowLunge"], { sided: true }),
  pigeon: exercise(["workout.exercise.pigeon", "workout.cue.pigeon", "workout.steps.pigeon"], { sided: true }),
});

/** The step of a flow exercise in progress `blockS` seconds into its block (its clip starts with the block), or -1. */
export function flowStep(id, blockS) {
  const flow = EXERCISES[id]?.flow;
  if (!flow || !(blockS >= 0)) return -1;
  const movement = Math.floor(blockS / flow.stepS) % flow.order.length;
  return flow.order[movement];
}

const MAX_BLOCKS = 200;
const MAX_BLOCK_S = 600;
const MAX_TOTAL_S = 2 * 3600;
const GET_READY_S = 30;

/**
 * @typedef {{kind: "exercise", exercise: string, seconds: number, label: string}
 *   | {kind: "rest", seconds: number, label: string}} Block
 * @typedef {{id: string, name: string, description: string, venue: string | null, blocks: Block[]}} Plan
 */

/** Validates and normalises a plan; throws an Error with a readable message. */
export function createPlan({ id, name, description = "", blocks, venue = null }) {
  if (venue !== null && !Object.hasOwn(VENUES, venue)) throw new Error("Unknown venue.");
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error("A plan needs at least one block.");
  if (blocks.length > MAX_BLOCKS) throw new Error(`A plan may have at most ${MAX_BLOCKS} blocks.`);
  const clean = blocks.map((block, index) => {
    const n = index + 1;
    const seconds = Math.round(Number(block.seconds));
    if (!(seconds >= 1 && seconds <= MAX_BLOCK_S)) throw new Error(`Block ${n} must last between 1 and ${MAX_BLOCK_S} seconds.`);
    if (block.kind === "rest") return { kind: "rest", seconds, get label() { return t("workout.rest"); } };
    if (block.kind === "exercise") {
      if (!Object.hasOwn(EXERCISES, block.exercise)) throw new Error(`Block ${n} has an unknown exercise.`);
      return { kind: "exercise", exercise: block.exercise, seconds, get label() { return EXERCISES[block.exercise].name; } };
    }
    throw new Error(`Block ${n} must be an exercise or a rest.`);
  });
  const total = clean.reduce((sum, b) => sum + b.seconds, 0);
  if (total > MAX_TOTAL_S) throw new Error("A plan may last at most 2 hours.");
  return { id: String(id), name: String(name || t("workout.defaultName")).slice(0, 80), description: String(description).slice(0, 500), venue, blocks: clean };
}

/** A new plan with a 30 s "Get ready" rest in front; the original is untouched. */
export function withGetReady(plan) {
  return { ...plan, blocks: [{ kind: "rest", seconds: GET_READY_S, get label() { return t("workout.getReady"); } }, ...plan.blocks] };
}

export const planDuration = (plan) => plan.blocks.reduce((sum, b) => sum + b.seconds, 0);

/**
 * Where we are in a plan after `elapsedS` seconds.
 * @returns {{finished: boolean, index: number, block: Block | null, blockRemainingS: number,
 *            next: Block | null, elapsedS: number, remainingS: number, count: number}}
 */
export function planPositionAt(plan, elapsedS) {
  const total = planDuration(plan);
  const elapsed = Math.max(0, elapsedS);
  if (elapsed >= total) {
    return { finished: true, index: plan.blocks.length, block: null, blockRemainingS: 0, next: null, elapsedS: total, remainingS: 0, count: plan.blocks.length };
  }
  let start = 0;
  for (let index = 0; index < plan.blocks.length; index += 1) {
    const block = plan.blocks[index];
    if (elapsed < start + block.seconds) {
      return {
        finished: false,
        index,
        block,
        blockRemainingS: start + block.seconds - elapsed,
        next: plan.blocks[index + 1] ?? null,
        elapsedS: elapsed,
        remainingS: total - elapsed,
        count: plan.blocks.length,
      };
    }
    start += block.seconds;
  }
  return { finished: true, index: plan.blocks.length, block: null, blockRemainingS: 0, next: null, elapsedS: total, remainingS: 0, count: plan.blocks.length };
}

/** "Squats 40 s · Rest 20 s · …" for the first six blocks. */
export function planSummary(plan) {
  const parts = plan.blocks.slice(0, 6).map((b) => t("workout.summary.seconds", { label: b.label, s: b.seconds }));
  if (plan.blocks.length > 6) parts.push("…");
  return parts.join(" · ");
}
