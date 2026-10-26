# Splits, laps and ride history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-laps and distance splits in the live HUD, on the finish screen and in FIT/TCX exports, plus a local ride history as the base for #48.

**Architecture:** A pure `ride/splits.js` turns recorder samples and pauses into splits; `main.js` calls it live (`final: false`) and at the finish. A `ride/rideHistory.js` store keeps one summary per ride in IndexedDB, injected like `rideAutosave.js`. Exporters take the splits as an option and fall back to one lap.

**Tech Stack:** Browser ES modules, no bundler; `node:test`; ESLint 9.

**Spec:** `docs/superpowers/specs/2026-10-18-splits-laps-ride-history-design.md`

## Global Constraints

- Client only; no server or protocol changes.
- No new dependencies (the `jsdom` in the #79 stash is not part of this work).
- Run tests and lint in Docker:
  `docker run --rm -v /root/projects/Open-Ride:/w -w /w/client node:22 sh -c "npm install --no-save --silent && npm run check"`
  (single file: `... node:22 node --test test/splits.test.js`).
- Split settings: `"auto" | "lap" | "1" | "5" | "10" | "off"`; default `"auto"`.
- `auto`: no route → `"5"`; route length < 20 000 m → `"lap"`; > 60 000 m → `"10"`; else `"5"`.
- Distance unit: 1000 m metric, 1609.344 m imperial (`getUnits()` from `util/format.js`).
- Free-split cut: 10 000 m; leftover merge threshold: 200 m.
- Commit messages: `Area: what (#83)` style as in `git log`, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Lap mode on a route longer than 10 km** (Col de la Forge, 12.9 km): a clean lap must not be cut at 10 km. Test in Task 1.
2. **Split just closed during the ride**: with `final: false` the new split shows at once, not 200 m later. Test in Task 1.
3. **Ride that never reaches a boundary** (short ride, or lap mode joined mid-loop and finished before the line): one free/partial split, no table, FIT has one lap. Tests in Tasks 1 and 5.
4. **Imperial rider**: 5 mi splits are labelled `Mi 5`, the toast uses mph. Test in Task 3.
5. **Finish screen opened twice / storage blocked** (private mode): history save is idempotent by id and never throws. Test in Task 2.

---

### Task 1: Split computation and route fields in samples

**Files:**
- Create: `client/public/js/ride/splits.js`
- Modify: `client/public/js/ride/rideRecorder.js` (`add`: keep `route`, `routeM`)
- Test: `client/test/splits.test.js`, `client/test/recorder.test.js`

**Interfaces:**
- Produces:
  - `export const SPLIT_SETTINGS = ["auto", "lap", "1", "5", "10", "off"]`
  - `resolveSplitMode(setting: string, routeLengthM: ?number) → "lap"|"1"|"5"|"10"|"off"`
  - `computeSplits(samples, pauses, { mode, unitM = 1000, routeLength = () => null, final = true }) → Split[]`
    where `routeLength(routeId) → ?number` and `Split` is the spec's object
    (`index, kind, route, lap, startIndex, endIndex, fromM, toM, startT, endT, durationS, distanceM, avgSpeed, avgPower, maxPower, avgHeartRate, elevationGainM, partial`).
    `mode "off"` or < 2 samples → `[]`.
  - `compareSplits(splits) → {comparable: boolean, best: boolean, speedDelta: ?number}[]`
    (same order; comparable = `lap` or non-partial `distance`; `speedDelta` = avgSpeed / mean comparable avgSpeed − 1; `best` = highest avgSpeed, only with ≥ 2 comparable).
  - Samples gain `route: ?string` and `routeM: ?number` (null when missing or not finite).

- [ ] **Step 1: Write failing tests** in `splits.test.js` with a helper `samples(n, { speed = 10, route = "loop", L = 1000, startM = 0, power = 200 })` producing 1 Hz samples (`distance = i·speed`, `routeM = (startM + i·speed) mod L`). Tests:
  - `resolveSplitMode`: `("auto", null) → "5"`, `("auto", 7800) → "lap"`, `("auto", 12900) → "lap"`, `("auto", 179600) → "10"`, `("auto", 40000) → "5"`, `("10", 7800) → "10"`, `("off", x) → "off"`.
  - distance `"1"`, 2500 m at 10 m/s → 3 splits `kind "distance"`, `toM` 1000/2000/2500, third `partial: true`, durations 100/100/50.
  - leftover 150 m (2150 m ride) merges: 2 splits, last `toM 2150`; with `final: false` → 3 splits, last 150 m.
  - closed pause between samples 30 and 31 (t gap 60 s) inside split 1 → its `durationS` 100, not 160; sum of durations = `RideRecorder.summary().durationS`.
  - zero-speed stretch (20 samples at 0 m/s) → counts in `durationS`.
  - lap mode, L = 1000, startM 0, 3500 m → laps 1–3 `kind "lap"`, `lap` 1/2/3, last split free and partial.
  - joined mid-loop (startM 400) → first split `free` ending at the first wrap (600 m), then laps.
  - leaving the route mid-lap (`route: null` for 50 samples in lap 2) → that stretch `free`.
  - route switch at a junction (`route` changes to `"other"`) → `free`, and a wrap on `"other"` is not a crossing for `"loop"`.
  - off route for 12 km → free split cut at the first sample ≥ 10 000 m from its start.
  - **L = 12 900, 30 km on route → laps of 12 900 m, no cut at 10 km.**
  - samples without `route`/`routeM` (old autosave) in lap mode → one free split per 10 km, no laps.
  - `compareSplits`: free never comparable; best is the fastest lap; single comparable → `best` false.
  - In `recorder.test.js`: `add` keeps `route` and `routeM`, nulls `NaN` / missing ones, and `toJSON()` round-trips them.

- [ ] **Step 2: Run** `... node --test test/splits.test.js test/recorder.test.js` — expect FAIL (module not found).

- [ ] **Step 3: Implement** `splits.js` and the two recorder fields.
  One pass over sample pairs; a split shares its boundary sample with the next (`endIndex` of one = `startIndex` of the next). Durations and power sum only pairs not spanning a closed pause (same test as `RideRecorder#spansPause`: `a.t <= p.from && b.t >= p.to`). Averages time-weighted like `summary()`; elevation gain over non-null pairs; `avgHeartRate` mean of non-null. Crossing for pair `a→b`: `a.route === b.route !== null`, both `routeM` finite, `L = routeLength(a.route)` > 0, `(b.routeM mod L) < (a.routeM mod L) − L/2`. A split is `lap` when it started at a crossing, ended at a crossing, and all its samples have the starting route. Distance split ends at the first sample with `distance ≥ k·everyM` (`everyM = Number(mode)·unitM`), `kind "distance"`, `partial` when shorter than `everyM`.

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Commit** `Client: compute splits and laps from ride samples (#83)`.

### Task 2: Ride history store

**Files:**
- Create: `client/public/js/ride/rideHistory.js`
- Test: `client/test/rideHistory.test.js`

**Interfaces:**
- Consumes: `indexedDbStore(name)` from `rideAutosave.js`; `Split` from Task 1.
- Produces:
  - `rideRecord({ recorder, splits, splitMode, routeId, measured, profile }) → record` (spec's `version: 1` record; `id = String(samples[0].t)`, totals from `recorder.summary()`, `ftp`/`weightKg` from `profile`).
  - `class RideHistory { constructor({ store, log = console.warn }); save(record) → Promise<void>; list() → Promise<record[]> /* newest first */ }` — errors logged once, `save` resolves, `list` gives `[]`.

- [ ] **Step 1: Write failing tests** with the `mapStore()` helper from `autosave.test.js`: `rideRecord` copies totals, `version 1`, `id` from first sample, `splitMode`, `measured`; save twice with the same id → `list()` has one record; two rides → newest first; a store whose `put` rejects → `save` resolves, `log` called once over two saves; `list` on a rejecting store → `[]`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Keys `ride:<id>`; `list` reads `keys()` with that prefix, gets each, sorts by `startedAt` descending.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Client: local ride history store (#48, #83)`.

### Task 3: Profile setting and HUD split readout

**Files:**
- Modify: `client/public/js/profile/profileStore.js` (`DEFAULT_PROFILE.splitMode = "auto"`, validation)
- Modify: `client/public/index.html` (profile `<select id="split-mode">` after the FTP field; `#split-toast`; "Last split" in broadcast `.strip` and training `.band-stats`)
- Modify: `client/public/js/view/hud.js` (format helpers)
- Modify: `client/public/js/main.js` (profile form read/write at ~278 and ~877; resolve mode at ride start; live splits after `recorder.add` at ~2752)
- Modify: `client/public/styles.css` (toast)
- Test: `client/test/hud.test.js`, profile tests in the existing profile test file (`grep -l validateProfile client/test`)

**Interfaces:**
- Consumes: `SPLIT_SETTINGS`, `resolveSplitMode`, `computeSplits` (Task 1).
- Produces (in `hud.js`):
  - `splitLabel(split, unitM) → string`: `lap` → `"Lap 3"`; `distance` → `"Km 10"` / `"Mi 10"` (`Math.round(toM / unitM)`); `free` → `formatDistanceWithUnit(distanceM, 1)`.
  - `splitLine(split, unitM) → string`: `` `${label} · ${formatDuration(durationS)} · ${formatSpeed(avgSpeed)} ${speedUnit()} · ${Math.round(avgPower)} W` ``.
  - `app.splitMode` (resolved) and `app.splits` (latest live result) in `main.js`, used by Tasks 4–5.

- [ ] **Step 1: Write failing tests:** `validateProfile` rejects `splitMode: "7"` with `"Splits must be auto, lap, 1, 5, 10 or off."` and accepts each setting; `splitLine` for a lap → `"Lap 3 · 12:41 · 36.8 km/h · 224 W"`; distance metric → starts `"Km 10 · "`; imperial (`setUnits("imperial")`, `unitM` 1609.344) → `"Mi 5 · …mph…"`; free 6200 m → starts `"6.2 km · "`. Reset units after the imperial test.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Select options: Auto, Every lap, Every 1 km, Every 5 km, Every 10 km, Off (labels say "mi" when imperial; update them where units switch). At ride start (where `app.rideRoute` is set, ~917–923): `app.splitMode = resolveSplitMode(profile.splitMode, app.studio ? null : app.route.length)`. After each kept sample: `app.splits = computeSplits(recorder.samples, recorder.pauses, { mode, unitM, routeLength: (id) => app.routes.get(id)?.length ?? null, final: false })`; when `app.splits.length − 1` grows, show `splitLine` of the newest closed split in `#split-toast` for 5 s and `hud.set("last-split", …)`. Recorder samples get `route: me?.route ?? null` (null in the studio and for `OFF_ROUTE_ID`) and `routeM: me?.route ? me.distance : null`. After a rejoin, set the shown count from the restored samples so no old toast fires.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Client: split setting and live split readout (#83)`.

### Task 4: Finish screen table and history save

**Files:**
- Create: `client/public/js/view/splitsView.js`
- Modify: `client/public/index.html` (`<table id="finish-splits" hidden>` after `#finish-summary`), `client/public/styles.css`, `client/public/js/main.js` (`openFinish` ~1567)
- Test: `client/test/splitsView.test.js`

**Interfaces:**
- Consumes: `computeSplits`, `compareSplits` (Task 1); `splitLabel` (Task 3); `RideHistory`, `rideRecord`, `indexedDbStore` (Task 2).
- Produces: `splitRows(splits, unitM) → {label, time, distance, speed, power, heartRate, gain, best, hint}[]` (strings, pure) and `renderSplits(table, splits, unitM)` (DOM; hides the table when `splits.length < 2`; hides the HR column when no split has HR).

- [ ] **Step 1: Write failing tests** for `splitRows`: hint `"+3 %"` / `"−2 %"` on comparable rows, `""` on free ones; exactly one `best: true` row; `heartRate "–"` when null.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In `openFinish`: `const splits = computeSplits(…, { final: true })`, `renderSplits($("finish-splits"), splits, unitM)`; when `!app.recorder.empty`, `app.history.save(rideRecord({ … measured: hasRealPowerSource(app.trainer) … }))` (fire and forget). `app.history = new RideHistory({ store: indexedDbStore("openradlr-history") })` next to the autosave setup. Best row gets class `best`.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Client: splits table on the finish screen, rides saved to history (#83)`.

### Task 5: FIT and TCX laps

**Files:**
- Modify: `client/public/js/ride/fitFile.js` (lap message fields; one lap per split)
- Modify: `client/public/js/ride/rideRecorder.js` (`toFit({ indoor, splits })`, `toTcx({ name, splits })`)
- Modify: `client/public/js/main.js` (pass the finish splits to the downloads and the Strava upload)
- Test: `client/test/fit.test.js`, `client/test/recorder.test.js`

**Interfaces:**
- Consumes: `Split` (Task 1).
- Produces: `encodeFitActivity(samples, summary, { indoor, pauses, splits = [] })`; `toFit`/`toTcx` accept `splits` (default `[]`).

- [ ] **Step 1: Write failing tests:** a 30 s ride with 3 given splits → `fitMessages` has 3 messages with global 19, the session (18) field 26 (`laps`) = 3, lap field 2 (`startTime`) of lap 2 = FIT time of `splits[1].startT`; no splits → 1 lap, `laps` = 1 (today's behaviour); TCX with 3 splits → 3 `<Lap ` elements, the first with `TriggerMethod` `Distance` for distance splits and `Location` for laps; every sample appears in exactly one `<Lap>`; no splits → 1 `<Lap>` with `Manual`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Lap message gains `[13, "avgSpeed", "uint16"]` (m/s × 1000), `[15, "avgHeartRate", "uint8"]`, `[20, "maxPower", "uint16"]`, `[24, "trigger", "enum"]` (2 distance, 4 lap/free, 7 single lap). One lap per split from its own fields (`timer = durationS·1000`, `elapsed = endT − startT`); session `laps = max(1, splits.length)`. TCX: samples `startIndex … endIndex − 1` per lap (the last lap includes `endIndex`), each lap's tracks still split at pauses.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `Client: one FIT and TCX lap per split (#83)`.

### Task 6: Docs, changelog and UI check

**Files:**
- Create: `docs/splits.md`
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

- [ ] **Step 1:** `docs/splits.md`: modes and `auto`, clean lap vs free split, 10 km cut, pauses, exports, the ride-history record (link the spec).
- [ ] **Step 2:** Changelog entry in the existing bold-lead style: **Splits and laps:** …
- [ ] **Step 3:** Playwright screenshots (docker recipe from memory) of the HUD toast in a ride on Rolling Hills and of the finish table; share via an Artifact page.
- [ ] **Step 4:** `npm run check` — PASS; commit `Docs: splits and laps (#83)`.
