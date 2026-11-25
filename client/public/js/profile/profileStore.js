/**
 * Local rider profile.
 *
 * A profile is display data plus the public key of the rider's key pair
 * (profile/riderKey.js). The key is sent with "join", signed over the
 * server's challenge, so servers recognise the same rider (ADR 0032).
 *
 * Storage and the key are injected for testability.
 */

// Keeps the pre-rename key so existing profiles (and their key pairs) survive.
const STORAGE_KEY = "openride.profile.v1";

import { defaultUnits, UNIT_SYSTEMS } from "../util/format.js";
import { SPLIT_SETTINGS } from "../ride/splits.js";
import { t } from "../i18n/i18n.js";

export const DEFAULT_PROFILE = Object.freeze({
  name: "",
  units: "metric",
  weightKg: 75,
  ftp: 200,
  // Where the FTP came from: default | typed | estimated | tested.
  ftpSource: "default",
  ftpDate: null,
  ftpDismissed: null,
  splitMode: "auto",
  autoPause: false,
  levelW: null,
  difficulty: 0.5,
  virtualShifting: false,
  chainring: 34,
  cog: 14,
  workoutPreset: null,
  workoutCues: true,
  publicKey: null,
});

export function validateProfile({ name, weightKg, units = "metric", ftp = 200, splitMode = "auto", autoPause = false, difficulty, virtualShifting = false, chainring = 34, cog = 14 }) {
  const errors = [];
  const trimmed = (name ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > 24) errors.push(t("profile.error.name"));
  if (!(weightKg >= 30 && weightKg <= 200)) errors.push(t(units === "imperial" ? "profile.error.weightImperial" : "profile.error.weightMetric"));
  if (!UNIT_SYSTEMS.includes(units)) errors.push(t("profile.error.units"));
  if (!(ftp >= 50 && ftp <= 600)) errors.push(t("profile.error.ftp"));
  if (!SPLIT_SETTINGS.includes(splitMode)) errors.push(t("profile.error.splits"));
  if (typeof autoPause !== "boolean") errors.push(t("profile.error.autoPause"));
  if (!(difficulty >= 0 && difficulty <= 1)) errors.push(t("profile.error.difficulty"));
  if (virtualShifting && !(Number.isInteger(chainring) && chainring >= 20 && chainring <= 60)) {
    errors.push(t("profile.error.chainring"));
  }
  if (virtualShifting && !(Number.isInteger(cog) && cog >= 10 && cog <= 36)) errors.push(t("profile.error.cog"));
  return errors;
}

/**
 * The profile with the edited fields that are valid on their own: what is typed in the
 * start menu is kept right away, a half-typed value ("7" on the way to "72") is not.
 */
export function keepValid(previous, edited) {
  // A valid profile that checks every field, the gears included.
  const base = { ...DEFAULT_PROFILE, name: "Rider", virtualShifting: true }; // i18n-ok (placeholder for validation only)
  const kept = { ...previous };
  for (const [key, raw] of Object.entries(edited)) {
    const value = key === "name" ? String(raw ?? "").trim() : raw;
    if (validateProfile({ ...base, [key]: value }).length === 0) kept[key] = value;
  }
  return kept;
}

export class ProfileStore {
  /**
   * @param {{storage?: Storage, keys?: import("./riderKey.js").RiderKey, locale?: string}} [deps]
   */
  constructor({ storage = globalThis.localStorage, keys = null, locale = globalThis.navigator?.language } = {}) {
    this.storage = storage;
    this.keys = keys;
    // Profiles without a units choice (new, or saved before #66) follow the browser's region.
    this.defaults = { ...DEFAULT_PROFILE, units: defaultUnits(locale) };
  }

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return { ...this.defaults };
      const stored = JSON.parse(raw);
      // Saved before provenance existed: a custom FTP was typed in
      if (stored.ftpSource === undefined && stored.ftp !== undefined && stored.ftp !== DEFAULT_PROFILE.ftp) stored.ftpSource = "typed";
      return { ...this.defaults, ...stored };
    } catch {
      return { ...this.defaults };
    }
  }

  /**
   * Saves the profile and returns what was stored. A changed FTP resets the level estimate
   * and records where it came from (typed by hand unless the caller says otherwise),
   * and forgets a dismissed estimate (unless the caller changed that too).
   */
  save(profile, { ftpSource = "typed", now = Date.now() } = {}) {
    const previous = this.load();
    const changed = profile.ftp !== previous.ftp;
    // An estimate dismissed for the old FTP says nothing about the new one, unless the caller sets it
    const ftpDismissed = profile.ftpDismissed === previous.ftpDismissed ? null : profile.ftpDismissed;
    const stored = changed ? { ...profile, levelW: null, ftpSource, ftpDate: now, ftpDismissed } : profile;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage can be unavailable (private mode); the profile then lives for this session only.
    }
    return stored;
  }

  /**
   * Makes sure the rider has a key pair and returns the updated profile: with its public
   * key, and an old private key moved out of it (riderKey.js). Unchanged without a key store.
   */
  async ensureKeys(profile) {
    if (!this.keys) return profile;
    const kept = await this.keys.ensure(profile);
    return kept === profile ? profile : this.save(kept);
  }

  /** The rider key's signature over `message`, or `null` (no key store, no key, or not the profile's key). */
  async sign(message) {
    return this.keys ? this.keys.sign(message, this.load().publicKey) : null;
  }
}
