/**
 * Codec for OpenBikeControl, an open protocol for cycling controllers
 * (github.com/OpenBikeControl/openbikecontrol-protocol, MIT). Over Bluetooth a
 * controller notifies "0x01, then button ID and state pairs" for every change;
 * the app may tell it which button IDs it understands (App Information).
 *
 * Button IDs are decoded into the same neutral names as Zwift's buttons (see
 * ble/zwiftProtocol.js), plus a few for actions a Zwift controller has no
 * button for: select, harder, easier, camera.
 */

export const OBC_SERVICE = "d273f680-d548-419d-b9d1-fa0472345229";
/** Button state notifications. */
export const BUTTON_STATE_CHARACTERISTIC = "d273f681-d548-419d-b9d1-fa0472345229";
/** The app's name and the button IDs it supports (optional on both sides). */
export const APP_INFO_CHARACTERISTIC = "d273f683-d548-419d-b9d1-fa0472345229";

const BUTTON_STATE = 0x01;
const APP_INFO = 0x04;
const APP_INFO_VERSION = 0x01;

/**
 * Standard button IDs → neutral button names. Steering and the d-pad share
 * names on purpose: a controller may send several IDs for one press (e.g. Left
 * and Steer Left), which then acts once. Other IDs are not acted on.
 */
export const OBC_BUTTONS = new Map([
  [0x01, "shiftUp"],
  [0x02, "shiftDown"],
  [0x10, "up"],
  [0x11, "down"],
  [0x12, "left"],
  [0x13, "right"],
  [0x14, "select"],
  [0x15, "b"], // back: closes panels, like a Zwift B
  [0x16, "y"], // menu, like a Zwift Y
  [0x18, "left"], // steer left: change lane
  [0x19, "right"],
  [0x24, "z"], // screenshot: take a photo, like a Zwift Z
  [0x30, "harder"], // increase difficulty: power or ERG target +
  [0x31, "easier"],
  [0x40, "camera"],
]);

/**
 * Decodes one button state notification into the changed buttons as
 * [ID, state] pairs (state 0 released, 1 pressed, 2–255 an analog value).
 * @param {DataView} view
 * @returns {{kind: "buttons", changes: [number, number][]} | {kind: "unknown", type: number}}
 */
export function parseButtonState(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes[0] !== BUTTON_STATE) return { kind: "unknown", type: bytes.length ? bytes[0] : -1 };
  const changes = [];
  // A trailing ID without a state is ignored.
  for (let i = 1; i + 1 < bytes.length; i += 2) changes.push([bytes[i], bytes[i + 1]]);
  return { kind: "buttons", changes };
}

/**
 * The App Information message: who we are and which button IDs we act on, so
 * a controller can leave out the others.
 * @param {{appId: string, appVersion?: string, buttons: number[]}} info
 */
export function encodeAppInfo({ appId, appVersion = "", buttons }) {
  const text = (value) => {
    const bytes = [...new TextEncoder().encode(value)].slice(0, 32);
    return [bytes.length, ...bytes];
  };
  return Uint8Array.from([APP_INFO, APP_INFO_VERSION, ...text(appId), ...text(appVersion), buttons.length, ...buttons]);
}
