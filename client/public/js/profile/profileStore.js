/**
 * Local rider profile.
 *
 * A profile is a key pair plus display data. The public key is sent with
 * "join" so servers can later recognise the same rider; in the proof of
 * concept servers run in "open" mode and do not verify it yet.
 *
 * Storage and crypto are injected for testability.
 */

// Keeps the pre-rename key so existing profiles (and their key pairs) survive.
const STORAGE_KEY = "openride.profile.v1";

import { defaultUnits, UNIT_SYSTEMS } from "../util/format.js";
import { SPLIT_SETTINGS } from "../ride/splits.js";

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
  if (trimmed.length < 1 || trimmed.length > 24) errors.push("Name must be 1 to 24 characters.");
  if (!(weightKg >= 30 && weightKg <= 200)) errors.push(units === "imperial" ? "Weight must be between 66 and 440 lb." : "Weight must be between 30 and 200 kg.");
  if (!UNIT_SYSTEMS.includes(units)) errors.push("Units must be metric or imperial.");
  if (!(ftp >= 50 && ftp <= 600)) errors.push("FTP must be between 50 and 600 W.");
  if (!SPLIT_SETTINGS.includes(splitMode)) errors.push("Splits must be auto, lap, 1, 5, 10 or off.");
  if (typeof autoPause !== "boolean") errors.push("Auto-pause must be on or off.");
  if (!(difficulty >= 0 && difficulty <= 1)) errors.push("Difficulty must be between 0 and 100 %.");
  if (virtualShifting && !(Number.isInteger(chainring) && chainring >= 20 && chainring <= 60)) {
    errors.push("Chainring must be 20 to 60 teeth.");
  }
  if (virtualShifting && !(Number.isInteger(cog) && cog >= 10 && cog <= 36)) errors.push("Rear cog must be 10 to 36 teeth.");
  return errors;
}

export class ProfileStore {
  /**
   * @param {{storage?: Storage, subtle?: SubtleCrypto}} [deps]
   */
  constructor({ storage = globalThis.localStorage, subtle = globalThis.crypto?.subtle, locale = globalThis.navigator?.language } = {}) {
    this.storage = storage;
    this.subtle = subtle;
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

  /** Makes sure the profile has a key pair and returns the updated profile. */
  async ensureKeys(profile) {
    if (profile.publicKey || !this.subtle) return profile;
    const pair = await this.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = await this.subtle.exportKey("spki", pair.publicKey);
    const privateJwk = await this.subtle.exportKey("jwk", pair.privateKey);
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(spki)));
    return this.save({ ...profile, publicKey, privateKeyJwk: privateJwk });
  }
}
