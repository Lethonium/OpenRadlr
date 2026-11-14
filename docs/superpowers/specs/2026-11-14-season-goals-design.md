# Season goals

Step 2 of season goals (#99), part of the Progress and motivation milestone (#98). Built on the profile
page (step 1, `2026-11-13-profile-page-design.md`, PR #100); this branch is stacked on that one.

## Intent

A single ride ends and is forgotten. A season goal ("2,000 km by the end of winter", "one ride of 50 km",
"a Rolling Hills lap in 20:00") gives every ride a place in something bigger, and the app works with the
rider towards it by turning the goal into a step for this week. The step is what gets a rider on the
trainer on a Tuesday evening: "this week 120 km, 62 done".

The pacing model is worked out in #99 and is binding here (summarised below). This document decides
where the goals live in the UI and how the weekly steps are kept.

## Goals

- Set, change, remove and follow season goals on a new **Goals** page of the profile dialog.
- Three kinds, several at once (up to 5 active): total, long ride, lap time.
- Automatic weekly steps with 3:1 build/recovery weeks on a shared calendar, re-planned every Monday.
- A **Goals** page in the in-game menu showing this week's steps, updated live during the ride.
- **One small HUD line** with the goal most relevant to the ride on screen.
- **One line on the finish screen** saying what this ride changed.

## Non-goals

- The three ghosts on a lap goal's route (best, week, goal): a follow-up, more commits or a stacked PR.
- #89's ride goal presets ("ride this week's step"): wait for #89 to merge. This branch does not include
  #89 and works without it.
- Power goals (FTP or W/kg), fast goals over distances, point-to-point lap goals, a season's result in
  history, a jersey mark: later, as in #99.
- Moving goals between devices (#97).

## Anti-goals

- Guilt. A missed week is spread over the weeks left (capped), never shown in red or as "behind".
  Recovery weeks are named as such ("easy week") next to their smaller step, so a lower number reads as planned.
- A dashboard wall: one line per goal, numbers with words.
- Anything that changes the simulation: goals are read-only views of recorded rides (cosmetic/meta only).
- Gaming: progress only comes from recorded rides and stored best laps, the same records as today.

## Constraints

- Client only, plain ES modules, no build step; UI text in `i18n/en.js` and `de.js` (ADR 0017).
- Pure modules with injected clock and storage, `node --test` (CONTRIBUTING.md). Weeks start Monday, local time
  (reuse `weekStart` from `profile/stats.js`); DST-safe like it.
- Metric and imperial everywhere (`util/format.js`). Targets are stored in SI (metres, seconds).
- Storage failures degrade quietly: no goals shown, nothing thrown.

## Approaches

How the weekly steps are kept (decided by the user: option 1).

1. **Computed, nothing stored but the goals. Chosen.** The store holds the goals only. This week's step is
   a pure function of the goal, the rides recorded before this Monday and the date. "Re-planned every
   Monday" falls out of it; a ride deleted on the profile page corrects the plan by itself; there is no
   plan that can go stale. The step does not move within a week (it only reads rides before Monday).
   Past weeks are not stored; they can be recomputed from history if ever wanted.
   Two small facts that history cannot give back are stored with the goals (builder check, my call; see
   "The goal record"): the rhythm's anchor and, for lap goals, the best lap as it stood on Monday.
2. A stored plan rebuilt every Monday: lets the app look back at what each week asked for, but needs
   writing, updating and staleness handling, and a deleted ride leaves it wrong.
3. Only the end target, no weekly steps: cheapest, drops the point of #99.

## Design

### The goal record

Stored in localStorage `openradlr.goals` as `{version: 1, rhythmStartMs, goals: [...]}`, injected storage like
other settings. Ride records are dated by `startedAt`; best laps by `recordedAt`.

```
{ id, kind: "total" | "long" | "lap",
  metric: "distance" | "time" | "climb"   // total: any; long: distance | time; lap: time (implicit)
  target,                                  // metres or seconds
  routeId,                                 // lap only, a loop route
  startMs, endMs,                          // set date (local midnight) and end date (end of that day)
  createdAt,
  weekBest }                               // lap only: {weekStartMs, durationS | null}, see Weekly steps
```

- **`rhythmStartMs`** is the Monday of the week the first goal was set. It stays while any goal (active or
  finished) remains, so removing the oldest goal does not move everyone's recovery weeks; it is set again
  when a goal is created and none remain. (My call: history cannot tell when the rhythm began.)
- **`weekBest`** (lap goals): the best lap as it stood when this week was first seen (`GhostStore.best` only
  keeps the current best, so a new best on Wednesday would otherwise move this week's step). Written the
  first time a week is read for that goal; a missing or older `weekBest` is replaced by the current best.
  The pure module takes it as input and returns the snapshot to store. (My call.)

- Up to 5 goals. A goal past its end date is **finished**: shown once more with its result (reached or
  not, plainly), then the rider removes it; it no longer counts towards the 5 or the HUD.
- End date presets: end of winter (20 March, the next one), in 8 weeks, in 12 weeks, end of the year, any date.
  The end must be at least one week out.
- Changing a goal keeps `startMs` (progress so far stays); removing goes through the delete confirmation
  from #100 (`createDeleteConfirm`, `deleteTexts` gets a `goal` item).
- The export and delete of "Your data" (#100) list goals as an item; "everything" includes them.

### Progress

- **Total:** sum of `metric` over ride records (not workouts) with `startMs ≤ recordedAt ≤ endMs`.
- **Long ride:** the longest single ride by `metric` in all history (a goal is about beating your
  longest, not your longest since the goal).
- **Lap:** `GhostStore.best(routeId)`, the best ever. Without a best lap: "no lap yet" and no curve until the first lap.
- **Already met when set** (long ride or lap target already beaten): the form says so ("Your longest ride
  is already 52 km") and does not save it. A total cannot be met at creation.

### Weekly steps (pacing from #99, binding)

All computed in a pure `profile/seasonGoals.js` (builder may name it) from the goal, the ride records, the
lap best and `now`. Reads only records **before this Monday** for the plan, and records since Monday for
"this week so far".

- **Shared rhythm:** weeks counted from `rhythmStartMs`; every 4th week is a recovery week for all goals
  together. A goal's last week is never a recovery week (it becomes a build week).
- **A goal's own weeks:** from the week containing `startMs` (a full build week, even when set on a
  Sunday, unless the rhythm makes it a recovery week) to the week containing `endMs`. "Week 6 of 18" counts
  the goal's own weeks; whether a week is a recovery week comes from the shared rhythm. Build weeks left
  counts this week.
- **The plan reads** records with `startMs ≤ startedAt < this Monday` (totals) or all records before this
  Monday (long ride), and `weekBest` (lap). "So far" reads records since this Monday plus the ride in progress.
- **Total:** what is left ÷ build-week equivalents left (a recovery week counts 0.65 of a build week); a
  recovery week's step is 0.65 × the build step. A missed week spreads over the weeks left; the build step
  is capped at 1.3× the original weekly pace (target ÷ build-week equivalents of the whole goal).
- **Long ride:** an ease-out from the longest ride so far to the target over the build weeks, share closed
  after build week k of n = `1 − (1 − k/n)²`, each step at most 15 % above the previous week's long ride
  (or the longest so far); the target itself in the last week. Recovery week: 70 % of the last step.
- **Lap:** the same ease-out from the best lap down to the target; recovery week holds last week's target.
  The worked example in #99 (12 weeks, 21:58 → 20:00, recovery weeks 4 and 8) is a test case.
- **Out of reach:** when the caps cannot reach the target by the end date, the goal says so plainly
  ("At a sensible pace this takes until 2 May") and offers to move the date or change the target.
  Its weekly step still shows the capped step.
- **Reached:** a goal whose target is met shows ✓ and no further steps.
- **Week done:** a step is done when this week's progress meets it (total: sum since Monday; long:
  a ride since Monday ≥ step; lap: best lap ≤ step).

### Profile → Goals

A new first page `goals` in the profile dialog (pages become goals, overview, rides, data). Empty state: one
sentence and a "Set a goal" button.

```
2,000 km by 20 March                    1,240 / 2,000 km  ▓▓▓▓▓▓▓▓░░░░
  This week 62 / 150 km · week 6 of 18
One ride of 50 km by 31 December        longest 38 km     ▓▓▓▓▓▓▓░░░
  This week: one ride of 41 km · easy week, a ride of 29 km
Rolling Hills lap in 20:00 by 20 March  best 21:58
  This week 21:16 ✓
                                   [Change] [Remove]       [New goal]
```

- One card per goal: title, progress with a bar, this week's step with "so far", a ✓ when the week is done,
  "easy week" in recovery weeks, the out-of-reach note when it applies.
- **New goal / Change:** an inline form in the page (not another dialog): kind, metric (where it applies),
  target in the rider's units (lap: m:ss), route (lap: loop routes from `/api/info`), end date preset or a
  date input. Validation: positive target, end at least a week out, lap route required, at most 5 goals.
- The Overview page gets one line linking to Goals ("2 goals · this week 62 / 150 km").

### In-game menu → Goals

A `goals` page in `MENU_PAGES` (after `training`), shown when at least one goal is active, also in the studio.
Its status line is the HUD line's text. The page lists this week's steps like the profile cards, without
edit buttons, with "so far" including the ride in progress (live distance, time and climbing from the
ride session; the lap best from the ghost lap when a lap completes). A link "Change goals" is not offered
during a ride.

### HUD line

One pill in `.hud-status` (next to `#ghost-gap`), hidden without active goals or in a race. It shows one goal,
chosen by relevance to this ride:

1. A lap goal on the route being ridden: "Lap goal this week 21:16".
2. Else a long-ride step not done yet: "Long ride 31 / 41 km" (this ride's distance or time).
3. Else a total step not done yet: "Week 85 / 150 km" (week so far plus this ride).
4. Else nothing (all of this week's steps done shows nothing rather than a trophy wall).

It updates at most once a second, from the same live numbers as the HUD's distance/time. Pure function:
`(goals, weekState, live) → {text} | null`.

### Finish screen

One line under the summary, only when the ride changed something: "Week done: 150 / 150 km ✓",
"New longest ride: 41 km ✓ this week's long ride", "Goal reached: 2,000 km ✓". Computed from the week state
captured at ride start (the same the HUD uses) and the state after the ride record and any new best lap
are saved (main.js awaits both before writing the line); at most two items, most important first (goal reached,
then week done, then progress).

## Build order

Ordered commits in one stacked PR (base `feat/profile-goals`).

1. Goal store and the pure pacing module (progress, weekly steps, rhythm, out-of-reach), with #99's examples as tests.
2. Profile → Goals: cards, form, remove via the delete confirmation; goals in Your data (export, delete).
3. In-game menu Goals page.
4. HUD line and finish screen line.

## Left to the builder

- Module names and boundaries beyond those named here.
- Exact copy (en and de) in the project's plain style; card and form styling within the existing profile CSS.
- How the menu page and HUD pull the live ride numbers (from `liveStats` or the session), as long as the
  pure functions stay pure.
- Rounding of steps for display (whole km/mi, 5 min, 10 m, whole seconds).
