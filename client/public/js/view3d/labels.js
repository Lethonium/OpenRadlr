/**
 * Name labels over other riders: whether each shows and how it looks.
 *
 * Whether a rider is in sight comes from the GPU (occlusion queries, see
 * `Renderer.queryOcclusion`) a frame or two late, and flickers where a rider
 * passes the edge of a house or a hill. So a label goes only after its rider
 * has been out of sight for `hideS`, and comes back after `showS` in sight.
 */
export class LabelVisibility {
  #riders = new Map();

  constructor({ hideS = 0.25, showS = 0.1 } = {}) {
    this.hideS = hideS;
    this.showS = showS;
  }

  /**
   * @param {boolean | undefined} seen true or false from the latest result, undefined while there is none
   * @returns {boolean} whether the label shows
   */
  update(id, seen, timeS) {
    let rider = this.#riders.get(id);
    if (!rider) {
      rider = { shown: false, seen: undefined, since: timeS };
      this.#riders.set(id, rider);
    }
    if (seen === undefined) return rider.shown;
    if (rider.seen === undefined) {
      // The first result counts at once: a new label needs no settling.
      Object.assign(rider, { shown: seen, seen, since: timeS });
      return rider.shown;
    }
    if (seen !== rider.seen) Object.assign(rider, { seen, since: timeS });
    const held = timeS - rider.since;
    if (seen && held >= this.showS) rider.shown = true;
    if (!seen && held >= this.hideS) rider.shown = false;
    return rider.shown;
  }

  /** Forgets the riders not in `ids`. */
  keep(ids) {
    for (const id of this.#riders.keys()) if (!ids.has(id)) this.#riders.delete(id);
  }
}

/** Size and opacity of a label `distance` metres away: smaller and fainter further out. */
export function labelLook(distance, maxDistance) {
  const far = Math.min(1, Math.max(0, distance / maxDistance));
  return { scale: 1 - 0.3 * far, opacity: 1 - 0.45 * far };
}
