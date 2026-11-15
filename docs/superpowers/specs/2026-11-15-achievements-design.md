# Achievements

Stage 1 of #27 (finds, achievements and quests), part of the Progress and motivation milestone (#98).
Achievements only; the equip system and cosmetics (#25) come later and will use them as one unlock path.

## Intent

Season goals give a rider something to aim for, but they have to be set up. Achievements need nothing:
they appear in the profile from riding that has already happened, so the profile fills up the day this
ships, and every ride can bring a small surprise. They are also the first unlock mechanism for cosmetics
later, so an earned achievement must stay earned.

v1 uses only data the client already stores. Some are milestones, some are about the island, and a few
are deliberately funny and secret.

## Goals

- A fixed list of achievements (below), each worked out from the stored data.
- Backdated: past rides earn achievements on first run, dated by the ride that earned them, with no banner.
- Earned during a ride: a short animation on the ride screen (the existing milestone banner with a
  badge), then nothing stays.
- Latched: once earned, an achievement stays earned with its date, even if rides are deleted later.
- An **Achievements** page in the profile dialog: a grid of badges, earned ones with their date, locked
  ones greyed with a hint, secret ones as "???" until earned.

## Non-goals

- Cosmetics, unlocks and the equip system (#25, #27 stage 1's other half).
- Achievements that need data not stored today: tandem/vehicle km, café visits, events, races, finds.
- Tiers beyond those listed, progress bars toward an achievement, sharing achievements with other riders,
  sending them to the server, moving them between devices (#97).
- Showing achievements on the summary image or in Strava uploads.

## Anti-goals

- HUD clutter: nothing permanent on the ride screen; the banner goes away after its 5 s.
- Daily streaks or anything that punishes rest days (#98: weekly, not daily). Rhythm achievements count weeks.
- Guilt: no "almost lost", nothing taken away.
- Anything that affects the simulation or ride data. Achievements only read records.
- Power achievements from fake power: rides not measured by a real trainer (`measured: false`, paddle or
  simulated trainer) never count for power-based ones.

## Constraints

- Client only, plain ES modules, no build step. UI text in `js/i18n/en.js` and `de.js` (ADR 0017).
- Pure logic with storage and clock injected (CONTRIBUTING.md); tests in plain node.
- Data available: ride records (`ride/rideHistory.js`: `startedAt`, `endedAt`, `routeId`, `device`,
  `measured`, `ftp`, `durationS`, `distanceM`, `elevationGainM`, `kilojoules`, `maxPower`, `curve`, `test`, `testFtp`;
  older records miss some fields, treat missing as unknown), workout records (`kind: "workout"`, `planId`),
  summits (`openradlr.summits`, a list of "routeId:metres", no dates), golden lemons (`openradlr.lemons`,
  a count, no dates), best laps (ghost store).
- Weeks start Monday, local time (`profile/stats.js` `weekStart`).

## Approaches

- **A. Derive from the stored data and latch earned dates (chosen).** One pure module with the list;
  each entry checks the history (plus the ride so far). Newly true during a ride → banner and stored with
  the date. Backdating comes for free, one definition serves the profile and the ride, latching keeps them for unlocks.
- **B. Event watchers per achievement** (like `MilestoneWatch`). No backdating, logic written twice
  (live and for the profile). Rejected.
- **C. Check only at the ride's end.** Simplest, but no animation during the ride, which the user asked for. Rejected.

## Design

### The list (v1)

"Rides" means records that aren't workouts. "Measured" means `measured: true`.

| id | Name (en) | Earned when | Secret |
|---|---|---|---|
| firstRide | First Pedal Stroke | first ride | |
| marathon | Marathon? On a Bike? | one ride ≥ 42,195 m | |
| century | Century | one ride ≥ 100 km | |
| climb1000 | Base Camp | ≥ 1,000 m climbed in all | |
| climb4000 | Summit Fever | ≥ 4,000 m climbed in all | |
| everest | Everest | ≥ 8,849 m climbed in all | |
| km1000 | Around the World (Slowly) | ≥ 1,000 km in all | |
| croissants | Bakery's Best Customer | ≥ 25,000 kJ in all (≈ 100 croissants; kJ of work ≈ kcal burned) | |
| weeks4 | Habit Forming | rides in 4 consecutive weeks | |
| weeks12 | Season Rider | rides in 12 consecutive weeks | |
| tourist | Tourist | rides on 3 different routes | |
| local | Local | a ride on every route the server offers (studio not counted) | |
| bothWays | Both Ways Round | rides on `herne-hill` and `herne-hill-clockwise` | |
| lavaFeet | Lava Feet | one ride on `lanzarote-lava-180` ≥ 180 km | |
| lemons10 | When Life Gives You Lemons | ≥ 10 golden lemons | |
| summits10 | Summit Collector | ≥ 10 different summits | |
| knowThyself | Know Thyself | a ride with a finished FTP test (`testFtp` set; `test` alone is also set by a ramp stopped too short, so older records without `testFtp` don't count) | |
| stronger | Getting Stronger | a ride's `ftp` ≥ 1.1 × the first ride's known `ftp` | |
| watts1000 | The 1,000 W Club | a measured ride with `maxPower` ≥ 1,000 | |
| nightOwl | Night Owl | a ride starting 22:00–03:59 local | yes |
| earlyBird | Early Bird | a ride starting 04:00–05:59 local | yes |
| lunchBreak | Lunch Break Legend | a weekday ride starting 12:00–12:59, under an hour, at least 15 min | yes |
| cookieBurner | Cookie Burner | a ride on 24, 25 or 26 December | yes |
| newYear | New Year, New Legs | a ride on 1 January | yes |
| thumbWarrior | Thumb Warrior | a ride with `device: "paddle"` | yes |
| bendy | Bendy | a yoga workout: `planId` is a preset whose venue's category is `yoga` (`workout/presets.js`, `workout/venues.js`); unknown plans don't count | yes |
| crossTrainer | Cross-Trainer | a ride and a workout in the same week | yes |

German names are translated in `de.js` (keep the joke, not the words). Each achievement has a name and a
one-line hint (shown when locked and not secret; shown for everyone once earned).

Times and dates (`nightOwl` … `newYear`, weeks) use the device's current time zone via `new Date(startedAt)`;
tests build their timestamps with local `new Date(y, m, d, h)` so they hold in any zone.
`thumbWarrior` is earned by paddle rides; only the power-based ones (`watts1000`) need `measured`.

Thresholds in metres and kJ, independent of the rider's unit setting. Only the hint text shows the unit.

### Module: `client/public/js/profile/achievements.js` (pure)

- `ACHIEVEMENTS`: the list, each `{id, secret, check(facts) → boolean}`.
- `facts` is built once from `{records, summits, lemons, routes}` (records oldest first, rides vs. workouts
  split, totals, route set, week set), so checks stay one-liners. `routes` is the server's route list from
  `/api/info` (for `local`). Without it, `local` cannot be earned this time.
- `earnedNow(sources)`: ids whose check holds.
- `backdate(sources)`: for each achievement that holds, the `startedAt` of the earliest record after which it
  first holds (prefix scan over all records, rides and workouts, oldest first, by `startedAt`). For those depending only on summits or lemons
  (no dates stored), and for `local` when the full list is only reached via the server's route list, use the date of the
  newest record (or `nowMs` with no records).
- Storage: `ACHIEVEMENTS_KEY = "openradlr.achievements"`, `{version: 1, earned: {id: earnedAtMs}}`.
  `loadAchievements(storage)` (anything unreadable is empty, never throws), `saveAchievements(storage, state)`
  (false when refused). Unknown ids in storage are kept (a later version may know them) but not shown.

### Flow

- **The live record** has the `rideRecord` fields that matter: `startedAt`, `routeId`, `device`, `measured`,
  `ftp` (the profile's current FTP, so `stronger` can fire live), `durationS`, `distanceM`, `elevationGainM`,
  `kilojoules`, `maxPower`, `testFtp` (once a test has a result). It counts like any other ride, including for
  the week-based ones (`weeks4`, `weeks12`, `crossTrainer`).
- **Routes for `local`:** reconcile and the live check pass the route list when it has loaded and `null`
  otherwise; `local` is simply checked again at the next reconcile. Latched means latched: a route added
  later does not take `local` away.
- **Reconcile** whenever the history has been read (profile opened, ride start once the history loads):
  ids that hold on the stored data but aren't latched get latched with their backdated date, silently.
- **During a road ride** (not the studio, not workouts, same places as milestones): at the milestone check's
  pace (every ~2 s), evaluate with the history plus a live record of the ride so far (distance, climbing,
  kJ, duration, max power, route, device, measured, start time, the FTP of a finished test).
  Ids newly true and not latched → latch with `nowMs`, save, show on the banner.
- Until the history has loaded during a ride, achievements are not checked (no false "first ride").
- **After the ride is saved:** reconcile once more (catches anything that only holds on the final record).
  No banner then; the ride screen is gone.

### The banner

Reuse `#milestone-banner` and `showMilestone`: an achievement adds a badge icon and its name
("🏅 Night Owl"-style, real icon is the builder's call) to the same 5 s banner. Several achievements in one check are rare (backdating is silent);
they join like milestones and the banner may wrap. If milestones and
achievements fire in the same check, they share one banner text joined by " · ". Respect reduced motion
as the banner already does. A small badge pop on the icon inside the banner is fine, but the banner
stays one element and goes away after 5 s.

### Profile page

A new page `achievements` in `PROFILE_PAGES` (after `overview`). Builder in `view/profilePage.js` style
(pure lines builder, main.js writes textContent): a grid, earned first (newest first) with name, hint and
date, then locked ones (name + hint, greyed), then secret locked as "???" with no hint. A count at the top
("12 of 27"). Empty history: all locked, the count shows 0.

### Your data

Deleting rides leaves the latched achievements alone. Achievements belong to the **progress** item in `profile/localData.js` (with summits and lemons): counted,
exported and deleted with it. After deleting rides or progress, the next reconcile re-derives from
what is left (backdated, silent).

## Left to the builder

- Badge visuals: decided after a design round as enamel pins (`view/badges.js`, inline SVG, no image
  files): a gold rim, enamel colour and shape per kind (round orange: distance and totals; teal shield:
  climbing; blue hexagon: rhythm and form; green ticket: places; purple starburst: secret), and one
  cartoon drawing per achievement. Locked pins are the same drawing greyed by CSS; secret locked ones a
  blank starburst with "?".
- Exact hint wording and the German names.
- How the live record is assembled in main.js (reuse what `rideRecord` would produce where cheap).
- Test layout, as long as each achievement's check has a test and backdating/latching are covered.
