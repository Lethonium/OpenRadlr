/**
 * The guided FTP ramp test: warm-up, settings, countdown, a locked ramp
 * workout, result. Holds the test state only; the caller renders it, feeds
 * `tick` and owns the clock. Never touches the DOM.
 *
 * Emits: "change" (state changed), "result" ({ftp, bestMinuteW, durationS} | {tooShort: true}).
 */
import { Emitter } from "../util/emitter.js";
import { buildRamp, detectFailure, FAIL_GRACE_S, FAIL_HOLD_S, rampResult, suggestStart } from "./ftpTest.js";

const START_LIMITS = Object.freeze({ min: 50, max: 400 });
const STEP_LIMITS = Object.freeze({ min: 5, max: 40 });
const COUNTDOWN_MS = 3000;
const LIVE_WINDOW_MS = 60_000;
const LIVE_MIN_MS = 15_000;

const clamp = (value, { min, max }) => Math.min(max, Math.max(min, Math.round(value)));

export class FtpTestSession extends Emitter {
  /** "idle" | "warmup" | "settings" | "countdown" | "ramp" | "result" */
  state = "idle";
  startW = 100;
  stepW = 10;
  result = null;
  /** "ramp" once a ramp has started, so the ride record can be flagged. */
  testFlag = null;
  #samples = [];
  #warmupFrom = 0;
  #countdownFrom = 0;
  /** When the rider stopped pedalling (the workout clock paused), in `now()` ms. */
  #stoppedSince = null;

  /** @param {{training: object, getSamples: () => {t: number, power: number}[], now?: () => number}} options */
  constructor({ training, getSamples, now = () => Date.now() }) {
    super();
    this.training = training;
    this.getSamples = getSamples;
    this.now = now;
    // "Stop workout" pressed outside, or the ramp ran out
    training.on("change", () => {
      if (this.state === "ramp" && !training.workout) this.finish();
    });
  }

  #set(state) {
    this.state = state;
    this.emit("change");
  }

  #warmupSamples() {
    return this.getSamples().filter((sample) => sample.t >= this.#warmupFrom);
  }

  begin() {
    // A free ride, whatever the rider was doing before
    this.training.stopWorkout();
    this.training.setMode("sim");
    this.#warmupFrom = this.now();
    this.result = null;
    this.#set("warmup");
  }

  /** Mean power of the last minute of the warm-up; null until 15 s are ridden. */
  liveMinuteW() {
    const samples = this.#warmupSamples();
    if (samples.length === 0) return null;
    const last = samples.at(-1).t;
    const window = samples.filter((sample) => sample.t > last - LIVE_WINDOW_MS);
    if (last - window[0].t < LIVE_MIN_MS) return null;
    return window.reduce((sum, sample) => sum + sample.power, 0) / window.length;
  }

  proceed() {
    if (this.state !== "warmup") return;
    ({ startW: this.startW, stepW: this.stepW } = suggestStart(this.#warmupSamples()));
    this.#set("settings");
  }

  setStart(watts) {
    this.startW = clamp(watts, START_LIMITS);
    this.emit("change");
  }

  setStep(watts) {
    this.stepW = clamp(watts, STEP_LIMITS);
    this.emit("change");
  }

  back() {
    if (this.state === "settings") this.#set("warmup");
  }

  start() {
    if (this.state !== "settings") return;
    this.#countdownFrom = this.now();
    this.#set("countdown");
  }

  #startRamp() {
    const { startW, stepW } = this;
    this.#samples = [];
    this.#stoppedSince = null;
    this.testFlag = "ramp";
    this.training.startWorkout(buildRamp({ startW, stepW, ftp: this.training.ftp }), { locked: true });
    this.#set("ramp");
  }

  /**
   * Call every frame after the training clock has ticked. In the ramp it
   * stores one sample per whole second of the workout clock (pauses don't count).
   */
  tick(nowS, latest = {}) {
    if (this.state === "countdown" && this.now() - this.#countdownFrom >= COUNTDOWN_MS) this.#startRamp();
    if (this.state !== "ramp") return;
    const workoutState = this.training.workoutState();
    if (!workoutState) return;
    const power = Number.isFinite(latest.power) ? latest.power : 0;
    for (let elapsedS = this.#samples.length + 1; elapsedS <= Math.floor(workoutState.elapsedS); elapsedS += 1) {
      this.#samples.push({ elapsedS, power });
    }
    if (detectFailure(this.#samples, this) !== null) {
      this.finish();
      return;
    }
    // No pedalling pauses the workout clock, so no samples come in: time the stop itself
    const stopped = Boolean(this.training.player?.paused) && !this.training.held && workoutState.elapsedS >= FAIL_GRACE_S;
    if (!stopped) {
      this.#stoppedSince = null;
      return;
    }
    this.#stoppedSince ??= this.now();
    if (this.now() - this.#stoppedSince >= FAIL_HOLD_S * 1000) this.finish();
  }

  done() {
    if (this.state === "ramp") this.finish();
  }

  cancel() {
    if (this.state === "idle") return;
    this.state = "idle";
    this.training.stopWorkout();
    this.emit("change");
  }

  finish() {
    if (this.state !== "ramp") return;
    this.state = "result";
    this.training.stopWorkout();
    this.result = rampResult(this.#samples) ?? { tooShort: true };
    this.emit("change");
    this.emit("result", this.result);
  }

  /** Back to idle; the flag stays for the ride in progress. */
  reset() {
    this.state = "idle";
    this.result = null;
    this.emit("change");
  }
}
