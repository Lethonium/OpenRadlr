/** Bluetooth Heart Rate Service decoding. */

export const HEART_RATE_SERVICE = 0x180d;
export const HEART_RATE_MEASUREMENT = 0x2a37;

/**
 * Parses a Heart Rate Measurement notification.
 * @param {DataView} view
 * @returns {number} beats per minute
 */
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  return is16Bit ? view.getUint16(1, true) : view.getUint8(1);
}
