/**
 * The "Still riding?" prompt shown when the server warns that a rider has
 * not pedalled for a long time (see docs/protocol.md, `afk_warning`).
 *
 * Pure state: the caller feeds it the server's warning, the rider's power and
 * the clock, and renders `visible`, `canStay` and `secondsLeft()`. Pedalling
 * closes the prompt on its own; the server agrees and does not remove a rider
 * who has pedalled.
 */
export class AfkPrompt {
  #stay;
  #leave;
  #now;
  #visible = false;
  #canStay = true;
  #deadline = 0;

  /**
   * @param {{stay: () => void, leave: () => void, now: () => number}} deps
   *   `stay` sends the answer to the server; `leave` ends the ride; `now`
   *   returns milliseconds.
   */
  constructor({ stay, leave, now }) {
    this.#stay = stay;
    this.#leave = leave;
    this.#now = now;
  }

  get visible() {
    return this.#visible;
  }

  get canStay() {
    return this.#canStay;
  }

  /** Shows the prompt for a server warning `{leave_in_s, can_stay}`. */
  open({ leave_in_s: leaveInS, can_stay: canStay }) {
    this.#visible = true;
    this.#canStay = canStay !== false;
    this.#deadline = this.#now() + leaveInS * 1000;
  }

  /** Whole seconds until the ride ends, never negative. */
  secondsLeft() {
    return Math.max(0, Math.ceil((this.#deadline - this.#now()) / 1000));
  }

  /** Feeds the rider's power; any pedalling closes the prompt. */
  power(watts) {
    if (watts > 0) this.#visible = false;
  }

  /** "Stay": answers the server and closes. Ignored on the final warning. */
  pressStay() {
    if (!this.#visible || !this.#canStay) return;
    this.#visible = false;
    this.#stay();
  }

  /** "Leave now": closes and ends the ride at once. */
  pressLeave() {
    this.#visible = false;
    this.#leave();
  }
}
