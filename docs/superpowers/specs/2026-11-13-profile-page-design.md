# Profile page

Step 1 of season goals (#99), part of the Progress and motivation milestone (#98). This step shows what the
browser already records; the goals themselves are step 2 with their own design.

## Intent

Riders need a reason to come back beyond a single ride. Season goals (#99) give every ride a place in
something bigger: a long-term goal ("2,000 km by the end of winter", "one ride of 50 km", "a Rolling
Hills lap in 20:00") that the app turns into weekly steps. Goals need a home where they are set and
where progress is visible, and riders have no place today to look back at all: every finished ride is
stored in the browser (`ride/rideHistory.js`) but only the FTP suggestion and the milestones read it.

So this step adds a **profile page**: who you are, how much you ride, how your FTP moves, your past
rides and what the app keeps about you in this browser. Season goals are built on it in step 2.

OpenRadlr is a workout first. The page shows real riding and fitness, not points: no XP, no
performance effects, nothing that changes the simulation.

## Goals

- A profile dialog on the start menu with three pages: Overview, Rides, Your data.
- Overview: rider, totals (this week, this month, lifetime), FTP over time, best lap per route.
- Rides: the recorded rides, newest first, each opening its splits and power curve.
- Your data: what is stored in this browser, export to a file, delete one kind or everything.

## Non-goals

- Training charts beyond FTP: fitness and fatigue curve, power curve over the season (option B, later).
- Moving data between devices or import (#97). Export is a file for the rider, not a sync format.
- Season goals, in any form (step 2, below).
- The profile inside a ride.
- Editing name, weight and FTP on the profile page. They stay in the start menu's Rider box, which is
  part of the ride setup; the profile shows them and links there.
- Server storage, accounts, sharing.

## Anti-goals

- Guilt. No streak counters, no red marks for quiet weeks; the page shows what was ridden, not what was missed.
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
`["overview", "rides", "data"]`, sharing the panel stack (`panels`) with the rest of the app.
The CSS of the in-game menu (`.menu-dialog`, `.menu-card`, `.menu-nav`, …) is reused; only page content
gets new rules.

- **Opened from** a "Profile" button in the Rider box's legend row. Esc, the backdrop and × close it, as in the in-game menu.
- **Not offered during a ride**: the start menu is not on screen then.
- Data is read when the dialog opens (history, ghosts) and after a delete; the dialog does not
  watch storage.

### Overview

```
Ralf · riding level 252 W (3.4 W/kg) · FTP 245 W, tested 2 Nov
This week 62 km · 2 h 10 min      November 210 km      All rides 1,240 km · 14,200 m climbing
FTP over time   ── set   ┄┄ estimated from rides
Best laps       Rolling Hills 21:58 · Coast Loop 48:12
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

### Rides

- Newest first (`RideHistory.list()`), 20 at a time with "Show more".
- A row: date, route name (Studio for `routeId: null`), distance, moving time, average power, climbing. Yoga and bodyweight
  workouts share the history (`kind: "workout"`): their row shows the plan name and time only, and totals count rides only; phone-paddle and simulator rides marked with the
  same icons as the ride mode cards (`measured: false` alone is not enough to tell them apart; if the
  record has no mode the row just shows no icon).
- Tapping a row opens it inline: splits (`view/splitsView.js` renders the table already) and the power
  curve from `record.curve` as a small chart (5 s, 1 min, 5 min, 20 min, longest).
- **Delete this ride** in the open row, through the delete confirmation (below). It removes the record
  (`RideHistory.delete`, new), so totals and the FTP estimate change accordingly.

### Your data

A list of what this browser keeps, with a count and what it is for:

| Item | Where | Shown as |
|---|---|---|
| Profile (name, weight, FTP, settings, key pair) | localStorage `openride.profile.v1` | "Profile" |
| Rides | IndexedDB `openradlr-history` | "42 rides" |
| Best laps | IndexedDB `openradlr-ghosts` | "3 best laps" |
| Summits, golden lemons | localStorage `openradlr.summits`, `openradlr.lemons` | "7 summits · 12 lemons" |
| Unfinished ride | IndexedDB `openradlr-autosave` | "1 unfinished ride" or nothing |
| Known devices, paired screens, Strava receipts | localStorage | "Devices and pairings" |

- **Export:** one JSON file (`openradlr-data-YYYY-MM-DD.json`) with every item above except the private
  key and the screen pairing secret, plus a `version` and `exportedAt`. *My call:* the private key stays
  out; a file in a downloads folder is not where a signing key should go, and servers don't verify keys
  yet (ADR 0003). Import is #97.
- **Delete:** per row, and "Delete everything on this device", each through the delete confirmation.
  Deleting the profile resets to defaults and a new key pair on the next start, as for a new rider.
- The data module is pure over injected stores; the counts come from the stores' `keys()`.
- A line under the list saying what leaves the device: while riding, the server gets the name, weight,
  riding level and public key ("join", `net/protocol.js`) and the live ride; a ride goes to Strava
  only when the rider uploads it. Everything else stays here.

### Delete confirmation

Every delete (one ride, one kind of data, everything) goes through the same confirmation, so nothing is
deleted by a stray tap:

- **A modal dialog on top of the profile**, not an inline button swap. Esc, the backdrop and Cancel close
  it without deleting; focus starts on **Cancel**, so Enter or a second tap doesn't delete.
- **It says plainly what deleting means**, per item, with the count:
  - what is deleted ("42 rides from 3 March to 13 November");
  - what changes because of it ("Your totals and the FTP estimated from your rides start again from
    what is left. Your set FTP stays." / "The best-lap ghosts on these routes are gone." / for the
    profile: "Your name, weight, FTP and settings go back to the defaults, and servers will see you as
    a new rider.");
  - what it does not touch (rides already uploaded to Strava stay there);
  - that it cannot be undone, with an **Export first** button next to it (except for a single ride).
- **The delete button names the action and the amount** ("Delete 42 rides", "Delete everything") in a
  destructive style, never just "OK".
- Delete everything also asks the rider to tick "I understand this cannot be undone" before its button
  is enabled.
- A failed delete (storage error) says so and leaves the dialog open.
- The texts are pure functions (item, counts, dates → strings), tested in en; de follows.

## Build order

One PR, ordered commits (the project's way for one feature).

1. Profile dialog shell: markup, a second `createMenuDialog`, opener in the Rider box, three empty pages.
2. Overview: rider, totals, best laps (`GhostStore.all`).
3. Rides: list, inline detail, delete (`RideHistory.delete`) with the delete confirmation.
4. FTP over time.
5. Your data: inventory, export, delete (reusing the delete confirmation).

## Left to the builder

- Module boundaries and file names beyond those named here.
- Exact chart styling within the project's canvas and colour conventions.
- Copy (en and de) in the project's plain style.
- Whether ride records should start storing the ride mode (trainer, paddles, simulator) so the Rides
  list can mark it; additive field, no migration.

## Next: season goals (step 2, own design and PR)

As in #99, built on this page:
- a Goals page in this dialog to set, change and follow goals;
- a Goals page in the in-game menu (`view/menuPages.js`), to see the week's step during a ride;
- something small in the HUD for the goal of the ride on screen (with #89's ride goal, once merged);
- the three ghosts on a lap goal's route.

Its pacing model and ghosts are already worked out in #99; its UI placement gets its own design.
