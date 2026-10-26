/**
 * Decides how the trainer is controlled:
 *
 * - "sim": the road decides (grade, difficulty, virtual shifting)
 * - "erg": a target power decides — set by hand, or by a running workout
 *
 * Trainers that only report power (`canControl: false`) never enter ERG
 * mode: a workout then runs "guided" — targets are shown, the rider holds
 * them, and the trainer's resistance stays as it is.
 *
 * During a workout, +/− changes the intensity (e.g. 95 %) instead of the
 * target, like in other training apps. The workout clock pauses while the
 * rider is not pedalling.
 *
 * Emits: "change" (any state change), "workoutFinished" (workout).
 */
import { Emitter } from "../util/emitter.js";
import { WorkoutPlayer } from "./workout.js";

export const ERG_LIMITS = Object.freeze({ min: 50, max: 1000, step: 5 });
export const INTENSITY_LIMITS = Object.freeze({ min: 0.5, max: 1.5, step: 0.05 });
const PAUSE_BELOW_CADENCE = 15;

export class TrainingControl extends Emitter {
  mode = "sim";
  ergTarget = 150;
  intensity = 1;
  player = null;
  /** The ride is paused (#89): the workout clock stands still whatever the cadence. */
  held = false;
  /** A locked workout (the FTP test) can't be adjusted or skipped. */
  #locked = false;
  #state = null;

  /** @param {{ftp: number, canControl?: boolean}} options */
  constructor({ ftp, canControl = true }) {
    super();
    this.ftp = ftp;
    this.canControl = canControl;
    this.ergTarget = Math.round((ftp * 0.6) / ERG_LIMITS.step) * ERG_LIMITS.step;
  }

  get workout() {
    return this.player?.workout ?? null;
  }

  /** @returns {boolean} false if the trainer can't do the mode */
  setMode(mode) {
    if (mode !== "sim" && mode !== "erg") throw new Error(`Unknown mode ${mode}`);
    if (mode === "erg" && !this.canControl) return false;
    if (mode === "sim") {
      this.player = null;
      this.#locked = false;
    }
    this.mode = mode;
    this.emit("change");
    return true;
  }

  get locked() {
    return this.#locked;
  }

  /** A workout without ERG: targets to follow, resistance unchanged. */
  get guided() {
    return Boolean(this.player) && this.mode !== "erg";
  }

  /** +/− by one step: target watts by hand, intensity during a workout. */
  adjust(direction) {
    if (this.#locked || (this.mode !== "erg" && !this.player)) return false;
    if (this.player) {
      const next = this.intensity + direction * INTENSITY_LIMITS.step;
      this.intensity = Math.round(Math.min(INTENSITY_LIMITS.max, Math.max(INTENSITY_LIMITS.min, next)) * 100) / 100;
    } else {
      this.ergTarget = Math.min(ERG_LIMITS.max, Math.max(ERG_LIMITS.min, this.ergTarget + direction * ERG_LIMITS.step));
    }
    this.emit("change");
    return true;
  }

  startWorkout(workout, { locked = false } = {}) {
    this.#locked = locked;
    this.player = new WorkoutPlayer(workout, this.ftp);
    this.intensity = 1;
    this.mode = this.canControl ? "erg" : "sim";
    this.#state = null;
    this.emit("change");
  }

  stopWorkout() {
    if (!this.player) return;
    this.player = null;
    this.#locked = false;
    this.emit("change");
  }

  skipSegment() {
    if (this.#locked) return;
    this.player?.skipSegment();
  }

  /** Advances the workout clock; call every frame or telemetry tick. */
  tick(nowS, latest = {}) {
    if (!this.player) return null;
    // The time since the last tick counts according to the previous pause state;
    // the current cadence decides about the time until the next tick.
    const state = this.player.tick(nowS);
    this.player.paused = this.held || (Number.isFinite(latest.cadence) && latest.cadence < PAUSE_BELOW_CADENCE);
    this.#state = state;
    if (state.finished) {
      const workout = this.player.workout;
      this.player = null;
      this.#locked = false;
      this.ergTarget = Math.round((this.ftp * 0.5) / ERG_LIMITS.step) * ERG_LIMITS.step;
      this.emit("workoutFinished", workout);
      this.emit("change");
    }
    return state;
  }

  /** Current workout position, or null without a workout. */
  workoutState() {
    if (!this.player) return null;
    return this.#state ?? this.player.state();
  }

  /** Target watts (workout or manual ERG), else null. */
  targetWatts() {
    if (this.player) {
      const state = this.workoutState();
      return Math.round((state?.targetWatts ?? 0) * this.intensity);
    }
    return this.mode === "erg" ? this.ergTarget : null;
  }

  /**
   * Resistance command for the RideSession.
   * @param {() => number | {grade: number}} simulation the road model used in "sim" mode
   */
  command(simulation) {
    const target = this.targetWatts();
    return this.mode === "erg" && target !== null ? { power: target } : simulation();
  }
}
