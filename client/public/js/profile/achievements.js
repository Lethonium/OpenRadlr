/**
 * Achievements (#27): worked out from the kept ride records, summits and lemons, then
 * latched with the date they were earned so they stay earned when rides are deleted.
 * Pure; storage and the clock come in.
 */

import { weekStart } from "./stats.js";
import { WORLD_STAMP } from "./worldStamp.js";
import { PRESETS } from "../workout/presets.js";
import { VENUES } from "../workout/venues.js";

export { WORLD_STAMP };

/** Whether the saved achievements hold Old School, which unlocks the classic rider. */
export const hasClassicRider = (state) => Boolean(state?.earned?.classicRider);

/** The Classic rider setting: offered once Old School is earned, on only when chosen ("on") and offered (a stale "on" is ignored). */
export const classicRiderChoice = (state, stored) => {
  const available = hasClassicRider(state);
  return { available, on: available && stored === "on" };
};

const YOGA_PLANS = new Set(PRESETS.filter((p) => VENUES[p.venue]?.category === "yoga").map((p) => p.id));
const WEEK_STEP_MS = 8 * 86_400_000;

const num = (value) => (Number.isFinite(value) ? value : 0);
const local = (record) => new Date(record.startedAt);
const hour = (record) => local(record).getHours();
const onDay = (record, month, days) => local(record).getMonth() === month && days.includes(local(record).getDate());

function longestWeekRun(weeks) {
  let best = 0;
  for (const week of weeks) {
    if (weeks.has(weekStart(week - 1))) continue;
    let run = 1;
    for (let w = weekStart(week + WEEK_STEP_MS); weeks.has(w); w = weekStart(w + WEEK_STEP_MS)) run++;
    best = Math.max(best, run);
  }
  return best;
}

/** Everything the checks need, worked out once. */
export function achievementFacts({ records = [], summits = [], lemons = 0, routes = null }) {
  const sorted = [...records].filter((r) => Number.isFinite(r?.startedAt)).sort((a, b) => a.startedAt - b.startedAt);
  const rides = sorted.filter((r) => r.kind !== "workout");
  const workouts = sorted.filter((r) => r.kind === "workout");
  const sum = (key) => rides.reduce((total, r) => total + num(r[key]), 0);
  const rideWeeks = new Set(rides.map((r) => weekStart(r.startedAt)));
  return {
    rides,
    workouts,
    distanceM: sum("distanceM"),
    climbM: sum("elevationGainM"),
    kJ: sum("kilojoules"),
    routeIds: new Set(rides.map((r) => r.routeId).filter((id) => typeof id === "string")),
    rideWeeks,
    workoutWeeks: new Set(workouts.map((r) => weekStart(r.startedAt))),
    weekRun: longestWeekRun(rideWeeks),
    firstFtp: rides.find((r) => Number.isFinite(r.ftp) && r.ftp > 0)?.ftp ?? null,
    summits: new Set(summits),
    lemons: num(lemons),
    routes,
  };
}

const anyRide = (test) => (f) => f.rides.some(test);
// `finalOnly`: decided by the saved ride only, never live (a ride's duration still grows).
const def = (id, check, secret = false, finalOnly = false) => Object.freeze({ id, secret, finalOnly, check });

export const ACHIEVEMENTS = Object.freeze([
  def("firstRide", (f) => f.rides.length > 0),
  def("marathon", anyRide((r) => num(r.distanceM) >= 42_195)),
  def("century", anyRide((r) => num(r.distanceM) >= 100_000)),
  def("climb1000", (f) => f.climbM >= 1000),
  def("climb4000", (f) => f.climbM >= 4000),
  def("everest", (f) => f.climbM >= 8849),
  def("km1000", (f) => f.distanceM >= 1_000_000),
  def("croissants", (f) => f.kJ >= 25_000),
  def("weeks4", (f) => f.weekRun >= 4),
  def("weeks12", (f) => f.weekRun >= 12),
  def("tourist", (f) => f.routeIds.size >= 3),
  def("local", (f) => Array.isArray(f.routes) && f.routes.length > 0 && f.routes.every((r) => f.routeIds.has(r.id))),
  def("bothWays", (f) => f.routeIds.has("herne-hill") && f.routeIds.has("herne-hill-clockwise")),
  def("lavaFeet", anyRide((r) => r.routeId === "lanzarote-lava-180" && num(r.distanceM) >= 180_000)),
  def("lemons10", (f) => f.lemons >= 10),
  def("summits10", (f) => f.summits.size >= 10),
  // A finished test only: `test` alone is also set by a ramp stopped too short, so older records without `testFtp` don't count.
  def("knowThyself", anyRide((r) => num(r.testFtp) > 0)),
  def("stronger", (f) => f.firstFtp !== null && f.rides.some((r) => num(r.ftp) * 10 >= f.firstFtp * 11)),
  def("watts1000", anyRide((r) => r.measured === true && num(r.maxPower) >= 1000)),
  def("nightOwl", anyRide((r) => hour(r) >= 22 || hour(r) < 4), true),
  def("earlyBird", anyRide((r) => hour(r) >= 4 && hour(r) < 6), true),
  def("lunchBreak", anyRide((r) => local(r).getDay() % 6 !== 0 && hour(r) === 12 && num(r.durationS) >= 900 && num(r.durationS) < 3600), true, true),
  def("cookieBurner", anyRide((r) => onDay(r, 11, [24, 25, 26])), true),
  def("newYear", anyRide((r) => onDay(r, 0, [1])), true),
  def("thumbWarrior", anyRide((r) => r.device === "paddle"), true),
  def("bendy", (f) => f.workouts.some((w) => YOGA_PLANS.has(w.planId)), true),
  def("crossTrainer", (f) => [...f.workoutWeeks].some((w) => f.rideWeeks.has(w)), true),
  def("classicRider", anyRide((r) => r.world !== WORLD_STAMP)),
]);

/** The ids whose check holds on `sources` ({records, summits, lemons, routes}). */
export function earnedNow(sources) {
  const facts = achievementFacts(sources);
  return ACHIEVEMENTS.filter((a) => a.check(facts)).map((a) => a.id);
}

export const ACHIEVEMENTS_KEY = "openradlr.achievements";
const VERSION = 1;

/** The stored earned dates; anything unreadable is empty. Unknown ids are kept. */
export function loadAchievements(storage) {
  try {
    const data = JSON.parse(storage.getItem(ACHIEVEMENTS_KEY) ?? "null");
    if (!data || data.version !== VERSION || typeof data.earned !== "object" || data.earned === null) return { earned: {} };
    return { earned: Object.fromEntries(Object.entries(data.earned).filter(([, ms]) => Number.isFinite(ms))) };
  } catch {
    return { earned: {} };
  }
}

/** False when the storage refuses. */
export function saveAchievements(storage, state) {
  try {
    storage.setItem(ACHIEVEMENTS_KEY, JSON.stringify({ version: VERSION, earned: state.earned }));
    return true;
  } catch {
    return false;
  }
}

/**
 * For each of `ids` (default: those that hold now), when it was earned: the start of the
 * first record after which it holds (summits and lemons carry no dates, so the search
 * leaves them out). Ones only summits or lemons complete are dated by the newest record,
 * or `nowMs` with none. Every check only grows with more records, so a binary search
 * over the prefixes finds that record.
 */
export function backdate(sources, nowMs, ids = earnedNow(sources)) {
  const { rides, workouts } = achievementFacts(sources);
  const records = [...rides, ...workouts].sort((a, b) => a.startedAt - b.startedAt);
  const prefixes = new Map();
  const factsOf = (n) => {
    if (!prefixes.has(n)) prefixes.set(n, achievementFacts({ routes: sources.routes, records: records.slice(0, n) }));
    return prefixes.get(n);
  };
  const fallback = records.at(-1)?.startedAt ?? nowMs;
  const dates = {};
  for (const a of ACHIEVEMENTS.filter((a) => ids.includes(a.id))) {
    if (!a.check(factsOf(records.length))) {
      dates[a.id] = fallback;
      continue;
    }
    let low = 1;
    let high = records.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (a.check(factsOf(mid))) high = mid;
      else low = mid + 1;
    }
    dates[a.id] = records[low - 1].startedAt;
  }
  return dates;
}

/** Latches what holds and isn't latched yet, with its backdated date; the same state when nothing is new. */
export function reconcile(state, sources, nowMs) {
  const fresh = earnedNow(sources).filter((id) => !(id in state.earned));
  if (fresh.length === 0) return state;
  const dates = backdate(sources, nowMs, fresh);
  return { earned: { ...state.earned, ...Object.fromEntries(fresh.map((id) => [id, dates[id]])) } };
}

/** Latches `ids` with `nowMs`, leaving the ones already latched as they are. */
export function latch(state, ids, nowMs) {
  const fresh = ids.filter((id) => !(id in state.earned));
  if (fresh.length === 0) return state;
  return { earned: { ...state.earned, ...Object.fromEntries(fresh.map((id) => [id, nowMs])) } };
}

const FINAL_ONLY = new Set(ACHIEVEMENTS.filter((a) => a.finalOnly).map((a) => a.id));

/**
 * Watches a ride for achievements earned on it. Until the kept history is known it
 * reports nothing, so a long-time rider never sees "first ride" while it loads.
 */
export class AchievementWatch {
  #storage;
  #nowMs;
  #state;
  #sources = null;

  constructor({ storage, nowMs }) {
    this.#storage = storage;
    this.#nowMs = nowMs;
    this.#state = loadAchievements(storage);
  }

  /** The kept records, summits, lemons and routes; what they already earned is latched silently. */
  setHistory(sources) {
    this.#sources = sources;
    const next = reconcile(this.#state, sources, this.#nowMs);
    if (next !== this.#state) saveAchievements(this.#storage, next);
    this.#state = next;
  }

  /** The ids `liveRecord` newly earns, latched with `nowMs`; `extra` replaces the history's summits or lemons. */
  update(liveRecord, nowMs, extra = {}) {
    if (!this.#sources) return [];
    const fresh = earnedNow({ ...this.#sources, ...extra, records: [...this.#sources.records, liveRecord] }).filter((id) => !(id in this.#state.earned) && !FINAL_ONLY.has(id));
    if (fresh.length === 0) return [];
    this.#state = latch(this.#state, fresh, nowMs);
    saveAchievements(this.#storage, this.#state);
    return fresh;
  }
}
