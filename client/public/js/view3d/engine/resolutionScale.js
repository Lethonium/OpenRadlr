/**
 * Dynamic resolution: the share of the drawing buffer's pixels a view draws,
 * chosen from how long its frames take. Slow frames over a while lower it a
 * step, down to the quality level's `resolutionFloor`; a while of fast frames
 * wins a step back. Most of a frame's GPU time scales with its pixels, so this
 * holds the frame rate on a weaker GPU (or a large Retina window) where a fixed
 * resolution would drop frames. Pure: the frame times come in as arguments.
 */

/** A frame longer than this (ms) is a gap (a hidden tab, a debugger), not a slow frame. */
const GAP_MS = 250;
/** A single frame longer than this (ms) is a hitch (a shader compile), left out of the average. */
const HITCH_MS = 120;

export class ResolutionGovernor {
  /** The share of the full resolution to draw at, `floor`..1. */
  scale = 1;
  #floor;
  #budgetMs;
  #step;
  #downAfterS;
  #baseUpAfterS;
  #upAfterS;
  #average = null;
  #slowS = 0;
  #fastS = 0;
  /** Seconds since the last step: a step's own first frames are not judged. */
  #sinceStepS = Infinity;
  /** Whether the last step was up, and how long ago: a quick step back down means that scale was too much. */
  #lastUp = false;

  /**
   * @param {{floor?: number, budgetMs?: number, step?: number, downAfterS?: number, upAfterS?: number}} [options]
   *   `floor` the lowest scale (1 turns scaling off), `budgetMs` the frame time aimed for (60 fps), `step` one change
   *   of the scale, `downAfterS` how long frames must be slow before a step down, `upAfterS` fast before a step up
   */
  constructor({ floor = 1, budgetMs = 1000 / 60, step = 0.1, downAfterS = 0.75, upAfterS = 3 } = {}) {
    this.#floor = clampFloor(floor);
    this.#budgetMs = budgetMs;
    this.#step = step;
    this.#downAfterS = downAfterS;
    this.#baseUpAfterS = upAfterS;
    this.#upAfterS = upAfterS;
  }

  /** A new lowest scale (a quality level changed); the scale is lifted to it if below. */
  setFloor(floor) {
    this.#floor = clampFloor(floor);
    if (this.scale < this.#floor) this.scale = this.#floor;
    if (this.#floor >= 1) this.scale = 1;
    this.#restart();
  }

  /**
   * One frame's interval (ms since the last frame).
   * @param {number} frameMs
   * @returns {number} the scale to draw the next frame at
   */
  sample(frameMs) {
    if (!(frameMs > 0) || frameMs > GAP_MS || this.#floor >= 1) return this.scale;
    const seconds = frameMs / 1000;
    this.#sinceStepS += seconds;
    if (frameMs > HITCH_MS) return this.scale;
    this.#average = this.#average === null ? frameMs : this.#average + (frameMs - this.#average) * 0.1;
    // The frames right after a step resize the targets and settle; they say nothing about the new scale yet.
    if (this.#sinceStepS < 0.3) return this.scale;
    const slow = this.#average > this.#budgetMs * 1.2;
    const fast = this.#average < this.#budgetMs * 1.08;
    this.#slowS = slow ? this.#slowS + seconds : 0;
    this.#fastS = fast ? this.#fastS + seconds : 0;
    if (this.#slowS >= this.#downAfterS && this.scale > this.#floor) {
      // Straight back down after a step up: that scale was too much, so the next try waits twice as long.
      if (this.#lastUp && this.#sinceStepS < this.#upAfterS) this.#upAfterS = Math.min(this.#upAfterS * 2, 60);
      this.#setScale(Math.max(this.#floor, this.scale - this.#step), false);
    } else if (this.#fastS >= this.#upAfterS && this.scale < 1) {
      this.#setScale(Math.min(1, this.scale + this.#step), true);
    } else if (this.#lastUp && this.#sinceStepS > this.#upAfterS * 2) {
      // A step up that held: the waiting starts over.
      this.#upAfterS = this.#baseUpAfterS;
      this.#lastUp = false;
    }
    return this.scale;
  }

  #setScale(scale, up) {
    // Whole hundredths: a target resized to a scale it had keeps its exact size.
    this.scale = Math.round(scale * 100) / 100;
    this.#lastUp = up;
    this.#sinceStepS = 0;
    this.#slowS = 0;
    this.#fastS = 0;
    this.#average = null;
  }

  #restart() {
    this.#slowS = 0;
    this.#fastS = 0;
    this.#average = null;
    this.#sinceStepS = 0;
  }
}

const clampFloor = (floor) => Math.min(1, Math.max(0.25, Number.isFinite(floor) ? floor : 1));
