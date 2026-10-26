/**
 * Bluetooth Cycling Power Service (CPS) decoding.
 *
 * Many trainers send their measured power through CPS in addition to (or
 * instead of) FTMS Indoor Bike Data. Cadence is not sent directly: it is
 * derived from cumulative crank revolutions and their event time.
 *
 * Spec: Bluetooth SIG "Cycling Power Service 1.1".
 */

export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;

const Flag = Object.freeze({
  PEDAL_POWER_BALANCE: 1 << 0,
  ACCUMULATED_TORQUE: 1 << 2,
  WHEEL_REVOLUTION_DATA: 1 << 4,
  CRANK_REVOLUTION_DATA: 1 << 5,
});

/**
 * Parses a Cycling Power Measurement notification.
 * @param {DataView} view
 * @returns {{power: number, crankRevolutions?: number, crankEventTime?: number}}
 */
export function parseCyclingPowerMeasurement(view) {
  const flags = view.getUint16(0, true);
  const result = { power: view.getInt16(2, true) };
  let offset = 4;

  if (flags & Flag.PEDAL_POWER_BALANCE) offset += 1;
  if (flags & Flag.ACCUMULATED_TORQUE) offset += 2;
  if (flags & Flag.WHEEL_REVOLUTION_DATA) offset += 6;
  if (flags & Flag.CRANK_REVOLUTION_DATA && view.byteLength >= offset + 4) {
    result.crankRevolutions = view.getUint16(offset, true);
    result.crankEventTime = view.getUint16(offset + 2, true);
  }
  return result;
}

/**
 * Turns cumulative crank data into cadence (rpm).
 * Both counters are 16 bit and wrap around; event time is in 1/1024 s.
 */
export class CadenceCalculator {
  #last = null;
  #lastChangeMs = null;
  cadence = null;

  /**
   * @param {{revolutions: number, eventTime: number}} sample
   * @param {number} nowMs wall clock, used to detect that the rider stopped
   * @param {number} [stopAfterMs] report 0 rpm after this long without a new crank event
   */
  update({ revolutions, eventTime }, nowMs, stopAfterMs = 3000) {
    if (this.#last) {
      const revs = (revolutions - this.#last.revolutions + 0x10000) % 0x10000;
      const ticks = (eventTime - this.#last.eventTime + 0x10000) % 0x10000;
      if (revs > 0 && ticks > 0) {
        this.cadence = Math.round((revs * 60 * 1024) / ticks);
        this.#lastChangeMs = nowMs;
      } else if (this.#lastChangeMs !== null && nowMs - this.#lastChangeMs > stopAfterMs) {
        this.cadence = 0;
      }
    } else {
      this.#lastChangeMs = nowMs;
    }
    this.#last = { revolutions, eventTime };
    return this.cadence;
  }
}
