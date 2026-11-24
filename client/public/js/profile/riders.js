/**
 * The riders on this device (#112): an ordered list of rider ids and the active one.
 * Rider "main" keeps today's unprefixed storage keys, so the roster only names the
 * riders; it never reads their data. Pure: storage, the random source and the ids
 * come in, and nothing here throws on unreadable storage.
 *
 * A rider can have a PIN lock (#114): the roster holds only its salted hash (see pin.js),
 * in `locks`, which is only present while some listed rider has one.
 */

export const RIDERS_KEY = "openradlr.riders";
export const MAIN_RIDER = "main";

const ID_LENGTH = 8;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

const defaultRoster = (orphanIds) => ({ active: MAIN_RIDER, ids: [MAIN_RIDER, ...orphanIds] });

const isLockRecord = (value) =>
  Boolean(value) &&
  typeof value.salt === "string" &&
  typeof value.hash === "string" &&
  Number.isInteger(value.iterations) &&
  value.iterations > 0;

/** A roster; `locks` is only there while a listed rider has a valid one, so unlocked rosters keep their shape. */
const build = (active, ids, locks = {}) => {
  const kept = Object.fromEntries(
    Object.entries(locks).filter(([id, record]) => ids.includes(id) && isLockRecord(record)),
  );
  return Object.keys(kept).length === 0 ? { active, ids } : { active, ids, locks: kept };
};

/**
 * The stored roster. Missing or unreadable storage gives the single main rider, and any
 * `orphanIds` (riders whose data is on this device but not listed) are added when the
 * roster itself is missing.
 */
export function loadRiders(storage, { orphanIds = [] } = {}) {
  let data;
  try {
    data = JSON.parse(storage.getItem(RIDERS_KEY) ?? "null");
  } catch {
    return defaultRoster(orphanIds);
  }
  if (!data || !Array.isArray(data.ids)) return defaultRoster(orphanIds);
  const ids = [...new Set(data.ids.filter((id) => typeof id === "string" && id !== ""))];
  if (ids.length === 0) return defaultRoster(orphanIds);
  const active = ids.includes(data.active) ? data.active : ids[0];
  return build(active, ids, data.locks && typeof data.locks === "object" ? data.locks : {});
}

/** Stores the roster; false when storage refuses. */
export function saveRiders(storage, roster) {
  try {
    storage.setItem(
      RIDERS_KEY,
      JSON.stringify({ active: roster.active, ids: roster.ids, ...(roster.locks ? { locks: roster.locks } : {}) }),
    );
    return true;
  } catch {
    return false;
  }
}

const randomId = (random) => {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
  return id;
};

/** Adds a rider with a fresh id and makes it the active one. */
export function addRider(roster, random = Math.random) {
  let id = randomId(random);
  while (roster.ids.includes(id)) id = randomId(random);
  return { roster: build(id, [...roster.ids, id], roster.locks), id };
}

/**
 * Removes a rider, and the rider's PIN with it. Removing the only rider is refused (null).
 * Removing the active rider activates the next one in order, or the previous one when it was last.
 */
export function removeRider(roster, id) {
  const index = roster.ids.indexOf(id);
  if (index === -1) return roster;
  if (roster.ids.length === 1) return null;
  const ids = roster.ids.filter((rider) => rider !== id);
  if (roster.active !== id) return build(roster.active, ids, roster.locks);
  const active = roster.ids[index + 1] ?? roster.ids[index - 1];
  return build(active, ids, roster.locks);
}

/** Makes a rider the active one; an unknown id leaves the roster unchanged. */
export function setActive(roster, id) {
  return roster.ids.includes(id) ? build(id, roster.ids, roster.locks) : roster;
}

/** Whether a rider has a PIN. */
export const isLocked = (roster, id) => Boolean(roster.locks?.[id]);

/** Puts a PIN record (from `hashPin`) on a rider; an unknown id leaves the roster unchanged. */
export function setLock(roster, id, record) {
  if (!roster.ids.includes(id)) return roster;
  return build(roster.active, roster.ids, { ...roster.locks, [id]: record });
}

/** Removes a rider's PIN. */
export function clearLock(roster, id) {
  const rest = Object.entries(roster.locks ?? {}).filter(([rider]) => rider !== id);
  return build(roster.active, roster.ids, Object.fromEntries(rest));
}