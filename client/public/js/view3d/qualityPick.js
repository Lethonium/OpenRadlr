/**
 * The graphics level a device starts on, and the one step down when its first
 * ride runs slowly. Pure: the browser signals come in as arguments.
 * Ultra is never picked automatically.
 */

/** A frame time (ms) above which the first ride steps down one level. */
const SLOW_MS = 40;
/** A frame time (ms) at the lowest level above which the device is sent to 2D. */
const UNUSABLE_MS = 70;
const LEVELS = Object.freeze(["low", "medium", "high", "ultra"]);

/**
 * @typedef {{webgl2: boolean, deviceMemory?: number, saveData?: boolean, coarsePointer?: boolean}} DeviceSignals
 */

/**
 * The level for a device by what the browser tells about it.
 * @param {DeviceSignals} signals `deviceMemory` is `navigator.deviceMemory` (missing counts as 8)
 * @returns {"2d"|"low"|"medium"|"high"}
 */
export function chooseQuality({ webgl2, deviceMemory, saveData, coarsePointer }) {
  const memory = deviceMemory ?? 8;
  if (!webgl2) return "2d";
  if (saveData || memory <= 2) return "low";
  if (coarsePointer || memory <= 4) return "medium";
  return "high";
}

/**
 * The level after a first ride: the median frame time above 40 ms steps down
 * one level; at low, above 70 ms it is 2D.
 * @param {string} level
 * @param {readonly number[]} frameMs
 * @returns {string}
 */
export function adjustQuality(level, frameMs) {
  if (frameMs.length === 0) return level;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (level === "low") return median > UNUSABLE_MS ? "2d" : level;
  if (median <= SLOW_MS) return level;
  const index = LEVELS.indexOf(level);
  return index > 0 ? LEVELS[index - 1] : level;
}

/**
 * What the first run stores, or null when a quality is stored already (a stored
 * choice is never overwritten). A stored view is kept too.
 * @param {string|null} storedQuality
 * @param {DeviceSignals} signals
 * @param {string|null} storedView
 * @returns {{quality: string, auto: boolean, view: "map"|null, notice: boolean}|null}
 */
export function firstRunQuality(storedQuality, signals, storedView) {
  if (storedQuality) return null;
  const pick = chooseQuality(signals);
  if (pick === "2d") return { quality: "low", auto: false, view: storedView ? null : "map", notice: !storedView };
  return { quality: pick, auto: true, view: null, notice: false };
}
