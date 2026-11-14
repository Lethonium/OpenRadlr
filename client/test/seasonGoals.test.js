import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  GOALS_KEY,
  MAX_GOALS,
  KINDS,
  loadGoals,
  saveGoals,
  addGoal,
  replaceGoal,
  removeGoal,
  endPresets,
  goalProgress,
  goalWeek,
  refreshWeekBest,
  activeGoals,
} from "../public/js/profile/seasonGoals.js";

// Local dates, as the app sees them.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const addDays = (ms, days) => {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
};
const endOfDay = (ms) => {
  const date = new Date(ms);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
};
const KM = 1000;
const ride = (startedAt, distanceM, extra = {}) => ({ startedAt, distanceM, durationS: 3600, elevationGainM: 100, ...extra });

const fakeStorage = (value) => {
  const items = new Map(value === undefined ? [] : [[GOALS_KEY, value]]);
  return { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, v) => items.set(key, String(v)), items };
};

// Monday 4 January 2027; a goal of `weeks` weeks ends on the Sunday of its last week.
const MON = at(2027, 1, 4, 0);
const goalOver = (weeks, fields) => ({
  id: "g1",
  kind: "total",
  metric: "distance",
  target: 2000 * KM,
  routeId: null,
  startMs: MON,
  endMs: endOfDay(addDays(MON, weeks * 7 - 1)),
  createdAt: MON,
  ...fields,
});
const week = (n, h = 12) => addDays(MON, (n - 1) * 7) + h * 3600_000;
const monday = (n) => addDays(MON, (n - 1) * 7);

test("constants", () => {
  assert.equal(GOALS_KEY, "openradlr.goals");
  assert.equal(MAX_GOALS, 5);
  assert.deepEqual(KINDS, ["total", "long", "lap"]);
});

test("loadGoals: missing, broken or another version is an empty state", () => {
  const empty = { rhythmStartMs: null, goals: [] };
  assert.deepEqual(loadGoals(fakeStorage()), empty);
  assert.deepEqual(loadGoals(fakeStorage("{")), empty);
  assert.deepEqual(loadGoals(fakeStorage(JSON.stringify({ version: 2, rhythmStartMs: MON, goals: [goalOver(10)] }))), empty);
});

test("loadGoals: a goal missing its target is dropped, the valid one kept", () => {
  const broken = { ...goalOver(10), id: "bad" };
  delete broken.target;
  const state = loadGoals(fakeStorage(JSON.stringify({ version: 1, rhythmStartMs: MON, goals: [broken, goalOver(10)] })));
  assert.deepEqual(state.goals.map((goal) => goal.id), ["g1"]);
  assert.equal(state.rhythmStartMs, MON);
});

test("loadGoals: a throwing storage is an empty state", () => {
  const storage = { getItem: () => { throw new Error("denied"); } };
  assert.deepEqual(loadGoals(storage), { rhythmStartMs: null, goals: [] });
});

test("saveGoals writes what loadGoals reads, and says false when storage throws", () => {
  const storage = fakeStorage();
  const state = { rhythmStartMs: MON, goals: [goalOver(10)] };
  assert.equal(saveGoals(storage, state), true);
  assert.deepEqual(loadGoals(storage), state);
  assert.equal(saveGoals({ setItem: () => { throw new Error("quota"); } }, state), false);
});

test("addGoal anchors the rhythm on the Monday of the first goal and keeps it", () => {
  let state = addGoal({ rhythmStartMs: null, goals: [] }, goalOver(10), at(2027, 1, 6));
  assert.equal(state.rhythmStartMs, MON);
  state = addGoal(state, { ...goalOver(10), id: "g2" }, at(2027, 2, 3));
  assert.equal(state.rhythmStartMs, MON);
  assert.equal(state.goals.length, 2);
});

test("removeGoal keeps the rhythm while a goal remains and clears it with the last", () => {
  let state = { rhythmStartMs: MON, goals: [goalOver(10), { ...goalOver(10), id: "g2" }] };
  state = removeGoal(state, "g1");
  assert.equal(state.rhythmStartMs, MON);
  assert.deepEqual(state.goals.map((goal) => goal.id), ["g2"]);
  state = removeGoal(state, "g2");
  assert.deepEqual(state, { rhythmStartMs: null, goals: [] });
});

test("replaceGoal keeps the start, so progress so far stays", () => {
  const state = { rhythmStartMs: MON, goals: [goalOver(10)] };
  const changed = replaceGoal(state, { ...goalOver(12), target: 1500 * KM, startMs: at(2027, 2, 1, 0) });
  assert.equal(changed.goals[0].startMs, MON);
  assert.equal(changed.goals[0].target, 1500 * KM);
});

test("endPresets: winter is the next 20 March, at the end of that day", () => {
  const presets = endPresets(at(2026, 11, 18));
  assert.deepEqual(presets.map((preset) => preset.id), ["winter", "weeks8", "weeks12", "yearEnd"]);
  const byId = Object.fromEntries(presets.map((preset) => [preset.id, preset.endMs]));
  assert.equal(byId.winter, endOfDay(at(2027, 3, 20)));
  assert.equal(byId.weeks8, endOfDay(at(2027, 1, 13)));
  assert.equal(byId.weeks12, endOfDay(at(2027, 2, 10)));
  assert.equal(byId.yearEnd, endOfDay(at(2026, 12, 31)));
});

test("endPresets: in the last week before 20 March winter is the next year's", () => {
  const byId = Object.fromEntries(endPresets(at(2027, 3, 15)).map((preset) => [preset.id, preset.endMs]));
  assert.equal(byId.winter, endOfDay(at(2028, 3, 20)));
});

test("goalProgress: a total sums rides inside the goal, not workouts", () => {
  const goal = goalOver(10);
  const records = [
    ride(at(2027, 1, 3), 50 * KM), // before the start
    ride(at(2027, 1, 5), 40 * KM),
    ride(at(2027, 1, 9), 30 * KM),
    ride(at(2027, 1, 7), 99 * KM, { kind: "workout" }),
    ride(at(2027, 3, 20), 70 * KM), // after the end
  ];
  assert.deepEqual(goalProgress(goal, { records, best: null }), { value: 70 * KM, reached: false });
});

test("goalProgress: a long ride is the longest of all history", () => {
  const goal = goalOver(10, { kind: "long", target: 50 * KM });
  const records = [ride(at(2026, 6, 1), 52 * KM), ride(at(2027, 1, 5), 30 * KM)];
  assert.deepEqual(goalProgress(goal, { records, best: null }), { value: 52 * KM, reached: true });
});

test("goalProgress: a lap is the best lap, nothing without one", () => {
  const goal = goalOver(10, { kind: "lap", metric: "time", target: 1200, routeId: "rolling-hills" });
  assert.deepEqual(goalProgress(goal, { records: [], best: { durationS: 1318, recordedAt: MON } }), { value: 1318, reached: false });
  assert.deepEqual(goalProgress(goal, { records: [], best: null }), { value: null, reached: false });
  assert.equal(goalProgress(goal, { records: [], best: { durationS: 1200, recordedAt: MON } }).reached, true);
});

const lapGoal = goalOver(12, { kind: "lap", metric: "time", target: 1200, routeId: "rolling-hills" });

test("lap: the worked example of #99, 21:58 to 20:00 over 12 weeks", () => {
  const steps = [];
  let mondayBest = 1318;
  for (let n = 1; n <= 12; n += 1) {
    const goal = { ...lapGoal, weekBest: { weekStartMs: monday(n), durationS: mondayBest } };
    const best = { durationS: mondayBest, recordedAt: monday(n) - 1000 };
    const w = goalWeek(goal, { records: [], best, rhythmStartMs: MON, nowMs: week(n) });
    steps.push([Math.round(w.step), w.recovery]);
    mondayBest = Math.round(w.step); // the rider rides each step exactly
  }
  const mmss = steps.map(([s, recovery]) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${recovery ? " easy" : ""}`);
  assert.deepEqual(mmss, ["21:36", "21:16", "20:58", "20:58 easy", "20:43", "20:30", "20:19", "20:19 easy", "20:11", "20:05", "20:01", "20:00"]);
});

test("lap: a faster best re-plans the rest of the curve", () => {
  const goal = { ...lapGoal, weekBest: { weekStartMs: monday(2), durationS: 1260 } };
  const w = goalWeek(goal, { records: [], best: { durationS: 1260, recordedAt: monday(2) - 1000 }, rhythmStartMs: MON, nowMs: week(2) });
  assert.ok(w.step < 1260 && w.step > 1200);
  assert.ok(w.step < 1276, `${w.step} should be under the on-plan 21:16`);
});

test("lap: a best set this week under the step makes the week done; the step stays on the Monday best", () => {
  const goal = { ...lapGoal, weekBest: { weekStartMs: monday(2), durationS: 1296 } };
  const before = goalWeek(goal, { records: [], best: { durationS: 1296, recordedAt: monday(1) }, rhythmStartMs: MON, nowMs: week(2) });
  const after = goalWeek(goal, { records: [], best: { durationS: 1270, recordedAt: week(2) }, rhythmStartMs: MON, nowMs: week(2, 18) });
  assert.equal(before.done, false);
  assert.equal(after.step, before.step);
  assert.equal(after.done, true);
  assert.equal(after.soFar, 1270);
});

test("lap: without a best lap there is no step yet", () => {
  const w = goalWeek(lapGoal, { records: [], best: null, rhythmStartMs: MON, nowMs: week(1) });
  assert.equal(w.step, null);
  assert.equal(w.done, false);
  assert.equal(w.reachable, true);
});

test("refreshWeekBest stores the Monday best once a week", () => {
  const best = { durationS: 1300, recordedAt: monday(1) };
  const fresh = refreshWeekBest(lapGoal, best, week(2));
  assert.deepEqual(fresh.weekBest, { weekStartMs: monday(2), durationS: 1300 });
  assert.equal(refreshWeekBest(fresh, { durationS: 1250, recordedAt: week(2) }, week(2, 20)), fresh);
  assert.equal(refreshWeekBest(goalOver(10), best, week(2)).weekBest, undefined);
});

const totalGoal = goalOver(10); // 2,000 km, recovery weeks 4 and 8
const PACE = (2000 * KM) / (8 + 2 * 0.65);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1, `${actual} ≈ ${expected}`);

test("total: the build step spreads the target over build-week equivalents", () => {
  const w = goalWeek(totalGoal, { records: [], best: null, rhythmStartMs: MON, nowMs: week(1) });
  assert.equal(w.index, 1);
  assert.equal(w.count, 10);
  assert.equal(w.recovery, false);
  near(w.step, PACE);
  assert.equal(w.reachable, true);
  assert.equal(w.earliestEndMs, null);
});

test("total: a recovery week asks 0.65 of the build step", () => {
  const records = [1, 2, 3].map((n) => ride(week(n), PACE));
  const w = goalWeek(totalGoal, { records, best: null, rhythmStartMs: MON, nowMs: week(4) });
  assert.equal(w.recovery, true);
  near(w.step, 0.65 * PACE);
});

test("total: a missed week spreads over the weeks left", () => {
  const w = goalWeek(totalGoal, { records: [], best: null, rhythmStartMs: MON, nowMs: week(2) });
  near(w.step, (2000 * KM) / (7 + 2 * 0.65));
  assert.ok(w.step > PACE);
});

test("total: the build step is capped at 1.3 times the original pace, and says when the cap cannot make it", () => {
  const w = goalWeek(totalGoal, { records: [], best: null, rhythmStartMs: MON, nowMs: week(9) });
  near(w.step, 1.3 * PACE);
  assert.equal(w.reachable, false);
  // At the cap from week 9: build weeks 9-11, 13-15, recovery 12, and week 16 finishes it.
  assert.equal(w.earliestEndMs, monday(17) - 1);
});

test("total: so far counts this week's rides and the ride in progress", () => {
  const records = [ride(week(1), 100 * KM), ride(week(2), 60 * KM)];
  const w = goalWeek(totalGoal, { records, best: null, rhythmStartMs: MON, nowMs: week(2, 18), live: { distanceM: 25 * KM, durationS: 3600, elevationGainM: 0, lapS: null } });
  assert.equal(w.soFar, 85 * KM);
  assert.equal(w.progress, 185 * KM);
  assert.equal(w.done, false);
});

const longGoal = goalOver(8, { kind: "long", target: 50 * KM }); // recovery week 4; week 8 is the last, so a build week

test("long: a build step is at most 15 % above the longest before Monday", () => {
  const records = [ride(at(2026, 10, 1), 30 * KM)];
  const w = goalWeek(longGoal, { records, best: null, rhythmStartMs: MON, nowMs: week(1) });
  assert.ok(w.step <= 1.15 * 30 * KM + 1e-6);
  near(w.step, 1.15 * 30 * KM);
  assert.equal(w.reachable, true);
});

test("long: the last week asks the target, or says it is out of reach", () => {
  const close = goalWeek(longGoal, { records: [ride(week(7), 45 * KM)], best: null, rhythmStartMs: MON, nowMs: week(8) });
  assert.equal(close.recovery, false);
  near(close.step, 50 * KM);
  assert.equal(close.reachable, true);
  const far = goalWeek(longGoal, { records: [ride(week(7), 40 * KM)], best: null, rhythmStartMs: MON, nowMs: week(8) });
  near(far.step, 46 * KM);
  assert.equal(far.reachable, false);
  assert.equal(far.earliestEndMs, monday(10) - 1);
});

test("long: a recovery week asks 70 % of the longest so far", () => {
  const w = goalWeek(longGoal, { records: [ride(week(3), 38 * KM)], best: null, rhythmStartMs: MON, nowMs: week(4) });
  assert.equal(w.recovery, true);
  near(w.step, 0.7 * 38 * KM);
});

test("long: the ride in progress counts for this week's long ride", () => {
  const records = [ride(at(2026, 10, 1), 30 * KM)];
  const live = { distanceM: 35 * KM, durationS: 4000, elevationGainM: 0, lapS: null };
  const w = goalWeek(longGoal, { records, best: null, rhythmStartMs: MON, nowMs: week(1), live });
  assert.equal(w.soFar, 35 * KM);
  assert.equal(w.done, true);
});

test("a goal's last week is a build week even when the rhythm says recovery", () => {
  const goal = goalOver(4);
  const w = goalWeek(goal, { records: [], best: null, rhythmStartMs: MON, nowMs: week(4) });
  assert.equal(w.recovery, false);
  near(w.step, 1.3 * ((2000 * KM) / 4)); // nothing ridden: the whole target is left, capped
});

test("a goal set on a Sunday counts that week as its first", () => {
  const sunday = at(2027, 1, 10, 0);
  const goal = { ...goalOver(10), startMs: sunday };
  const w = goalWeek(goal, { records: [], best: null, rhythmStartMs: MON, nowMs: at(2027, 1, 10, 20) });
  assert.equal(w.index, 1);
  assert.equal(w.count, 10);
});

test("finished after the end date; a reached goal has no step", () => {
  const records = [ride(week(2), 2000 * KM)];
  const reached = goalWeek(totalGoal, { records, best: null, rhythmStartMs: MON, nowMs: week(3) });
  assert.equal(reached.reached, true);
  assert.equal(reached.step, null);
  assert.equal(reached.finished, false);
  const over = goalWeek(totalGoal, { records: [], best: null, rhythmStartMs: MON, nowMs: week(11) });
  assert.equal(over.finished, true);
  assert.equal(over.reached, false);
  assert.equal(over.step, null);
});

test("lap: a lap in progress under the step marks the week done", () => {
  const goal = { ...lapGoal, weekBest: { weekStartMs: monday(1), durationS: 1318 } };
  const live = { distanceM: 0, durationS: 0, elevationGainM: 0, lapS: 1290 };
  const w = goalWeek(goal, { records: [], best: { durationS: 1318, recordedAt: monday(1) - 1 }, rhythmStartMs: MON, nowMs: week(1), live });
  assert.equal(w.done, true);
  assert.equal(w.soFar, 1290);
});

test("activeGoals leaves out finished goals", () => {
  const state = { rhythmStartMs: MON, goals: [goalOver(2), { ...goalOver(10), id: "g2" }] };
  assert.deepEqual(activeGoals(state, week(5)).map((goal) => goal.id), ["g2"]);
});

test("week count across the end of summer time (TZ=Europe/Zurich)", () => {
  // Clocks go back on Sunday 25 October 2026 and forward on 28 March 2027.
  const code = `
    import { goalWeek } from ${JSON.stringify(new URL("../public/js/profile/seasonGoals.js", import.meta.url).href)};
    const at = (y, m, d, h) => new Date(y, m - 1, d, h).getTime();
    const goal = (s, e) => ({ id: "g", kind: "total", metric: "distance", target: 1e6, routeId: null, startMs: s, endMs: e, createdAt: s });
    const autumn = goalWeek(goal(at(2026, 10, 19, 0), at(2026, 11, 8, 23)), { records: [], best: null, rhythmStartMs: at(2026, 10, 19, 0), nowMs: at(2026, 11, 2, 0) });
    const spring = goalWeek(goal(at(2027, 3, 22, 0), at(2027, 4, 11, 23)), { records: [], best: null, rhythmStartMs: at(2027, 3, 22, 0), nowMs: at(2027, 3, 29, 0) });
    console.log(JSON.stringify([autumn.count, autumn.index, spring.count, spring.index]));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TZ: "Europe/Zurich" } });
  assert.deepEqual(JSON.parse(String(out)), [3, 3, 3, 2]);
});
