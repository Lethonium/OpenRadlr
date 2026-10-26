# Splits, laps and ride history — design

Date: 2026-10-18 · Issues: #83 (first version), foundation for #48 · Status: agreed in discussion, awaiting spec review

## Goal

Split a ride into laps or distance splits the way a bike computer does, show
the last split while riding and all splits at the finish, and write one lap
per split into the FIT and TCX files. Save a small summary of every finished
ride locally, so measured FTP, fitness and level (#48) can be built on a ride
history later.

## Decisions

| Question | Decision |
| --- | --- |
| Combine #48 and #83 | Shared base: a pure ride-analysis module and a local ride history (IndexedDB). This PR: base + splits. FTP, fitness, level and segment PBs follow as their own PRs |
| Where the logic lives | Client only, pure functions over `RideRecorder` samples and pauses. Server-side analysis waits for leaderboards (#46, #47) |
| Split modes | Profile setting `splitMode`: `auto` (default), `lap`, `1`, `5`, `10` (km), `off` |
| `auto` | Decided once at ride start: loop route under 20 km → `lap`; route over 60 km → `10`; otherwise `5`. No route (studio) → `5` |
| Laps with junctions | A split closes at every start/finish line crossing. It is a **lap** only when ridden line to line on one route without leaving it; anything else is a **free split** (shown, exported, never compared). A split that leaves the route or switches routes is cut 10 km after its start; staying on one route always reaches the line, so no cut is needed there (a 12.9 km lap stays whole) |
| Joining mid-loop | First stretch to the line is a free split |
| Live HUD | Toast for ~5 s after each split, and a "last split" field in the broadcast and training layouts |
| Pauses (#73) | Split time = elapsed minus closed pauses, the rule `RideRecorder.summary()` uses, so split times add up to the ride time |
| Stopping without pausing | Counts as time (no auto-pause) |
| Boundary between samples | Split ends at the first sample at or past the boundary; ≤ 1 s error, no interpolation |
| Short leftover | A last stretch under 200 m merges into the split before it |
| PR | One PR, ordered commits |

## Scope

In:

- `client/public/js/ride/splits.js`: split boundaries and `computeSplits`.
- `client/public/js/ride/rideHistory.js`: IndexedDB store of ride summaries.
- Two new sample fields in `RideRecorder`: `route` and `routeM`.
- Profile setting `splitMode` with validation and a control on the profile page.
- HUD split toast and "last split" field.
- Splits table on the finish screen.
- One FIT `lap` message and one TCX `<Lap>` per split.
- `docs/` note on splits, `CHANGELOG.md`.

Out (later PRs, see #48 and #83):

- Power curve, weighted power, load, measured FTP, ramp test, fitness/fatigue/form, XP and levels.
- Climb and sprint segments with personal bests; lap personal bests across rides.
- Showing the ride history anywhere in the UI; syncing it to accounts (#47).
- Workout blocks as splits.

## Data

### Samples

`RideRecorder.add` takes two optional fields, stored as `null` when missing:

- `route`: id of the route the rider is on, `null` off route or in the studio.
- `routeM`: the rider's position on that route in metres (`me.distance`), `null` off route.

Older autosaves have neither field; their samples count as off route.

### Split

```js
{
  index: 1,             // 1-based, in ride order
  kind: "lap" | "free" | "distance",
  route: "rolling-hills" | null, // laps only
  lap: 3 | null,        // number among this ride's clean laps on that route
  startIndex, endIndex, // first and last sample; neighbours share the boundary sample
  fromM, toM,           // ride distance (sample.distance)
  startT, endT,         // epoch ms of the first and last sample
  durationS,            // endT − startT − closed pauses inside
  distanceM,            // toM − fromM
  avgSpeed,             // m/s, distanceM / durationS
  avgPower,             // W, time-weighted like summary()
  maxPower,
  avgHeartRate,         // null without heart rate
  elevationGainM,
  partial,              // true for the last split if it is shorter than a full one
}
```

`distance` splits are numbered by the km where they end ("Km 10"). A `partial`
distance split is not ranked as best.

### Ride history record

```js
{
  version: 1,
  id,                   // start time in epoch ms as a string
  startedAt, endedAt,   // epoch ms
  routeId,              // route at the start, null for the studio
  measured,             // hasRealPowerSource(trainer): later FTP work ignores taps and keys
  ftp, weightKg,        // profile values at the time
  durationS, distanceM, kilojoules, avgPower, maxPower, avgHeartRate, elevationGainM,
  splitMode,            // the resolved mode: "lap", "1", "5", "10" or "off"
  splits,               // as above
}
```

Saved once when the finish screen opens for a non-empty ride. Later PRs add
fields (power curve, weighted power, load) without a migration; readers treat
missing fields as unknown. The store is injected like `rideAutosave.js` so tests
run without a browser.

## Algorithm

`resolveSplitMode(setting, route)` turns `auto` into a concrete mode from the
route's loop length (`null` route → `5`).

`computeSplits(samples, pauses, { mode, routeLength })` is pure:

1. Walk the samples in order and decide where splits end.
2. Distance modes: a split ends at the first sample with
   `distance ≥ k · everyM` (k = 1, 2, …; `everyM` from km or miles).
3. Lap mode, per sample pair `a → b`:
   - A **line crossing** is `a.route === b.route`, both `routeM` set, and
     `b.routeM mod L < a.routeM mod L − L/2` (the position wrapped).
     `L` is that route's length from `routeLength(routeId)`.
   - At a crossing the current split ends at `b`.
   - The split is a `lap` when it started at a crossing and every sample in
     it has the same non-null `route`; otherwise it is `free`.
   - A split with a sample off route (`route: null`) or on another route
     than its first sample ends as `free` at the first sample ≥ 10 km after
     its start.
4. After the last sample, the rest is the last split; with `final: true`
   (the default) a rest under 200 m merges into the split before, and a
   merged lap stays a lap only if the tail stays on the same route. The live
   ride passes `final: false`: no merge, so a split shows the moment it
   closes, and the last element is the split in progress.
5. Time per split subtracts closed pauses that lie between its first and last
   sample (same test as `RideRecorder`'s `#spansPause`).

The live ride does not keep its own split state: `main.js` calls
`computeSplits(…, { final: false })` each time the recorder keeps a sample
(one linear pass, well under a millisecond for a 6 h ride) and shows the
newest closed split, i.e. all but the last element.
After a rejoin (#73) the recorder comes back from the autosave and the split
display follows from it.

## UI

- **Profile:** a "Splits" select next to FTP: Auto, Every lap, Every 1 km,
  Every 5 km, Every 10 km, Off. With imperial units the distance modes are
  miles (1 / 5 / 10 mi) and `auto` picks 5 or 10 mi; the 20 km and 60 km
  route-length thresholds stay in metres.
- **HUD toast** (~5 s): `Lap 3 · 12:41 · 36.8 km/h · 224 W`, or
  `Km 10 · 17:31 · 34.2 km/h · 212 W`, or `6.2 km · 11:40 · 31.9 km/h · 190 W`
  for a free split. Uses the existing format helpers and units.
- **"Last split" field** in the broadcast and training layouts through
  `MetricBinder`; `–` until the first split.
- **Finish screen:** a table under `#finish-summary`: split, time, distance,
  speed, power, heart rate (column hidden without HR), elevation gain. The
  fastest full lap (or full distance split) is highlighted; each comparable
  row shows a faster/slower hint against the average of the comparable rows.
  Hidden when there is only one split or the mode is off.

## Exports

- `encodeFitActivity(samples, summary, { splits })`: one `lap` message per
  split (start time, elapsed and timer time, distance, average/max power,
  average speed, average HR), then the session with `laps: n`. No splits →
  one lap over the whole ride, as today.
- `toTcx`: one `<Lap>` per split with its own trackpoints; `TriggerMethod`
  `Distance` for distance splits, `Location` for laps and free splits.
- GPX has no laps; unchanged.

## Testing

`node:test` in the node:22 Docker container (repo root mounted).

- `splits.test.js`: distance mode at exact multiples; short leftover merged;
  pauses inside a split; zero-speed stretch; clean laps; joining mid-loop;
  leaving the route mid-lap; switching routes at a junction; 10 km safety
  cut; samples without `route` (old autosave); `resolveSplitMode` for each
  route length and the studio.
- `rideHistory.test.js`: save and list with an in-memory fake store.
- `fit.test.js`, `recorder.test.js`: n splits → n lap messages and
  `session.laps = n`, n `<Lap>` elements; no splits → one lap.
- `hud.test.js`: toast and "last split" text for each kind, both unit systems.
- Profile validation for `splitMode`.
- Playwright screenshot of the HUD toast and the finish table (docker recipe),
  shared as an artifact page.

## Commits

1. `computeSplits`, `resolveSplitMode` and tests; `route`/`routeM` in samples
2. Ride history store and saving on finish
3. Profile setting
4. HUD toast and "last split" field
5. Finish splits table
6. FIT and TCX laps
7. Docs and changelog
