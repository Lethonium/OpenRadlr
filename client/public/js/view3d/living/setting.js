/**
 * The Living setting: a third view choice beside 2D and 3D, on top of `3d`
 * (`app.viewMode` stays `"3d"` so saved views and every check of it keep working).
 * Pure: the caller reads storage and the device.
 */
export const LIVING_KEY = "openride.living";

/** Below this much reported memory (GB) a device starts on plain 3D. */
const MIN_MEMORY_GB = 4;

/**
 * Used only while nothing is saved: off on low memory and on phones, otherwise
 * on. A browser that does not report memory counts as enough.
 */
export function livingDefault({ deviceMemory, coarsePointer, narrow }) {
  if (deviceMemory !== undefined && deviceMemory < MIN_MEMORY_GB) return false;
  return !(coarsePointer && narrow);
}

/** The saved `"on"` / `"off"`; anything else counts as unset. */
export function resolveLiving(saved, device) {
  if (saved === "on") return true;
  if (saved === "off") return false;
  return livingDefault(device);
}

/** Riders on Living by default shouldn't hear about a feature they never picked. */
export const livingNoteShown = (saved, hasLiving) => saved === "on" && !hasLiving;

/** Which of the three choices a view mode and the setting amount to. */
export function viewChoice(mode, living) {
  if (mode !== "3d") return "2d";
  return living ? "living" : "3d";
}

/** What picking a choice means. `living` null: leave the setting as it is. */
export function fromViewChoice(id) {
  if (id === "living") return { mode: "3d", living: true };
  if (id === "3d") return { mode: "3d", living: false };
  return { mode: "2d", living: null };
}
