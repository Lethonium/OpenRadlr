/**
 * Storage scoped to the active rider (#112). Device keys (the roster, paired devices,
 * second screens, graphics, Strava) pass through unchanged; every other key is the
 * rider's. Rider "main" keeps today's unprefixed keys, so existing data needs no
 * migration; other riders live under `openradlr.rider.<id>.`. The rider is resolved on
 * every call, so switching riders needs no new wrapper. Reads never throw: unavailable
 * storage reads as empty, and writes without any storage are ignored. A storage that
 * is there but refuses a write or a delete throws to the caller, whose catch it is.
 */
import { MAIN_RIDER, RIDERS_KEY } from "./riders.js";

export const DEVICE_KEYS = [
  RIDERS_KEY,
  "openradlr.devices",
  "openradlr.nativeDevices",
  "openradlr.screenKey",
  "openradlr.screenPaired",
  "openradlr.cockpit",
  "openradlr.cockpit.layout",
  "openride.quality",
];
export const DEVICE_PREFIXES = ["openradlr.strava-upload."];
export const RIDER_PREFIX = "openradlr.rider.";

const OURS = /^open(radlr|ride)\./;

export const isDeviceKey = (key) =>
  DEVICE_KEYS.includes(key) || DEVICE_PREFIXES.some((prefix) => key.startsWith(prefix));

/** The raw key under which rider `id` stores `key`. */
export const riderKey = (id, key) => (id === MAIN_RIDER ? key : `${RIDER_PREFIX}${id}.${key}`);

/** The IndexedDB name for rider `id`. */
export const riderDbName = (base, id) => (id === MAIN_RIDER ? base : `${base}.${id}`);

function rawKeys(raw) {
  const keys = [];
  try {
    const length = raw.length;
    for (let i = 0; i < length; i++) {
      const key = raw.key(i);
      if (typeof key === "string") keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

const attempt = (fallback, action) => {
  try {
    return action();
  } catch {
    return fallback;
  }
};

/** Distinct rider ids that have prefixed keys in `raw`. */
export function riderIdsInStorage(raw) {
  const ids = new Set();
  for (const key of rawKeys(raw)) {
    if (!key.startsWith(RIDER_PREFIX)) continue;
    const id = key.slice(RIDER_PREFIX.length).split(".")[0];
    if (id !== "") ids.add(id);
  }
  return [...ids];
}

/**
 * A Storage-like view. `rawKeyOf` maps a visible key to the raw key; `visible` lists the
 * visible keys from the raw ones.
 */
function view(raw, rawKeyOf, visible) {
  return {
    getItem: (key) => attempt(null, () => raw.getItem(rawKeyOf(key))),
    setItem: (key, value) => raw?.setItem(rawKeyOf(key), value),
    removeItem: (key) => raw?.removeItem(rawKeyOf(key)),
    key: (index) => visible(rawKeys(raw))[index] ?? null,
    get length() {
      return visible(rawKeys(raw)).length;
    },
  };
}

export function riderStorage(raw, riderOf) {
  const scope = (key) => (isDeviceKey(key) ? key : riderKey(riderOf(), key));
  const visible = (keys) => {
    const id = riderOf();
    if (id === MAIN_RIDER) {
      return keys.filter((key) => OURS.test(key) && !isDeviceKey(key) && !key.startsWith(RIDER_PREFIX));
    }
    const prefix = riderKey(id, "");
    return keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  };
  return view(raw, scope, visible);
}

export function deviceStorage(raw) {
  return view(raw, (key) => key, (keys) => keys.filter(isDeviceKey));
}
