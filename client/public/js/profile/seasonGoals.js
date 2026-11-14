/**
 * Season goals (#99): the stored goals and their weekly steps. Only the goals are
 * stored, with the rhythm's anchor and a lap goal's Monday best; this week's step is
 * computed from the goal, the ride records before this Monday and the clock, so it
 * is re-planned every Monday by itself. Pure; storage and the clock come in.
 */

import { weekStart } from "./stats.js";

export const GOALS_KEY = "openradlr.goals";
export const MAX_GOALS = 5;
export const KINDS = ["total", "long", "lap"];
/** What the ride's summary image shows of the goals: reached goals, also this week's progress, or nothing. */
export const IMAGE_MODES = ["reached", "progress", "off"];
const METRICS = ["distance", "time", "climb"];
const VERSION = 1;

/** Every 4th week of the shared rhythm is an easy week. */
const RHYTHM = 4;
/** An easy week of a total counts this much of a build week, and asks this share. */
const TOTAL_RECOVERY = 0.65;
/** A total's build step is at most this many times the goal's original pace. */
const TOTAL_CAP = 1.3;
/** A long ride grows at most this much per build week. */
const LONG_CAP = 1.15;
/** An easy week's long ride, as a share of the longest so far. */
const LONG_RECOVERY = 0.7;
/** How far ahead "at a sensible pace this takes until" looks. */
const HORIZON_WEEKS = 104;

const DAY_MS = 86_400_000;
const EPSILON = 1e-6;

const emptyState = () => ({ rhythmStartMs: null, image: IMAGE_MODES[0], goals: [] });

const finite = (value) => typeof value === "number" && Number.isFinite(value);

function validGoal(goal) {
  if (!goal || typeof goal !== "object" || typeof goal.id !== "string") return false;
  if (!KINDS.includes(goal.kind) || !METRICS.includes(goal.metric)) return false;
  if (!finite(goal.target) || goal.target <= 0 || !finite(goal.startMs) || !finite(goal.endMs)) return false;
  // A goal whose end is before its start has no weeks; keeping it would throw later.
  if (goal.endMs < goal.startMs) return false;
  return goal.kind !== "lap" || typeof goal.routeId === "string";
}

/** The stored goals; anything unreadable is no goals, never a throw. */
export function loadGoals(storage) {
  try {
    const data = JSON.parse(storage.getItem(GOALS_KEY) ?? "null");
    if (!data || data.version !== VERSION || !Array.isArray(data.goals)) return emptyState();
    const goals = data.goals.filter(validGoal);
    const image = IMAGE_MODES.includes(data.image) ? data.image : IMAGE_MODES[0];
    return { rhythmStartMs: goals.length && finite(data.rhythmStartMs) ? data.rhythmStartMs : null, image, goals };
  } catch {
    return emptyState();
  }
}

/** Stores the goals; false when storage refuses. */
export function saveGoals(storage, state) {
  try {
    storage.setItem(GOALS_KEY, JSON.stringify({ version: VERSION, ...state }));
    return true;
  } catch {
    return false;
  }
}

/** Adds a goal; the first one anchors the shared rhythm on this Monday. */
export function addGoal(state, goal, nowMs) {
  const rhythmStartMs = state.goals.length && finite(state.rhythmStartMs) ? state.rhythmStartMs : weekStart(nowMs);
  return { ...state, rhythmStartMs, goals: [...state.goals, goal] };
}

/** Changes a goal; it keeps its start, so progress so far stays. */
export function replaceGoal(state, goal) {
  const goals = state.goals.map((old) => {
    if (old.id !== goal.id) return old;
    const changed = { ...goal, startMs: old.startMs, createdAt: old.createdAt };
    // A Monday best only holds for the route it was taken on.
    if (changed.kind !== "lap" || changed.routeId !== old.routeId) delete changed.weekBest;
    return changed;
  });
  return { ...state, goals };
}

/** Removes a goal; the rhythm stays while any goal remains. */
export function removeGoal(state, id) {
  const goals = state.goals.filter((goal) => goal.id !== id);
  return { ...state, rhythmStartMs: goals.length ? state.rhythmStartMs : null, goals };
}

const endOfDay = (year, month, day) => new Date(year, month, day, 23, 59, 59, 999).getTime();

/** The end dates the goal form offers; each at least a week out. */
export function endPresets(nowMs) {
  const now = new Date(nowMs);
  const weekOut = nowMs + 7 * DAY_MS;
  const year = now.getFullYear();
  const inDays = (days) => endOfDay(year, now.getMonth(), now.getDate() + days);
  const winter = endOfDay(year, 2, 20) >= weekOut ? endOfDay(year, 2, 20) : endOfDay(year + 1, 2, 20);
  const yearEnd = endOfDay(year, 11, 31) >= weekOut ? endOfDay(year, 11, 31) : endOfDay(year + 1, 11, 31);
  return [
    { id: "winter", endMs: winter },
    { id: "weeks8", endMs: inDays(56) },
    { id: "weeks12", endMs: inDays(84) },
    { id: "yearEnd", endMs: yearEnd },
  ];
}

const FIELDS = { distance: "distanceM", time: "durationS", climb: "elevationGainM" };
const amount = (item, metric) => (finite(item?.[FIELDS[metric]]) ? item[FIELDS[metric]] : 0);
const rides = (records) => records.filter((record) => record.kind !== "workout" && finite(record.startedAt));

const sum = (list, metric) => list.reduce((total, record) => total + amount(record, metric), 0);
const longest = (list, metric) => list.reduce((most, record) => Math.max(most, amount(record, metric)), 0);

function progressValue(goal, records, best) {
  if (goal.kind === "lap") return finite(best?.durationS) ? best.durationS : null;
  const all = rides(records);
  if (goal.kind === "long") return longest(all, goal.metric);
  return sum(all.filter((r) => r.startedAt >= goal.startMs && r.startedAt <= goal.endMs), goal.metric);
}

const isReached = (goal, value) => value !== null && (goal.kind === "lap" ? value <= goal.target : value >= goal.target);

/** How far a goal is: total so far, longest ride, or best lap (null without one). */
export function goalProgress(goal, { records, best }) {
  const value = progressValue(goal, records, best);
  return { value, reached: isReached(goal, value) };
}

/** Whole weeks between two Mondays; rounding keeps a DST week at one week. */
const weeksBetween = (fromMonday, toMonday) => Math.round(Math.round((toMonday - fromMonday) / DAY_MS) / 7);

function addWeeks(mondayMs, weeks) {
  const date = new Date(mondayMs);
  date.setDate(date.getDate() + weeks * 7);
  return date.getTime();
}

/** A goal's weeks: Monday of each, and whether it is an easy week on the shared rhythm. */
function goalWeeks(goal, rhythmStartMs) {
  const first = weekStart(goal.startMs);
  const count = weeksBetween(first, weekStart(goal.endMs)) + 1;
  const anchor = rhythmStartMs ?? first;
  return Array.from({ length: count }, (_, i) => {
    const mondayMs = addWeeks(first, i);
    const recovery = i < count - 1 && isRhythmRecovery(anchor, mondayMs);
    return { mondayMs, recovery };
  });
}

const isRhythmRecovery = (anchor, mondayMs) => ((weeksBetween(anchor, mondayMs) % RHYTHM) + RHYTHM) % RHYTHM === RHYTHM - 1;

/** The remaining gap after build week k of n, as a share of the gap at its Monday (memoryless ease-out). */
const easeOut = (k, n) => {
  const before = (1 - (k - 1) / n) ** 2;
  return before > 0 ? (1 - k / n) ** 2 / before : 0;
};

/**
 * Steps forward from this Monday at the caps until the goal would be met; the end
 * of that week, or null beyond the horizon. `grow(level, recovery, last)` is one week.
 */
function earliestEnd(mondayMs, thisRecovery, anchor, start, done, grow) {
  let level = start;
  for (let i = 0; i < HORIZON_WEEKS; i += 1) {
    const monday = addWeeks(mondayMs, i);
    const recovery = i === 0 ? thisRecovery : isRhythmRecovery(anchor, monday);
    // Any week can be the last, and a last week is a build week.
    if (done(grow(level, false))) return addWeeks(mondayMs, i + 1) - 1;
    level = grow(level, recovery);
  }
  return null;
}

/**
 * This week of a goal: which week it is, whether it is an easy week, the step and
 * how much of it is done. `live` is the ride in progress (`lapS` its last lap).
 */
export function goalWeek(goal, { records, best, rhythmStartMs, nowMs, live = null }) {
  const weeks = goalWeeks(goal, rhythmStartMs);
  const monday = weekStart(nowMs);
  const all = rides(records);
  const thisWeek = all.filter((r) => r.startedAt >= monday);
  const progress = liveProgress(goal, progressValue(goal, records, best), live);
  const reached = isReached(goal, progress);
  const finished = nowMs > goal.endMs || weeks.length === 0;
  // A goal with no weeks (junk that slipped past the store) has nothing to plan.
  if (weeks.length === 0) {
    return { index: 0, count: 0, recovery: false, finished, reached, progress, step: null, soFar: null, done: false, reachable: true, earliestEndMs: null };
  }
  const position = Math.min(Math.max(weeksBetween(weeks[0].mondayMs, monday), 0), weeks.length - 1);
  const { recovery } = weeks[position];
  const beforeMonday = all.filter((r) => r.startedAt < monday);

  const base = { index: position + 1, count: weeks.length, recovery, finished, reached, progress };
  const none = { ...base, step: null, soFar: null, done: false, reachable: true, earliestEndMs: null };
  if (finished || reached) return none;

  const buildWeeks = weeks.filter((w) => !w.recovery).length;
  const buildIndex = weeks.slice(0, position + 1).filter((w) => !w.recovery).length;
  const anchor = rhythmStartMs ?? weeks[0].mondayMs;

  if (goal.kind === "total") {
    const window = (r) => r.startedAt >= goal.startMs && r.startedAt <= goal.endMs;
    const left = goal.target - sum(beforeMonday.filter(window), goal.metric);
    const weight = (w) => (w.recovery ? TOTAL_RECOVERY : 1);
    const pace = goal.target / weeks.reduce((total, w) => total + weight(w), 0);
    const cap = TOTAL_CAP * pace;
    const equivalents = weeks.slice(position).reduce((total, w) => total + weight(w), 0);
    const build = Math.min(left / equivalents, cap);
    const step = recovery ? TOTAL_RECOVERY * build : build;
    const soFar = sum(thisWeek.filter(window), goal.metric) + amount(live, goal.metric);
    const reachable = cap * equivalents >= left - EPSILON;
    const grow = (done, easy) => done + (easy ? TOTAL_RECOVERY : 1) * cap;
    const earliestEndMs = reachable ? null : earliestEnd(monday, recovery, anchor, 0, (done) => done >= left - EPSILON, grow);
    return { ...base, step, soFar, done: soFar >= step - EPSILON, reachable, earliestEndMs };
  }

  if (goal.kind === "long") {
    const longestSoFar = longest(beforeMonday, goal.metric);
    const soFar = Math.max(longest(thisWeek, goal.metric), amount(live, goal.metric));
    const cap = longestSoFar > 0 ? LONG_CAP * longestSoFar : Infinity;
    const planned = goal.target - (goal.target - longestSoFar) * easeOut(buildIndex, buildWeeks);
    // An easy week trims the longest so far; with nothing yet, the week's own plan.
    const step = recovery ? LONG_RECOVERY * (longestSoFar || planned) : Math.min(planned, cap);
    const buildLeft = weeks.slice(position).filter((w) => !w.recovery).length;
    const reachable = longestSoFar === 0 || longestSoFar * LONG_CAP ** buildLeft >= goal.target - EPSILON;
    const grow = (level, easy) => (easy ? level : level * LONG_CAP);
    const earliestEndMs = reachable ? null : earliestEnd(monday, recovery, anchor, longestSoFar, (level) => level >= goal.target - EPSILON, grow);
    return { ...base, step, soFar, done: soFar >= step - EPSILON, reachable, earliestEndMs };
  }

  // Lap: the best as it stood on Monday, so a new best this week does not move the step.
  const mondayBest = goal.weekBest?.weekStartMs === monday ? goal.weekBest.durationS : finite(best?.durationS) ? best.durationS : null;
  const laps = [finite(best?.durationS) && best.recordedAt >= monday ? best.durationS : null, live?.lapS ?? null].filter(finite);
  const soFar = laps.length ? Math.min(...laps) : null;
  if (!finite(mondayBest)) return { ...none, soFar };
  const step = recovery ? mondayBest : goal.target + (mondayBest - goal.target) * easeOut(buildIndex, buildWeeks);
  return { ...base, step, soFar, done: soFar !== null && soFar <= step + EPSILON, reachable: true, earliestEndMs: null };
}

/** Progress including the ride in progress: added for a total, the longer ride, the faster lap. */
function liveProgress(goal, value, live) {
  if (!live) return value;
  if (goal.kind === "total") return value + amount(live, goal.metric);
  if (goal.kind === "long") return Math.max(value, amount(live, goal.metric));
  return finite(live.lapS) ? Math.min(value ?? Infinity, live.lapS) : value;
}

/** A lap goal with this week's Monday best stored; the same object when it is current. */
export function refreshWeekBest(goal, best, nowMs) {
  if (goal.kind !== "lap") return goal;
  const monday = weekStart(nowMs);
  if (goal.weekBest?.weekStartMs === monday) return goal;
  return { ...goal, weekBest: { weekStartMs: monday, durationS: finite(best?.durationS) ? best.durationS : null } };
}

/** The goals not past their end date. */
export function activeGoals(state, nowMs) {
  return state.goals.filter((goal) => nowMs <= goal.endMs);
}
