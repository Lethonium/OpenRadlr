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
