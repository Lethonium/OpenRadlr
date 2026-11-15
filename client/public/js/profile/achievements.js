/**
 * Achievements (#27): worked out from the kept ride records, summits and lemons, then
 * latched with the date they were earned so they stay earned when rides are deleted.
 * Pure; storage and the clock come in.
 */

import { weekStart } from "./stats.js";
import { PRESETS } from "../workout/presets.js";
import { VENUES } from "../workout/venues.js";

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
const def = (id, check, secret = false) => Object.freeze({ id, secret, check });

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
  def("knowThyself", anyRide((r) => Boolean(r.test))),
  def("stronger", (f) => f.firstFtp !== null && f.rides.some((r) => num(r.ftp) * 10 >= f.firstFtp * 11)),
  def("watts1000", anyRide((r) => r.measured === true && num(r.maxPower) >= 1000)),
  def("nightOwl", anyRide((r) => hour(r) >= 22 || hour(r) < 4), true),
  def("earlyBird", anyRide((r) => hour(r) >= 4 && hour(r) < 6), true),
  def("lunchBreak", anyRide((r) => local(r).getDay() % 6 !== 0 && hour(r) === 12 && num(r.durationS) >= 900 && num(r.durationS) < 3600), true),
  def("cookieBurner", anyRide((r) => onDay(r, 11, [24, 25, 26])), true),
  def("newYear", anyRide((r) => onDay(r, 0, [1])), true),
  def("thumbWarrior", anyRide((r) => r.device === "paddle"), true),
  def("bendy", (f) => f.workouts.some((w) => YOGA_PLANS.has(w.planId)), true),
  def("crossTrainer", (f) => [...f.workoutWeeks].some((w) => f.rideWeeks.has(w)), true),
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
 * For each id that holds now, when it was earned: the start of the first record after
 * which it holds (summits and lemons carry no dates, so the scan leaves them out). Ones
 * only summits or lemons complete are dated by the newest record, or `nowMs` with none.
 */
export function backdate(sources, nowMs) {
  const { rides, workouts } = achievementFacts(sources);
  const records = [...rides, ...workouts].sort((a, b) => a.startedAt - b.startedAt);
  const pending = new Set(earnedNow(sources));
  const dates = {};
  for (let i = 0; i < records.length && pending.size > 0; i++) {
    const facts = achievementFacts({ routes: sources.routes, records: records.slice(0, i + 1) });
    for (const a of ACHIEVEMENTS) {
      if (pending.has(a.id) && a.check(facts)) {
        dates[a.id] = records[i].startedAt;
        pending.delete(a.id);
      }
    }
  }
  const fallback = records.at(-1)?.startedAt ?? nowMs;
  for (const id of pending) dates[id] = fallback;
  return dates;
}

/** Latches what holds and isn't latched yet, with its backdated date; the same state when nothing is new. */
export function reconcile(state, sources, nowMs) {
  const fresh = earnedNow(sources).filter((id) => !(id in state.earned));
  if (fresh.length === 0) return state;
  const dates = backdate(sources, nowMs);
  return { earned: { ...state.earned, ...Object.fromEntries(fresh.map((id) => [id, dates[id]])) } };
}

/** Latches `ids` with `nowMs`, leaving the ones already latched as they are. */
export function latch(state, ids, nowMs) {
  const fresh = ids.filter((id) => !(id in state.earned));
  if (fresh.length === 0) return state;
  return { earned: { ...state.earned, ...Object.fromEntries(fresh.map((id) => [id, nowMs])) } };
}
