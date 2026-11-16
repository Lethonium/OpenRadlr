/**
 * How smoothly the 3D view is drawing, for the optional read-out (#117).
 *
 * A raw frames-per-second number swings too much to judge by, and an average
 * hides the stutter that riders actually feel. This keeps a short window and
 * reports both the mean and the 1% lowest frame rate, which is the number that
 * says whether a scene can be ridden.
 *
 * Pure: the caller feeds it the clock. No timers, no DOM.
 */

/** Frames kept for the 1% low. At 60 fps this is about five seconds. */
const WINDOW = 300;

/** A gap longer than this is the tab or the machine pausing, not a slow frame.
 *  Two seconds: longer than any frame a device could still be riding through. */
const PAUSE_S = 2;

export class FpsMeter {
  #frames = [];
  #last = null;

  /**
   * One frame, at `now` seconds. A gap this long means the tab or the machine
   * stopped, not that the frame was slow, so the window starts again — but the
   * bar is high on purpose: a device running at 2 fps must still get a
   * reading, and at that rate every frame is half a second.
   */
  frame(now) {
    const last = this.#last;
    this.#last = now;
    if (last === null) return;
    const delta = now - last;
    if (delta <= 0) return;
    if (delta > PAUSE_S) {
      this.#frames.length = 0;
      return;
    }
    this.#frames.push(delta);
    if (this.#frames.length > WINDOW) this.#frames.shift();
  }

  /** `{ fps, low, frames }`, or null until there is something to average. */
  read() {
    const frames = this.#frames;
    if (frames.length < 2) return null;
    const mean = frames.reduce((sum, delta) => sum + delta, 0) / frames.length;
    // The slowest 1% of the window, as a frame rate of its own.
    const slowest = Math.max(1, Math.round(frames.length * 0.01));
    const sorted = [...frames].sort((a, b) => b - a);
    const lowMean = sorted.slice(0, slowest).reduce((sum, delta) => sum + delta, 0) / slowest;
    return { fps: 1 / mean, low: 1 / lowMean, frames: frames.length };
  }

  /** Forgets the window, e.g. when the view switches from 2D back to 3D. */
  reset() {
    this.#frames.length = 0;
    this.#last = null;
  }
}

/** "58 fps · low 44", the way the read-out shows it. */
export function formatFps({ fps, low }) {
  return `${Math.round(fps)} fps · low ${Math.round(low)}`;
}
