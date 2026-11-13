/**
 * What this browser keeps for OpenRadlr, for the profile's "Your data" page:
 * counts per item, an export file and deletes. Pure over the injected
 * localStorage and the raw IndexedDB key-value stores (ride/rideAutosave.js
 * `indexedDbStore`): `{history, ghosts, autosave}`.
 */

export const DATA_ITEMS = ["profile", "rides", "bestLaps", "progress", "unfinished", "settings"];

const PROFILE_KEY = "openride.profile.v1";
const SUMMITS_KEY = "openradlr.summits";
const LEMONS_KEY = "openradlr.lemons";
const PROGRESS_KEYS = [SUMMITS_KEY, LEMONS_KEY];
// Pairs this device with second screens: a secret, it stays out of the export.
const SCREEN_KEY = "openradlr.screenKey";
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
const settingsKeys = (storage) => storageKeys(storage).filter((key) => key !== PROFILE_KEY && !PROGRESS_KEYS.includes(key));

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
  return { summits: Array.isArray(summits) ? summits : [], lemons: Number.isFinite(lemons) ? lemons : 0 };
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
  progress: ({ storage }) => {
    const { summits, lemons } = progressOf(storage);
    return { summits: summits.length, lemons };
  },
  unfinished: ({ stores }) => stores.autosave.keys().then((keys) => (keys.includes(UNFINISHED_KEY) ? 1 : 0)),
  settings: ({ storage }) => settingsKeys(storage).length,
};

/**
 * Each item with its count; an item whose storage can't be read is `readable: false`, never a throw.
 * @returns {Promise<{id: string, count: number | {summits: number, lemons: number} | null, readable: boolean}[]>}
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
  const settings = Object.fromEntries(settingsKeys(storage).filter((key) => key !== SCREEN_KEY).map((key) => [key, storage.getItem(key)]));
  const autosaveKeys = await stores.autosave.keys();
  return {
    version: 1,
    exportedAt: now,
    profile,
    rides: await values(stores.history, await stores.history.keys()),
    bestLaps: await values(stores.ghosts, await stores.ghosts.keys()),
    progress: progressOf(storage),
    // Photos are blobs; they don't go into JSON.
    unfinished: autosaveKeys.includes(UNFINISHED_KEY) ? await stores.autosave.get(UNFINISHED_KEY) : null,
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
  progress: ({ storage }) => PROGRESS_KEYS.forEach((key) => storage.removeItem(key)),
  settings: ({ storage }) => settingsKeys(storage).forEach((key) => storage.removeItem(key)),
};

/** Deletes one item, or "everything"; false when the storage refused. */
export async function deleteItem(id, { storage, stores }) {
  try {
    for (const item of id === "everything" ? DATA_ITEMS : [id]) {
      if (STORE_OF[item]) await clearStore(stores[STORE_OF[item]]);
      else DELETES[item]({ storage });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * After these the page reloads: the profile and settings in memory aren't
 * written back, and the start menu stops offering a deleted unfinished ride.
 */
export function needsReload(id) {
  return ["everything", "profile", "settings", "unfinished"].includes(id);
}
