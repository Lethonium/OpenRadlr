/**
 * Every controller from one chooser: Zwift's (ble/zwiftController.js) and
 * OpenBikeControl ones (ble/openBikeControl.js). The chooser doesn't say which
 * filter a device matched, so the connected device is asked for the
 * OpenBikeControl service; anything else is a Zwift controller.
 */

import { t } from "../i18n/i18n.js";
import { FIRST_CONNECT_ATTEMPTS, connectGatt } from "./gattConnect.js";
import { OpenBikeControlController } from "./openBikeControl.js";
import { OBC_SERVICE } from "./openBikeControlProtocol.js";
import { ZwiftController } from "./zwiftController.js";
import { ZWIFT_COMPANY_ID, ZWIFT_RIDE_SERVICE, ZWIFT_SERVICE } from "./zwiftProtocol.js";

/** What the chooser lists: Zwift and OpenBikeControl devices, or the remembered ones by name. */
function requestOptions(names) {
  return {
    filters: names?.length ? names.map((name) => ({ name })) : [{ manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }, { namePrefix: "Zwift" }, { services: [OBC_SERVICE] }], // i18n-ok
    optionalServices: [ZWIFT_SERVICE, ZWIFT_RIDE_SERVICE, OBC_SERVICE],
  };
}

/**
 * Opens the browser's device picker and connects to the chosen controller.
 * Options as for ZwiftController.connect.
 * @param {Bluetooth} [bluetooth]
 * @param {{log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function, isConnected?: (device: object) => boolean, names?: string[]}} [options]
 */
export async function connectController(bluetooth = globalThis.navigator.bluetooth, { isConnected = () => false, names, ...options } = {}) {
  const device = await bluetooth.requestDevice(requestOptions(names));
  options.log?.info(`Selected controller "${device.name ?? "unnamed"}"`);
  if (isConnected(device)) throw new Error(t("devices.error.connected", { name: device.name ?? t("devices.error.thisController") }));
  return openController(device, options);
}

/**
 * Connects to a controller the browser already granted (no chooser).
 * @param {{log?: import("./deviceLog.js").DeviceLog | null, setTimeout?: Function, clearTimeout?: Function}} [options]
 */
export async function openController(device, options = {}) {
  return (await offersOpenBikeControl(device, options)) ? OpenBikeControlController.open(device, options) : ZwiftController.open(device, options);
}

/** The link stays open for the controller that follows: its connect then returns at once. */
async function offersOpenBikeControl(device, { log = null, ...timers }) {
  let server;
  try {
    server = await connectGatt(device, { attempts: FIRST_CONNECT_ATTEMPTS, log, ...timers });
  } catch (error) {
    device.gatt.disconnect();
    throw error;
  }
  try {
    await server.getPrimaryService(OBC_SERVICE);
    log?.info("Controller offers OpenBikeControl");
    return true;
  } catch {
    return false;
  }
}
