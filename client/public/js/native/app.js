/**
 * The OpenRadlr app (docs/app.md) loads the very same page as the browser,
 * in a web view that lacks a few things: Web Bluetooth, a working screen
 * wake lock and downloads. Its native plugins fill them in, so the rest of
 * the client never needs to know where it runs.
 */

import { NativeBluetooth } from "../ble/nativeBluetooth.js";

/** The app's native plugins, or null in a browser. */
export function nativePlugins(win = globalThis) {
  const capacitor = win.Capacitor;
  return capacitor?.isNativePlatform?.() ? (capacitor.Plugins ?? {}) : null;
}

/**
 * Puts the native stand-ins in place: `navigator.bluetooth`,
 * `navigator.wakeLock` and `navigator.share`. Returns what the page uses to
 * save files there, or null in a browser.
 * @returns {{saveFiles: (files: {blob: Blob, name: string}[]) => Promise<void>} | null}
 */
export function installNativeApp({ plugins = nativePlugins(), navigator: nav = globalThis.navigator, storage } = {}) {
  if (!plugins) return null;
  if (plugins.BluetoothLe && !nav.bluetooth) define(nav, "bluetooth", new NativeBluetooth({ plugin: plugins.BluetoothLe, ...(storage !== undefined && { storage }) }));
  // The web view's own wake lock may exist and still let the screen dim.
  if (plugins.KeepAwake) define(nav, "wakeLock", nativeWakeLock(plugins.KeepAwake));
  if (!plugins.Filesystem || !plugins.Share) return null;
  const share = (files, title) => shareFiles(plugins, files, title);
  define(nav, "canShare", (data) => Array.isArray(data?.files) && data.files.length > 0);
  define(nav, "share", ({ files = [], title } = {}) => share(files.map((file) => ({ blob: file, name: file.name })), title));
  // No downloads folder on a phone: the share sheet offers "Save to Files" and other apps.
  return { saveFiles: (files) => share(files) };
}

function define(target, name, value) {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

/** `navigator.wakeLock` on the native idle timer. */
export function nativeWakeLock(keepAwake) {
  return {
    async request() {
      await keepAwake.keepAwake();
      const sentinel = {
        released: false,
        async release() {
          if (sentinel.released) return;
          sentinel.released = true;
          await keepAwake.allowSleep();
        },
      };
      return sentinel;
    },
  };
}

/**
 * Writes the files to the app's cache and opens the share sheet with them.
 * Closing the sheet rejects with an AbortError, as `navigator.share` does.
 */
export async function shareFiles({ Filesystem, Share }, files, title) {
  const uris = [];
  for (const { blob, name } of files) {
    const { uri } = await Filesystem.writeFile({ path: name, data: await base64Of(blob), directory: "CACHE" });
    uris.push(uri);
  }
  try {
    await Share.share({ files: uris, ...(title && { title }) });
  } catch (error) {
    if (/cancel/i.test(error?.message ?? "")) throw Object.assign(new Error("Share canceled."), { name: "AbortError" });
    throw error;
  }
}

export async function base64Of(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
