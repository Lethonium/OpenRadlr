/**
 * The rules for a rider's PIN (#114), on top of the roster: who may be opened, and how a PIN is
 * set, changed and removed. Every function returns a new roster (or null when refused) and never
 * saves; crypto and randomness are injected through `deps`, as for pin.js.
 */

import { hashPin, isValidPin, verifyPin } from "./pin.js";
import { clearLock, isLocked, setLock } from "./riders.js";

/** Whether rider `id` may be opened: it has no PIN, or its PIN was entered this session. */
export const canOpen = (roster, id, unlockedId) => !isLocked(roster, id) || unlockedId === id;

/** Whether `pin` opens rider `id`. A rider without a PIN always opens. */
export async function unlock(roster, id, pin, deps) {
  if (!isLocked(roster, id)) return true;
  return verifyPin(pin, roster.locks[id], deps);
}

/** Puts a PIN on a rider that has none; null for an invalid PIN, an unknown rider or a rider that already has one. */
export async function setPin(roster, id, pin, deps) {
  if (!roster.ids.includes(id) || isLocked(roster, id) || !isValidPin(pin)) return null;
  return setLock(roster, id, await hashPin(pin, deps));
}

/** Replaces a rider's PIN; null unless the old PIN is right and the new one is valid. */
export async function changePin(roster, id, oldPin, newPin, deps) {
  if (!isLocked(roster, id) || !isValidPin(newPin)) return null;
  if (!(await verifyPin(oldPin, roster.locks[id], deps))) return null;
  return setLock(roster, id, await hashPin(newPin, deps));
}

/** Removes a rider's PIN; null unless the PIN is right. */
export async function removePin(roster, id, pin, deps) {
  if (!isLocked(roster, id)) return null;
  if (!(await verifyPin(pin, roster.locks[id], deps))) return null;
  return clearLock(roster, id);
}
