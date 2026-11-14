# Season Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Season goals (total, long ride, lap time) with automatic weekly steps, set and followed on the profile, shown on an in-game menu page, a HUD pill, a finish-screen line and (by setting) the summary image.

**Architecture:** A pure pacing module computes each goal's week from the goal, the ride records, the best lap and the clock; nothing but the goals (plus the rhythm anchor and a lap goal's Monday best) is stored, in localStorage. A pure view module turns those weeks into text. `main.js` wires them into the profile dialog (#100), the in-game menu, the HUD and the finish screen.

**Tech Stack:** Plain ES modules, no build step; `node --test` with injected storage and clock; i18n in `js/i18n/en.js` + `de.js`.

**Spec:** `docs/superpowers/specs/2026-11-14-season-goals-design.md` (pacing rules from issue #99, binding).

## Global Constraints

- Client only. No change to the simulation or the server (cosmetic/meta only).
- Branch `feat/season-goals`, stacked on `feat/profile-goals` (PR #100); one PR, ordered commits.
- Weeks start Monday, local time: reuse `weekStart(nowMs)` from `profile/stats.js`; DST-safe.
- Targets stored in SI (metres, seconds); shown in metric or imperial via `util/format.js`.
- localStorage key `openradlr.goals`, value `{version: 1, rhythmStartMs, image: "reached"|"progress"|"off" (default "reached"), goals}`; unreadable or invalid → no goals, never a throw.
- At most 5 goals that are not finished (`MAX_GOALS = 5`).
- Pacing constants: recovery every 4th week of the shared rhythm; total recovery weight and step 0.65; total build step cap 1.3× original pace; long-ride step cap +15 % per build week; long-ride recovery 0.7× the longest so far; lap recovery holds the Monday best. A goal's last week is never a recovery week.
- Ride records: `kind !== "workout"`, dated by `startedAt`; `distanceM`, `durationS`, `elevationGainM`. Best laps: `GhostStore.best(routeId)` → `{durationS, recordedAt}`.
- Every en key used; en/de parity (`i18n` tests); `npm run preload` after adding modules (`modulePreload.test.js`).
- Run Node via Docker (`node:22` with the repo mounted), as in AGENTS.md / memory.
- No model identifiers in commits; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A goal set mid-week, on a Sunday, or with its end in the current week: week index/count and the step must still make sense (last week = target, never a recovery week).
2. Rides before the goal's start: count for long-ride and lap baselines, never for a total's progress.
3. A lap goal whose best improves mid-week: the step stays put; "week done" stays true.
4. Removing the oldest goal does not move recovery weeks; removing the last one resets the rhythm.
5. Storage holding junk (`"{"`, wrong version, a goal missing fields): no goals and no throw; a junk goal is dropped, the others kept.

---

### Task 1: Goal store and pacing module

**Files:**
- Create: `client/public/js/profile/seasonGoals.js`
- Test: `client/test/seasonGoals.test.js`

**Interfaces:**
- Produces:
  - `GOALS_KEY = "openradlr.goals"`, `MAX_GOALS = 5`, `KINDS = ["total", "long", "lap"]`
  - `Goal = {id: string, kind, metric: "distance"|"time"|"climb", target: number, routeId: string|null, startMs, endMs, createdAt, weekBest?: {weekStartMs, durationS: number|null}}` (lap: `metric: "time"`)
  - `loadGoals(storage) → {rhythmStartMs: number|null, goals: Goal[]}`; `saveGoals(storage, state) → boolean`
  - `addGoal(state, goal, nowMs) → state` (sets `rhythmStartMs = weekStart(nowMs)` when there are no goals); `replaceGoal(state, goal) → state` (keeps `startMs`); `removeGoal(state, id) → state` (`rhythmStartMs: null` when none left)
  - `endPresets(nowMs) → [{id: "winter"|"weeks8"|"weeks12"|"yearEnd", endMs}]` (winter = 20 March, the next one at least a week out)
  - `goalProgress(goal, {records, best}) → {value: number|null, reached: boolean}`
  - `goalWeek(goal, {records, best, rhythmStartMs, nowMs, live?}) → GoalWeek` where `live = {distanceM, durationS, elevationGainM, lapS: number|null}` is the ride in progress and
    `GoalWeek = {index, count, recovery, finished, reached, progress, step: number|null, soFar: number|null, done, reachable, earliestEndMs: number|null}`
  - `refreshWeekBest(goal, best, nowMs) → Goal` (returns the same object when `weekBest` is current)
  - `activeGoals(state, nowMs) → Goal[]` (not finished)

- [ ] **Step 1: Write the failing tests** — one `test()` each, clock injected, fake storage `{getItem, setItem}`:
  - `loadGoals` on missing, `"{"`, `{version: 2}` → `{rhythmStartMs: null, goals: []}`; a goal missing `target` is dropped, the valid one kept; a throwing `getItem` → empty state.
  - `addGoal` sets the rhythm anchor to the Monday of `nowMs`; a second `addGoal` keeps it; `removeGoal` of the oldest keeps it; removing the last clears it.
  - `endPresets(Date of Wed 2026-11-18)` → winter end is 20 March 2027 end of day; on 15 March 2027 winter is 20 March 2028.
  - total progress sums only rides with `startMs ≤ startedAt ≤ endMs` and ignores workouts; long progress is the all-time longest; lap progress is `best.durationS`, `null` without a best.
  - **#99 lap example:** goal 21:58 → 20:00 over 12 weeks from a Monday, rhythm from the same Monday, best stays on plan each week (feed `weekBest` = the previous week's step): steps are 21:36, 21:16, 20:58, (20:58, recovery), 20:43, 20:30, 20:19, (20:19), 20:11, 20:05, 20:01, 20:00 (round to whole seconds).
  - lap re-plan: a best of 21:00 at the start of week 2 gives a step between 21:00 and 20:00 that is smaller (faster) than the on-plan 21:16.
  - lap week done: best set this week (`recordedAt ≥ Monday`) at or under the step → `done: true`; the step is computed from `weekBest`, not the new best.
  - total: 2,000 km over 10 weeks with recovery weeks 4 and 8 → build step = 2000 / (8 + 2×0.65) km; a recovery week's step is 0.65× that; after a week with 0 km the next build step grows but never above 1.3× the original pace, and `reachable` turns false when the cap cannot close the gap, with `earliestEndMs` a later Monday-based date.
  - long ride: from a longest of 30 km to 50 km over 8 weeks: each build step ≤ 1.15× the longest before Monday; the last week's step is 50 km or `reachable: false`; recovery step = 0.7× longest so far.
  - a goal's last week is a build week even when the rhythm says recovery.
  - goal set on a Sunday: `index: 1`, that week counts.
  - `finished` once `nowMs > endMs`; `reached` when progress meets target (lap: ≤); a reached goal has `step: null`.
  - `live` adds to `soFar` (total, long) and a `live.lapS` under the step marks a lap week done.
  - DST: a goal spanning the end of October in `TZ=Europe/Zurich` has the right week count (child process, as `profileStats.test.js` does).

- [ ] **Step 2: Run to see them fail**
  Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/seasonGoals.test.js`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `profile/seasonGoals.js`**
  - A goal's weeks: Mondays from `weekStart(startMs)` to `weekStart(endMs)`; recovery when `((weekIndexInRhythm) % 4) === 3`, except the goal's last week.
  - Lap and long ride follow the original ease-out without memory: with `n` build weeks and this the `k`-th build week, the remaining gap after this week is the gap at Monday × `(1 − k/n)² / (1 − (k−1)/n)²`. Base at Monday: lap `weekBest.durationS`; long ride the longest ride before Monday (all history). On plan this reproduces #99's fixed curve; off plan it re-plans.
  - Long ride caps the step at 1.15× the base (no cap when the base is 0). Lap has no cap and is always reachable.
  - `earliestEndMs`: step forward week by week at the caps, on the shared rhythm, until the target is reached (stop after 104 weeks → `null`).

- [ ] **Step 4: Run to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit** `feat(client): Pace season goals into weekly steps with easy weeks`

### Task 2: Goal texts

**Files:**
- Create: `client/public/js/view/goalsView.js`
- Modify: `client/public/js/i18n/en.js`, `de.js` (`goals.*` keys)
- Test: `client/test/goalsView.test.js`

**Interfaces:**
- Consumes: `Goal`, `GoalWeek` (Task 1); `routeName(routeId, routes)` from `view/profilePage.js`; formatters from `util/format.js`.
- Produces:
  - `goalTitle(goal, routes) → string` ("2,000 km by 20 March", "One ride of 50 km by 31 December", "Rolling Hills lap in 20:00 by 20 March")
  - `goalCard(goal, week, {routes, locale}) → {title, progress, fraction (0–1), week: string|null, done, note: string|null}`; `note` is the out-of-reach sentence ("At a sensible pace this takes until 2 May") or the finished result.
  - `goalLine(goal, week) → string` (the short form the HUD and menu status use: "Week 85 / 150 km", "Long ride 31 / 41 km", "Lap goal this week 21:16")
  - `hudGoal(entries, {routeId}) → string|null`, `entries = [{goal, week}]`: lap goal on `routeId` first, else the first long-ride step not done, else the first total not done, else null.
  - `finishGoalLine(before, after) → string|null` (`before`/`after`: entries; at most two items, goal reached > week done > nothing).
  - `parseGoalForm(fields, {nowMs, records, bests}) → {goal} | {error: i18n key}`; `fields = {kind, metric, target (string in the rider's units, lap "m:ss"), routeId, endPreset | endDate}`. Errors: `goals.error.target`, `goals.error.end` (less than a week out), `goals.error.route`, `goals.error.met` (already beaten, with the current value in the message), `goals.error.full` (5 goals).

- [ ] **Step 1: Failing tests** for each function in en, metric and imperial (one test each), including the recovery wording ("easy week"), ✓ when done, `hudGoal` priority order, a route the server doesn't list (id shown), and each `parseGoalForm` error.
- [ ] **Step 2: Run, expect FAIL** (`node --test test/goalsView.test.js`).
- [ ] **Step 3: Implement**, adding the en and de keys.
- [ ] **Step 4: Run goalsView and i18n tests, expect PASS** (`node --test test/goalsView.test.js test/i18n*.test.js`).
- [ ] **Step 5: Commit** `feat(client): Word season goals for cards, the HUD and the finish screen`

### Task 3: Profile → Goals page

**Files:**
- Modify: `client/public/js/view/profilePage.js` (`PROFILE_PAGES = ["goals", "overview", "rides", "data"]`), `view/deleteConfirm.js` (`deleteTexts("goal", {title})`, `deleteTexts("goals", {count})`), `profile/localData.js` (`DATA_ITEMS` gets `"goals"` after `"bestLaps"`; `GOALS_KEY` out of `settings`; exported under `goals`; "everything" deletes it), `main.js`, `index.html` (goals page, nav item, form), `styles.css`, i18n.
- Test: `client/test/profilePage.test.js`, `deleteConfirm.test.js`, `localData.test.js`

**Interfaces:**
- Consumes: Tasks 1–2; `createDeleteConfirm` (#100).
- Produces in `main.js`: `app.goals` (the loaded state), `loadGoalsState()`, `goalEntries(nowMs, live?) → [{goal, week}]` (refreshes and saves `weekBest` for lap goals), `renderProfileGoals()`.

- [ ] **Step 1: Failing tests:** `PROFILE_PAGES[0] === "goals"`; `deleteTexts("goal", …)` names the goal and says rides stay; `inventory` counts goals and `settings` no longer includes `openradlr.goals`; export contains `goals`; `deleteItem("goals")` removes the key; `overviewLines` gets a `goals` line ("2 goals · this week 62 / 150 km") when given entries.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the pure changes, then the page: cards (`goalCard`), empty state with "Set a goal", inline form (kind, metric, target, route = routes with a best lap, end preset or date), Change (form prefilled, keeps `startMs`), Remove via `app.deleteConfirm.ask`. `loadProfile` also reads goals. Run `npm run preload`.
  Ruling (plan): lap goals are offered on routes with a stored best lap — `/api/info` routes carry no loop flag and only loops record laps; a client-only choice that also gives the "already met" check its baseline.
- [ ] **Step 4: Run the whole client suite and lint, expect PASS.**
  `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm test && npm run lint"`
- [ ] **Step 5: UI check** with Playwright (memory recipe): set a total, a long-ride and a lap goal on seeded rides; screenshot the Goals page, the form, the remove confirmation, phone width.
- [ ] **Step 6: Commit** `feat(client): Set and follow season goals on the profile`

### Task 4: In-game menu Goals page

**Files:**
- Modify: `view/menuPages.js` (`MENU_PAGES` gets `"goals"` after `"training"`; `visiblePages({studio, hasEvents, hasGoals})`; `pageStatus("goals", ctx)` → `ctx.goalLine ?? ""`), `main.js` (`menuPages()`, `menuStatusContext()`, render the page on open and with the menu status refresh), `index.html`, `styles.css`, i18n.
- Test: `client/test/menuPages.test.js`

- [ ] **Step 1: Failing tests:** goals hidden without goals, shown with them, also in the studio; status shows the line.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Week entries are computed at ride start (with the history read in `startMilestones`'s style) and kept in `app.goalWeek`; the page renders `goalCard`s with `live` from `app.recorder.summary()` and the lap just ridden. No edit buttons.
- [ ] **Step 4: Suite + lint, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Show this week's goals in the ride menu`

### Task 5: HUD pill and finish line

**Files:**
- Modify: `main.js`, `index.html` (`<span id="goal-pill" class="pill glass" hidden>` in `.hud-status` after `#ghost-gap`; a `<p id="finish-goals">` under `#finish-summary`), `styles.css`, i18n if needed.
- Test: `client/test/goalsView.test.js` (only if Task 2's functions need a new case).

- [ ] **Step 1: Failing test** for any gap found while wiring (e.g. `hudGoal` hides in a race: `hudGoal(entries, {routeId, racing: true}) → null`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** The pill updates at most once a second from the display timer; hidden in a race/event and without goals. The finish line is written after `saveFinishedRide` and any pending `ghosts.offer` resolve, from the entries at ride start (`before`) and recomputed ones (`after`); hidden when null.
- [ ] **Step 4: Suite + lint, expect PASS;** UI check of the pill on a ride and the finish line (screenshots).
- [ ] **Step 5: Commit** `feat(client): Show the ride's goal in the HUD and what the ride changed at the finish`

### Task 6: Goals on the summary image

**Files:**
- Modify: `view/goalsView.js` (`imageGoalLine(before, after, mode) → string|null`), `view/photos.js` (`composeSummary({..., goalLine = null})` draws it in gold between the stat grid and the chart), `profile/seasonGoals.js` (`image` in load/save, default `"reached"`, junk → default), `main.js` (setting control on the Goals page; `summaryImage()` passes the line; `refreshSummaryImage()` again once the finish line is computed), `index.html`, `styles.css`, i18n.
- Test: `client/test/goalsView.test.js`, `seasonGoals.test.js`, `photos.test.js` (if it exists; else a fake-canvas test that the line is drawn only when given)

- [ ] **Step 1: Failing tests:** `imageGoalLine` → null for `"off"`; with `"reached"` only a reached goal (null for week done); with `"progress"` week done and progress, at most two items, reached first; `loadGoals` returns `image: "reached"` when missing or unknown; `composeSummary` with `goalLine` draws the text (fake 2d context records `fillText` calls), without it draws nothing extra.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Gold `#f2c14e` (validate against `#0f1216` with the dataviz validator's contrast check), `700 34px`, baseline ≈ y 710, `fit()` to the width. The setting is a three-option select under the goal cards.
- [ ] **Step 4: Suite + lint, expect PASS;** render the summary image for a ride that reaches a goal and look at it.
- [ ] **Step 5: Commit** `feat(client): Put a reached goal on the ride's summary image`
