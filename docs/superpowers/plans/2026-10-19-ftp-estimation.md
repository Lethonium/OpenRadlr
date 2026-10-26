# Measured FTP: ride estimate and ramp test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure FTP from the rider's own rides and from a guided ramp test, offer the result with a confirm prompt, and show where the profile's FTP came from. First slice of #48.

**Architecture:** Three pure modules (`ride/powerAnalysis.js`, `ride/ftpEstimate.js`, `ride/ftpTest.js`) work on recorder samples and ride-history records. A small state machine (`ride/ftpTestSession.js`) drives the test and starts a generated ramp as an ordinary workout through `TrainingControl`. `main.js` only wires panels and the confirm prompt. The ride record in `rideHistory.js` grows to version 2.

**Tech Stack:** Browser ES modules, no bundler; `node:test`; ESLint 9. No DOM test library: logic that needs testing lives in pure functions (as `view/splitsView.js` does).

**Spec:** `docs/superpowers/specs/2026-10-19-ftp-estimation-design.md`

## Global Constraints

- Client only; no server or protocol changes. No new dependencies.
- Run tests and lint in Docker:
  `docker run --rm -v /root/projects/Open-Ride:/w -w /w/client node:22 sh -c "npm install --no-save --silent && npm run check"`
  (single file: `... node:22 node --test test/powerAnalysis.test.js`).
- Samples: `{ t (ms), power, cadence, heartRate, speed, distance, elevation, ... }` at about 1 Hz; `recorder.pauses` is `[{ from, to }]` in ms (an open pause has `to: null`).
- Names shown to riders: "weighted power" and "Load" (no TSS/NP/CTL/ATL/TSB).
- Constants live in one place (`ftpEstimate.js` / `ftpTest.js` exports): `CP_TO_FTP = 0.97`, `TWENTY_MIN_TO_FTP = 0.95`, `RAMP_TO_FTP = 0.75`, `ESTIMATE_WINDOW_DAYS = 90`, `MIN_RISE_W = 5`, `MIN_RISE_FRACTION = 0.03`, `FAIL_BELOW = 0.85`, `FAIL_HOLD_S = 10`, `FAIL_GRACE_S = 60`, `MIN_RAMP_S = 300`, `POWER_CAP_W = 2000`.
- The profile FTP stays within 50–600 W (`validateProfile`); every suggestion is clamped to that range or dropped.
- Commit messages: `Area: what (#48)` style as in `git log`, ending with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Work on branch `feat/ftp-estimation` (already cut from up-to-date `main`); one PR, ordered commits, assign RalfLeonFasler, do not merge.

## Review Focus

1. **Pauses inside a best-effort window**: a window never spans a pause, and a pause is not work. Test in Task 1.
2. **Ride shorter than a duration**: that curve entry is `null`, never a partial average. Test in Task 1.
3. **Easy rides must not lower FTP**: the estimate only suggests a higher value by the margin; a ride history of only easy rides gives no prompt. Tests in Tasks 3 and 5.
4. **A 100 W rider and a 300 W rider**: warmup suggestion and ramp shape are sensible for both, including a rider whose start is below `ERG_LIMITS.min` (50 W). Test in Task 6.
5. **Locked controls during the test**: intensity and skip cannot change the ramp, and stopping the workout ends the test cleanly. Tests in Task 7.
6. **Applying an FTP mid-ride**: `app.profile`, `app.training.ftp`, the paddle trainer and the stored profile all change together, and a running workout keeps its absolute targets. Test in Task 5.

---

### Task 1: Power analysis

**Files:**
- Create: `client/public/js/ride/powerAnalysis.js`
- Test: `client/test/powerAnalysis.test.js`

**Interfaces:**
- Produces:
  - `export const CURVE_DURATIONS = [5, 15, 60, 180, 300, 480, 720, 1200, 1800, 3600]` (seconds)
  - `powerSeries(samples, pauses) → number[][]`: one array of 1 Hz power values (W, capped at `POWER_CAP_W`) per stretch between closed pauses, resampled by time (hold the last value over gaps up to 5 s; a longer gap splits the stretch).
  - `bestEfforts(samples, pauses) → { [seconds: number]: ?number }`: best average power for each `CURVE_DURATIONS` entry over windows inside one stretch; `null` when no stretch is long enough. Values rounded to whole watts.
  - `weightedPower(samples, pauses) → ?number`: per stretch the 30 s rolling mean, then the 4th root of the mean of its 4th powers over all rolling values of all stretches; `null` under 30 s of riding.
  - `rideLoad({ weightedPower, durationS, ftp }) → ?number`: `(durationS / 3600) * (weightedPower / ftp) ** 2 * 100`, one decimal; `null` when an input is missing or `ftp` is 0.

- [ ] **Step 1: Write failing tests** with a helper `ride(powers, { startT = 0 })` producing 1 Hz samples and a `pause(fromS, toS)` helper:
  - steady 200 W for 1300 s → every duration up to 1200 is 200, 1800 and 3600 are `null`.
  - 600 s at 150 W then 300 s at 300 W then 600 s at 150 W → 300 s best 300, 60 s best 300, 1200 s best (300 · 300 + 900 · 150) / 1200 = 187.5 → 188 (rounded).
  - a 120 s pause (time gap, closed pause) inside a 300 s ride at 250 W: `bestEfforts[300]` is `null` (stretches are 150 s each) and `bestEfforts[60]` is 250.
  - a spike sample of 5000 W counts as 2000 W.
  - 10 s gap in the samples without a pause → stretch split there.
  - `weightedPower`: steady 200 W for 600 s → 200; alternating 30 s at 100 W / 30 s at 300 W for 20 min → between the average (200) and 300, and above 200 (test `> 200` and `< 260`).
  - under 30 s of riding → `null`.
  - `rideLoad`: 1 h at weighted power = ftp → 100; 30 min at 0.8 × ftp → 32; missing ftp → `null`.
- [ ] **Step 2: Run** `... node --test test/powerAnalysis.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement.** Build the stretches first (split at closed pauses using the `a.t <= p.from && b.t >= p.to` test from `RideRecorder#spansPause`, and at gaps over 5 s), resample each to 1 Hz, then use prefix sums for the window averages so the 60 min window over a long ride stays linear.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `Client: power curve, weighted power and load from ride samples (#48)`.

### Task 2: Ride record version 2

**Files:**
- Modify: `client/public/js/ride/rideHistory.js` (`rideRecord`)
- Modify: `client/public/js/main.js` (pass `test` into `rideRecord` at the finish screen)
- Test: `client/test/rideHistory.test.js`

**Interfaces:**
- Consumes: `bestEfforts`, `weightedPower`, `rideLoad` (Task 1).
- Produces: `rideRecord({ recorder, splits, splitMode, routeId, measured, profile, test = null })` now returns `version: 2` with the old fields plus `curve` (the `bestEfforts` object), `weightedPower`, `load` (from the profile FTP of that day), and `test` (`"ramp"` or `null`). Version 1 records are untouched; readers treat missing fields as unknown.

- [ ] **Step 1: Write failing tests:** a 20 min ride at 200 W with `profile.ftp 200` → `version 2`, `curve[1200] === 200`, `weightedPower === 200`, `load` about 33.3 (1/3 h at IF 1); `test: "ramp"` is stored; a ride without power (all 0 W) → `curve[60] === 0`, `load` 0; a stored v1 record still lists and saves unchanged.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Compute from `recorder.samples` and `recorder.pauses`; no change to `RideHistory`.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `Client: power curve, weighted power and load in the ride record (#48)`.

### Task 3: FTP estimate from rides

**Files:**
- Create: `client/public/js/ride/ftpEstimate.js`
- Test: `client/test/ftpEstimate.test.js`

**Interfaces:**
- Consumes: ride records (Task 2).
- Produces:
  - the constants from Global Constraints (`CP_TO_FTP`, `TWENTY_MIN_TO_FTP`, `ESTIMATE_WINDOW_DAYS`, `MIN_RISE_W`, `MIN_RISE_FRACTION`).
  - `estimateFtp(records, nowMs) → ?{ ftp, cp, wPrime, basis: "cp" | "twenty" }`: uses records with `startedAt` in the last 90 days and a `curve`; takes the best value per duration of 180, 300, 480, 720 and 1200 s across them; with at least two efforts whose durations are at least 2× apart, least squares of work `P · t` against `t` gives `cp` (slope) and `wPrime` (intercept) and `ftp = round(cp · 0.97)`; with only a 1200 s effort `ftp = round(0.95 · it)`, `basis "twenty"`; otherwise `null`. A fit with `cp <= 0` or `wPrime < 0` falls back to the 20 min rule, or `null` without one.
  - `suggestFtp(records, { ftp, dismissed = null }, nowMs) → ?{ ftp, delta, basis }`: `estimateFtp` result, only when `result.ftp >= ftp + max(MIN_RISE_W, ftp · MIN_RISE_FRACTION)`, within 50–600, and `result.ftp > (dismissed ?? 0)`.

- [ ] **Step 1: Write failing tests** with a `record(daysAgo, curve)` helper:
  - perfect CP data: CP 250 W, W′ 20 kJ → efforts at 180 s (361 W), 300 s (317 W), 720 s (278 W), 1200 s (267 W) → `cp` within 1 W of 250, `ftp` 243 or 242 (`round(250 · 0.97)`), `basis "cp"`.
  - only a 1200 s effort of 260 W → `ftp 247`, `basis "twenty"`.
  - two efforts less than 2× apart (300 s and 480 s) and no 1200 s → `null`.
  - a record 100 days old is ignored; one 89 days old counts.
  - best across rides: 1200 s from one ride and 300 s from another are combined.
  - noisy data that fits with a negative W′ → falls back to the 20 min rule.
  - `suggestFtp`: current 200 and estimate 245 → `{ ftp: 245, delta: 45 }`; current 240 and estimate 244 → `null` (below margin); current 300 and estimate 250 → `null` (never lowers); `dismissed: 245` with estimate 245 → `null`, with estimate 252 → suggestion; estimate above 600 → `null`.
  - records without `curve` (version 1) are skipped.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Plain least squares on the pooled efforts; no library.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `Client: estimate FTP from the ride history with a critical-power fit (#48)`.

### Task 4: Profile provenance

**Files:**
- Modify: `client/public/js/profile/profileStore.js`
- Modify: `client/public/js/view/profileView.js` (provenance line, if the file holds profile text; otherwise add `ftpProvenance` here)
- Modify: `client/public/index.html` (`<p id="ftp-source" class="field-hint">` under the FTP field)
- Modify: `client/public/js/main.js` (fill the line at ~301; pass `typed` when the form changes FTP)
- Test: the existing profile test file (`grep -l ProfileStore client/test`), `client/test/units.test.js` or a new `client/test/profileFtp.test.js` for the provenance text

**Interfaces:**
- Produces:
  - `DEFAULT_PROFILE` gains `ftpSource: "default"`, `ftpDate: null`, `ftpDismissed: null`.
  - `ProfileStore.save(profile, { ftpSource = "typed", now = Date.now() } = {})`: when `profile.ftp` differs from the stored one, the stored profile gets `ftpSource`, `ftpDate: now` and keeps the `levelW: null` reset; an unchanged FTP keeps source and date. A stored profile from before this change loads with `ftpSource: "default"` (the spread of `defaults` provides it); nothing migrates.
  - `ftpProvenance(profile, { locale }) → string`: `default` → `"Default value: take the FTP test or ride a hard effort to measure it."`; `typed` → `"Entered by hand on 19 Oct."`; `estimated` → `"Estimated from your rides on 19 Oct."`; `tested` → `"Measured by the ramp test on 19 Oct."` (date short, locale-aware; no date → no suffix).

- [ ] **Step 1: Write failing tests:** a new store loads `ftpSource "default"`; `save` with a new FTP and no options → `typed`, `ftpDate` set; with `{ ftpSource: "tested" }` → `tested`; save with the same FTP keeps the old source and date; an old stored JSON without the fields loads as `default`; each `ftpProvenance` string.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `joinRide` passes no option, so a hand-edited FTP becomes `typed`; accepting a suggestion (Task 5, Task 8) passes `estimated` or `tested`.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Client: remember where the profile's FTP came from (#48)`.

### Task 5: "New FTP detected" prompt on the finish screen

**Files:**
- Create: `client/public/js/view/ftpPrompt.js`
- Modify: `client/public/index.html` (`#ftp-prompt` block in `#finish`, between the splits table and the actions)
- Modify: `client/public/js/main.js` (`applyFtp`, prompt wiring after the history save at ~1657)
- Modify: `client/public/styles.css` (prompt)
- Test: `client/test/ftpPrompt.test.js`

**Interfaces:**
- Consumes: `suggestFtp` (Task 3), `RideHistory.list` (Task 2), `ProfileStore.save` (Task 4).
- Produces:
  - `ftpPromptText({ ftp, delta, basis }) → { title, detail }`: title `"New FTP detected: 252 W (+7)"`; detail `"From your best efforts of the last 90 days."` (`cp`) or `"From your best 20 minutes."` (`twenty`); a test result uses `"Measured by the ramp test."` via a `source: "test"` argument.
  - in `main.js`: `applyFtp(ftp, source)`: sets `app.profile.ftp`, saves through `ProfileStore.save(app.profile, { ftpSource: source })`, sets `app.training.ftp`, calls `app.trainer.setFtp(ftp)` for a `PaddleTrainer`, updates `app.studio.ftp` when a studio session exists, and refreshes the FTP field and the provenance line. A running workout is unaffected apart from the displayed zone/targets that read `app.profile.ftp`; generated ramps are not running at the finish screen.
  - Dismiss stores `app.profile.ftpDismissed = suggestion.ftp` through the profile store.

- [ ] **Step 1: Write failing tests** for `ftpPromptText` (both bases and the test source; delta sign). `applyFtp` is in `main.js` and not unit-tested; keep it a few lines and covered by the manual check in Task 9.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** On the finish screen, after `history.save(...)` resolves, read `history.list()` (the just-saved record included), call `suggestFtp(records, { ftp: app.profile.ftp, dismissed: app.profile.ftpDismissed }, Date.now())` and show the prompt with "Use it" and "Not now". Do not show it for a test ride (the test has its own prompt) or when storage is unavailable (empty list).
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Client: offer a detected FTP after the ride (#48)`.

### Task 6: Ramp test logic

**Files:**
- Create: `client/public/js/ride/ftpTest.js`
- Test: `client/test/ftpTest.test.js`

**Interfaces:**
- Consumes: `createWorkout`, `steady` from `workout.js`; `powerSeries` (Task 1).
- Produces:
  - `suggestStart(warmupSamples) → { startW, stepW }`: `best` = best 60 s average power in the warmup (`bestEfforts[60]`; `null` or under 40 W → default `startW 50`, `stepW 10`); `startW = max(50, round(0.6 · best / 5) · 5)`; `stepW = clamp(round(startW / 8 / 5) · 5, 10, 30)`.
  - `buildRamp({ startW, stepW, ftp }) → Workout`: name `"FTP ramp test"`, 1 min steady blocks labelled `"120 W"` etc. from `startW` up in `stepW` steps until 600 W; `from = to = watts / ftp`; kind `"test"`.
  - `rampTargetAt(startW, stepW, elapsedS) → number`: `startW + floor(elapsedS / 60) · stepW`.
  - `detectFailure(rampSamples, { startW, stepW }) → ?number`: seconds into the ramp at which power was below `FAIL_BELOW · target` for `FAIL_HOLD_S` seconds in a row, ignoring the first `FAIL_GRACE_S`; `null` otherwise. `rampSamples` carry `{ elapsedS, power }`.
  - `rampResult(rampSamples) → ?{ ftp, bestMinuteW, durationS }`: best rolling 60 s average of `power` over the ramp, `ftp = round(0.75 · best)`; `null` when the ramp lasted under `MIN_RAMP_S` or the result is outside 50–600.

- [ ] **Step 1: Write failing tests:**
  - `suggestStart`: warmup 5 min at 100 W → `startW 60`, `stepW 10`; warmup at 220 W → `startW 130`, `stepW 15`; warmup at 40 W → `startW 50`; empty warmup → `{ 50, 10 }`.
  - `buildRamp({ startW 100, stepW 20, ftp 200 })` → first block 0.5, second 0.6; 1 min each; last block ≤ 600 W; total duration 26 min; `from === to` on every block.
  - `rampTargetAt(100, 20, 59)` → 100; `(…, 60)` → 120; `(…, 600)` → 300.
  - `detectFailure`: ramp 100 +20/min, rider follows to minute 8 (260 W) then drops to 150 W: failure found about 10 s after the drop; a dip to 80 % for 5 s then recovery → `null`; a drop inside the first 60 s → `null`.
  - `rampResult`: ramp that follows its targets up to 330 W → `bestMinuteW` equals the mean of the last full minute, `ftp = round(0.75 · bestMinuteW)`; under 5 min → `null`; result above 600 → `null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Pure functions only; no timers.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `Client: ramp test logic: start suggestion, ramp workout, failure and result (#48)`.

### Task 7: Test session and locked controls

**Files:**
- Create: `client/public/js/ride/ftpTestSession.js`
- Modify: `client/public/js/ride/trainingControl.js` (`startWorkout(workout, { locked })`, `locked` getter, no-op `adjust` and `skipSegment` while locked)
- Test: `client/test/ftpTestSession.test.js`, `client/test/erg.test.js` (locked behaviour)

**Interfaces:**
- Consumes: Task 6 functions; `TrainingControl`.
- Produces:
  - `TrainingControl.startWorkout(workout, { locked = false } = {})`; `training.locked`; `adjust()` returns `false` and `skipSegment()` does nothing while `locked`; `stopWorkout()` and the workout finishing clear it.
  - `class FtpTestSession extends Emitter` with state `"idle" | "warmup" | "settings" | "countdown" | "ramp" | "result"`. Constructor `{ training, getSamples: () => ({ t, power }[]), now = () => Date.now() }`.
    - `begin()` → `warmup`; `liveMinuteW()` → the best-effort-style average of the last 60 s (or fewer, shown as `null` under 15 s).
    - `proceed()` (from `warmup`) → `settings` with `{ startW, stepW }` from `suggestStart` over the warmup samples; `setStart(w)` / `setStep(w)` clamp to 50–400 W and 5–40 W; `back()` returns to `warmup`.
    - `start()` (from `settings`) → `countdown` for 3 s, then `ramp`: `training.startWorkout(buildRamp(...), { locked: true })`, remembering the ramp start time.
    - `tick(nowS, latest)` while `ramp`: stores `{ elapsedS, power }` from the workout clock (pauses do not count), runs `detectFailure`; on failure or when the workout finishes → `finish()`.
    - `done()` ("I'm done") → `finish()`; `cancel()` → `idle` and stops the workout without a result.
    - `finish()` stops the workout, computes `rampResult`, goes to `result` with `{ ftp, bestMinuteW, durationS }` or `{ tooShort: true }`; emits `"result"`.
    - `stopWorkout` from outside (the user pressing "Stop workout") ends the test through `finish()`.
    - `testFlag`: `"ramp"` once a ramp has started, so the ride record can be flagged; `reset()` → `idle` keeps the flag for the current ride.

- [ ] **Step 1: Write failing tests** with a fake `training` (record `startWorkout` args, `locked`), a clock under test control and synthetic samples:
  - the happy path: begin → proceed (with a 5 min warmup at 150 W → `startW 90`, `stepW 10`) → start → countdown → ramp follows the target to minute 10 then drops → state `result` with `ftp = round(0.75 · best)` and `training.startWorkout` called with `locked: true` and a workout named `"FTP ramp test"`.
  - `done()` after 3 min → `result` with `tooShort: true`, no `ftp`.
  - `cancel()` in `warmup` and in `ramp` → `idle`, workout stopped, no `result` event.
  - `setStart(10)` clamps to 50; `setStep(100)` clamps to 40.
  - `liveMinuteW()` is `null` under 15 s, then the mean of the last 60 s.
  - external stop during `ramp` → `result`.
  - In `erg.test.js`: locked workout → `adjust(1)` returns `false` and intensity unchanged; `skipSegment()` leaves the clock; after `stopWorkout()` both work again.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The session never touches the DOM or `main.js`; `main.js` calls `tick` from `renderWorkoutProgress` and renders from the `change` / `result` events.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `Client: FTP test session with a locked ramp workout (#48)`.

### Task 8: FTP test panel

**Files:**
- Create: `client/public/js/view/ftpTestView.js` (pure text/format helpers)
- Modify: `client/public/index.html` (FTP test section in `#training-panel`, above `#workout-picker`)
- Modify: `client/public/js/main.js` (create the session after `app.training`, wire buttons, render states, tick, offer the test when `ftpSource` is `default`, pass `test` to `rideRecord`)
- Modify: `client/public/styles.css`
- Test: `client/test/ftpTestView.test.js`

**Interfaces:**
- Consumes: `FtpTestSession` (Task 7), `applyFtp` (Task 5), `ftpPromptText` (Task 5).
- Produces (`ftpTestView.js`):
  - `ftpTestState({ state, startW, stepW, liveMinuteW, result, source }) → { heading, body, primary: ?{ id, label }, secondary: ?{ id, label }, fields: boolean }` — a pure mapping from session state to panel text:
    - `warmup`: heading `"Warm up"`, body `"Ride freely at your own level. Your best minute so far: 142 W."` (or `"…: –"`), primary `"I'm warm, set up the ramp"`.
    - `settings`: heading `"Ramp setup"`, body `"Starts at 90 W and adds 10 W every minute until you can't hold the target."`, fields shown, primary `"Start ramp"`, secondary `"Back to warmup"`.
    - `countdown`: heading `"Get ready"`.
    - `ramp`: heading `"Ramp test"`, body `"Hold the target as long as you can."`, primary `"I'm done"`.
    - `result`: `"Your FTP ≈ 240 W"`, detail `"75 % of your best minute (320 W). It is an estimate."`, primary `"Use 240 W"`, secondary `"Keep 200 W"`; `tooShort` → `"That ramp was too short to trust."`, primary `"Try again"`.
    - units: watts only, so no unit switch.
  - `main.js`: panel visibility follows session state; entry button `"FTP test"` in the training panel; when `app.profile.ftpSource === "default"` the entry shows `"No measured FTP yet. Take the 15 minute ramp test."` (a hint, not a modal); accepting a result calls `applyFtp(result.ftp, "tested")` and clears `ftpDismissed`; the saved ride record carries `test: session.testFlag`.

- [ ] **Step 1: Write failing tests** for `ftpTestState` over every state, including `tooShort`, `liveMinuteW: null`, and a result with the current FTP in the secondary label.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Hide `#workout-picker` and the manual ERG row while a test is running (the ramp is its own workout; `renderTraining` already hides the picker while a workout runs). The warmup shows no ERG target. Disable the entry button in a studio class, where the class controls the trainer.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Client: FTP test panel in the training section (#48)`.

### Task 9: Docs, changelog and end-to-end check

**Files:**
- Create: `docs/ftp.md`
- Modify: `docs/splits.md` (link in the "Ride history" section), `CHANGELOG.md`

- [ ] **Step 1: Write `docs/ftp.md`:** what is measured (curve, weighted power, load), the critical-power fit with the constants, the "only higher" rule and why, the ramp test flow and its limits (sprinters and endurance riders), provenance values, where data lives (browser only), and the trademark-free names.
- [ ] **Step 2: Update `docs/splits.md`** (ride record is now version 2, link to `docs/ftp.md`) and add two bullets under `### Added` in `CHANGELOG.md`: measured FTP from rides with a confirm prompt, and the ramp test with a free warmup.
- [ ] **Step 3: Manual check in the browser** (Playwright in Docker per the existing recipe, simulated trainer): start a ride, open the FTP test, warm up, run the ramp until the simulated power drops, accept the result and see the profile line change to "Measured by the ramp test"; finish the ride and confirm no estimate prompt appears for the test ride; ride a hard 20 minute effort on the simulated trainer (or seed the history with a record) and confirm the "New FTP detected" prompt appears, and "Not now" suppresses it next time. Screenshot the panel and the prompt.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Docs: measured FTP and the ramp test (#48)`.
- [ ] **Step 6:** Push `feat/ftp-estimation`; open one PR "Measured FTP: ride estimate and ramp test (#48)" with RalfLeonFasler assigned, filled from the repo's PR template if there is one. Do not merge.
