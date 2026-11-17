/**
 * The riders on this device (#112): an ordered list of rider ids and the active one.
 * Rider "main" keeps today's unprefixed storage keys, so the roster only names the
 * riders; it never reads their data. Pure: storage, the random source and the ids
 * come in, and nothing here throws on unreadable storage.
 */

export const RIDERS_KEY = "openradlr.riders";
export const MAIN_RIDER = "main";

const ID_LENGTH = 8;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

const defaultRoster = (orphanIds) => ({ active: MAIN_RIDER, ids: [MAIN_RIDER, ...orphanIds] });

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
  return { active, ids };
}

/** Stores the roster; false when storage refuses. */
export function saveRiders(storage, roster) {
  try {
    storage.setItem(RIDERS_KEY, JSON.stringify({ active: roster.active, ids: roster.ids }));
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
  return { roster: { active: id, ids: [...roster.ids, id] }, id };
}

/**
 * Removes a rider. Removing the only rider is refused (null). Removing the active rider
 * activates the next one in order, or the previous one when it was last.
 */
export function removeRider(roster, id) {
  const index = roster.ids.indexOf(id);
  if (index === -1) return roster;
  if (roster.ids.length === 1) return null;
  const ids = roster.ids.filter((rider) => rider !== id);
  if (roster.active !== id) return { active: roster.active, ids };
  const active = roster.ids[index + 1] ?? roster.ids[index - 1];
  return { active, ids };
}

/** Makes a rider the active one; an unknown id leaves the roster unchanged. */
export function setActive(roster, id) {
  return roster.ids.includes(id) ? { active: id, ids: roster.ids } : roster;
}
