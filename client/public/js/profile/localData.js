/**
 * What this browser keeps for OpenRadlr, for the profile's "Your data" page:
 * counts per item, an export file and deletes. Pure over the injected
 * localStorage and the raw IndexedDB key-value stores (ride/rideAutosave.js
 * `indexedDbStore`): `{history, ghosts, autosave, streams}`; `streams` (the
 * rides' per-second data) is optional and goes with the rides. `storage` is the active
 * rider's; `deviceStorage` (profile/riderStorage.js) is the device's own keys.
 */

import { ACHIEVEMENTS_KEY, loadAchievements } from "./achievements.js";
import { GOALS_KEY, loadGoals } from "./seasonGoals.js";
import { RIDERS_KEY, removeRider } from "./riders.js";

export const DATA_ITEMS = ["profile", "rides", "bestLaps", "goals", "progress", "unfinished", "settings", "device"];

const PROFILE_KEY = "openride.profile.v1";
const SUMMITS_KEY = "openradlr.summits";
const LEMONS_KEY = "openradlr.lemons";
const PROGRESS_KEYS = [SUMMITS_KEY, LEMONS_KEY, ACHIEVEMENTS_KEY];
// Pairing secrets stay out of the export: this device's key for its second
// screens, and on a phone used as a cockpit, the tablet's key.
const SECRET_KEYS = ["openradlr.screenKey", "openradlr.cockpit"];
const STORE_OF = { rides: "history", bestLaps: "ghosts", unfinished: "autosave" };
// The autosave keeps one ride ("current") and its photos.
const UNFINISHED_KEY = "current";

const ours = (key) => key.startsWith("openradlr.") || key.startsWith("openride.");

function storageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
  return keys.filter((key) => key !== null && ours(key));
}

/** Every other key of ours: devices, pairings, cockpit, language, Strava receipts, view settings. */
const settingsKeys = (storage) => storageKeys(storage).filter((key) => key !== PROFILE_KEY && key !== GOALS_KEY && !PROGRESS_KEYS.includes(key));

/** The device's keys except the roster, which belongs to no row. */
const deviceKeys = (deviceStorage) => (deviceStorage ? storageKeys(deviceStorage).filter((key) => key !== RIDERS_KEY) : []);

function parseJson(text, fallback) {
  try {
    return text === null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

function progressOf(storage) {
  const summits = parseJson(storage.getItem(SUMMITS_KEY), []);
  const lemons = Number.parseInt(storage.getItem(LEMONS_KEY) ?? "", 10);
  return { summits: Array.isArray(summits) ? summits : [], lemons: Number.isFinite(lemons) ? lemons : 0, achievements: loadAchievements(storage).earned };
}

async function readable(act) {
  try {
    return { count: await act(), readable: true };
  } catch {
    return { count: null, readable: false };
  }
}

const COUNTS = {
  profile: ({ storage }) => (storage.getItem(PROFILE_KEY) === null ? 0 : 1),
  rides: ({ stores }) => stores.history.keys().then((keys) => keys.length),
  bestLaps: ({ stores }) => stores.ghosts.keys().then((keys) => keys.length),
  goals: ({ storage }) => {
    const text = storage.getItem(GOALS_KEY);
    return loadGoals({ getItem: () => text }).goals.length;
  },
  progress: ({ storage }) => {
    const { summits, lemons, achievements } = progressOf(storage);
    return { summits: summits.length, lemons, achievements: Object.keys(achievements).length };
  },
  unfinished: ({ stores }) => stores.autosave.keys().then((keys) => (keys.includes(UNFINISHED_KEY) ? 1 : 0)),
  settings: ({ storage }) => settingsKeys(storage).length,
  device: ({ deviceStorage }) => deviceKeys(deviceStorage).length,
};

/**
 * Each item with its count; an item whose storage can't be read is `readable: false`, never a throw.
 * @returns {Promise<{id: string, count: number | {summits: number, lemons: number, achievements: number} | null, readable: boolean}[]>}
 */
export function inventory(sources) {
  return Promise.all(DATA_ITEMS.map(async (id) => ({ id, ...(await readable(() => COUNTS[id](sources))) })));
}

async function values(store, keys) {
  return Promise.all(keys.map((key) => store.get(key)));
}

/** Everything as one object for a file, without the private key and the screen pairing secret. */
export async function exportData({ storage, stores, now }) {
  const profile = { ...parseJson(storage.getItem(PROFILE_KEY), null) };
  delete profile.privateKeyJwk;
  const settings = Object.fromEntries(settingsKeys(storage).filter((key) => !SECRET_KEYS.includes(key)).map((key) => [key, storage.getItem(key)]));
  const autosaveKeys = await stores.autosave.keys();
  return {
    version: 1,
    exportedAt: now,
    profile,
    rides: await values(stores.history, await stores.history.keys()),
    bestLaps: await values(stores.ghosts, await stores.ghosts.keys()),
    goals: parseJson(storage.getItem(GOALS_KEY), null),
    progress: progressOf(storage),
    // Photos are blobs; they don't go into JSON.
    unfinished: autosaveKeys.includes(UNFINISHED_KEY) ? await stores.autosave.get(UNFINISHED_KEY) : null,
    settings,
  };
}

/** Keys about the account link itself: they describe this device's link, not the rider. */
const ACCOUNT_KEYS = ["openradlr.account.rider", "openradlr.account.backedUp", "openradlr.account.rides"];

/**
 * What the account backup keeps besides the rides (ADR 0032): the export without the rides
 * (they go one by one), the unfinished ride, the secrets and the account link.
 */
export async function backupSnapshot({ storage, stores, now }) {
  const profile = { ...parseJson(storage.getItem(PROFILE_KEY), null) };
  delete profile.privateKeyJwk;
  const kept = (key) => !SECRET_KEYS.includes(key) && !ACCOUNT_KEYS.includes(key);
  const settings = Object.fromEntries(settingsKeys(storage).filter(kept).map((key) => [key, storage.getItem(key)]));
  return {
    version: 1,
    takenAt: now,
    profile,
    bestLaps: await values(stores.ghosts, await stores.ghosts.keys()),
    goals: parseJson(storage.getItem(GOALS_KEY), null),
    progress: progressOf(storage),
    settings,
  };
}

/** "openradlr-data-2026-11-13.json", by the local date. */
export function exportFileName(now) {
  const date = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `openradlr-data-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

async function clearStore(store) {
  for (const key of await store.keys()) await store.delete(key);
}

const DELETES = {
  profile: ({ storage }) => storage.removeItem(PROFILE_KEY),
  goals: ({ storage }) => storage.removeItem(GOALS_KEY),
  progress: ({ storage }) => PROGRESS_KEYS.forEach((key) => storage.removeItem(key)),
  settings: ({ storage }) => settingsKeys(storage).forEach((key) => storage.removeItem(key)),
  device: ({ deviceStorage }) => deviceKeys(deviceStorage).forEach((key) => deviceStorage.removeItem(key)),
};

/**
 * Deletes one item, or "everything" of the rider (going on past an item that fails; the
 * device's keys are not the rider's); false when the storage refused any.
 */
export async function deleteItem(id, { storage, stores, deviceStorage }) {
  let ok = true;
  for (const item of id === "everything" ? DATA_ITEMS.filter((name) => name !== "device") : [id]) {
    try {
      if (STORE_OF[item]) await clearStore(stores[STORE_OF[item]]);
      else DELETES[item]({ storage, deviceStorage });
      // A ride's stream (ride/rideStreamStore.js) goes with its ride.
      if (item === "rides" && stores?.streams) await clearStore(stores.streams);
    } catch {
      ok = false;
    }
  }
  return ok;
}

/**
 * Removes a rider: every key their storage view lists, then each database by name.
 * Goes on past a failure; false when anything failed.
 * @param {{storage: Storage, dbNames: string[], deleteDb: (name: string) => Promise<void>}} options
 */
export async function deleteRider({ storage, dbNames, deleteDb }) {
  let ok = true;
  try {
    storageKeys(storage).forEach((key) => storage.removeItem(key));
  } catch {
    ok = false;
  }
  for (const name of dbNames) {
    try {
      await deleteDb(name);
    } catch {
      ok = false;
    }
  }
  return ok;
}

/**
 * Deletes rider `id` of `roster` with everything they kept here and says which roster to
 * keep: the rider leaves it only once all of their data went. When any of it refused,
 * `ok` is false and the roster stands unchanged — the rider stays in the picker, so the
 * data that remains stays reachable for a retry or an export.
 * @param {{active: string, ids: string[]}} roster
 * @param {string} id
 * @param {{storage: Storage, dbNames: string[], deleteDb: (name: string) => Promise<void>}} options
 * @returns {Promise<{roster: {active: string, ids: string[]}, ok: boolean}>}
 */
export async function deleteRiderFromRoster(roster, id, { storage, dbNames, deleteDb }) {
  const ok = await deleteRider({ storage, dbNames, deleteDb });
  return { roster: ok ? removeRider(roster, id) : roster, ok };
}

/**
 * After these the page reloads: the profile and settings in memory aren't
 * written back, and the start menu stops offering a deleted unfinished ride.
 */
export function needsReload(id) {
  return ["everything", "profile", "settings", "unfinished"].includes(id);
}
