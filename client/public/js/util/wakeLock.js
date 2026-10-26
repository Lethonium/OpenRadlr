/**
 * Keeps the screen on while riding: a phone on the handlebars must not
 * dim mid-climb. Browsers drop the lock when the page is hidden, so it is
 * taken again when the page comes back. Without the Screen Wake Lock API
 * (older Safari, Firefox) it does nothing.
 */
export class ScreenWakeLock {
  #sentinel = null;
  #wanted = false;

  /** @param {{navigator?: any, document?: any}} [deps] */
  constructor({ navigator: nav = globalThis.navigator, document: doc = globalThis.document } = {}) {
    this.nav = nav;
    this.doc = doc;
    this.onVisibility = () => {
      if (this.#wanted && this.doc?.visibilityState === "visible") this.#request();
    };
  }

  get supported() {
    return Boolean(this.nav?.wakeLock?.request);
  }

  get held() {
    return Boolean(this.#sentinel && !this.#sentinel.released);
  }

  /** Asks for the lock and keeps asking after the page was hidden. */
  async acquire() {
    if (!this.supported || this.#wanted) return;
    this.#wanted = true;
    this.doc?.addEventListener?.("visibilitychange", this.onVisibility);
    await this.#request();
  }

  async release() {
    this.#wanted = false;
    this.doc?.removeEventListener?.("visibilitychange", this.onVisibility);
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    await sentinel?.release?.().catch?.(() => {});
  }

  async #request() {
    if (this.held) return;
    try {
      const sentinel = await this.nav.wakeLock.request("screen");
      // Released while the request was pending: give it back.
      if (!this.#wanted) return void sentinel.release?.();
      this.#sentinel = sentinel;
    } catch {
      // Denied (low battery, not visible): the ride works without it.
    }
  }
}
