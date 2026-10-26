/**
 * The pause of a ride (#89), as a pure state machine: no DOM, no network.
 *
 * - "riding": the timer runs.
 * - "stopped": auto-paused (standing still); the timer is stopped, the rider
 *   is still in the lane.
 * - "parked": paused on purpose, or auto-paused for a while; the rider has
 *   pulled over onto the shoulder.
 *
 * `update()` is called every HUD tick and `toggle()` by the pause button; both
 * return the actions the caller must perform, in order: "pauseTimer",
 * "resumeTimer", "park", "unpark" (the server's pause / resume) and "leave"
 * (paused for too long). Auto-pause looks at speed only, so rolling downhill
 * without pedalling is riding. It also waits until the rider has moved once,
 * so standing at the start of a ride or right after a resume is no stop.
 */

export const PAUSE = Object.freeze({
  /** Under this speed (m/s, 1 km/h) the rider counts as standing. */
  stopSpeed: 0.28,
  /** Seconds standing before auto-pause. */
  stopS: 3,
  /** Seconds auto-paused before the rider pulls over. */
  parkAfterS: 10,
  /** Watts that count as pedalling off from a pause. */
  resumeW: 30,
  /** Seconds of pedalling before the ride resumes. */
  resumeS: 2,
  /** Seconds paused before the client leaves the world. */
  leaveAfterS: 1800,
});

export class RidePause {
  autoPause;
  allowed = true;
  state = "riding";
  /** Seconds (the caller's `now`) when the timer stopped, or null while riding. */
  pausedAt = null;
  #slowSince = null;
  #pedalSince = null;
  /** Pedalling resumes only after the rider stopped pedalling once, so pausing mid-stroke sticks. */
  #coasted = false;
  #armed = false;
  #left = false;

  constructor({ autoPause = false } = {}) {
    this.autoPause = autoPause;
  }

  update({ now, speed, power, offline }) {
    if (!this.allowed) return this.state === "riding" ? [] : this.#resume();
    if (offline) {
      this.#slowSince = null;
      this.#pedalSince = null;
      return [];
    }
    const standing = speed < PAUSE.stopSpeed;
    if (!standing) this.#armed = true;

    if (this.state === "riding") {
      if (!this.autoPause || !this.#armed || !standing) {
        this.#slowSince = null;
        return [];
      }
      this.#slowSince ??= now;
      if (now - this.#slowSince < PAUSE.stopS) return [];
      this.state = "stopped";
      this.pausedAt = now;
      this.#slowSince = null;
      return ["pauseTimer"];
    }

    if (now - this.pausedAt >= PAUSE.leaveAfterS) {
      if (this.#left) return [];
      this.#left = true;
      return ["leave"];
    }

    if (this.state === "stopped") {
      if (!standing) return this.#resume();
      if (now - this.pausedAt >= PAUSE.parkAfterS) {
        this.state = "parked";
        this.#coasted = false;
        return ["park"];
      }
      return [];
    }

    // parked: pedalling off resumes
    if (power < PAUSE.resumeW) this.#coasted = true;
    if (power >= PAUSE.resumeW && this.#coasted) {
      this.#pedalSince ??= now;
      if (now - this.#pedalSince >= PAUSE.resumeS) return this.#resume();
    } else {
      this.#pedalSince = null;
    }
    return [];
  }

  /** The pause button or key. */
  toggle(now) {
    if (!this.allowed) return [];
    if (this.state === "parked") return this.#resume();
    const actions = this.state === "riding" ? ["pauseTimer", "park"] : ["park"];
    if (this.state === "riding") this.pausedAt = now;
    this.state = "parked";
    this.#slowSince = null;
    this.#pedalSince = null;
    this.#coasted = false;
    return actions;
  }

  /** The server refused the pause (race, event or vehicle). */
  rejected() {
    if (this.state === "riding") return [];
    this.#reset();
    return ["resumeTimer"];
  }

  #resume() {
    const actions = this.state === "parked" ? ["resumeTimer", "unpark"] : ["resumeTimer"];
    this.#reset();
    return actions;
  }

  #reset() {
    this.state = "riding";
    this.pausedAt = null;
    this.#slowSince = null;
    this.#pedalSince = null;
    this.#armed = false;
    this.#coasted = false;
    this.#left = false;
  }
}
