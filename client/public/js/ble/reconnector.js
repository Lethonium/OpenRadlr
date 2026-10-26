/**
 * Keeps a Bluetooth device connected. After the link drops it opens the
 * device again, waiting longer after every failed attempt, until it works or
 * close() is called. No chooser is needed: the BluetoothDevice the browser
 * handed out once can connect again for as long as the page lives (#43).
 */

/** Waits between reconnect attempts; the last one repeats. */
export const RECONNECT_DELAYS_MS = Object.freeze([1000, 2000, 5000, 10000, 30000]);

export class Reconnector {
  #timer = null;
  #attempt = 0;
  #closed = false;
  #reconnecting = false;

  /**
   * @param {{
   *   open: () => Promise<void>, release: () => void,
   *   onLost?: () => void, onBack?: () => void, onFailed?: (error: Error, attempt: number) => void,
   *   setTimeout?: Function, clearTimeout?: Function,
   * }} deps `open` connects and subscribes again; `release` drops a link
   *   that came back after close()
   */
  constructor({
    open,
    release,
    onLost = () => {},
    onBack = () => {},
    onFailed = () => {},
    setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: cancel = (id) => globalThis.clearTimeout(id),
  }) {
    Object.assign(this, { open, release, onLost, onBack, onFailed, schedule, cancel });
  }

  get closed() {
    return this.#closed;
  }

  /** The link dropped (`gattserverdisconnected`): try again in a moment. */
  lost() {
    // A failed attempt can drop the link again; its own retry is already planned.
    if (this.#closed || this.#reconnecting || this.#timer !== null) return;
    this.onLost();
    this.#attempt = 0;
    this.#scheduleRetry();
  }

  /** Stops trying, e.g. when the rider disconnects the device on purpose. */
  close() {
    this.#closed = true;
    if (this.#timer !== null) this.cancel(this.#timer);
    this.#timer = null;
  }

  #scheduleRetry() {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.#attempt += 1;
    this.#timer = this.schedule(() => this.#retry(), delay);
  }

  async #retry() {
    this.#timer = null;
    if (this.#closed) return;
    this.#reconnecting = true;
    try {
      await this.open();
      this.#reconnecting = false;
      if (this.#closed) return this.release();
      this.onBack();
    } catch (error) {
      this.#reconnecting = false;
      this.onFailed(error, this.#attempt);
      if (!this.#closed) this.#scheduleRetry();
    }
  }
}
