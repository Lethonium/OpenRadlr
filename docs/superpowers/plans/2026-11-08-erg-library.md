# ERG Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four sourced interval sessions in the ERG library, and a power-profile preview of the selected session under the dropdown.

**Architecture:** Sessions are ordinary `createWorkout` data in `ride/workout.js`, built with two new helpers and one new option on `intervals`. The preview reuses `drawWorkout` from `view/workoutView.js` with no "now" line. `main.js` only wires it up. No server or protocol change.

**Tech Stack:** Plain ES-module client, `node --test`, canvas 2D.

**Spec:** `docs/superpowers/specs/2026-11-08-erg-library-design.md`

## Global Constraints

- Branch `feat/erg-library`, based on `origin/main`. Do not merge or rebase onto `feat/yoga`.
- All UI text through `t()` with literal keys in both `en.js` and `de.js` (ADR 0017). Lines with English data strings that the i18n sweep flags end with `// i18n-ok`, like their neighbours.
- Commands run in Docker, from the repo root (tests read `/routes`, so mount the root):
  - client: `docker run --rm -v "$PWD":/w -w /w/client node:22-alpine node --test "test/**/*.test.js"`
  - one file: `docker run --rm -v "$PWD":/w -w /w/client node:22-alpine node --test test/erg.test.js`
  - lint: `docker run --rm -v "$PWD":/w -w /w/client node:22-alpine sh -c "npm ci --silent && npm run lint"`
- Commit messages imperative, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **An imported `.zwo` loses its last recovery.** `parseZwo` calls `intervals` too; the new option must default to today's behaviour. Test in Task 1.
2. **A label that only looks like a series.** A `.zwo` or unknown inner label must pass through unchanged, not throw or lose text. Test in Task 1.
3. **A single-set series.** `series(1, ...)` must have no break block. Test in Task 1.
4. **The picker is hidden when the preview first draws.** The canvas is 0 px wide at startup; drawing must not throw. Test in Task 3.
5. **No workout selected.** `app.workouts[NaN]` is `undefined`; the preview clears instead of throwing. Test in Task 3.

---

### Task 1: Series, over-under and label building blocks

**Files:**
- Modify: `client/public/js/ride/workout.js` (`LABEL_KEYS`, `segmentLabel`, `intervals`, new exports after `intervals`)
- Modify: `client/public/js/i18n/en.js`, `client/public/js/i18n/de.js` (after `workout.label.recovery`)
- Test: `client/test/erg.test.js`

**Interfaces:**
- Produces:
  - `intervals(repeat, onS, onPower, offS, offPower, { lastRecovery = true } = {}) -> Segment[]`
  - `series(count, restS, restPower, makeSet: () => Segment[]) -> Segment[]`
  - `overUnders(repeat, underS, underPower, overS, overPower) -> Segment[]`

- [ ] **Step 1: Write the failing tests**

Add `overUnders`, `segmentLabel`, `series` to the `workout.js` import, import `setLocale` from `../public/js/i18n/i18n.js`, and import `afterEach` from `node:test` with `afterEach(() => setLocale("en"))`.

```js
test("intervals can leave out the recovery after the last rep", () => {
  const segments = intervals(3, 30, 1.2, 15, 0.6, { lastRecovery: false });
  assert.equal(segments.length, 5);
  assert.equal(segments.at(-1).label, "Interval 3/3");
  assert.equal(intervals(3, 30, 1.2, 15, 0.6).at(-1).label, "Recovery 3/3");
});

test("an imported .zwo keeps the recovery after its last interval", () => {
  const workout = parseZwo('<workout_file><workout><IntervalsT Repeat="2" OnDuration="30" OnPower="1.2" OffDuration="15" OffPower="0.6"/></workout></workout_file>');
  assert.equal(workout.segments.at(-1).kind, "off");
});

test("series prefixes labels and puts a break only between sets", () => {
  const segments = series(2, 180, 0.6, () => intervals(2, 30, 1.2, 15, 0.6, { lastRecovery: false }));
  assert.deepEqual(segments.map((s) => s.label), [
    "Series 1/2 · Interval 1/2", "Series 1/2 · Recovery 1/2", "Series 1/2 · Interval 2/2",
    "Series break",
    "Series 2/2 · Interval 1/2", "Series 2/2 · Recovery 1/2", "Series 2/2 · Interval 2/2",
  ]);
  assert.deepEqual([segments[3].durationS, segments[3].from, segments[3].to, segments[3].kind], [180, 0.6, 0.6, "off"]);
});

test("a single series has no break", () => {
  assert.equal(series(1, 180, 0.6, () => intervals(1, 30, 1.2, 15, 0.6)).length, 2);
});

test("overUnders alternates under and over blocks", () => {
  const segments = overUnders(2, 120, 0.95, 60, 1.05);
  assert.deepEqual(segments.map((s) => [s.label, s.durationS, s.from, s.kind]), [
    ["Under 1/2", 120, 0.95, "on"], ["Over 1/2", 60, 1.05, "on"],
    ["Under 2/2", 120, 0.95, "on"], ["Over 2/2", 60, 1.05, "on"],
  ]);
});

test("segmentLabel translates series, under, over and the break", () => {
  assert.equal(segmentLabel("Series 2/3 · Interval 5/13"), "Series 2/3 · Interval 5/13");
  setLocale("de");
  assert.equal(segmentLabel("Series 2/3 · Interval 5/13"), "Serie 2/3 · Intervall 5/13");
  assert.equal(segmentLabel("Series 1/3 · Under 2/3"), "Serie 1/3 · Unter 2/3");
  assert.equal(segmentLabel("Over 1/3"), "Über 1/3");
  assert.equal(segmentLabel("Series break"), "Serienpause");
});

test("segmentLabel leaves labels it does not know alone", () => {
  setLocale("de");
  assert.equal(segmentLabel("Series 1/2 · Hill repeat"), "Serie 1/2 · Hill repeat");
  assert.equal(segmentLabel("Series of hills"), "Series of hills");
});
```

- [ ] **Step 2: Run the file and verify the new tests fail**

Run the one-file command. Expected: FAIL, `series` and `overUnders` are not exported.

- [ ] **Step 3: Implement in `workout.js` and add the keys**

- `intervals`: skip the off block for `i === repeat` when `lastRecovery` is false.
- `series`: prefix each block from `makeSet()` with `Series ${s}/${count} · `; call `makeSet` once per set; between sets push `{ durationS: restS, from: restPower, to: restPower, label: "Series break", kind: "off" }`.
- `overUnders`: blocks labelled `Under ${i}/${repeat}` and `Over ${i}/${repeat}`, both kind `"on"`.
- `LABEL_KEYS`: `"Series break": "workout.label.seriesBreak"`.
- `segmentLabel`: match `/^Series (\d+)\/(\d+) · (.+)$/` first and return `t("workout.label.series", { i, n, label: segmentLabel(rest) })`. Extend the round regex or add a second one for `Under` and `Over`, using literal `t()` keys.

| Key | `en.js` | `de.js` |
|---|---|---|
| `workout.label.series` | `Series {i}/{n} · {label}` | `Serie {i}/{n} · {label}` |
| `workout.label.seriesBreak` | `Series break` | `Serienpause` |
| `workout.label.under` | `Under {i}/{n}` | `Unter {i}/{n}` |
| `workout.label.over` | `Over {i}/{n}` | `Über {i}/{n}` |

- [ ] **Step 4: Run all client tests and verify they pass**

Run the client command. Expected: all pass, including the i18n sweep and parity tests.

- [ ] **Step 5: Commit**

Stage the four files. Message: `Add series and over-under building blocks for ERG sessions`.

### Task 2: The four sessions

**Files:**
- Modify: `client/public/js/ride/workout.js` (`LIBRARY_KEYS`, `PRESET_WORKOUTS`)
- Modify: `client/public/js/i18n/en.js`, `client/public/js/i18n/de.js` (after `workout.lib.erg.description`)
- Test: `client/test/erg.test.js`

**Interfaces:**
- Consumes: `intervals`, `series`, `overUnders` from Task 1.

- [ ] **Step 1: Write the failing tests**

```js
const preset = (name) => PRESET_WORKOUTS.find((w) => w.name === name);

test("the sourced sessions have the planned shape", () => {
  const expected = { "Seiler 4×8": [9, 3180, 1.05], "Rønnestad 30/15": [79, 2970, 1.2], "40/20 4×8": [65, 3100, 1.15], "Over-unders 3×9": [22, 3120, 1.05] }; // i18n-ok
  for (const [name, [blocks, seconds, peak]] of Object.entries(expected)) {
    const workout = preset(name);
    assert.equal(workout.segments.length, blocks, name);
    assert.equal(totalDuration(workout), seconds, name);
    assert.equal(Math.max(...workout.segments.map((s) => s.from)), peak, name);
  }
});

test("Rønnestad 30/15 has 12 reliefs per series and 3 minutes between series", () => {
  const { segments } = preset("Rønnestad 30/15");
  assert.equal(segments.filter((s) => s.label.startsWith("Series 2/3 · Recovery")).length, 12);
  assert.equal(segments.filter((s) => s.label === "Series break" && s.durationS === 180).length, 2);
});

test("sessions are shown with a translated name and description", () => {
  setLocale("de");
  assert.match(workoutDescription(preset("Over-unders 3×9")), /nicht aus einer veröffentlichten Studie/);
  assert.equal(workoutName(preset("40/20 4×8")), "40/20 4×8");
  assert.equal(PRESET_WORKOUTS.at(-1).name, "ERG check 10");
});
```

Add `workoutDescription`, `workoutName` to the import.

- [ ] **Step 2: Run the file and verify the new tests fail**

Run the one-file command. Expected: FAIL, `preset(...)` is undefined.

- [ ] **Step 3: Add the presets**

Insert after VO2max 5×3, in this order. Every session: warm-up `ramp(600, 0.45, 0.75, "Warm-up", "warmup")`, cool-down `ramp(300, 0.6, 0.45, "Cool-down", "cooldown")`. Set `description` to the English text below, and register each name in `LIBRARY_KEYS` with its keys.

| Name | Main set | Keys |
|---|---|---|
| `Seiler 4×8` | `intervals(4, 480, 1.05, 120, 0.5, { lastRecovery: false })` | `workout.lib.seiler.*` |
| `Rønnestad 30/15` | `series(3, 180, 0.6, () => intervals(13, 30, 1.2, 15, 0.6, { lastRecovery: false }))` | `workout.lib.ronnestad.*` |
| `40/20 4×8` | `series(4, 120, 0.58, () => intervals(8, 40, 1.15, 20, 0.58, { lastRecovery: false }))` | `workout.lib.fortyTwenty.*` |
| `Over-unders 3×9` | `series(3, 300, 0.5, () => overUnders(3, 120, 0.95, 60, 1.05))` | `workout.lib.overUnders.*` |

Exact copy (`.name` in both languages: the table's name, except German `Over-Unders 3×9`):

| Key | `en.js` | `de.js` |
|---|---|---|
| `seiler.description` | Four 8-minute efforts with 2 minutes easy between them. Based on Seiler et al. 2013, where riders held the hardest effort they could sustain. 105 % FTP is our estimate: adjust it to your effort. | Vier 8-Minuten-Belastungen mit je 2 Minuten locker dazwischen. Nach Seiler et al. 2013, dort fuhren die Teilnehmenden die härteste Belastung, die sie halten konnten. 105 % FTP ist unsere Schätzung: Passe sie an deine Belastung an. |
| `ronnestad.description` | Three series of 13 × 30 s on, 15 s off, with 3 minutes between series. From Rønnestad et al. 2015, where riders held the hardest effort they could sustain. 120 % FTP is our estimate: adjust it to your effort. | Drei Serien aus 13 × 30 s Belastung, 15 s Erholung, mit 3 Minuten zwischen den Serien. Aus Rønnestad et al. 2015, dort fuhren die Teilnehmenden die härteste Belastung, die sie halten konnten. 120 % FTP ist unsere Schätzung: Passe sie an deine Belastung an. |
| `fortyTwenty.description` | Four sets of 8 × 40 s on, 20 s off, with 2 minutes between sets. Format from clinical trial NCT04075929. 115 % FTP is our estimate: adjust it to your effort. | Vier Sätze aus 8 × 40 s Belastung, 20 s Erholung, mit 2 Minuten zwischen den Sätzen. Format aus der klinischen Studie NCT04075929. 115 % FTP ist unsere Schätzung: Passe sie an deine Belastung an. |
| `overUnders.description` | Three sets of 2 minutes just under and 1 minute just over threshold, with 5 minutes between sets. Common coaching practice, not from a published study. | Drei Sätze aus 2 Minuten knapp unter und 1 Minute knapp über der Schwelle, mit 5 Minuten zwischen den Sätzen. Gängige Trainingspraxis, nicht aus einer veröffentlichten Studie. |

- [ ] **Step 4: Run all client tests and verify they pass**

Run the client command. Expected: all pass.

- [ ] **Step 5: Commit**

Stage the four files. Message: `Add four research-backed sessions to the ERG library`.

### Task 3: Preview under the dropdown

**Files:**
- Modify: `client/public/js/view/workoutView.js`
- Modify: `client/public/index.html` (in `#workout-picker`, directly above `#workout-description`)
- Modify: `client/public/styles.css` (after `.workout-picker select`)
- Modify: `client/public/js/main.js` (`renderWorkoutDescription` and the setup near `addEventListener("change", ...)` on `workout-select`)
- Modify: `client/public/js/i18n/en.js`, `client/public/js/i18n/de.js`, `CHANGELOG.md`
- Test: `client/test/erg.test.js`

**Interfaces:**
- Produces: `drawWorkoutPreview(canvas, workout | undefined) -> void`, and `drawWorkout` accepting `elapsedS: null`.

- [ ] **Step 1: Write the failing tests**

Add `drawWorkout` and `drawWorkoutPreview` to the `workoutView.js` import next to `workoutShapes`. A recording fake:

```js
function fakeCanvas(clientWidth = 200) {
  const log = { fills: [], strokes: 0, clears: 0 };
  const ctx = {
    globalAlpha: 1, setTransform() {}, clearRect() { log.clears += 1; }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { log.fills.push(ctx.globalAlpha); }, stroke() { log.strokes += 1; },
  };
  return { canvas: { clientWidth, clientHeight: 56, width: 0, height: 0, getContext: () => ctx }, log };
}
const previewWorkout = () => createWorkout({ name: "P", segments: [steady(60, 0.5), steady(60, 1.2)] });

test("the preview draws every block at full alpha and no now-line", () => {
  const { canvas, log } = fakeCanvas();
  drawWorkoutPreview(canvas, previewWorkout());
  assert.deepEqual(log.fills, [0.9, 0.9]);
  assert.equal(log.strokes, 0);
});

test("the in-ride chart still dims finished blocks and draws the now-line", () => {
  const { canvas, log } = fakeCanvas();
  drawWorkout(canvas, { workout: previewWorkout(), elapsedS: 60, colors: { text: "#fff" } });
  assert.deepEqual(log.fills, [0.35, 0.9]);
  assert.equal(log.strokes, 1);
});

test("the preview survives a hidden canvas", () => {
  const { canvas, log } = fakeCanvas(0);
  assert.doesNotThrow(() => drawWorkoutPreview(canvas, previewWorkout()));
  assert.equal(log.fills.length, 2);
});

test("the preview clears when no workout is selected", () => {
  const { canvas, log } = fakeCanvas();
  drawWorkoutPreview(canvas, undefined);
  assert.equal(log.clears, 1);
  assert.equal(log.fills.length, 0);
});
```

- [ ] **Step 2: Run the file and verify the new tests fail**

Run the one-file command. Expected: FAIL, `drawWorkoutPreview` is not exported.

- [ ] **Step 3: Implement the drawing**

In `workoutView.js`: `drawWorkout` skips the "now" line when `elapsedS === null`. `drawWorkoutPreview(canvas, workout)` calls `prepareCanvas` and returns when `workout` is falsy, otherwise `drawWorkout(canvas, { workout, elapsedS: null })`. Check that the alpha test `shape.end <= elapsedS` does not dim blocks for `null` (`shape.end <= null` is false for positive ends).

- [ ] **Step 4: Run the file and verify the tests pass**

Run the one-file command. Expected: PASS.

- [ ] **Step 5: Add the canvas and wire it up**

- HTML: `<canvas id="workout-preview" class="canvas-workout-preview" aria-label="Power profile of the selected workout" data-i18n-attr="aria-label:drawer.workoutPreview"></canvas>`.
- CSS: `.canvas-workout-preview { width: 100%; height: 56px; }`, with the same fixed-height reason as `.canvas-workout`.
- Key `drawer.workoutPreview`: en `Power profile of the selected workout`, de `Leistungsprofil des gewählten Workouts`.
- `main.js`: `renderWorkoutDescription` also calls `drawWorkoutPreview($("workout-preview"), chosen)`. Next to the `change` listener add `new ResizeObserver(renderWorkoutDescription).observe($("workout-preview"));`. Import `drawWorkoutPreview` on the existing `workoutView.js` import line.

- [ ] **Step 6: Add the CHANGELOG entry**

Under `[Unreleased]` → `### Added`: `Four research-backed ERG sessions (Seiler 4×8, Rønnestad 30/15, 40/20, over-unders), each naming its source, and a power-profile preview of the selected session in the workout picker. (#26)`

- [ ] **Step 7: Run tests and lint**

Run the client and lint commands. Expected: all pass, no lint errors.

- [ ] **Step 8: Check it in the running app**

Start the server and take a screenshot with the recipe in the "UI verification" section of `AGENTS.md`. Open the workout picker after the page has loaded, so the `ResizeObserver` path runs, select Rønnestad 30/15, and screenshot `#workout-picker`. Expected: a filled zone-coloured profile and the description below it. Save outside the repo, under `~/.cache/openradlr/screenshots/`.

- [ ] **Step 9: Commit**

Stage the changed files. Message: `Preview the selected ERG session's power profile`.

Manual, for the user after the PR is up: ride the Rønnestad 30/15 and the 40/20 on a real smart trainer. If the 15 s and 20 s recoveries are unusable in ERG, those two descriptions say so; the protocols stay.
