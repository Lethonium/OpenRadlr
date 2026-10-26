/**
 * Getting back onto the server after the connection dropped (#73): tries
 * again and again with growing pauses, gives up after a few minutes. What
 * "connect" means (a new GameConnection that joins with the resume token)
 * is up to the caller; timers and the clock are injected for tests.
 */

/** Wait before attempt `attempt` (0-based): 1, 2, 4, 8 s, then every 15 s. */
export function reconnectDelay(attempt, delaysMs = [1000, 2000, 4000, 8000], maxDelayMs = 15000) {
  return attempt < delaysMs.length ? delaysMs[attempt] : maxDelayMs;
}

export class Reconnector {
  #running = false;
  #attempt = 0;
  #startedAt = 0;
  #timer = null;
  #attemptTimer = null;
  /** Bumped by every attempt and by stop(): late answers of older ones are dropped. */
  #generation = 0;

  /**
   * @param {{connect: () => Promise<any>, onConnected: (connection: any) => void, onGiveUp: () => void,
   *   giveUpAfterMs?: number, attemptTimeoutMs?: number, setTimer?: Function, clearTimer?: Function, now?: () => number}} options
   */
  constructor({
    connect,
    onConnected,
    onGiveUp,
    giveUpAfterMs = 180000,
    attemptTimeoutMs = 10000,
    // Wrapped: browsers only accept the timer functions called on window.
    setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = (id) => globalThis.clearTimeout(id),
    now = () => Date.now(),
  }) {
    Object.assign(this, { connect, onConnected, onGiveUp, giveUpAfterMs, attemptTimeoutMs, setTimer, clearTimer, now });
  }

  get running() {
    return this.#running;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#attempt = 0;
    this.#startedAt = this.now();
    this.#wait();
  }

  stop() {
    this.#running = false;
    this.#generation += 1;
    this.#clearTimers();
  }

  #clearTimers() {
    if (this.#timer !== null) this.clearTimer(this.#timer);
    if (this.#attemptTimer !== null) this.clearTimer(this.#attemptTimer);
    this.#timer = null;
    this.#attemptTimer = null;
  }

  /** Waits for the next attempt, but never past the give-up time. */
  #wait() {
    const left = this.giveUpAfterMs - (this.now() - this.#startedAt);
    this.#timer = this.setTimer(() => {
      this.#timer = null;
      if (this.now() - this.#startedAt >= this.giveUpAfterMs) this.#giveUp();
      else this.#try();
    }, Math.max(0, Math.min(reconnectDelay(this.#attempt), left)));
  }

  #retry() {
    this.#attempt += 1;
    this.#wait();
  }

  #giveUp() {
    this.stop();
    this.onGiveUp();
  }

  #try() {
    const generation = ++this.#generation;
    const current = () => this.#running && generation === this.#generation;
    // An attempt that never answers counts as failed.
    this.#attemptTimer = this.setTimer(() => {
      this.#attemptTimer = null;
      if (!current()) return;
      this.#generation += 1;
      this.#retry();
    }, this.attemptTimeoutMs);
    Promise.resolve()
      .then(() => this.connect())
      .then(
        (connection) => {
          if (!current()) {
            connection?.close?.();
            return;
          }
          this.stop();
          this.onConnected(connection);
        },
        () => {
          if (!current()) return;
          this.clearTimer(this.#attemptTimer);
          this.#attemptTimer = null;
          this.#retry();
        },
      );
  }
}
