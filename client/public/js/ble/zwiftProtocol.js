/**
 * Codec for Zwift's controller protocol (Zwift Click, Play and Ride).
 *
 * The protocol is proprietary; this follows the community's public
 * reverse-engineering notes (see docs/devices.md and ADR 0012). We only use
 * the unencrypted mode: after the "RideOn" handshake the controller sends
 * button states as small protobuf messages, one type byte first.
 *
 * Messages are decoded into neutral button names, so the input layer never
 * needs to know which controller pressed them:
 *   shiftUp, shiftDown, up, down, left, right, a, b, y, z
 */

export const ZWIFT_COMPANY_ID = 0x094a;
/** Click and Play. */
export const ZWIFT_SERVICE = "00000001-19ca-4651-86e5-fa29dcdd09d1";
/** Ride and newer firmware advertise this short service instead. */
export const ZWIFT_RIDE_SERVICE = 0xfc82;
/** Button and battery notifications. */
export const ASYNC_CHARACTERISTIC = "00000002-19ca-4651-86e5-fa29dcdd09d1";
/** Commands to the controller (the handshake). */
export const SYNC_RX_CHARACTERISTIC = "00000003-19ca-4651-86e5-fa29dcdd09d1";
/** Answers from the controller (indications). */
export const SYNC_TX_CHARACTERISTIC = "00000004-19ca-4651-86e5-fa29dcdd09d1";

const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]; // "RideOn"

export const MESSAGE_TYPES = Object.freeze({
  play: 0x07,
  idle: 0x15,
  battery: 0x19,
  ride: 0x23,
  click: 0x37,
});

/** In Click and Play messages a button field of 0 means "pressed". */
const PRESSED = 0;

/**
 * Zwift Ride and the two-piece Click v2: a map in which a cleared bit means
 * "pressed" (verified with a Click v2). The left lever shifts down and the
 * right lever up, whichever of a lever's two buttons is pressed.
 * Not mapped: 0x400/0x4000 power-up and 0x800/0x8000 on/off buttons.
 */
const RIDE_BUTTONS = [
  [0x0001, "left"],
  [0x0002, "up"],
  [0x0004, "right"],
  [0x0008, "down"],
  [0x0010, "a"],
  [0x0020, "b"],
  [0x0040, "y"],
  [0x0080, "z"],
  [0x0100, "shiftDown"], // left lever (Click v2: "−")
  [0x0200, "shiftDown"],
  [0x1000, "shiftUp"], // right lever (Click v2: "+")
  [0x2000, "shiftUp"],
];

/** The handshake that switches the controller to plain (unencrypted) messages. */
export function encodeHandshake() {
  return Uint8Array.from(RIDE_ON);
}

/**
 * Decodes one notification.
 * @param {DataView} view
 * @returns {{kind: "handshake"} | {kind: "buttons", buttons: string[]} | {kind: "battery", level: number} | {kind: "idle"} | {kind: "unknown", type: number}}
 */
export function parseControllerMessage(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes.length === 0) return { kind: "unknown", type: -1 };
  if (RIDE_ON.every((b, i) => bytes[i] === b)) return { kind: "handshake" };

  const type = bytes[0];
  const fields = () => readFields(bytes, 1);
  switch (type) {
    case MESSAGE_TYPES.click:
      return { kind: "buttons", buttons: clickButtons(fields()) };
    case MESSAGE_TYPES.play:
      return { kind: "buttons", buttons: playButtons(fields()) };
    case MESSAGE_TYPES.ride: {
      // Without a button map the message carries no button state (e.g. only paddle values).
      const buttons = rideButtons(fields());
      return buttons ? { kind: "buttons", buttons } : { kind: "idle" };
    }
    case MESSAGE_TYPES.battery:
      return { kind: "battery", level: fields().get(2) ?? fields().get(1) ?? 0 };
    case MESSAGE_TYPES.idle:
      return { kind: "idle" };
    default:
      return { kind: "unknown", type };
  }
}

function clickButtons(fields) {
  const buttons = [];
  if (fields.get(1) === PRESSED) buttons.push("shiftUp");
  if (fields.get(2) === PRESSED) buttons.push("shiftDown");
  return buttons;
}

/**
 * A Play controller is one half of a pair. The right half has the Y/Z/A/B
 * buttons and shifts up; the left half has the d-pad and shifts down.
 */
function playButtons(fields) {
  const right = fields.get(1) === PRESSED;
  const names = right ? { 2: "y", 3: "z", 4: "a", 5: "b", 7: "shiftUp" } : { 2: "up", 3: "left", 4: "right", 5: "down", 7: "shiftDown" };
  return Object.entries(names)
    .filter(([field]) => fields.get(Number(field)) === PRESSED)
    .map(([, name]) => name);
}

/** Bits checked in the Ride button map; pressed bits without a name are reported as hex. */
const RIDE_MAP_BITS = 20;

function rideButtons(fields) {
  const map = fields.get(1);
  if (map === undefined) return null;
  const names = new Map(RIDE_BUTTONS);
  const buttons = new Set();
  for (let i = 0; i < RIDE_MAP_BITS; i++) {
    const bit = 2 ** i;
    if (Math.floor(map / bit) % 2 === 0) buttons.add(names.get(bit) ?? `0x${bit.toString(16)}`);
  }
  return [...buttons];
}

/**
 * Reads the varint fields of a protobuf message (field number → value).
 * Other wire types are skipped; a repeated field keeps its first value.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {Map<number, number>}
 */
export function readFields(bytes, offset = 0) {
  const fields = new Map();
  let i = offset;
  const varint = () => {
    let value = 0;
    let scale = 1;
    while (i < bytes.length) {
      const byte = bytes[i++];
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
    return null;
  };
  while (i < bytes.length) {
    const key = varint();
    if (key === null) break;
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 0) {
      const value = varint();
      if (value === null) break;
      if (!fields.has(field)) fields.set(field, value);
    } else if (wireType === 2) {
      const length = varint();
      if (length === null) break;
      i += length;
    } else if (wireType === 5) {
      i += 4;
    } else if (wireType === 1) {
      i += 8;
    } else {
      break;
    }
  }
  return fields;
}
