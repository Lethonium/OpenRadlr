/**
 * Combines readings from several Bluetooth sources of one trainer.
 *
 * A trainer may report power both via FTMS Indoor Bike Data and via the
 * Cycling Power Service. Some trainers only fill one of them with real values
 * (and send zeros in the other). Rule: a source that recently reported a value
 * wins, preferring CPS (measured power) over FTMS. This avoids flickering
 * between a real value and a zero from the other source.
 */
export class ReadingMerger {
  #latest = new Map();

  /**
   * @param {{now?: () => number, staleMs?: number, preference?: string[]}} [options]
   */
  constructor({ now = () => Date.now(), staleMs = 3000, preference = ["cps", "ftms"] } = {}) {
    this.now = now;
    this.staleMs = staleMs;
    this.preference = preference;
  }

  /**
   * Records a reading from `source` and returns the merged reading.
   * @param {string} source e.g. "ftms" or "cps"
   * @param {{power?: number, cadence?: number, heartRate?: number}} reading
   */
  update(source, reading) {
    const now = this.now();
    const entry = this.#latest.get(source) ?? {};
    for (const key of ["power", "cadence", "heartRate"]) {
      if (Number.isFinite(reading[key])) entry[key] = { value: reading[key], at: now, nonZeroAt: reading[key] > 0 ? now : entry[key]?.nonZeroAt };
    }
    this.#latest.set(source, entry);
    return {
      power: this.#pick("power", now),
      cadence: this.#pick("cadence", now),
      heartRate: this.#pick("heartRate", now),
    };
  }

  #pick(key, now) {
    const fresh = (field) => field && now - field.at <= this.staleMs;
    const order = [...this.preference, ...[...this.#latest.keys()].filter((s) => !this.preference.includes(s))];
    const candidates = order.map((source) => this.#latest.get(source)?.[key]).filter(fresh);
    // A source that is actively reporting non-zero values beats one that only sends zeros.
    const active = candidates.find((field) => field.nonZeroAt !== undefined && now - field.nonZeroAt <= this.staleMs);
    return (active ?? candidates[0])?.value;
  }
}
