/**
 * The looks riders chose (#25) for the views: my own look from this device, the others' from `riders[].look`.
 * Codes are decoded once and kept. Pure apart from that cache.
 */
import { decodeLook, lookFromChoice } from "../profile/riderLook.js";
import { lookOf } from "./assets/riders/look.js";

/** How many decoded looks are kept. */
const CACHE_SIZE = 256;

/**
 * Whether the jerseys follow the colour code: while a race on my route counts down or runs, or an event runs, so
 * the field can be told apart. Otherwise riders wear the looks they chose.
 * @param {{race?: {phase?: string}, event?: {phase?: string}} | null} state the server's last `state`
 */
export const wearsColourCode = (state) =>
  ["countdown", "running"].includes(state?.race?.phase) || state?.event?.phase === "running";

export class RiderLooks {
  /** My own look code (none: the rolled look). */
  #mine = null;
  /** @type {Map<string, object | null>} decoded choices by code */
  #choices = new Map();

  /** Sets my own look code; null for none. */
  setMine(code) {
    this.#mine = typeof code === "string" && code ? code : null;
  }

  #choice(code) {
    if (!this.#choices.has(code)) {
      if (this.#choices.size >= CACHE_SIZE) this.#choices.delete(this.#choices.keys().next().value);
      this.#choices.set(code, decodeLook(code));
    }
    return this.#choices.get(code);
  }

  /**
   * What a rider entry needs for a rider's look: `look` and `lookKey` when they chose one this client can read,
   * `classic` when that look is the classic rider. Bots and riders without a look get nothing.
   * @param {{id: number, look?: string, is_bot?: boolean}} rider
   * @param {boolean} mine whether it is my own rider (my look comes from this device, not the server's echo)
   * @param {number} [lookId] the id the rolled look comes from
   * @returns {{look?: object, lookKey?: string, classic: boolean}}
   */
  of(rider, mine, lookId = rider.id) {
    const code = mine ? this.#mine : rider.is_bot ? null : rider.look;
    const choice = typeof code === "string" ? this.#choice(code) : null;
    if (!choice) return { classic: false };
    const look = lookFromChoice(choice, lookOf(lookId));
    return { look, lookKey: code, classic: look.classic };
  }
}
