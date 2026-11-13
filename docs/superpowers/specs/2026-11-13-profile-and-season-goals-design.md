# Profile page and season goals

Issue: #99 (season goals), part of the Progress and motivation milestone (#98).

## Intent

Riders need a reason to come back beyond a single ride. Season goals (#99) give every ride a place in
something bigger: a long-term goal ("2,000 km by the end of winter", "one ride of 50 km", "a Rolling
Hills lap in 20:00") that the app turns into weekly steps. Goals need a home where they are set and
where progress is visible, and riders have no place today to look back at all: every finished ride is
stored in the browser (`ride/rideHistory.js`) but only the FTP suggestion and the milestones read it.

So this work adds a **profile page**: who you are, how much you ride, how your FTP moves, your goals,
your past rides and what the app keeps about you in this browser. Season goals are built on it.

OpenRadlr is a workout first. The page shows real riding and fitness, not points: no XP, no
performance effects, nothing that changes the simulation.

## Goals

- A profile dialog on the start menu with four pages: Overview, Goals, Rides, Your data.
- Overview: rider, totals (this week, this month, lifetime), FTP over time, best lap per route.
- Rides: the recorded rides, newest first, each opening its splits and power curve.
- Your data: what is stored in this browser, export to a file, delete one kind or everything.
- Season goals as in #99: three kinds, several at once, paced weekly steps, a line on the start menu
  and on the finish screen, and three ghosts on a lap goal's route.

## Non-goals

- Training charts beyond FTP: fitness and fatigue curve, power curve over the season (option B, later).
- Moving data between devices or import (#97). Export is a file for the rider, not a sync format.
- The profile inside a ride. During a ride, goals show only on the finish screen (and the HUD via #89
  once merged).
- Editing name, weight and FTP on the profile page. They stay in the start menu's Rider box, which is
  part of the ride setup; the profile shows them and links there.
- Server storage, accounts, sharing.

## Anti-goals

- Guilt. Missed weeks are spread out and capped (*pull, not guilt*); no streak counters, no red marks.
- A dashboard wall. Each page answers one question in a few lines; numbers come with words.
- Gaming the numbers: progress only comes from recorded rides, the same records as today.

## Constraints

- Client only, plain ES modules, no build step. UI text in `i18n/en.js` and `de.js` (ADR 0017).
- Pure modules with injected clock and storage, tested with `node --test` (CONTRIBUTING.md).
- Units: metric or imperial everywhere (`util/format.js`).
- Storage failures (private mode, quota) degrade quietly, like `RideHistory` and `GhostStore`.
- Phone layout: list first, then page (as the in-game menu).

## Approaches

Where the page lives (decided by the user: option 1).

1. **A full-screen dialog over the start menu, reusing the in-game menu's dialog** (`view/menuDialog.js`:
   page list left, page right, list first on a phone). Opened from the Rider box. The island stays
   loaded behind it. **Chosen:** same look and keyboard and phone behaviour as the in-game menu, no
   reload, no second composition root.
2. A separate `profile.html` with its own composition root, like the cockpit. Clean separation, but
   leaving the app reloads the island and the WebSocket on return.
3. A fifth start-menu tab next to Ride, Studio and Workout. Cheapest, but those tabs answer "what do you
   want to ride?" and the panel shares the screen with the setup form.

Depth of the stats (decided by the user): **A**, an overview plus a ride list with per-ride detail from
what records already hold. The FTP line is in A because it is the clearest fitness signal we have.
Training charts (B) come later.

## Design

### The dialog

`createMenuDialog` already takes its pages from markup hooks (`data-menu-page`, `data-menu-nav`) inside a
`root`, so the profile is a second instance with its own root (`#profile-dialog`) and pages
`["overview", "goals", "rides", "data"]`, sharing the panel stack (`panels`) with the rest of the app.
The CSS of the in-game menu (`.menu-dialog`, `.menu-card`, `.menu-nav`, …) is reused; only page content
gets new rules.

- **Opened from** a "Profile" button in the Rider box's legend row, and from the start menu's goals line
  (opens on Goals). Esc, the backdrop and × close it, as in the in-game menu.
- **Not offered during a ride**: the start menu is not on screen then.
- Data is read when the dialog opens (history, ghosts, goals) and after a delete; the dialog does not
  watch storage.

### Overview

```
Ralf · riding level 252 W (3.4 W/kg) · FTP 245 W, tested 2 Nov
This week 62 km · 2 h 10 min      November 210 km      All rides 1,240 km · 14,200 m climbing
FTP over time   ── set   ┄┄ estimated from rides
Best laps       Rolling Hills 21:58 · Coast Loop 48:12
Goals           1,240 / 2,000 km · this week 62 / 150 km   (one line per goal, opens Goals)
```

- **Rider:** name, riding level as the Rider box shows it today (`levelLabel`), FTP with its provenance
  (`view/ftpProvenance.js`).
- **Totals:** this week (Monday, local time), this calendar month, all rides: distance, time, climbing.
  A pure `periodTotals(records, now)` next to `lifetimeTotals` in `ride/milestones.js` (or a new
  `profile/stats.js`; builder's call).
- **FTP over time**, one small chart, two lines:
  - *Set FTP*: the `ftp` each ride record stored, by date, as a step line, with FTP tests (`record.test`)
    as dots.
  - *Estimated from rides*: `estimateFtp(records, weekEnd)` (`ride/ftpEstimate.js`) at the end of each
    week with rides; weeks without an estimate (no measured hard effort) leave a gap, not a zero.
  - Too few points (fewer than 2 weeks) → a sentence instead of a chart ("Ride with a power meter or
    smart trainer for a few weeks to see your FTP move").
  - Built on a canvas like the other charts (`view/canvas.js`), following the project's chart colours.
- **Best laps:** one line per route with a stored best (`GhostStore` gets an `all()` that lists its
  keys), route names from `/api/info` routes, the id when the server doesn't offer that route.
- **Goals:** the same one-line summaries as the start menu (below).

### Rides

- Newest first (`RideHistory.list()`), 20 at a time with "Show more".
- A row: date, route name (Studio for `routeId: null`; records keep no workout name), distance, moving time, average power, climbing; phone-paddle and simulator rides marked with the
  same icons as the ride mode cards (`measured: false` alone is not enough to tell them apart; if the
  record has no mode the row just shows no icon).
- Tapping a row opens it inline: splits (`view/splitsView.js` renders the table already) and the power
  curve from `record.curve` as a small chart (5 s, 1 min, 5 min, 20 min, longest).
- **Delete this ride** in the open row, with a confirm step. It removes the record (`RideHistory.delete`,
  new), so totals, the FTP estimate and goals change accordingly; this is said in the confirm text.

### Your data

A list of what this browser keeps, with a count and what it is for:

| Item | Where | Shown as |
|---|---|---|
| Profile (name, weight, FTP, settings, key pair) | localStorage `openride.profile.v1` | "Profile" |
| Rides | IndexedDB `openradlr-history` | "42 rides" |
| Best laps | IndexedDB `openradlr-ghosts` | "3 best laps" |
| Season goals | localStorage `openradlr.goals` (new) | "2 goals" |
| Summits, golden lemons | localStorage `openradlr.summits`, `openradlr.lemons` | "7 summits · 12 lemons" |
| Unfinished ride | IndexedDB `openradlr-autosave` | "1 unfinished ride" or nothing |
| Known devices, paired screens, Strava receipts | localStorage | "Devices and pairings" |

- **Export:** one JSON file (`openradlr-data-YYYY-MM-DD.json`) with every item above except the private
  key and the screen pairing secret, plus a `version` and `exportedAt`. *My call:* the private key stays
  out; a file in a downloads folder is not where a signing key should go, and servers don't verify keys
  yet (ADR 0003). Import is #97.
- **Delete:** per row (with a confirm), and "Delete everything on this device" (confirm with the count).
  Deleting the profile resets to defaults and a new key pair on the next start, as for a new rider.
- The data module is pure over injected stores; the counts come from the stores' `keys()`.
- A line under the list saying what leaves the device: while riding, the server gets the name, weight,
  riding level and public key ("join", `net/protocol.js`) and the live ride; a ride goes to Strava
  only when the rider uploads it. Everything else stays here.

### Season goals

As in #99. Summary of the model the builder needs:

- **A goal:** `{id, kind, metric, target, routeId, createdAt, endsOn}`
  - `kind: "total"`: `metric` is distance, time or climbing; progress is the sum over rides since
    `createdAt`.
  - `kind: "long"`: `metric` is distance or time; progress is the longest single ride since
    `createdAt` (before it: the longest ride ever, as the starting point of the curve).
  - `kind: "lap"`: `routeId` is a loop route; progress is `GhostStore.best(routeId).durationS`.
- **Up to 5 active.** Date presets: end of winter (20 March), in 8 or 12 weeks, end of the year, any date.
  At least 2 weeks out.
- **Weeks** start Monday, local time. **Recovery weeks** every 4th on one calendar, counted from the
  Monday of the oldest active goal's start; a goal's last week is never a recovery week.
- **Weekly step per kind:**
  - Total: what is left ÷ build weeks left, at most 1.3× the original even pace; recovery week ≈ 65 %
    of a build week.
  - Long ride: ease-out from the starting point to the target, closed share after build week *k* of *n*
    is `1 − (1 − k/n)²`, each week at most ~15 % longer than the last; the target in the last week;
    recovery week ≈ 70 % of the last long ride.
  - Lap: the same ease-out from the best lap to the target; the recovery week holds last week's target.
- **Re-planned weekly from the real progress:** the week's step is computed from progress at the start
  of the week. Lap bests have no history (GhostStore keeps only the best), so each goal keeps a small
  snapshot `{weekOf, from}` that is written the first time the goals are evaluated in a new week. *My
  call:* lazy snapshot instead of a history of bests.
- **Out of reach** (the next step would break a cap): the goal says so and offers to move the date or
  the target.
- **Ending:** a goal reached is marked done with its date; a goal past `endsOn` ends with its result.
  Ended goals move to "Past goals" on the Goals page (kept, deletable).
- One pure module, `profile/seasonGoals.js`, with injected `now`; the store is a small class over
  localStorage like `profileStore`.

**Goals page:** the active goals as cards (target, end date, progress bar, this week's step, "recovery
week" when it is one), "Add a goal" (kind → metric or route → target → end date), edit and remove per
goal, past goals below.

**Elsewhere:**
- Start menu: one line per active goal below the stage head, with a bar, and "This week: 120 km · one
  ride of 38 km · Rolling Hills lap in 21:16". Tapping opens the profile on Goals. Hidden without goals,
  with a quiet "Set a season goal" link once the rider has 3+ rides.
- Finish screen: what this ride changed ("+42 km · week done ✓", "new best lap 21:12 · week target
  beaten").
- With #89 merged: the ride goal screen offers this week's step as a preset.

### Three ghosts on a lap goal's route

On a route with an active lap goal, next to today's best-lap ghost:

| Ghost | Trace | Label |
|---|---|---|
| Best lap | the stored best lap | "Best lap" |
| This week | the best lap's trace, every time scaled by week target ÷ best | "Week 21:16" |
| Goal | the same, scaled to the goal | "Goal 20:00" |

- A scaled trace keeps metres and lanes and multiplies times: evenly faster on the same line.
- Distinct look per ghost (opacity or tint), never used for drafting (as the ghost lap).
- The gap pill shows the gap to the week ghost; a beaten week target (best ≤ target) drops that ghost.
- No best lap yet → no target ghosts until the first lap.
- The ghost lap code today drives one ghost; it needs to drive a list.

## Build order

One PR, ordered commits (the project's way for one feature). The builder may cut the ghosts into a
follow-up PR if the first part gets large.

1. Profile dialog shell: markup, a second `createMenuDialog`, opener in the Rider box, four empty pages.
2. Overview: rider, totals, best laps (`GhostStore.all`).
3. Rides: list, inline detail, delete (`RideHistory.delete`).
4. FTP over time.
5. Your data: inventory, export, delete.
6. Season goal model (`profile/seasonGoals.js`) with tests for every rule above.
7. Goals page: add, edit, remove, past goals.
8. Start menu line and finish screen line.
9. Week and goal ghosts.

## Left to the builder

- Module boundaries and file names beyond those named here.
- Exact chart styling within the project's canvas and colour conventions.
- Copy (en and de) in the project's plain style.
- Whether ride records should start storing the ride mode (trainer, paddles, simulator) so the Rides
  list can mark it; additive field, no migration.

## Open questions

- Physics calibration (#22) will change lap times and so lap goals and ghosts. Accepted for now.
