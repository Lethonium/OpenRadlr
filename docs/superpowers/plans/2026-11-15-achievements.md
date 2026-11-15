# Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achievements worked out from the stored rides, latched with their date, shown on a new profile page and announced on the ride screen's milestone banner when earned.

**Architecture:** One pure module `profile/achievements.js` holds the list, the checks over a `facts` object, backdating, latching and storage. A pure view builder makes the profile page's cards. `main.js` wires it: reconcile when the history is read, a live check next to the milestone check, the banner, the page.

**Tech Stack:** Plain ES modules, `node --test`, no build step.

**Spec:** `docs/superpowers/specs/2026-11-15-achievements-design.md` (the list, thresholds and flow are binding; read it first).

## Global Constraints

- Client only; nothing changes the simulation or ride records.
- All UI text in `client/public/js/i18n/en.js` and `de.js` (ADR 0017); parity tests (`i18nParity.test.js`, `i18nHtml.test.js`, `i18nSweep.test.js`) must pass.
- Pure modules take storage, clock and data as arguments; tests use fakes, no sleeps, one reason to fail per test.
- Storage key `openradlr.achievements`, value `{version: 1, earned: {id: earnedAtMs}}`; unreadable → empty, never a throw.
- Power-based achievements (`watts1000`) only count records with `measured: true`.
- Times use `new Date(startedAt)` local time; tests build timestamps with `new Date(y, m, d, h, min).getTime()`.
- No duplicate CSS selectors or overridden properties in `styles.css`.
- Run tests in Docker from the repo root: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js"'`; lint: `... sh -c 'npx eslint .'` (after `npm ci` if `client/node_modules` is missing).

## Review Focus

- Old records missing fields (`device`, `measured`, `kilojoules`, `test`, `ftp`): treated as unknown, never earn by accident, never throw. → Task 1 test "records without the newer fields earn nothing they can't prove".
- History not loaded yet during a ride: no "First Pedal Stroke" banner for a rider with 200 rides. → Task 3 test "nothing is newly earned before the history is known".
- A rider with existing history opening the app for the first time: everything latched silently, dated by the earning ride, no banner. → Task 2 test "reconcile latches backdated without reporting them as new".
- Deleting rides keeps latched ones; deleting progress clears them. → Task 5 tests.
- Storage full or refusing: the ride goes on, the banner still shows once (in-memory latch). → Task 3 test "a refused save still shows the banner only once".

---

### Task 1: The list and its checks

**Files:**
- Create: `client/public/js/profile/achievements.js`
- Test: `client/test/achievements.test.js`

**Interfaces:**
- Produces:
  - `ACHIEVEMENTS: readonly {id: string, secret: boolean, check: (facts) => boolean}[]` in the spec's table order, with the spec's ids.
  - `achievementFacts({records, summits, lemons, routes}) → facts`; `records` any order (sorted oldest first inside), `summits: string[]`, `lemons: number`, `routes: {id: string}[] | null`.
  - `earnedNow(sources) → string[]` (ids whose check holds; `sources` as for `achievementFacts`).

- [ ] **Step 1: Write the failing tests.** One test per achievement with a minimal record set that just earns it and one that just misses it (e.g. `century`: 100,000 m earns, 99,999 m doesn't). Helpers in the test: `ride(overrides)` → `{startedAt: new Date(2026, 10, 10, 18).getTime(), durationS: 3600, distanceM: 30_000, elevationGainM: 200, kilojoules: 700, maxPower: 400, measured: true, device: "trainer", ftp: 200, routeId: "rolling-hills", test: null, ...overrides}`, `workout(planId, at)`. Pin exactly:
  - `marathon` 42,195 m; `century` 100,000 m; `climb1000/4000/everest` 1,000/4,000/8,849 m summed; `km1000` 1,000,000 m summed; `croissants` 25,000 kJ summed.
  - `weeks4`: rides in 4 consecutive Monday-weeks earns; 3 + a gap + 1 doesn't. `weeks12` the same at 12.
  - `tourist` 3 distinct non-null `routeId`; `local`: every id of `routes` ridden; `routes: null` never earns; studio (`routeId: null`) not counted.
  - `bothWays`: `herne-hill` and `herne-hill-clockwise`; `lavaFeet`: one `lanzarote-lava-180` record ≥ 180,000 m (two 90 km rides don't).
  - `lemons10` lemons ≥ 10; `summits10` ≥ 10 distinct summit strings.
  - `knowThyself` any `test` truthy; `stronger` a later ride's `ftp` ≥ 1.1 × the oldest ride's finite `ftp`; `watts1000` `maxPower` ≥ 1000 with `measured: true` (unmeasured 1,200 W doesn't).
  - `nightOwl` start hour 22–23 or 0–3; `earlyBird` 4–5; `lunchBreak` Mon–Fri, start 12:00–12:59, `durationS` 900–3599 (Saturday doesn't); `cookieBurner` 24–26 Dec; `newYear` 1 Jan; `thumbWarrior` `device: "paddle"`.
  - `bendy` a workout whose `planId` is `"sun-salutation"` (a beach-café preset); `"tabata"` doesn't. `crossTrainer` a ride and a workout in the same Monday-week.
  - "records without the newer fields earn nothing they can't prove": `{startedAt, distanceM: 10_000}` only → `earnedNow` is `["firstRide"]` (plus time-based ones its start time hits; pick 18:00 on a Tuesday so none do).
  - Workouts alone never earn `firstRide`.
- [ ] **Step 2: Run, expect FAIL** (module not found).
- [ ] **Step 3: Implement.** `achievementFacts` computes once: `rides`, `workouts`, totals (`distanceM`, `climbM`, `kJ`), `routeIds` set, `rideWeeks` / `workoutWeeks` sets of `weekStart` (from `profile/stats.js`), longest run of consecutive ride weeks, first known ftp. Yoga plan ids: `PRESETS` (`workout/presets.js`) filtered by `VENUES[preset.venue]?.category === "yoga"` (`workout/venues.js`), computed once at module load. Consecutive weeks step by `weekStart(monday + 8 days)` to stay DST-safe. Each `check` is one expression over `facts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Work out achievements from the kept rides`.

### Task 2: Backdating, latching and storage

**Files:**
- Modify: `client/public/js/profile/achievements.js`
- Test: `client/test/achievements.test.js`

**Interfaces:**
- Consumes: Task 1's `achievementFacts`, `ACHIEVEMENTS`, `earnedNow`.
- Produces:
  - `ACHIEVEMENTS_KEY = "openradlr.achievements"`
  - `loadAchievements(storage) → {earned: Record<string, number>}`; `saveAchievements(storage, state) → boolean`.
  - `backdate(sources, nowMs) → Record<string, number>`: for each id earned now, the `startedAt` of the earliest record after which it holds (prefix scan over records oldest first, summits/lemons/routes held fixed). If it doesn't hold on any prefix of records alone (e.g. `lemons10`, `summits10`, `local` via routes), the newest record's `startedAt`, or `nowMs` with no records.
  - `reconcile(state, sources, nowMs) → state`: adds backdated dates for ids that hold and aren't latched; never removes or changes a latched one; returns the same object when nothing changes.
  - `latch(state, ids, nowMs) → state`.

- [ ] **Step 1: Write the failing tests:** load of missing/garbage/wrong-version → `{earned: {}}`; save then load round-trips; save with a throwing `setItem` → `false`; unknown ids in storage are kept by load and reconcile; `backdate` dates `century` by the 100 km ride, not the newest; `km1000` by the ride that crossed 1,000 km; `lemons10` by the newest ride; "reconcile latches backdated without reporting them as new" (a latched id keeps its old date; the returned state differs only by new ids); reconcile with a ride deleted keeps the latch.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** per the interfaces; storage like `loadGoals`/`saveGoals` in `profile/seasonGoals.js`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Keep earned achievements with the date they were earned`.

### Task 3: Earned during the ride, on the banner

**Files:**
- Modify: `client/public/js/profile/achievements.js` (a small watch), `client/public/js/main.js` (`startMilestones`, `checkMilestones`, after `app.history.save(record)` at ~3525, ride reset at ~1990), `client/public/js/i18n/en.js`, `de.js`, `client/public/styles.css`
- Test: `client/test/achievements.test.js`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `class AchievementWatch { constructor({storage, nowMs}); setHistory(sources); update(liveRecord, nowMs) → string[] }`. Before `setHistory` it returns `[]`. `setHistory` runs `reconcile` and saves. `update` checks `earnedNow` with `records: [...history, liveRecord]`, latches ids not yet latched with `nowMs`, saves, returns the new ids. Its in-memory state stays latched even when the save is refused.
  - i18n: `achievement.<id>.name`, `achievement.<id>.hint` for every id (en + de), `achievement.banner` = `"Achievement: {name}"` (de: `"Erfolg: {name}"`).

- [ ] **Step 1: Write the failing tests:** "nothing is newly earned before the history is known"; with an empty history, the first live update returns `["firstRide"]`; with rides in the history, `firstRide` is latched silently by `setHistory` and never returned by `update`; history 999 km + live 1.5 km → contains `"km1000"`; the same update twice returns it once; "a refused save still shows the banner only once" (throwing storage).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the watch.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Wire main.js.** In `startMilestones`, create `app.achievements = new AchievementWatch(...)` and in the existing `app.history.list().then` call `setHistory({records, summits, lemons: <current lemons count>, routes: routesOf(app.info)})`. In `checkMilestones`, at the existing 2 s pace, build the live record from `app.recorder.summary()` plus `startedAt` (first sample's `t`), `routeId`, `device: deviceKind(app.trainer)`, `measured: hasRealPowerSource(app.trainer)`, `ftp: app.profile.ftp`, `test: app.ftpTest?.testFlag ?? null`; pass the live summits and lemons. Join new ids' `t("achievement.banner", {name})` with milestone texts into one `showMilestone` call. Clear `app.achievements` on ride reset like `app.milestones`. After the ride's `app.history.save(record)` resolves, run `reconcile` + save once more (no banner).
- [ ] **Step 6: i18n + banner badge.** Names and hints from the spec table (German names keep the joke). A `.milestone-banner .achievement-badge` span (CSS only, small medal shape, short pop animation inside the existing 5 s banner, `prefers-reduced-motion` → none, in the existing reduced-motion block).
- [ ] **Step 7: Run all client tests + lint, expect PASS.**
- [ ] **Step 8: Commit** `feat(client): Show an achievement on the ride screen when it is earned`.

### Task 4: The Achievements page in the profile

**Files:**
- Create: `client/public/js/view/achievementsView.js`
- Modify: `client/public/js/view/profilePage.js` (`PROFILE_PAGES` → `["goals", "overview", "achievements", "rides", "data"]`), `client/public/index.html` (nav button + `data-menu-page="achievements"` after overview), `client/public/js/main.js` (`loadProfile` reconciles and saves; `renderProfileAchievements` in `renderProfile`), `en.js`, `de.js`, `styles.css`
- Test: `client/test/achievementsView.test.js`, plus `profilePage.test.js` if it pins `PROFILE_PAGES`

**Interfaces:**
- Consumes: `ACHIEVEMENTS`, `loadAchievements`, `reconcile`.
- Produces: `achievementCards(state, {locale}) → {count: string, cards: {id, state: "earned" | "locked" | "secret", name, hint, date: string | null}[]}`. Order: earned newest first, then locked in list order, then secret locked. Secret locked: `name` = `"???"`, `hint` = `""`. `count` = `t("achievements.count", {earned, total})` ("12 of 27").

- [ ] **Step 1: Write the failing tests:** ordering; secret locked shows `???` and no hint; secret earned shows name, hint and date; count string for 0 and some; date formatted in the locale (malformed locale falls back, as `rideDate` in `profilePage.js` does).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the builder; then the page markup, `renderProfileAchievements` (grid via `textElement`, `data-state` attribute for styling), i18n `profilePage.achievements` (nav title), `achievements.count`, CSS grid of badges (earned in colour, locked greyed).**
- [ ] **Step 4: Run all client tests + lint, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Add an Achievements page to the profile`.

### Task 5: Your data

**Files:**
- Modify: `client/public/js/profile/localData.js`, the progress delete text in `en.js`/`de.js` (`profilePage.delete.progress.*` mentions achievements)
- Test: `client/test/localData.test.js`

**Interfaces:**
- Consumes: `ACHIEVEMENTS_KEY`, `loadAchievements`.
- Produces: `progress` count `{summits, lemons, achievements}`; export `progress.achievements` = the stored earned map; `deleteItem("progress")` removes the key; settings no longer count it.

- [ ] **Step 1: Write the failing tests:** count includes achievements; export carries them; deleting progress removes them; deleting rides leaves them; the key is not counted under settings. Update `hasAny` in `profilePage.js` for the new count field.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (add `ACHIEVEMENTS_KEY` to `PROGRESS_KEYS`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Count, export and delete achievements with your progress`.

### Task 6: Verify in the app

- [ ] **Step 1:** `make check` (lint + all tests, as CI) passes.
- [ ] **Step 2:** `make dev`; screenshot the profile's Achievements page and a ride with a forced banner at 1× (`make screenshot` recipe from AGENTS.md); check layout on desktop and phone width.
- [ ] **Step 3:** Fix what the screenshots show; commit `fix(client): …` if needed.
