/**
 * Virtual shifting over standard FTMS, for riders on a single physical gear
 * (e.g. a Zwift Cog). No proprietary protocol is involved: the app changes
 * the simulated grade so that pedalling feels like the chosen virtual gear.
 *
 * A gear k = r / r0 times the physical one r0 turns the road's force at the
 * pedals into k times that force, like a real gear:
 *
 *   F_trainer = k · max(F_road(v), F_floor)
 *   F_road(v) = m·g·(sin θ + Crr·cos θ) + ½·ρ·CdA·v²
 *
 * `v` is the rider's speed in the game, not one worked out from cadence:
 * that made the force grow with the cube of the gear and follow every wobble
 * in cadence, too light on descents until the legs spun up, then far too
 * hard. `F_floor` keeps something to push against on a descent, where the
 * road's force is about nothing at the speed one rolls down at.
 *
 * The trainer is asked for the grade that produces F_trainer by itself
 * (no wind, no air drag of its own: `cw` 0), so it doesn't add a drag of its
 * own wheel speed on top. Power still drives the in-game speed on the server;
 * gears only change how hard each pedal stroke is — just like real gears.
 */

const GRAVITY = 9.80665;

/** 24 virtual gears, roughly a 34/50 × 11–34 road setup, geometric steps. */
export const GEAR_RATIOS = Object.freeze(
  Array.from({ length: 24 }, (_, i) => Number((0.75 * Math.pow(5.0 / 0.75, i / 23)).toFixed(3))),
);

export class Gearbox {
  /** @param {{ratios?: number[], startGear?: number}} [options] startGear is 1-based */
  constructor({ ratios = GEAR_RATIOS, startGear = 12 } = {}) {
    this.ratios = ratios;
    this.index = Math.min(ratios.length - 1, Math.max(0, startGear - 1));
  }

  get gear() {
    return this.index + 1;
  }

  get count() {
    return this.ratios.length;
  }

  get ratio() {
    return this.ratios[this.index];
  }

  /** Harder gear. Returns true if the gear changed. */
  shiftUp() {
    if (this.index >= this.ratios.length - 1) return false;
    this.index += 1;
    return true;
  }

  /** Easier gear. Returns true if the gear changed. */
  shiftDown() {
    if (this.index <= 0) return false;
    this.index -= 1;
    return true;
  }
}

/** Least force on the pedals in the physical gear, as a grade in percent. */
export const FLOOR_GRADE = 1.5;
/** Drag of an undrafted rider, ½·ρ·CdA (the server's physics: ρ 1.225, CdA 0.32). */
const DRAG = 0.5 * 1.225 * 0.32;
/** Trainer air drag sent with a virtual gear: none, the grade carries it. */
export const SHIFTING_CW = 0;

/**
 * Grade (percent) to send to an FTMS trainer, with `cw` SHIFTING_CW, so that
 * the rider feels the virtual gear.
 * @param {{
 *   gradePercent: number, ratio: number, referenceRatio: number, speed: number | null,
 *   massKg: number, crr?: number, dragFactor?: number, floorGrade?: number,
 *   minGrade?: number, maxGrade?: number,
 * }} input `speed` m/s in the game; `dragFactor` below 1 in a draft
 */
export function effectiveGrade({
  gradePercent,
  ratio,
  referenceRatio,
  speed,
  massKg,
  crr = 0.004,
  dragFactor = 1,
  floorGrade = FLOOR_GRADE,
  minGrade = -10,
  maxGrade = 20,
}) {
  const k = ratio / referenceRatio;
  const theta = Math.atan(gradePercent / 100);
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const weight = massKg * GRAVITY;

  const road = weight * (Math.sin(theta) + crr * Math.cos(theta)) + DRAG * dragFactor * v * v;
  const wanted = k * Math.max(road, (weight * floorGrade) / 100);
  const sinTheta = Math.min(0.99, Math.max(-0.99, wanted / weight - crr));
  const grade = Math.tan(Math.asin(sinTheta)) * 100;
  return Math.min(maxGrade, Math.max(minGrade, Math.round(grade * 10) / 10));
}

export const referenceRatio = (chainring, cog) => chainring / cog;
