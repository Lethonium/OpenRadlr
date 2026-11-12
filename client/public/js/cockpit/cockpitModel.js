/**
 * What the cockpit knows about the tablet's ride: the latest figures of the
 * host's rider (from the relayed state), the latest display frame, the
 * workout plan and a 20-minute history. Pure: time is injected.
 */
const STALE_AFTER_MS = 3000;
const POWER_WINDOW_MS = 3000;
const HISTORY_INTERVAL_MS = 1000;
const HISTORY_LIMIT = 1200;

export class CockpitModel {
  #now;
  #live = false;
  #name = null;
  #lastMessageAt = null;
  #rider = null;
  #race = null;
  #frame = {};
  #plan = null;
  #recent = [];
  #lastHistoryAt = null;
  #history = { power: [], hr: [], cadence: [] };

  constructor({ now }) {
    this.#now = now;
  }

  /** The watch status from the server: is the tablet riding, and whose ride it is. */
  onStatus({ live, name }) {
    this.#live = Boolean(live);
    this.#name = name ?? this.#name;
    if (this.#live) this.#lastMessageAt = this.#now();
  }

  /**
   * A relayed `state` or `studio_state`. The data view leaves only the host in
   * `riders`; `riderName` picks it out if more arrive.
   */
  onState(message, riderName) {
    const now = this.#now();
    this.#lastMessageAt = now;
    this.#race = message.race ?? null;
    const riders = message.riders ?? [];
    const rider = riders.find((r) => r.name === riderName) ?? riders[0];
    if (!rider) return;
    this.#rider = rider;
    this.#recent = this.#recent.filter((s) => now - s.t < POWER_WINDOW_MS);
    this.#recent.push({ t: now, power: rider.power });
    if (this.#lastHistoryAt === null || now - this.#lastHistoryAt >= HISTORY_INTERVAL_MS) {
      this.#lastHistoryAt = now;
      this.#push("power", rider.power ?? 0);
      this.#push("hr", this.hr ?? 0);
      this.#push("cadence", this.cadence ?? 0);
    }
  }

  /** The data of a `display` frame: a workout plan, or the live figures. */
  onDisplay(data) {
    this.#lastMessageAt = this.#now();
    if (data.workout_plan) {
      this.#plan = data.workout_plan;
      return;
    }
    this.#frame = data;
    if (!data.workout) this.#plan = null;
  }

  #push(series, value) {
    const list = this.#history[series];
    list.push(value);
    if (list.length > HISTORY_LIMIT) list.shift();
  }

  get status() {
    if (!this.#live) return "waiting";
    return this.#now() - this.#lastMessageAt > STALE_AFTER_MS ? "stale" : "live";
  }

  get live() {
    return this.status === "live";
  }

  get name() { return this.#rider?.name ?? this.#name; }
  get hostName() { return this.#name; }
  get power() { return this.#rider?.power ?? null; }
  get cadence() { return this.#rider?.cadence ?? this.#frame.workout?.cadence ?? null; }
  get speed() { return this.#rider?.speed ?? null; }
  get lap() { return this.#rider?.lap ?? null; }
  get race() { return this.#race; }
  get hr() { return this.#frame.hr ?? null; }
  get grade() { return this.#frame.grade ?? null; }
  get ftp() { return this.#frame.ftp ?? null; }
  get stats() { return this.#frame.stats ?? null; }
  get zonesS() { return this.#frame.zones_s ?? null; }
  get workout() { return this.#frame.workout ?? null; }
  get plan() { return this.#plan; }
  get history() { return this.#history; }

  /** Mean power of the last 3 s of states, or null before any. */
  get power3s() {
    const now = this.#now();
    const window = this.#recent.filter((s) => now - s.t < POWER_WINDOW_MS && Number.isFinite(s.power));
    if (window.length === 0) return null;
    return window.reduce((sum, s) => sum + s.power, 0) / window.length;
  }
}
