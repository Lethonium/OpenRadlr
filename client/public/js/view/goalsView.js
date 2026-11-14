/**
 * Season goals in words (#99): the profile's goal cards, the short line for the HUD
 * and the in-game menu, the finish screen's line and the goal form. Pure; the weeks
 * come from `profile/seasonGoals.js`.
 */

import { t, tn } from "../i18n/i18n.js";
import { distanceUnit, elevationUnit, formatDuration, formatNumber, unitHeightMetres, unitMetres } from "../util/format.js";
import { MAX_GOALS, endPresets } from "../profile/seasonGoals.js";
import { routeName } from "./profilePage.js";

const DAY_MS = 86_400_000;

/** "20 March" in the rider's language. */
function dayMonth(ms, locale) {
  const format = { day: "numeric", month: "long" };
  try {
    return new Date(ms).toLocaleDateString(locale, format);
  } catch {
    return new Date(ms).toLocaleDateString(undefined, format);
  }
}

const whole = (value, round = Math.round) => formatNumber(round(value), 0);

/** Seconds → "3:00" (hours and minutes). */
function hoursMinutes(seconds, round = Math.round) {
  const minutes = round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A number of the metric without its unit, rounded for display. */
function bare(metric, value, round = Math.round) {
  if (metric === "distance") return whole(value / unitMetres(), round);
  if (metric === "climb") return whole(value / unitHeightMetres(), round);
  return hoursMinutes(value, round);
}

const unit = (metric) => (metric === "distance" ? distanceUnit() : metric === "climb" ? elevationUnit() : "h");

/** "50 km", "20,000 m", "100 h" or "2:30 h". */
function amount(metric, value) {
  if (metric === "time" && Math.round(value / 60) % 60 === 0) return `${whole(value / 3600)} h`;
  return `${bare(metric, value)} ${unit(metric)}`;
}

/** "85 / 150 km"; a lap "21:10 / 20:00". What is done rounds down, so 149.6 of 150 never reads as met. */
function pair(goal, value, of) {
  if (goal.kind === "lap") return `${lapTime(value)} / ${lapTime(of)}`;
  return `${bare(goal.metric, value ?? 0, Math.floor)} / ${bare(goal.metric, of)} ${unit(goal.metric)}`;
}

const lapTime = (seconds) => formatDuration(Math.round(seconds));
const tick = (text, done) => (done ? `${text} ✓` : text);

/** What the goal asks, without its date: "2,000 km", "One ride of 50 km", "Rolling Hills lap in 20:00". */
function goalWhat(goal, routes) {
  if (goal.kind === "lap") return t("goals.what.lap", { route: routeName(goal.routeId, routes), time: lapTime(goal.target) });
  const value = amount(goal.metric, goal.target);
  if (goal.kind === "long") return t("goals.what.long", { amount: value });
  if (goal.metric === "time") return t("goals.what.time", { amount: value });
  if (goal.metric === "climb") return t("goals.what.climb", { amount: value });
  return value;
}

/** "2,000 km by 20 March". */
export function goalTitle(goal, routes, { locale } = {}) {
  return t("goals.title", { what: goalWhat(goal, routes), date: dayMonth(goal.endMs, locale) });
}

function progressText(goal, week) {
  if (goal.kind === "total") return pair(goal, week.progress, goal.target);
  if (goal.kind === "long") return t("goals.progress.long", { amount: amount(goal.metric, week.progress ?? 0) });
  return week.progress === null ? t("goals.progress.noLap") : t("goals.progress.lap", { time: lapTime(week.progress) });
}

function fraction(goal, week) {
  if (week.reached) return 1;
  if (week.progress === null || week.progress <= 0) return 0;
  return Math.min(1, goal.kind === "lap" ? goal.target / week.progress : week.progress / goal.target);
}

function stepText(goal, week) {
  if (goal.kind === "total") {
    return t(week.recovery ? "goals.week.total.easy" : "goals.week.total", { pair: pair(goal, week.soFar, week.step) });
  }
  if (goal.kind === "long") {
    return t(week.recovery ? "goals.week.long.easy" : "goals.week.long", { amount: amount(goal.metric, week.step) });
  }
  return t(week.recovery ? "goals.week.lap.easy" : "goals.week.lap", { time: lapTime(week.step) });
}

function weekText(goal, week, routes) {
  if (week.finished) return null;
  if (week.reached) return t("goals.reached");
  if (week.step === null) return t("goals.week.noLap", { route: routeName(goal.routeId, routes) });
  return `${tick(stepText(goal, week), week.done)} · ${t("goals.weekOf", { index: week.index, count: week.count })}`;
}

function noteText(goal, week, locale) {
  if (week.finished) {
    if (week.reached) return t("goals.finished.reached");
    if (week.progress === null) return t("goals.finished.noLap");
    return t("goals.finished.missed", { progress: pair(goal, week.progress, goal.target) });
  }
  if (week.reached || week.reachable) return null;
  return week.earliestEndMs === null ? t("goals.note.farOut") : t("goals.note.until", { date: dayMonth(week.earliestEndMs, locale) });
}

/** One goal card on the profile's Goals page and the in-game menu. */
export function goalCard(goal, week, { routes, locale } = {}) {
  return {
    title: goalTitle(goal, routes, { locale }),
    progress: progressText(goal, week),
    fraction: fraction(goal, week),
    week: weekText(goal, week, routes),
    done: week.done || week.reached,
    note: noteText(goal, week, locale),
  };
}

/** The short form: "Week 85 / 150 km", "Long ride 31 / 41 km", "Lap goal this week 21:16". */
export function goalLine(goal, week) {
  if (week.reached) return t("goals.reached");
  if (week.finished) return t("goals.line.ended");
  if (week.step === null) return t("goals.line.noLap");
  if (goal.kind === "total") return tick(t("goals.line.total", { pair: pair(goal, week.soFar, week.step) }), week.done);
  if (goal.kind === "long") return tick(t("goals.line.long", { pair: pair(goal, week.soFar, week.step) }), week.done);
  return tick(t("goals.line.lap", { time: lapTime(week.step) }), week.done);
}

const open = ({ week }) => !week.finished && !week.reached && week.step !== null;

/** The goal most relevant to the ride on screen, or null (always in a race): a lap goal on this route, a long ride, a total. */
export function hudGoal(entries, { routeId, racing = false }) {
  if (racing) return null;
  const pick =
    entries.find((entry) => open(entry) && entry.goal.kind === "lap" && entry.goal.routeId === routeId) ??
    entries.find((entry) => open(entry) && entry.goal.kind === "long" && !entry.week.done) ??
    entries.find((entry) => open(entry) && entry.goal.kind === "total" && !entry.week.done);
  return pick ? goalLine(pick.goal, pick.week) : null;
}

/** The Overview's line: "2 goals · this week 62 / 150 km" (the first total still open), or null without goals. */
export function goalsSummary(entries) {
  if (!entries.length) return null;
  const count = tn("goals.count", entries.length);
  const total = entries.find((entry) => open(entry) && entry.goal.kind === "total");
  return total ? `${count} · ${t("goals.summary.week", { pair: pair(total.goal, total.week.soFar, total.week.step) })}` : count;
}

/** What this ride changed, as items most important first ({rank, text}); shared with the summary image. */
export function goalChanges(before, after, { routes } = {}) {
  const was = new Map(before.map((entry) => [entry.goal.id, entry.week]));
  const items = [];
  for (const { goal, week } of after) {
    const old = was.get(goal.id);
    if (!old) continue;
    if (week.reached && !old.reached) {
      items.push({ rank: 0, goal, text: t("goals.finish.reached", { what: goalWhat(goal, routes) }) });
    } else if (week.done && !old.done && !week.reached) {
      items.push({ rank: 1, goal, text: weekDoneText(goal, week) });
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}

function weekDoneText(goal, week) {
  if (goal.kind === "total") return t("goals.finish.week", { pair: pair(goal, week.soFar, week.step) });
  if (goal.kind === "long") return t("goals.finish.long", { amount: amount(goal.metric, week.soFar) });
  return t("goals.finish.lap", { time: lapTime(week.soFar) });
}

/** A goal this ride moved, for the summary image: "1,240 / 2,000 km by 20 March", "Longest 39 km of 50 km by 31 December". */
function progressItem(goal, week, routes, locale) {
  const date = dayMonth(goal.endMs, locale);
  if (goal.kind === "total") return t("goals.title", { what: pair(goal, week.progress, goal.target), date });
  if (goal.kind === "long") return t("goals.image.long", { amount: amount(goal.metric, week.progress), target: amount(goal.metric, goal.target), date });
  return `${progressText(goal, week)} · ${goalTitle(goal, routes, { locale })}`;
}

/**
 * The summary image's gold line by the rider's setting (`mode` from the goals' `image`):
 * "reached" shows a reached goal only, "progress" also a week done and what the ride moved.
 */
export function imageGoalLine(before, after, mode, { routes, locale } = {}) {
  if (mode === "off") return null;
  let items = goalChanges(before, after, { routes });
  if (mode === "reached") items = items.filter((item) => item.rank === 0);
  else {
    const was = new Map(before.map((entry) => [entry.goal.id, entry.week]));
    const named = new Set(items.map((item) => item.goal.id));
    for (const { goal, week } of after) {
      const old = was.get(goal.id);
      if (!old || named.has(goal.id) || week.reached || week.progress === old.progress || week.progress === null) continue;
      items.push({ rank: 2, goal, text: progressItem(goal, week, routes, locale) });
    }
  }
  // The star marks the line; the finish screen's ticks would repeat it.
  const shown = items.slice(0, 2).map((item) => item.text.replace(/ ✓$/, ""));
  return shown.length ? `★ ${shown.join(" · ")}` : null;
}

/** The finish screen's line, at most two items, or null when the ride changed nothing. */
export function finishGoalLine(before, after, { routes } = {}) {
  const items = goalChanges(before, after, { routes }).slice(0, 2);
  return items.length ? items.map((item) => item.text).join(" · ") : null;
}

/** "20:00" or "1:02:00" → seconds; NaN when it isn't a time. */
function parseLapTime(text) {
  const match = /^(?:(\d+):)?(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!match) return NaN;
  const [, hours = "0", minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

const parseNumber = (text) => (String(text).trim() === "" ? NaN : Number(String(text).trim().replace(",", ".")));

function parseTarget(kind, metric, text) {
  if (kind === "lap") return parseLapTime(String(text));
  const value = parseNumber(text);
  if (metric === "distance") return value * unitMetres();
  if (metric === "climb") return value * unitHeightMetres();
  if (/^\d+:[0-5]\d$/.test(String(text).trim())) return parseLapTime(`${String(text).trim()}:00`);
  return value * 3600;
}

function parseEnd(fields, nowMs) {
  if (fields.endPreset) return endPresets(nowMs).find((preset) => preset.id === fields.endPreset)?.endMs ?? NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fields.endDate ?? "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999).getTime() : NaN;
}

const FIELDS = { distance: "distanceM", time: "durationS", climb: "elevationGainM" };

/** What the rider already has, when the target is beaten before it starts. */
function alreadyMet(kind, metric, target, routeId, { records, bests }) {
  if (kind === "long") {
    const longest = records.filter((r) => r.kind !== "workout").reduce((most, r) => Math.max(most, r[FIELDS[metric]] || 0), 0);
    return longest >= target ? amount(metric, longest) : null;
  }
  if (kind === "lap") {
    const best = bests.find((entry) => entry.routeId === routeId);
    return best && best.durationS <= target ? lapTime(best.durationS) : null;
  }
  return null;
}

const failure = (error, params) => ({ error, message: t(error, params) });

/**
 * The goal form's fields → a goal, or an error key with its message. `activeCount`
 * is the number of goals the new one would join (leave the changed one out).
 */
export function parseGoalForm(fields, { nowMs, records, bests, activeCount = 0 }) {
  if (activeCount >= MAX_GOALS) return failure("goals.error.full", { max: MAX_GOALS });
  const { kind } = fields;
  const metric = kind === "lap" ? "time" : fields.metric;
  const target = parseTarget(kind, metric, fields.target ?? "");
  if (!Number.isFinite(target) || target <= 0) return failure("goals.error.target");
  const routeId = kind === "lap" ? fields.routeId || null : null;
  if (kind === "lap" && !bests.some((best) => best.routeId === routeId)) return failure("goals.error.route");
  const endMs = parseEnd(fields, nowMs);
  if (!Number.isFinite(endMs) || endMs < nowMs + 7 * DAY_MS) return failure("goals.error.end");
  const met = alreadyMet(kind, metric, target, routeId, { records, bests });
  if (met) return failure("goals.error.met", { value: met });
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const id = fields.id || `goal-${nowMs.toString(36)}`;
  return { goal: { id, kind, metric, target, routeId, startMs: start.getTime(), endMs, createdAt: nowMs } };
}
