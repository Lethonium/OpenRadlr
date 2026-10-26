/**
 * One rider's view of a spin class: follows the server's class clock
 * (extrapolated between state messages), turns targets into watts for this
 * rider and decides how the trainer is driven:
 *
 * - ERG: the trainer holds the target (times intensity, +/− in 5 % steps),
 * - free: flat road with the rider's own gears; targets are shown only.
 *
 * Power-only trainers always ride free.
 */
import { classPosition, targetWatts } from "./classClock.js";

/** ERG target outside the class: easy spinning. */
const LOBBY_TARGET = 0.5;
const INTENSITY = Object.freeze({ min: 0.5, max: 1.5, step: 0.05 });

export class StudioSession {
  /** Latest `studio_state` message. */
  state = null;
  intensity = 1;
  #receivedAt = 0;
  #announced = null;

  /**
   * @param {{catalog: {classes: object[]}, ftp: number, canControl?: boolean}} options
   *        catalog: the `/api/studio` response
   */
  constructor({ catalog, ftp, canControl = true }) {
    this.classes = new Map(catalog.classes.map((c) => [c.id, c]));
    this.ftp = ftp;
    this.canControl = canControl;
    this.erg = canControl;
  }

  /** @param {object} message a `studio_state` message, @param {number} nowS local clock */
  update(message, nowS) {
    this.state = message;
    this.#receivedAt = nowS;
  }

  get plan() {
    return this.state ? (this.classes.get(this.state.class.id) ?? null) : null;
  }

  /** Seconds since the class started (negative in the lobby). */
  elapsed(nowS) {
    return this.state ? this.state.class.elapsed_s + (nowS - this.#receivedAt) : null;
  }

  position(nowS) {
    const plan = this.plan;
    return plan ? classPosition(plan, this.elapsed(nowS)) : null;
  }

  /** The class target for this rider in watts (easy spin outside the class). */
  targetWatts(nowS) {
    const position = this.position(nowS);
    if (!position) return null;
    return targetWatts(position.target ?? LOBBY_TARGET, this.ftp, this.intensity);
  }

  /** @returns {boolean} false if the trainer can't do ERG */
  setErg(on) {
    if (on && !this.canControl) return false;
    this.erg = on;
    return true;
  }

  adjust(direction) {
    const next = this.intensity + direction * INTENSITY.step;
    this.intensity = Math.round(Math.min(INTENSITY.max, Math.max(INTENSITY.min, next)) * 100) / 100;
  }

  /** Resistance command for the RideSession; `simulation` is the free-ride model. */
  command(simulation, nowS) {
    const target = this.targetWatts(nowS);
    return this.erg && target !== null ? { power: target } : simulation();
  }

  /** The block that just started, once (for the coach's call-out), else null. */
  newCue(nowS) {
    const position = this.position(nowS);
    if (!position) return null;
    const key = `${this.state.class.id}:${position.phase}:${position.index ?? ""}`;
    if (key === this.#announced) return null;
    this.#announced = key;
    return position;
  }
}
