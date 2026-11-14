import { test } from "node:test";
import assert from "node:assert/strict";
import { setUnits } from "../public/js/util/format.js";
import { finishGoalLine, goalCard, goalsSummary, goalLine, goalTitle, hudGoal, parseGoalForm } from "../public/js/view/goalsView.js";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const endOfDay = (y, m, d) => new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
const KM = 1000;
const routes = [{ id: "rolling-hills", name: "Rolling Hills" }];
const ctx = { routes, locale: "en-GB" };

const total = { id: "t", kind: "total", metric: "distance", target: 2000 * KM, routeId: null, startMs: at(2026, 11, 2, 0), endMs: endOfDay(2027, 3, 20), createdAt: 0 };
const long = { ...total, id: "l", kind: "long", target: 50 * KM, endMs: endOfDay(2026, 12, 31) };
const lap = { ...total, id: "p", kind: "lap", metric: "time", target: 1200, routeId: "rolling-hills" };
const week = (fields) => ({ index: 6, count: 20, recovery: false, finished: false, reached: false, progress: 0, step: null, soFar: null, done: false, reachable: true, earliestEndMs: null, ...fields });

const imperial = (fn) => () => {
  setUnits("imperial");
  try {
    fn();
  } finally {
    setUnits("metric");
  }
};

test("goalTitle names the target, the kind and the end date", () => {
  assert.equal(goalTitle(total, routes, { locale: "en-GB" }), "2,000 km by 20 March");
  assert.equal(goalTitle(long, routes, { locale: "en-GB" }), "One ride of 50 km by 31 December");
  assert.equal(goalTitle(lap, routes, { locale: "en-GB" }), "Rolling Hills lap in 20:00 by 20 March");
});

test("goalTitle: time and climbing totals, and a route the server doesn't list", () => {
  assert.equal(goalTitle({ ...total, metric: "time", target: 100 * 3600 }, routes, { locale: "en-GB" }), "100 h of riding by 20 March");
  assert.equal(goalTitle({ ...total, metric: "climb", target: 20000 }, routes, { locale: "en-GB" }), "20,000 m of climbing by 20 March");
  assert.equal(goalTitle({ ...lap, routeId: "gone" }, routes, { locale: "en-GB" }), "gone lap in 20:00 by 20 March");
});

test("goalTitle in imperial units", imperial(() => {
  assert.equal(goalTitle({ ...total, target: 1609.344 * 1200 }, routes, { locale: "en-GB" }), "1,200 mi by 20 March");
}));

test("goalCard: a total with this week's step and the week of the goal", () => {
  const card = goalCard(total, week({ progress: 1240 * KM, step: 150 * KM, soFar: 62 * KM }), ctx);
  assert.equal(card.title, "2,000 km by 20 March");
  assert.equal(card.progress, "1,240 / 2,000 km");
  assert.equal(card.fraction, 0.62);
  assert.equal(card.week, "This week 62 / 150 km · week 6 of 20");
  assert.equal(card.done, false);
  assert.equal(card.note, null);
});

test("goalCard: a week done gets a tick", () => {
  const card = goalCard(total, week({ progress: 1240 * KM, step: 150 * KM, soFar: 151 * KM, done: true }), ctx);
  assert.equal(card.week, "This week 151 / 150 km ✓ · week 6 of 20");
  assert.equal(card.done, true);
});

test("goalCard: an easy week is named as such", () => {
  const card = goalCard(long, week({ progress: 38 * KM, step: 26.6 * KM, soFar: 0, recovery: true, index: 4 }), ctx);
  assert.equal(card.progress, "Longest 38 km");
  assert.equal(card.week, "Easy week: one ride of 27 km · week 4 of 20");
});

test("goalCard: a long ride's build week", () => {
  const card = goalCard(long, week({ progress: 38 * KM, step: 41.2 * KM, soFar: 20 * KM }), ctx);
  assert.equal(card.week, "This week: one ride of 41 km · week 6 of 20");
});

test("goalCard: a lap step in m:ss, and no curve without a lap", () => {
  const card = goalCard(lap, week({ progress: 1318, step: 1276.4, soFar: null }), ctx);
  assert.equal(card.progress, "Best 21:58");
  assert.equal(card.week, "This week 21:16 · week 6 of 20");
  const none = goalCard(lap, week({ progress: null }), ctx);
  assert.equal(none.progress, "No lap yet");
  assert.equal(none.fraction, 0);
  assert.equal(none.week, "Ride a full lap of Rolling Hills to start the plan.");
});

test("goalCard: out of reach says until when at a sensible pace", () => {
  const card = goalCard(total, week({ progress: 100 * KM, step: 280 * KM, soFar: 0, reachable: false, earliestEndMs: endOfDay(2027, 5, 2) }), ctx);
  assert.equal(card.note, "At a sensible pace this takes until 2 May. Move the date or change the target.");
});

test("goalCard: a reached goal and a finished one say so plainly", () => {
  const reached = goalCard(total, week({ progress: 2000 * KM, reached: true }), ctx);
  assert.equal(reached.week, "Goal reached ✓");
  assert.equal(reached.fraction, 1);
  const missed = goalCard(total, week({ progress: 1800 * KM, finished: true }), ctx);
  assert.equal(missed.week, null);
  assert.equal(missed.note, "Ended at 1,800 / 2,000 km. Remove it to make room for the next one.");
  const done = goalCard(total, week({ progress: 2100 * KM, finished: true, reached: true }), ctx);
  assert.equal(done.note, "Reached. Remove it to make room for the next one.");
});

test("goalCard in imperial units", imperial(() => {
  const card = goalCard(total, week({ progress: 1240 * KM, step: 150 * KM, soFar: 62 * KM }), ctx);
  assert.equal(card.progress, "770 / 1,243 mi");
  assert.equal(card.week, "This week 38 / 93 mi · week 6 of 20");
}));

test("goalLine: the short form for the HUD and the menu", () => {
  assert.equal(goalLine(total, week({ step: 150 * KM, soFar: 85 * KM })), "Week 85 / 150 km");
  assert.equal(goalLine(long, week({ step: 41 * KM, soFar: 31 * KM })), "Long ride 31 / 41 km");
  assert.equal(goalLine(lap, week({ step: 1276 })), "Lap goal this week 21:16");
  assert.equal(goalLine(total, week({ step: 150 * KM, soFar: 150 * KM, done: true })), "Week 150 / 150 km ✓");
  assert.equal(goalLine({ ...total, metric: "time" }, week({ step: 3 * 3600, soFar: 4200 })), "Week 1:10 / 3:00 h");
});

test("hudGoal: a lap goal on this route comes first", () => {
  const entries = [
    { goal: total, week: week({ step: 150 * KM, soFar: 85 * KM }) },
    { goal: long, week: week({ step: 41 * KM, soFar: 31 * KM }) },
    { goal: lap, week: week({ step: 1276 }) },
  ];
  assert.equal(hudGoal(entries, { routeId: "rolling-hills" }), "Lap goal this week 21:16");
  assert.equal(hudGoal(entries, { routeId: "coast" }), "Long ride 31 / 41 km");
});

test("hudGoal: a total when the long ride is done, nothing when all is done", () => {
  const longDone = { goal: long, week: week({ step: 41 * KM, soFar: 42 * KM, done: true }) };
  const totalOpen = { goal: total, week: week({ step: 150 * KM, soFar: 85 * KM }) };
  assert.equal(hudGoal([longDone, totalOpen], { routeId: null }), "Week 85 / 150 km");
  const totalDone = { goal: total, week: week({ step: 150 * KM, soFar: 150 * KM, done: true }) };
  assert.equal(hudGoal([longDone, totalDone], { routeId: null }), null);
  assert.equal(hudGoal([], { routeId: null }), null);
});

test("finishGoalLine: a reached goal before a week done, at most two", () => {
  const before = [
    { goal: total, week: week({ progress: 1990 * KM, step: 150 * KM, soFar: 140 * KM }) },
    { goal: long, week: week({ progress: 38 * KM, step: 41 * KM, soFar: 0 }) },
    { goal: lap, week: week({ progress: 1300, step: 1276 }) },
  ];
  const after = [
    { goal: total, week: week({ progress: 2010 * KM, reached: true }) },
    { goal: long, week: week({ progress: 42 * KM, step: 41 * KM, soFar: 42 * KM, done: true }) },
    { goal: lap, week: week({ progress: 1270, step: 1276, soFar: 1270, done: true }) },
  ];
  assert.equal(finishGoalLine(before, after, { routes }), "Goal reached: 2,000 km ✓ · This week's long ride: 42 km ✓");
});

test("finishGoalLine: a week done, and nothing when nothing changed", () => {
  const before = [{ goal: total, week: week({ step: 150 * KM, soFar: 120 * KM }) }];
  const after = [{ goal: total, week: week({ step: 150 * KM, soFar: 152 * KM, done: true }) }];
  assert.equal(finishGoalLine(before, after, { routes }), "Week done: 152 / 150 km ✓");
  assert.equal(finishGoalLine(after, after, { routes }), null);
  const lapAfter = [{ goal: lap, week: week({ step: 1276, soFar: 1270, done: true }) }];
  assert.equal(finishGoalLine([{ goal: lap, week: week({ step: 1276 }) }], lapAfter, { routes }), "Lap goal this week: 21:10 ✓");
});

const NOW = at(2026, 11, 18);
const form = (fields) => ({ kind: "total", metric: "distance", target: "2000", routeId: "", endPreset: "winter", ...fields });

test("parseGoalForm: a total in the rider's units, ending on a preset", () => {
  const { goal } = parseGoalForm(form(), { nowMs: NOW, records: [], bests: [] });
  assert.equal(goal.kind, "total");
  assert.equal(goal.target, 2000 * KM);
  assert.equal(goal.routeId, null);
  assert.equal(goal.startMs, at(2026, 11, 18, 0));
  assert.equal(goal.endMs, endOfDay(2027, 3, 20));
  assert.equal(goal.createdAt, NOW);
  assert.equal(typeof goal.id, "string");
});

test("parseGoalForm: a lap time in m:ss on a route, ending on a date", () => {
  const { goal } = parseGoalForm(form({ kind: "lap", metric: "distance", target: "20:00", routeId: "rolling-hills", endPreset: "", endDate: "2027-02-01" }), { nowMs: NOW, records: [], bests: [{ routeId: "rolling-hills", durationS: 1318 }] });
  assert.equal(goal.metric, "time");
  assert.equal(goal.target, 1200);
  assert.equal(goal.routeId, "rolling-hills");
  assert.equal(goal.endMs, endOfDay(2027, 2, 1));
});

test("parseGoalForm: hours for time goals, miles in imperial", imperial(() => {
  assert.equal(parseGoalForm(form({ target: "100" }), { nowMs: NOW, records: [], bests: [] }).goal.target, 160934.4);
  assert.equal(parseGoalForm(form({ metric: "time", target: "2.5" }), { nowMs: NOW, records: [], bests: [] }).goal.target, 9000);
}));

test("parseGoalForm: the target must be above zero", () => {
  for (const target of ["", "0", "-5", "abc", "1:99"]) {
    const kind = target === "1:99" ? "lap" : "total";
    assert.equal(parseGoalForm(form({ kind, target, routeId: "rolling-hills" }), { nowMs: NOW, records: [], bests: [{ routeId: "rolling-hills", durationS: 1318 }] }).error, "goals.error.target", target);
  }
});

test("parseGoalForm: the end must be at least a week out", () => {
  const result = parseGoalForm(form({ endPreset: "", endDate: "2026-11-22" }), { nowMs: NOW, records: [], bests: [] });
  assert.equal(result.error, "goals.error.end");
  assert.equal(parseGoalForm(form({ endPreset: "", endDate: "" }), { nowMs: NOW, records: [], bests: [] }).error, "goals.error.end");
});

test("parseGoalForm: a lap goal needs a route with a best lap", () => {
  assert.equal(parseGoalForm(form({ kind: "lap", target: "20:00", routeId: "" }), { nowMs: NOW, records: [], bests: [] }).error, "goals.error.route");
});

test("parseGoalForm: a target already beaten is not saved", () => {
  const records = [{ startedAt: at(2026, 6, 1), distanceM: 52 * KM, durationS: 7200 }];
  const result = parseGoalForm(form({ kind: "long", target: "50" }), { nowMs: NOW, records, bests: [] });
  assert.equal(result.error, "goals.error.met");
  assert.equal(result.message, "You already have that: 52 km. Pick a bigger goal.");
  const lapResult = parseGoalForm(form({ kind: "lap", target: "22:00", routeId: "rolling-hills" }), { nowMs: NOW, records: [], bests: [{ routeId: "rolling-hills", durationS: 1318 }] });
  assert.equal(lapResult.error, "goals.error.met");
  assert.equal(lapResult.message, "You already have that: 21:58. Pick a bigger goal.");
});

test("parseGoalForm: at most five goals", () => {
  const result = parseGoalForm(form(), { nowMs: NOW, records: [], bests: [], activeCount: 5 });
  assert.equal(result.error, "goals.error.full");
  assert.equal(result.message, "You can follow up to 5 goals at a time. Remove one first.");
});

test("goalsSummary: the count and this week's total for the Overview", () => {
  const entries = [
    { goal: long, week: week({ step: 41 * KM, soFar: 0 }) },
    { goal: total, week: week({ step: 150 * KM, soFar: 62 * KM }) },
  ];
  assert.equal(goalsSummary(entries), "2 goals · this week 62 / 150 km");
  assert.equal(goalsSummary(entries.slice(0, 1)), "1 goal");
  assert.equal(goalsSummary([]), null);
});

test("hudGoal: nothing in a race or event, where the others count", () => {
  const entries = [{ goal: total, week: week({ step: 150 * KM, soFar: 85 * KM }) }];
  assert.equal(hudGoal(entries, { routeId: null, racing: true }), null);
});

test("so far rounds down, so a step not yet done never reads as met", () => {
  assert.equal(goalLine(total, week({ step: 150 * KM, soFar: 149.6 * KM })), "Week 149 / 150 km");
  assert.equal(goalLine({ ...total, metric: "time" }, week({ step: 3 * 3600, soFar: 3 * 3600 - 20 })), "Week 2:59 / 3:00 h");
});
