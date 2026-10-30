/**
 * Opening a device's GATT server, the step that most often goes wrong:
 * Chrome's first connect after the chooser regularly fails once (Windows,
 * Android), and a device that is asleep or held by another app may never
 * answer at all. So the first connect is tried a few times, and every
 * attempt gives up after a while instead of "Connecting…" forever.
 */

export const CONNECT_TIMEOUT_MS = 15_000;
/** Attempts for the first connect; reconnects have their own retries (Reconnector). */
export const FIRST_CONNECT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

/** Errors worth another try right away: the link, not the device, failed. */
export function isRetryable(error) {
  return error?.name === "NetworkError" || /GATT|connection attempt failed|in progress/i.test(error?.message ?? "");
}

/**
 * @param {BluetoothDevice} device
 * @param {{attempts?: number, timeoutMs?: number, setTimeout?: Function, clearTimeout?: Function, log?: {info: Function} | null}} [options]
 * @returns {Promise<BluetoothRemoteGATTServer>}
 */
export async function connectGatt(device, { attempts = 1, timeoutMs = CONNECT_TIMEOUT_MS, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout, log = null } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s`), { name: "TimeoutError" })), timeoutMs); // i18n-ok
    });
    try {
      return await Promise.race([device.gatt.connect(), timeout]);
    } catch (error) {
      if (error.name === "TimeoutError") {
        // Cancels the pending connect; long enough to not try again on our own.
        device.gatt.disconnect?.();
        throw error;
      }
      if (attempt >= attempts || !isRetryable(error)) throw error;
      log?.info(`Connect attempt ${attempt} failed (${error.message}); trying again`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    } finally {
      clearTimeout(timer);
    }
  }
}
