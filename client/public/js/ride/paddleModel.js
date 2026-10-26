/**
 * Phone paddles: riding without a trainer by tapping the left and right
 * side of the screen in turn, like pedal strokes. Pure and clock-driven
 * (times in milliseconds are passed in), so it is tested without timers.
 *
 * - Alternating taps are strokes; strokes per minute ("spm") set the power.
 * - A steady rhythm in the sweet spot gives 75 % of FTP. Faster goes up to
 *   150 % of FTP, but drains an energy budget (about 45 s flat out) that
 *   refills when riding easier. With the tank empty, power is held at FTP.
 * - The same side twice is a stumble: no stroke, the combo restarts.
 *   A clean combo earns a little extra (+5 % from 20, +10 % from 50).
 * - Climbs move the sweet spot lower: slower, heavier strokes, like an
 *   easier gear.
 * - Power eases in and fades out within about two seconds without taps.
 */

export const SIDES = Object.freeze(["left", "right"]);

export const PADDLE = Object.freeze({
  sweetSpm: 120,
  /** Sweet spot spm lost per percent of climbing, up to `maxClimb`. */
  climbSpmPerPercent: 4,
  maxClimb: 10,
  /** Width of the sweet spot around its centre (± fraction). */
  sweetBand: 0.1,
  sweetFraction: 0.75,
  maxFraction: 1.5,
  /** Spm (relative to the sweet spot) where the sprint tops out. */
  sprintSpan: 0.75,
  /** Seconds at the maximum until the tank is empty. */
  drainS: 45,
  /** Seconds to refill an empty tank when not pedalling at all. */
  refillS: 40,
  /** Below this fraction of FTP the tank refills. */
  refillBelow: 0.9,
  /** Taps closer than this are two thumbs at once, not a rhythm. */
  minIntervalMs: 70,
  /** Without a stroke for this long the rider coasts to a stop. */
  idleMs: 2000,
  stumbleMs: 450,
  powerTauS: 0.5,
  /** rpm reported for one stroke per minute (a sweet 120 spm reads 90 rpm), up to a believable maximum. */
  rpmPerSpm: 0.75,
  maxRpm: 130,
  combos: [
    [50, 1.1],
    [20, 1.05],
  ],
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Fraction of FTP for a stroke rate relative to the sweet spot (1 = in it). */
export function paddleFraction(relativeSpm) {
  if (relativeSpm <= 0) return 0;
  if (relativeSpm <= 1) return PADDLE.sweetFraction * relativeSpm ** 1.2;
  const sprint = Math.min(1, (relativeSpm - 1) / PADDLE.sprintSpan);
  return PADDLE.sweetFraction + (PADDLE.maxFraction - PADDLE.sweetFraction) * sprint;
}

/** Power bonus for a clean combo. */
export function comboBonus(combo) {
  for (const [from, bonus] of PADDLE.combos) if (combo >= from) return bonus;
  return 1;
}

export class PaddleModel {
  combo = 0;
  bestCombo = 0;
  energy = 1;
  grade = 0;
  power = 0;
  lastSide = null;
  #spm = 0;
  #lastStrokeT = null;
  #lastUpdateT = null;
  #stumbleUntil = -Infinity;

  /** @param {{ftp?: number}} [options] */
  constructor({ ftp = 200 } = {}) {
    this.ftp = Math.max(50, Number(ftp) || 200);
  }

  /** Centre of the sweet spot in strokes per minute: lower on climbs. */
  get sweetCenter() {
    return PADDLE.sweetSpm - clamp(this.grade, 0, PADDLE.maxClimb) * PADDLE.climbSpmPerPercent;
  }

  get sweetSpot() {
    const center = this.sweetCenter;
    return { low: Math.round(center * (1 - PADDLE.sweetBand)), high: Math.round(center * (1 + PADDLE.sweetBand)) };
  }

  setGrade(gradePercent) {
    this.grade = Number.isFinite(gradePercent) ? gradePercent : 0;
  }

  /**
   * A tap on one paddle.
   * @param {"left" | "right"} side
   * @param {number} t time in ms
   * @returns {"stroke" | "stumble" | "ignored"}
   */
  tap(side, t) {
    if (!SIDES.includes(side)) return "ignored";
    this.update(t);
    if (side === this.lastSide) {
      this.combo = 0;
      this.#stumbleUntil = t + PADDLE.stumbleMs;
      return "stumble";
    }
    const last = this.#lastStrokeT;
    if (last !== null && t - last < PADDLE.minIntervalMs) return "ignored";
    this.lastSide = side;
    this.#lastStrokeT = t;
    if (last === null || t - last > PADDLE.idleMs) {
      // The first stroke of an effort: no rate yet, the next one sets it.
      this.#spm = 0;
      this.combo = 1;
    } else {
      const instant = 60000 / (t - last);
      this.#spm = this.#spm ? 0.5 * this.#spm + 0.5 * instant : instant;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    }
    return "stroke";
  }

  /** Stroke rate at `t`: it falls once the next stroke is overdue. */
  spmAt(t) {
    if (this.#lastStrokeT === null || !this.#spm) return 0;
    const gap = t - this.#lastStrokeT;
    if (gap > PADDLE.idleMs) return 0;
    const expected = 60000 / this.#spm;
    return gap > expected ? Math.min(this.#spm, 60000 / gap) : this.#spm;
  }

  /** Power the rhythm asks for at `t`, before easing in. */
  targetPower(t) {
    const fraction = paddleFraction(this.spmAt(t) / this.sweetCenter) * comboBonus(this.combo);
    const capped = this.energy > 0 ? fraction : Math.min(fraction, 1);
    return capped * this.ftp;
  }

  /** Advances power and energy to `t` (ms). Safe to call at any rate. */
  update(t) {
    const dt = this.#lastUpdateT === null ? 0 : clamp((t - this.#lastUpdateT) / 1000, 0, 5);
    this.#lastUpdateT = Math.max(t, this.#lastUpdateT ?? t);
    if (this.#lastStrokeT !== null && t - this.#lastStrokeT > PADDLE.idleMs) this.combo = 0;
    const target = this.targetPower(t);
    this.power += (target - this.power) * (1 - Math.exp(-dt / PADDLE.powerTauS));
    if (target < 1 && this.power < 1) this.power = 0;
    const fraction = this.power / this.ftp;
    if (fraction > 1) {
      this.energy -= ((fraction - 1) / (PADDLE.maxFraction - 1) / PADDLE.drainS) * dt;
    } else if (fraction < PADDLE.refillBelow) {
      this.energy += ((PADDLE.refillBelow - fraction) / PADDLE.refillBelow / PADDLE.refillS) * dt;
    }
    this.energy = clamp(this.energy, 0, 1);
  }

  /** Everything the trainer and the paddle view show, at `t` (ms). */
  reading(t) {
    this.update(t);
    const spm = this.spmAt(t);
    const relative = spm / this.sweetCenter;
    let zone = "idle";
    if (spm > 0) zone = relative < 1 - PADDLE.sweetBand ? "easy" : relative <= 1 + PADDLE.sweetBand ? "sweet" : "sprint";
    return {
      power: Math.round(this.power),
      cadence: Math.round(Math.min(spm * PADDLE.rpmPerSpm, PADDLE.maxRpm)),
      spm: Math.round(spm),
      energy: this.energy,
      combo: this.combo,
      bestCombo: this.bestCombo,
      zone,
      tired: this.energy <= 0,
      stumbling: t < this.#stumbleUntil,
      nextSide: this.lastSide === "left" ? "right" : this.lastSide === "right" ? "left" : null,
      sweetSpot: this.sweetSpot,
      climbing: this.grade >= 3,
    };
  }
}
