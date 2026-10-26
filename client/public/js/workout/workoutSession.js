/**
 * A running workout: get-ready, then the plan's blocks. Holds the state only;
 * the caller owns the clock tick, executes the returned actions and never lets
 * this touch the DOM or the network.
 *
 * Actions: ["send", exercise | null] (tell the server), ["cue"], ["finished"].
 */
import { planDuration, planPositionAt, withGetReady } from "./plan.js";

const CUE_SECONDS = 3;

export class WorkoutSession {
  /** "ready" | "block" | "paused" | "done" */
  state = "ready";
  #plan;
  #now;
  #wallNow;
  #startedAt;
  #endedAt = null;
  /** Plan seconds elapsed; only grows while running. */
  #elapsed = 0;
  /** Seconds really spent (skipped time excluded): the HUD's elapsed. */
  #spent = 0;
  #lastNow;
  #running = true;
  #activeS = 0;
  #accounted = 0;
  /** Per block: "done" | "skipped" | undefined (not over yet). */
  #status = [];
  #sent;
  #cued = null;
  #hr = [];

  /**
   * @param {{plan: object, now: () => number, wallNow?: () => number}} options `now` returns seconds on any
   *   steady clock; `wallNow` returns epoch milliseconds for the record (default: `now` in ms); `plan` has no get-ready block.
   */
  constructor({ plan, now, wallNow = () => now() * 1000 }) {
    this.#plan = withGetReady(plan);
    this.#now = now;
    this.#wallNow = wallNow;
    this.#startedAt = wallNow();
    this.#lastNow = now();
  }

  #advance() {
    if (this.state === "done") return;
    const now = this.#now();
    if (this.#running) {
      const before = this.#elapsed;
      this.#elapsed = Math.min(planDuration(this.#plan), before + Math.max(0, now - this.#lastNow));
      this.#spent += this.#elapsed - before;
    }
    this.#lastNow = now;
    this.#account(this.#elapsed);
  }

  /** Counts exercise time up to `elapsed` and settles every block that is over. */
  #account(elapsed) {
    let start = 0;
    this.#plan.blocks.forEach((block, index) => {
      const end = start + block.seconds;
      if (block.kind === "exercise") {
        this.#activeS += Math.max(0, Math.min(end, elapsed) - Math.max(start, this.#accounted));
      }
      if (elapsed >= end) this.#status[index] ??= "done";
      start = end;
    });
    this.#accounted = Math.max(this.#accounted, elapsed);
  }

  /**
   * The plan position. `elapsedS` is the time actually spent (a skipped block
   * adds only what was spent in it); `remainingS` is plan time left, so it
   * drops by the whole skipped block.
   */
  position() {
    this.#advance();
    return { ...planPositionAt(this.#plan, this.#elapsed), elapsedS: this.#spent };
  }

  /** True once the whole plan ran out (as opposed to ending it early). */
  get completed() {
    this.#advance();
    return this.#elapsed >= planDuration(this.#plan);
  }

  currentExercise() {
    const block = this.position().block;
    return block?.kind === "exercise" && this.state !== "paused" && this.state !== "done" ? block.exercise : null;
  }

  #send(exercise) {
    if (this.#sent === exercise) return [];
    this.#sent = exercise;
    return [["send", exercise]];
  }

  /** Moves the state to where the clock is and reports what must happen. */
  #settle() {
    const position = planPositionAt(this.#plan, this.#elapsed);
    if (position.finished) return this.#finish();
    if (!this.#running) return this.#send(null);
    this.state = position.index === 0 ? "ready" : "block";
    const actions = this.#send(this.currentExercise());
    const remaining = Math.ceil(position.blockRemainingS);
    const key = `${position.index}:${remaining}`;
    if (remaining >= 1 && remaining <= CUE_SECONDS && key !== this.#cued) {
      this.#cued = key;
      actions.push(["cue"]);
    }
    return actions;
  }

  #finish() {
    if (this.state === "done") return [];
    this.#endedAt = this.#wallNow();
    this.state = "done";
    return [...this.#send(null), ["finished"]];
  }

  tick() {
    if (this.state === "done" || !this.#running) return [];
    this.#advance();
    return this.#settle();
  }

  pause() {
    if (this.state === "done" || !this.#running) return [];
    this.#advance();
    this.#running = false;
    if (planPositionAt(this.#plan, this.#elapsed).finished) return this.#finish();
    this.state = "paused";
    return this.#send(null);
  }

  resume() {
    if (this.state !== "paused") return [];
    this.#lastNow = this.#now();
    this.#running = true;
    return this.#settle();
  }

  skip() {
    if (this.state === "done") return [];
    this.#advance();
    const position = planPositionAt(this.#plan, this.#elapsed);
    if (position.finished) return this.#settle();
    this.#status[position.index] ??= "skipped";
    // The block's exact end, not elapsed + remaining: that can fall one float ulp short.
    this.#elapsed = this.#plan.blocks.slice(0, position.index + 1).reduce((sum, block) => sum + block.seconds, 0);
    this.#accounted = this.#elapsed;
    return this.#settle();
  }

  end() {
    if (this.state === "done") return [];
    this.#advance();
    return this.#finish();
  }

  heartRate(bpm) {
    if (this.state !== "done" && Number.isFinite(bpm)) this.#hr.push(bpm);
  }

  /** The history record, or null when no exercise block was completed. */
  record() {
    this.#advance();
    const count = (status) =>
      this.#plan.blocks.filter((block, index) => block.kind === "exercise" && this.#status[index] === status).length;
    const blocksDone = count("done");
    if (blocksDone === 0) return null;
    const endedAt = this.#endedAt ?? this.#wallNow();
    const hr = this.#hr.length
      ? { avg: Math.round(this.#hr.reduce((a, b) => a + b, 0) / this.#hr.length), max: Math.max(...this.#hr) }
      : null;
    return {
      version: 2,
      kind: "workout",
      id: String(this.#startedAt),
      planId: this.#plan.id,
      planName: this.#plan.name,
      startedAt: this.#startedAt,
      endedAt,
      durationS: Math.round((endedAt - this.#startedAt) / 1000),
      activeS: Math.round(this.#activeS),
      blocksDone,
      blocksSkipped: count("skipped"),
      hr,
      measured: false,
    };
  }
}
