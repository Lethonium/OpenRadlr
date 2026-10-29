/**
 * Devices this browser connected before, so the start screen can connect them
 * again (#43): without the chooser where the browser allows it
 * (`navigator.bluetooth.getDevices()`), otherwise with a chooser that lists
 * only the remembered device.
 */

import { t } from "../i18n/i18n.js";

const STORAGE_KEY = "openradlr.devices";
const KINDS = ["trainer", "hr", "controller"];
/** A Zwift Play is two devices; a third controller pushes out the oldest. */
export const MAX_CONTROLLERS = 2;

/** @typedef {{kind: "trainer" | "hr" | "controller", id: string, name: string}} KnownDevice */

export class KnownDevices {
  /** @param {Storage | null} [storage] */
  constructor(storage = defaultStorage()) {
    this.storage = storage;
  }

  /** @returns {KnownDevice[]} */
  list() {
    try {
      const entries = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(entries) ? entries.filter(valid) : [];
    } catch {
      return [];
    }
  }

  /** @returns {KnownDevice[]} */
  of(kind) {
    return this.list().filter((entry) => entry.kind === kind);
  }

  /**
   * Remembers a connected device. One trainer and one heart rate monitor (a
   * new one replaces the old), up to MAX_CONTROLLERS controllers.
   * @param {KnownDevice["kind"]} kind
   * @param {{id?: string, label?: string, name?: string}} device
   */
  remember(kind, device) {
    const name = device.name ?? device.label;
    if (!KINDS.includes(kind) || !device.id || !name) return;
    const others = this.list().filter((entry) => entry.kind !== kind);
    const same = this.of(kind).filter((entry) => kind === "controller" && entry.id !== device.id);
    const kept = [...same, { kind, id: device.id, name }].slice(-(kind === "controller" ? MAX_CONTROLLERS : 1));
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...others, ...kept]));
    } catch {
      // A convenience: without storage the rider just picks devices again.
    }
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked storage (privacy settings) throws on access.
    return null;
  }
}

const valid = (entry) => KINDS.includes(entry?.kind) && typeof entry.id === "string" && typeof entry.name === "string" && entry.name !== "";

/**
 * The remembered devices this site may use without the chooser. Empty where
 * the browser has no `getDevices()` (or it fails).
 * @param {KnownDevice[]} known
 * @returns {Promise<{entry: KnownDevice, device: object}[]>}
 */
export async function grantedDevices(known, bluetooth = globalThis.navigator?.bluetooth) {
  if (!known.length || typeof bluetooth?.getDevices !== "function") return [];
  let devices;
  try {
    devices = await bluetooth.getDevices();
  } catch {
    return [];
  }
  return known.flatMap((entry) => {
    const device = devices.find((d) => d.id === entry.id);
    return device ? [{ entry, device }] : [];
  });
}

/**
 * Resolves once the device advertises: it is switched on and in range (a
 * Zwift Click only after a button press). Where the browser cannot watch
 * advertisements it resolves at once and connecting simply tries. Rejects
 * after `timeoutMs` without a sign of the device.
 */
export function whenInRange(device, { timeoutMs = 120000, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout } = {}) {
  if (typeof device.watchAdvertisements !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watch = new AbortController();
    let timer = null;
    const done = (settle) => {
      clearTimeout(timer);
      watch.abort();
      device.removeEventListener?.("advertisementreceived", onAdvertisement);
      settle();
    };
    const onAdvertisement = () => done(resolve);
    timer = setTimeout(() => done(() => reject(new Error(t("devices.notFound", { name: device.name ?? t("devices.theDevice") })))), timeoutMs);
    device.addEventListener("advertisementreceived", onAdvertisement);
    // Watching unsupported or refused: just try to connect.
    Promise.resolve()
      .then(() => device.watchAdvertisements({ signal: watch.signal }))
      .catch(() => done(resolve));
  });
}
