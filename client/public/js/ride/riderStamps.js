/**
 * When each rider on the map was first seen parked, and since when a workout
 * rider has its exercise. The views draw the animation from these stamps, so
 * the tablet and the VR page keep them the same way. The clock is injected.
 */
export class RiderStamps {
  #now;
  #parked = new Map();
  #exercise = new Map();

  /** @param {{now: () => number}} deps `now` in seconds */
  constructor({ now }) {
    this.#now = now;
  }

  /** The rider with `parkedSince` (null unless parked) and `exerciseSince` added. */
  stamp(rider) {
    return { ...rider, parkedSince: this.#parkedSince(rider), exerciseSince: this.#exerciseSince(rider) };
  }

  /** Forgets the riders that are no longer in `riders` (and the parked stamp of one that stopped parking). */
  keep(riders) {
    for (const id of this.#parked.keys()) if (!riders.some((rider) => rider.id === id && rider.parked)) this.#parked.delete(id);
    for (const id of this.#exercise.keys()) if (!riders.some((rider) => rider.id === id)) this.#exercise.delete(id);
  }

  #parkedSince(rider) {
    if (!rider.parked) return null;
    if (!this.#parked.has(rider.id)) this.#parked.set(rider.id, this.#now());
    return this.#parked.get(rider.id);
  }

  #exerciseSince(rider) {
    const exercise = rider.exercise ?? null;
    const seen = this.#exercise.get(rider.id);
    if (!seen || seen.exercise !== exercise) this.#exercise.set(rider.id, { exercise, since: this.#now() });
    return this.#exercise.get(rider.id).since;
  }
}
