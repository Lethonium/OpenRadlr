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

/**
 * Whether controller buttons navigate (true) or ride (false). `screen`: what is in
 * front ("setup", "finish", "drawer", or null while riding). The start menu and
 * the end of a ride have nothing to shift; a drawer is navigated only when the
 * controller opened it, so a menu opened by mouse or touch keeps the shifters shifting.
 */
export function controllerNavigates({ screen, openedByController }) {
  if (screen === "setup" || screen === "finish") return true;
  if (screen === "drawer") return openedByController;
  return false;
}

/** A press back within this long after its release is the same press (a half relaying the other). */
export const RELAY_MS = 120;

/**
 * Several controllers as one stream of presses. The two halves of a Zwift Click
 * differ: one relays the other's presses and sends its own, the other only its
 * own, so with both connected a press can arrive twice, at nearly the same time
 * or just after the first copy was released. The pressed buttons of all of
 * them are merged; a press that comes back within RELAY_MS of another
 * controller releasing it is that press's relayed copy and is held back, so
 * every press acts once.
 */
export class MergedControllers {
  #input;
  #now;
  #relayMs;
  #pressed = new Map();
  #releasedAt = new Map();
  /** Per button: which controllers held it when it was last released. */
  #releasedBy = new Map();
  #lastUnion = new Set();
  /** Buttons held now only as a relayed copy of a press that already acted: the input never sees them. */
  #suppressed = new Set();

  /** @param {ControllerInput} input @param {{now?: () => number, relayMs?: number}} [options] now in milliseconds */
  constructor(input, { now = () => performance.now(), relayMs = RELAY_MS } = {}) {
    this.#input = input;
    this.#now = now;
    this.#relayMs = relayMs;
  }

  /** Controller `id` reports the buttons pressed now; returns the actions to run. */
  update(id, pressed, navigating) {
    const t = this.#now();
    const holders = this.#holders();
    this.#pressed.set(id, new Set(pressed));
    const union = this.#union();
    this.#released(union, holders, t);
    for (const button of this.#suppressed) if (!union.has(button)) this.#suppressed.delete(button);
    // Back right after another controller released it: the relayed copy of that press, not a new one.
    // Only copies are held back: what the input sees is what is really pressed, so a quick + then −
    // is two shifts, never "both together" (which opens the menu).
    for (const button of union) {
      if (this.#lastUnion.has(button)) continue;
      const by = this.#releasedBy.get(button);
      const recent = t - (this.#releasedAt.get(button) ?? -Infinity) < this.#relayMs;
      if (recent && by?.size && !by.has(id)) this.#suppressed.add(button);
    }
    this.#lastUnion = union;
    return this.#input.update(this.#effective(union), navigating);
  }

  /** A controller dropped: what it held counts as released, for the input too. */
  forget(id) {
    const holders = this.#holders();
    this.#pressed.delete(id);
    const union = this.#union();
    this.#released(union, holders, this.#now());
    for (const button of this.#suppressed) if (!union.has(button)) this.#suppressed.delete(button);
    this.#lastUnion = union;
    this.#input.update(this.#effective(union), false);
  }

  #effective(union) {
    return [...union].filter((button) => !this.#suppressed.has(button));
  }

  /** button → the controllers holding it now */
  #holders() {
    const holders = new Map();
    for (const [id, buttons] of this.#pressed) for (const button of buttons) holders.set(button, new Set([...(holders.get(button) ?? []), id]));
    return holders;
  }

  #released(union, holders, t) {
    for (const button of this.#lastUnion) {
      if (union.has(button)) continue;
      this.#releasedAt.set(button, t);
      this.#releasedBy.set(button, holders.get(button) ?? new Set());
    }
  }

  #union() {
    return new Set([...this.#pressed.values()].flatMap((buttons) => [...buttons]));
  }
}
