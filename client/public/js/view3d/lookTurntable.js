/**
 * The Look preview's turning stand (#25): it turns slowly on its own, follows a drag, and waits a moment after a
 * drag before turning on. Pure: the preview feeds it time and pointer moves.
 */
export class Turntable {
  /**
   * @param {{angle?: number, speed?: number, radiansPerPixel?: number, holdS?: number, still?: boolean}} [options]
   *   `speed` radians per second on its own; `still` (reduced motion) turns only by hand
   */
  constructor({ angle = 0.7, speed = 0.45, radiansPerPixel = 0.012, holdS = 3, still = false } = {}) {
    Object.assign(this, { angle, speed, radiansPerPixel, holdS, still });
    this.held = false;
    this.wait = 0;
  }

  update(dt) {
    if (this.held || this.still) return;
    if (this.wait > 0) {
      const waited = Math.min(this.wait, dt);
      this.wait -= waited;
      dt -= waited;
    }
    this.angle += dt * this.speed;
  }

  grab() {
    this.held = true;
  }

  /** The pointer moved `dx` CSS pixels while held. */
  drag(dx) {
    if (this.held) this.angle += dx * this.radiansPerPixel;
  }

  release() {
    this.held = false;
    this.wait = this.holdS;
  }
}

/**
 * When the Look preview draws: on its own at most `maxFps` frames a second (it shares the device with the menu or
 * the ride), or, `still` (reduced motion), never on its own; then the preview draws only when something changes.
 * `onFrame(dt)` gets the seconds since the last frame drawn. Pure: the browser's frame clock is injected.
 */
export class PreviewTicker {
  #frame = 0;
  #last = 0;

  /** @param {{onFrame: (dt: number) => void, still?: boolean, maxFps?: number, raf?: Function, caf?: Function, now?: () => number}} options */
  constructor({ onFrame, still = false, maxFps = 30, raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame, now = () => performance.now() }) {
    Object.assign(this, { onFrame, still, raf, caf, now });
    // A little slack, so a 60 Hz display's frames 33.3 ms apart are not skipped for being a hair early.
    this.minGapMs = 1000 / maxFps - 1;
  }

  get running() {
    return this.#frame !== 0;
  }

  start() {
    if (this.still || this.#frame) return;
    this.#last = this.now();
    const step = (now) => {
      this.#frame = this.raf(step);
      if (now - this.#last < this.minGapMs) return;
      const dt = Math.min(0.1, (now - this.#last) / 1000);
      this.#last = now;
      this.onFrame(dt);
    };
    this.#frame = this.raf(step);
  }

  stop() {
    if (this.#frame) this.caf(this.#frame);
    this.#frame = 0;
  }
}
