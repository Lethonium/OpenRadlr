/**
 * Phone paddles on screen: two big pads, left and right, to tap in turn
 * (see ride/paddleModel.js), with an energy bar, a rhythm meter that shows
 * the sweet spot, a combo counter and a hint. A horizontal swipe above the
 * pads changes lanes. Everything is written with textContent and classes.
 */

import { t } from "../i18n/i18n.js";

const SWIPE_MIN_PX = 50;
const SWIPE_MAX_MS = 700;

/** The hint under the meter for a paddle reading. */
export function paddleHint(state) {
  if (state.stumbling) return t("paddle.stumble");
  if (state.tired) return t("paddle.tired");
  switch (state.zone) {
    case "idle":
      return t("paddle.idle");
    case "easy":
      return state.climbing ? t("paddle.climbEasy") : t("paddle.faster");
    case "sweet":
      return state.climbing ? t("paddle.climbGood") : state.combo >= 20 ? t("paddle.smooth") : t("paddle.nice");
    case "sprint":
      return state.energy < 0.3 ? t("paddle.sprintLow") : t("paddle.sprint");
    default:
      return "";
  }
}

/** Position (0–100 %) of a stroke rate on the rhythm meter. */
export function meterPercent(spm, sweetSpot) {
  const top = sweetSpot.high * 1.6;
  return Math.max(0, Math.min(100, (spm / top) * 100));
}

/** A horizontal swipe between two pointer positions, or null. */
export function swipeDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.t - start.t > SWIPE_MAX_MS || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "left" : "right";
}

export class PaddleView {
  #listeners = [];
  #frame = null;
  #swipes = new Map();
  #lastCombo = 0;

  /**
   * @param {HTMLElement} root the #paddles overlay
   * @param {{tap: (side: string) => string, state: () => object}} trainer
   * @param {{onLane?: (side: "left" | "right") => void, vibrate?: (pattern: number | number[]) => void,
   *   requestAnimationFrame?: Function, cancelAnimationFrame?: Function}} [options]
   */
  constructor(
    root,
    trainer,
    {
      onLane = () => {},
      vibrate = (pattern) => globalThis.navigator?.vibrate?.(pattern),
      requestAnimationFrame: raf = (fn) => globalThis.requestAnimationFrame(fn),
      cancelAnimationFrame: caf = (id) => globalThis.cancelAnimationFrame(id),
    } = {},
  ) {
    this.root = root;
    this.trainer = trainer;
    this.onLane = onLane;
    this.vibrate = vibrate;
    this.caf = caf;
    this.raf = raf;
    this.parts = {
      left: root.querySelector('[data-side="left"]'),
      right: root.querySelector('[data-side="right"]'),
      swipe: root.querySelector(".paddle-swipe"),
      energy: root.querySelector(".paddle-energy-fill"),
      energyBar: root.querySelector(".paddle-energy"),
      band: root.querySelector(".paddle-band"),
      marker: root.querySelector(".paddle-marker"),
      hint: root.querySelector(".paddle-hint"),
      combo: root.querySelector(".paddle-combo"),
      spm: root.querySelector(".paddle-spm"),
    };
    for (const side of ["left", "right"]) this.#on(this.parts[side], "pointerdown", (event) => this.#tap(side, event));
    this.#on(this.parts.swipe, "pointerdown", (event) => this.#swipes.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp }));
    this.#on(this.parts.swipe, "pointerup", (event) => this.#swipeEnd(event));
    this.#on(this.parts.swipe, "pointercancel", (event) => this.#swipes.delete(event.pointerId));
    // Long presses must not open the context menu or select text.
    this.#on(root, "contextmenu", (event) => event.preventDefault());
    root.hidden = false;
    const loop = () => {
      this.render();
      this.#frame = this.raf(loop);
    };
    this.#frame = this.raf(loop);
  }

  #on(target, type, listener) {
    if (!target) return;
    target.addEventListener(type, listener);
    this.#listeners.push(() => target.removeEventListener(type, listener));
  }

  #tap(side, event) {
    event.preventDefault?.();
    const result = this.trainer.tap(side);
    if (result === "ignored") return;
    const pad = this.parts[side];
    if (result === "stumble") {
      this.vibrate([25, 40, 25]);
      this.#flash(pad, "stumble");
    } else {
      this.vibrate(8);
      this.#flash(pad, "hit");
      this.#ripple(pad, event);
    }
  }

  /** Restarts a short CSS animation on `element`. */
  #flash(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  #ripple(pad, event) {
    const doc = pad.ownerDocument;
    if (!doc || !Number.isFinite(event.clientX)) return;
    const box = pad.getBoundingClientRect();
    const ripple = doc.createElement("span");
    ripple.className = "paddle-ripple";
    ripple.style.left = `${event.clientX - box.left}px`;
    ripple.style.top = `${event.clientY - box.top}px`;
    ripple.addEventListener("animationend", () => ripple.remove());
    pad.append(ripple);
  }

  #swipeEnd(event) {
    const start = this.#swipes.get(event.pointerId);
    this.#swipes.delete(event.pointerId);
    if (!start) return;
    const direction = swipeDirection(start, { x: event.clientX, y: event.clientY, t: event.timeStamp });
    if (direction) this.onLane(direction);
  }

  render() {
    const state = this.trainer.state();
    const { parts } = this;
    this.root.dataset.zone = state.tired ? "tired" : state.zone;
    parts.energy.style.width = `${Math.round(state.energy * 100)}%`;
    parts.energyBar.classList.toggle("low", state.energy < 0.25);
    const low = meterPercent(state.sweetSpot.low, state.sweetSpot);
    const high = meterPercent(state.sweetSpot.high, state.sweetSpot);
    parts.band.style.left = `${low}%`;
    parts.band.style.width = `${high - low}%`;
    parts.marker.style.left = `${meterPercent(state.spm, state.sweetSpot)}%`;
    const hint = paddleHint(state);
    if (parts.hint.textContent !== hint) parts.hint.textContent = hint;
    const combo = state.combo >= 5 ? `×${state.combo}` : "";
    if (parts.combo.textContent !== combo) parts.combo.textContent = combo;
    // Milestones earn a bonus: make them pop.
    if ((state.combo === 20 || state.combo === 50) && this.#lastCombo !== state.combo) this.#flash(parts.combo, "milestone");
    this.#lastCombo = state.combo;
    const spm = state.spm ? `${state.spm} spm` : "";
    if (parts.spm.textContent !== spm) parts.spm.textContent = spm;
    for (const side of ["left", "right"]) parts[side].classList.toggle("next", state.nextSide === side || (state.nextSide === null && side === "left"));
  }

  dispose() {
    this.caf(this.#frame);
    for (const off of this.#listeners) off();
    this.#listeners = [];
    this.root.hidden = true;
  }
}
