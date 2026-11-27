/**
 * The graphics level a device starts on, and the steps down when its rides
 * run slowly. Pure: the browser signals and frame times come in as arguments.
 * Ultra is never picked automatically.
 */

/** A frame time (ms) above which the first ride steps down one level. */
const SLOW_MS = 40;
/** A frame time (ms) at the lowest level above which the device is sent to 2D. */
const UNUSABLE_MS = 70;
const LEVELS = Object.freeze(["low", "medium", "high", "ultra"]);

/**
 * @typedef {{webgl2: boolean, deviceMemory?: number, saveData?: boolean, coarsePointer?: boolean}} DeviceSignals
 */

/**
 * The level for a device by what the browser tells about it.
 * @param {DeviceSignals} signals `deviceMemory` is `navigator.deviceMemory` (missing counts as 8)
 * @returns {"2d"|"low"|"medium"|"high"}
 */
export function chooseQuality({ webgl2, deviceMemory, saveData, coarsePointer }) {
  const memory = deviceMemory ?? 8;
  if (!webgl2) return "2d";
  if (saveData || memory <= 2) return "low";
  if (coarsePointer || memory <= 4) return "medium";
  return "high";
}

/**
 * The level after a first ride: the median frame time above 40 ms steps down
 * one level; at low, above 70 ms it is 2D.
 * @param {string} level
 * @param {readonly number[]} frameMs
 * @returns {string}
 */
export function adjustQuality(level, frameMs) {
  if (frameMs.length === 0) return level;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (level === "low") return median > UNUSABLE_MS ? "2d" : level;
  if (median <= SLOW_MS) return level;
  const index = LEVELS.indexOf(level);
  return index > 0 ? LEVELS[index - 1] : level;
}

/**
 * What the first run stores, or null when a quality is stored already (a stored
 * choice is never overwritten). A stored view is kept too.
 * @param {string|null} storedQuality
 * @param {DeviceSignals} signals
 * @param {string|null} storedView
 * @returns {{quality: string, auto: boolean, view: "2d"|null, notice: boolean}|null}
 */
export function firstRunQuality(storedQuality, signals, storedView) {
  if (storedQuality) return null;
  const pick = chooseQuality(signals);
  if (pick === "2d") return { quality: "low", auto: false, view: storedView ? null : "2d", notice: !storedView };
  return { quality: pick, auto: true, view: null, notice: false };
}

/**
 * Watches the frame times of an automatically picked level during rides and
 * asks for one level down whenever a window of `frames` frames runs slowly
 * (`adjustQuality`), as often as needed. Long stalls of a visible page count;
 * the time a page spends hidden does not (`pause` drops the frame baseline).
 * After a step the probe waits `cooldownS` seconds for the new level to settle
 * (its world is rebuilt) before it measures again.
 */
export class QualityProbe {
  #frames;
  #cooldownS;
  #last = null;
  #samples = [];
  #quietUntil = -Infinity;

  /** @param {{frames?: number, cooldownS?: number}} [options] */
  constructor({ frames = 90, cooldownS = 20 } = {}) {
    this.#frames = frames;
    this.#cooldownS = cooldownS;
  }

  /**
   * A frame shown at `time` (seconds) on `level`.
   * @returns {string | null} the level to switch to ("2d" for the 2D view), or null to stay
   */
  frame(time, level) {
    const last = this.#last;
    this.#last = time;
    if (last === null || last < this.#quietUntil) return null;
    this.#samples.push((time - last) * 1000);
    if (this.#samples.length < this.#frames) return null;
    const next = adjustQuality(level, this.#samples);
    this.#samples = [];
    if (next === level) return null;
    this.#quietUntil = time + this.#cooldownS;
    return next;
  }

  /** The page was hidden or shown again: the next frame starts a new gap. */
  pause() {
    this.#last = null;
  }

  /** A new ride, the 2D view or leaving the ride: drops the partial window too. */
  reset() {
    this.#last = null;
    this.#samples = [];
  }
}
