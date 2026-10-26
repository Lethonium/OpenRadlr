# Measured FTP: ride estimate and ramp test — design

Date: 2026-10-19 · Issues: #48 (first slice: ride summary and FTP) · Status: agreed in discussion, awaiting spec review

## Goal

FTP is a number typed into the profile. Measure it instead: estimate it from
the rider's own rides, and offer a ramp test for riders who have no FTP or
want to rebase the one they have. The rider always confirms before the profile
changes, and sees where the number came from.

Builds on the local ride history (#84). Fitness, fatigue, form, level and XP
follow in the next PR.

## Decisions

| Question | Decision |
| --- | --- |
| First slice of #48 | Ride summary (power curve, weighted power, load) + FTP estimate + FTP test. Fitness/form and level/XP are the next PR |
| Where the logic lives | Client only, pure functions over `RideRecorder` samples and ride-history records. Sync waits for accounts (#47) |
| Names | "Weighted power" and "Load", not the TrainingPeaks trademarks (NP, TSS) |
| Estimate from rides | 2-parameter critical-power fit on the best 3–20 min efforts of the last 90 days; FTP = CP minus ~3 % (CP runs a little above FTP; the factor is a constant) |
| Too little data | One 20 min effort alone → 95 % of it. Otherwise no estimate |
| Direction | The ride estimate only ever suggests a **higher** FTP (≥ 5 W and ≥ 3 % above the current one) so easy rides cannot pull it down. Lowering is done by the test |
| Applying | Never silent: "New FTP detected: 252 W (+7). Use it?" A dismissed value is not offered again |
| Provenance | Profile gets `ftpSource` (`default` / `typed` / `estimated` / `tested`) and `ftpDate`. A fresh profile is `default`, which is how "no FTP given" is detected |
| Test protocol | Ramp test, FTP ≈ 75 % of the best rolling minute. The 20 min test is a later addition |
| Warmup | Free ride (no ERG, no targets, no limit), so a 100 W rider and a 300 W rider both warm up at their own level |
| Ramp start | Suggested from the warmup: ~60 % of the best 1 min power, rounded to 5 W; step scaled from the start (default 20 W/min). Both editable before the countdown |
| Fit with workouts | The ramp is generated as a normal `createWorkout` of 1 min blocks and run by the existing `WorkoutPlayer`, `training.startWorkout` and HUD. Targets are stored as fractions of the current FTP, so the player is untouched |
| Power-only trainers | Same as other workouts: targets are shown, resistance stays |
| During the test | Intensity +/− and skip-segment are locked; they would corrupt the result |
| End of the ramp | Power below 85 % of target for 10 s (after a 60 s grace period), or the rider presses "I'm done" |
| Aborted test | A ramp under 5 min gives no suggestion |
| Test ride | Recorded and saved like any ride, flagged `test: "ramp"` in its record |
| PR | One PR, ordered commits |

## Scope

In:

- `client/public/js/ride/powerAnalysis.js`: `bestEfforts`, `weightedPower`, `rideLoad`.
- `rideRecord` version 2: `curve`, `weightedPower`, `load`, `test`. Version 1 records stay readable; missing fields mean unknown, no migration.
- `client/public/js/ride/ftpEstimate.js`: critical-power fit and the suggestion rules.
- `client/public/js/ride/ftpTest.js`: `suggestStart`, `buildRamp`, `detectFailure`, `rampResult`.
- Profile fields `ftpSource` and `ftpDate`, kept by `profileStore.js` (a changed FTP sets them).
- Finish screen: the "New FTP detected" prompt.
- Training panel: an "FTP test" section (warmup with live 1 min average, start, countdown, result and prompt).
- Unit tests for each pure module, UI tests in the style of `hud` and `menu`.
- `docs/ftp.md`, a link from `docs/splits.md`, `CHANGELOG.md`.

Out (later PRs, see #48):

- Fitness, fatigue, form, level, XP, rider type, charts, a history screen.
- The 20 min test, suggesting a lower FTP after weeks without hard efforts.
- Syncing to an account (#47), server-side checks.

## Design

### Ride summary (`powerAnalysis.js`)

- `bestEfforts(samples, pauses)` resamples to a 1 s grid by time and returns the best average power for 5 s, 15 s, 1, 3, 5, 8, 12, 20, 30 and 60 min. A window never spans a pause; a duration longer than the ride is `null`.
- `weightedPower(samples, pauses)`: 4th root of the mean of the 4th powers of the 30 s rolling average.
- `rideLoad({ weightedPower, durationS, ftp })`: `hours × (weightedPower / ftp)² × 100`. One hour at FTP is 100. Stored with the FTP of that day (already in the record).
- Sanity: samples above 2000 W are ignored for the curve; the record still stores the raw summary.

### FTP estimate (`ftpEstimate.js`)

- Input: ride-history records of the last 90 days and the current FTP.
- Take the best value per duration across the records, for 3, 5, 8, 12 and 20 min.
- With at least two efforts at least 2× apart: linear least squares of work (`P × t`) against time `t` gives CP (slope) and W′ (intercept). Estimate = CP × 0.97.
- With only a 20 min effort: 95 % of it. Otherwise: no estimate.
- Returns `{ ftp, cp, wPrime, basis }` or `null`. The caller applies the "higher by 5 W and 3 %" rule and the dismissed list.

### FTP test (`ftpTest.js`)

- `suggestStart(samples)`: from the warmup, `{ startW, stepW }` as above.
- `buildRamp({ startW, stepW, ftp })`: workout of 1 min blocks from `startW` up to 600 W, targets as fractions of `ftp`.
- `detectFailure(samples, targets)`: true when power stays below 85 % of target for 10 s after the grace period.
- `rampResult(samples)`: best rolling minute, `ftp = round(best × 0.75)`; `null` under 5 min of ramp.

### UI

- Training panel: "FTP test" section next to the workout picker. States: warmup (live 1 min average, "Start ramp"), settings (start and step, editable), countdown, ramp (workout HUD, "I'm done"), result ("Your FTP ≈ 240 W · Use it?").
- A rider whose profile `ftpSource` is `default` is offered the test when opening the panel.
- Finish screen: the estimate prompt, using the same confirm component as the test result.
- Profile page shows "FTP 245 W · tested 19 Oct" from `ftpSource` and `ftpDate`.

## Testing

- `powerAnalysis`: steady ride, intervals, a pause inside a window, ride shorter than a duration, spikes.
- `ftpEstimate`: two-point fit, 20 min only, too little data, rule for "higher only", dismissed value.
- `ftpTest`: start suggestion for 100 W and 300 W warmups, ramp shape, failure after grace period, short abort, result.
- UI: panel states, locked controls during the test, prompt accept and dismiss, profile provenance line.
- Run the client tests and lint in the `node:22` container.

## Open risks

- Trainers differ in calibration; estimates are shown as estimates.
- The 0.97 and 0.75 factors are the usual rules of thumb; they are constants so they can be tuned.
- Power spikes and bad data count for nothing here (no leaderboards yet), but the sanity cap stays for later.
