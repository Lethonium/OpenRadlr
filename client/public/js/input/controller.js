/**
 * Turns controller button states into the same action names the keyboard
 * produces (see input/keyboard.js), plus three navigation actions for menus:
 * focusNext, focusPrev and select.
 *
 * What a button does depends on whether the rider is navigating (a menu,
 * dialog or the start screen is in front) or riding. Pressing both shift
 * buttons together is a chord: it opens the menu while riding and selects
 * while navigating, so a two-button Zwift Click can do both.
 */

export const RIDING_ACTIONS = Object.freeze({
  shiftUp: "shiftUp",
  shiftDown: "shiftDown",
  left: "laneLeft",
  right: "laneRight",
  up: "powerUp",
  down: "powerDown",
  a: "cycleCamera",
  b: "closePanels",
  y: "toggleMenu",
  z: "takePhoto",
  chord: "toggleMenu",
});

export const NAVIGATING_ACTIONS = Object.freeze({
  shiftUp: "focusNext",
  shiftDown: "focusPrev",
  left: "focusPrev",
  right: "focusNext",
  up: "focusPrev",
  down: "focusNext",
  a: "select",
  b: "closePanels",
  y: "toggleMenu",
  chord: "select",
});

/** Undoes the first half of a chord. */
const OPPOSITE = Object.freeze({
  shiftUp: "shiftDown",
  shiftDown: "shiftUp",
  focusNext: "focusPrev",
  focusPrev: "focusNext",
});

const CHORD = ["shiftUp", "shiftDown"];

export class ControllerInput {
  /** button → { at, action } for buttons held down right now */
  #held = new Map();
  #now;
  #chordMs;

  /** @param {{now?: () => number, chordMs?: number}} [options] now in milliseconds */
  constructor({ now = () => performance.now(), chordMs = 250 } = {}) {
    this.#now = now;
    this.#chordMs = chordMs;
  }

  /**
   * Feeds the buttons that are pressed now; returns the actions to run.
   * Buttons act when pressed, not when released, so shifting feels instant.
   * If the second chord button follows the first within `chordMs`, the first
   * button's action is undone and the chord's action runs instead.
   * @param {string[]} pressed
   * @param {boolean} navigating
   * @returns {string[]}
   */
  update(pressed, navigating) {
    const map = navigating ? NAVIGATING_ACTIONS : RIDING_ACTIONS;
    const now = this.#now();
    const down = new Set(pressed);
    for (const button of [...this.#held.keys()]) if (!down.has(button)) this.#held.delete(button);

    const fresh = [...down].filter((button) => !this.#held.has(button));
    const actions = [];
    const chordNow = CHORD.every((button) => down.has(button)) && CHORD.some((button) => fresh.includes(button));
    if (chordNow) {
      const earlier = CHORD.map((button) => this.#held.get(button)).find(Boolean);
      const inTime = !earlier || now - earlier.at <= this.#chordMs;
      if (inTime) {
        if (earlier && OPPOSITE[earlier.action]) actions.push(OPPOSITE[earlier.action]);
        if (map.chord) actions.push(map.chord);
        for (const button of CHORD) this.#held.set(button, { at: now, action: null });
      }
    }
    for (const button of fresh) {
      if (this.#held.has(button)) continue; // consumed by the chord
      const action = map[button] ?? null;
      this.#held.set(button, { at: now, action });
      if (action) actions.push(action);
    }
    return actions;
  }
}
