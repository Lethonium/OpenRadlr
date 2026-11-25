/**
 * The ride streams of one rider (ride/rideStream.js), kept next to the ride history in
 * their own IndexedDB: one gzipped stream per finished ride, under "stream:<ride id>".
 * The store is injected (`indexedDbStore`); a failing one is reported once and never
 * throws, like the history: a ride without its stream still has its record.
 */

import { decodeStream, encodeStream } from "./rideStream.js";

const PREFIX = "stream:";

export class RideStreams {
  #reported = false;
  #persistAsked = false;

  /**
   * @param {{
   *   store: {get: Function, put: Function, delete: Function, keys: Function},
   *   encode?: typeof encodeStream,
   *   decode?: typeof decodeStream,
   *   persist?: () => Promise<boolean>,
   *   log?: (...args: any[]) => void,
   * }} deps `persist` asks the browser not to evict the streams (`navigator.storage.persist`)
   */
  constructor({ store, encode = encodeStream, decode = decodeStream, persist = () => globalThis.navigator?.storage?.persist?.(), log = console.warn }) {
    Object.assign(this, { store, encode, decode, persist, log });
  }

  async #safely(act, fallback) {
    try {
      return await act();
    } catch (error) {
      if (!this.#reported) {
        this.#reported = true;
        this.log("Ride streams unavailable:", error); // i18n-ok
      }
      return fallback;
    }
  }

  /** Keeps the stream of a finished ride; false when there was nothing to keep or the store refused. */
  async save(rideId, recording) {
    if ((recording?.samples?.length ?? 0) === 0) return false;
    const saved = await this.#safely(async () => {
      await this.store.put(PREFIX + rideId, await this.encode(recording, rideId));
      return true;
    }, false);
    if (saved) this.#askToPersist();
    return saved;
  }

  /** Once: streams are worth keeping when the browser runs short of room. A refusal changes nothing. */
  #askToPersist() {
    if (this.#persistAsked) return;
    this.#persistAsked = true;
    Promise.resolve()
      .then(() => this.persist())
      .catch(() => {});
  }

  /** The recording of ride `rideId` (what `RideRecorder.from` takes), or null without a stream. */
  get(rideId) {
    return this.#safely(async () => {
      const bytes = await this.store.get(PREFIX + rideId);
      return bytes ? (await this.decode(bytes)).recording : null;
    }, null);
  }

  /** Removes a ride's stream; false when the store refused. */
  delete(rideId) {
    return this.#safely(async () => {
      await this.store.delete(PREFIX + rideId);
      return true;
    }, false);
  }

  /** The ids of the rides that have a stream. */
  ids() {
    return this.#safely(async () => (await this.store.keys()).filter((key) => key.startsWith(PREFIX)).map((key) => key.slice(PREFIX.length)), []);
  }

  /** What the streams take, in bytes. */
  bytes() {
    return this.#safely(async () => {
      let total = 0;
      for (const key of await this.store.keys()) {
        if (!key.startsWith(PREFIX)) continue;
        total += (await this.store.get(key))?.byteLength ?? 0;
      }
      return total;
    }, 0);
  }
}
