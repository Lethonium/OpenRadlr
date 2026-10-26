/**
 * Bluetooth Fitness Machine Service (FTMS) encoding and decoding.
 * Pure functions on DataView / Uint8Array, so they can be tested without hardware.
 *
 * Spec: Bluetooth SIG "Fitness Machine Service 1.0".
 */

export const FTMS_SERVICE = 0x1826;
export const INDOOR_BIKE_DATA = 0x2ad2;
export const CONTROL_POINT = 0x2ad9;

export const OpCode = Object.freeze({
  REQUEST_CONTROL: 0x00,
  SET_TARGET_POWER: 0x05,
  START_OR_RESUME: 0x07,
  SET_SIMULATION_PARAMETERS: 0x11,
  RESPONSE: 0x80,
});

const Flag = Object.freeze({
  MORE_DATA: 1 << 0, // 0 means instantaneous speed IS present
  AVERAGE_SPEED: 1 << 1,
  INSTANTANEOUS_CADENCE: 1 << 2,
  AVERAGE_CADENCE: 1 << 3,
  TOTAL_DISTANCE: 1 << 4,
  RESISTANCE_LEVEL: 1 << 5,
  INSTANTANEOUS_POWER: 1 << 6,
  AVERAGE_POWER: 1 << 7,
  EXPENDED_ENERGY: 1 << 8,
  HEART_RATE: 1 << 9,
});

/**
 * Parses an Indoor Bike Data notification.
 * @param {DataView} view
 * @returns {{speedKmh?: number, cadence?: number, power?: number, heartRate?: number}}
 */
export function parseIndoorBikeData(view) {
  const flags = view.getUint16(0, true);
  let offset = 2;
  const result = {};

  if ((flags & Flag.MORE_DATA) === 0) {
    result.speedKmh = view.getUint16(offset, true) / 100;
    offset += 2;
  }
  if (flags & Flag.AVERAGE_SPEED) offset += 2;
  if (flags & Flag.INSTANTANEOUS_CADENCE) {
    result.cadence = view.getUint16(offset, true) / 2;
    offset += 2;
  }
  if (flags & Flag.AVERAGE_CADENCE) offset += 2;
  if (flags & Flag.TOTAL_DISTANCE) offset += 3;
  if (flags & Flag.RESISTANCE_LEVEL) offset += 2;
  if (flags & Flag.INSTANTANEOUS_POWER) {
    result.power = view.getInt16(offset, true);
    offset += 2;
  }
  if (flags & Flag.AVERAGE_POWER) offset += 2;
  if (flags & Flag.EXPENDED_ENERGY) offset += 5;
  if (flags & Flag.HEART_RATE) result.heartRate = view.getUint8(offset);
  return result;
}

export function encodeRequestControl() {
  return Uint8Array.of(OpCode.REQUEST_CONTROL);
}

export function encodeStartOrResume() {
  return Uint8Array.of(OpCode.START_OR_RESUME);
}

/**
 * Encodes "Set Target Power" (ERG mode): the trainer holds this power
 * regardless of cadence. Watts are a signed 16-bit value.
 */
export function encodeSetTargetPower(watts) {
  const bytes = new Uint8Array(3);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, OpCode.SET_TARGET_POWER);
  view.setInt16(1, Math.min(4000, Math.max(0, Math.round(watts))), true);
  return bytes;
}

/**
 * Encodes "Set Indoor Bike Simulation Parameters".
 * @param {{gradePercent: number, windSpeed?: number, crr?: number, cw?: number}} params
 */
export function encodeSimulationParameters({ gradePercent, windSpeed = 0, crr = 0.004, cw = 0.51 }) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const buffer = new ArrayBuffer(7);
  const view = new DataView(buffer);
  view.setUint8(0, OpCode.SET_SIMULATION_PARAMETERS);
  view.setInt16(1, clamp(Math.round(windSpeed * 1000), -32768, 32767), true);
  view.setInt16(3, clamp(Math.round(gradePercent * 100), -32768, 32767), true);
  view.setUint8(5, clamp(Math.round(crr * 10000), 0, 255));
  view.setUint8(6, clamp(Math.round(cw * 100), 0, 255));
  return new Uint8Array(buffer);
}

/**
 * Parses a control point indication.
 * @returns {{requestOpCode: number, resultCode: number, success: boolean} | null}
 */
export function parseControlPointResponse(view) {
  if (view.byteLength < 3 || view.getUint8(0) !== OpCode.RESPONSE) return null;
  const resultCode = view.getUint8(2);
  return { requestOpCode: view.getUint8(1), resultCode, success: resultCode === 0x01 };
}
