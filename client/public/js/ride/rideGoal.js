/** Personal ride goals. Totals come from the recorder; no clock or I/O here. */
const FIELDS = { time: "durationS", distance: "distanceM", climbing: "elevationGainM" };
const valid = (kind, target) => Object.hasOwn(FIELDS, kind) && Number.isFinite(target) && target > 0;

export const goalUnit = (kind, units) => kind === "time" ? "min" : kind === "distance" ? (units === "imperial" ? "mi" : "km") : (units === "imperial" ? "ft" : "m");
export const goalTarget = (kind, value, units) => value * (kind === "time" ? 60 : kind === "distance" ? (units === "imperial" ? 1609.344 : 1000) : (units === "imperial" ? 0.3048 : 1));

export class RideGoal {
  kind = null;
  target = 0;
  completed = false;
  progress = 0;
  current = 0;

  constructor(saved) {
    if (saved && valid(saved.kind, saved.target)) {
      this.set(saved.kind, saved.target);
      this.completed = saved.completed === true;
    }
  }

  set(kind, target) {
    if (!valid(kind, target)) throw new RangeError("Invalid ride goal"); // i18n-ok (internal)
    this.kind = kind;
    this.target = target;
    this.completed = false;
    this.progress = 0;
    this.current = 0;
  }

  clear() {
    this.kind = null;
    this.target = this.current = this.progress = 0;
    this.completed = false;
  }

  /** Returns true only on the update that first reaches the target. */
  update(summary) {
    if (!this.kind) return false;
    const value = summary[FIELDS[this.kind]];
    if (!Number.isFinite(value)) return false;
    this.current = Math.max(0, value);
    this.progress = Math.min(1, this.current / this.target);
    if (this.completed || this.progress < 1) return false;
    this.completed = true;
    return true;
  }

  snapshot() {
    return this.kind ? { kind: this.kind, target: this.target, completed: this.completed } : null;
  }
}
