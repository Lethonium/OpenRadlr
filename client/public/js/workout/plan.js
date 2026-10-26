/**
 * Bodyweight circuit plans: a list of timed exercise and rest blocks.
 *
 * Pure functions only; the client runs the clock and the server never sees a plan.
 */

/** The exercise ids the server and the 3D gym know about, with display names. */
export const EXERCISES = Object.freeze({
  squats: { name: "Squats" },
  situps: { name: "Sit-ups" },
  pushups: { name: "Push-ups" },
  jumping_jacks: { name: "Jumping jacks" },
  plank: { name: "Plank" },
  burpees: { name: "Burpees" },
});

const MAX_BLOCKS = 200;
const MAX_BLOCK_S = 600;
const MAX_TOTAL_S = 2 * 3600;
const GET_READY_S = 30;

/**
 * @typedef {{kind: "exercise", exercise: string, seconds: number, label: string}
 *   | {kind: "rest", seconds: number, label: string}} Block
 * @typedef {{id: string, name: string, description: string, blocks: Block[]}} Plan
 */

/** Validates and normalises a plan; throws an Error with a readable message. */
export function createPlan({ id, name, description = "", blocks }) {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error("A plan needs at least one block.");
  if (blocks.length > MAX_BLOCKS) throw new Error(`A plan may have at most ${MAX_BLOCKS} blocks.`);
  const clean = blocks.map((block, index) => {
    const n = index + 1;
    const seconds = Math.round(Number(block.seconds));
    if (!(seconds >= 1 && seconds <= MAX_BLOCK_S)) throw new Error(`Block ${n} must last between 1 and ${MAX_BLOCK_S} seconds.`);
    if (block.kind === "rest") return { kind: "rest", seconds, label: "Rest" };
    if (block.kind === "exercise") {
      if (!Object.hasOwn(EXERCISES, block.exercise)) throw new Error(`Block ${n} has an unknown exercise.`);
      return { kind: "exercise", exercise: block.exercise, seconds, label: EXERCISES[block.exercise].name };
    }
    throw new Error(`Block ${n} must be an exercise or a rest.`);
  });
  const total = clean.reduce((sum, b) => sum + b.seconds, 0);
  if (total > MAX_TOTAL_S) throw new Error("A plan may last at most 2 hours.");
  return { id: String(id), name: String(name || "Workout").slice(0, 80), description: String(description).slice(0, 500), blocks: clean };
}

/** A new plan with a 30 s "Get ready" rest in front; the original is untouched. */
export function withGetReady(plan) {
  return { ...plan, blocks: [{ kind: "rest", seconds: GET_READY_S, label: "Get ready" }, ...plan.blocks] };
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
  const parts = plan.blocks.slice(0, 6).map((b) => `${b.label} ${b.seconds} s`);
  if (plan.blocks.length > 6) parts.push("…");
  return parts.join(" · ");
}
