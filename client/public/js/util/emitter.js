/** Minimal event emitter used by connections and devices. */
export class Emitter {
  #listeners = new Map();

  /** Registers a listener and returns a function that removes it. */
  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  emit(event, payload) {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload);
  }
}
