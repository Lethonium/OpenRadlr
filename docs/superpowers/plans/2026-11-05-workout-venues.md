# Workout venues and statues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each café workout happens at its own outdoor gym, with stone statues of its figures; the start menu shows workout cards with a block strip and figure chips that fly the drone to the gym and its statues; during rests the next figure's statue glows.

**Architecture:** Venues are client data (`workout/venues.js`); presets name a venue (café id) and the client joins the route starting at that café. Gyms learn their café id and a statue-row transform from the world build; statues are posed rider bodies built on the main thread into a per-gym layer of `View3D` (`setStatues`, `setStatueGlow`). Menu camera gains a statue shot; `MenuStage` steers to the picked workout's gym.

**Tech Stack:** Plain ES modules (no build), own WebGL renderer, `node --test`, ESLint. No server change.

**Spec:** `docs/superpowers/specs/2026-11-05-workout-venues-design.md`

## Global Constraints

- No server, protocol or Rust change; `cargo test` stays green untouched.
- Venues: `valley-cafe` fullBody marble; `hill-cafe` hiit bronze; `beach-cafe` core sandstone; `forge-hut` strength granite. Presets: `full-body` → `valley-cafe`, `tabata` → `hill-cafe`, `core` → `beach-cafe`.
- Route at a venue: first route in `/api/info` order whose start lies within 30 m of the café node; else the default route.
- Statue row at gym-local z = 8, plinths over x −7.5…7.5 (one figure centred; spacing `15 / (n − 1)` capped at 3 m), facing −z (the road). Figure scale 1.15. Upright plinth 0.9 × 0.9 × 1.0 m; lying plinth 2.0 × 0.8 × 0.6 m.
- Statue close shot: eye 4.5 m in front of the plinth, 2 m above its top, looking at the figure's chest, swinging ±20° (0.349 rad).
- Glow only during rest blocks (get-ready included), for the next exercise; off otherwise; never pulses; local only.
- UI text in `js/i18n/en.js` and `de.js` (ADR 0017); DOM via `textContent` only. English data labels get `// i18n-ok`.
- Run node tooling via Docker (no host node): `NODE='docker run --rm -v /root/projects/Open-Ride:/w -w /w/client node:22-alpine'`; single file: `$NODE node --test test/<file>.test.js`. Full gate: `make check` from the repo root.
- One PR on `feat/workout-venues`, assigned to RalfLeonFasler, not merged by us. Commits imperative, ending with the Co-Authored-By trailer.

## Review Focus

1. **Server offering only some routes** (e.g. only `rolling-hills`, or Lanzarote's separate world): a workout whose café has no offered route must still start (default route) and the default gym's row must show that workout's figures — test in Task 1 (`venueRoute` → null) and Task 7 (override row).
2. **Switching cards quickly while the world is still building:** the camera must end on the last pick's gym, never a stale one, and no statue rows from a disposed view leak — test in Task 7.
3. **Language switch with the workout tab open:** card names, tags and chip labels re-render in the new language and the selection stays — test in Task 6.
4. **Saved `workoutPreset` that no longer exists** (old profile): first card preselected, no exception — test in Task 6.
5. **Pause / skip during a rest:** glow follows `planPositionAt` (skip into an exercise turns it off; finishing turns it off) — test in Task 8.

---

### Task 1: Venues and the route to join

**Files:**
- Create: `client/public/js/workout/venues.js`
- Modify: `client/public/js/workout/plan.js` (`createPlan` keeps `venue`), `client/public/js/workout/presets.js` (add `venue`)
- Test: `client/test/venues.test.js`, `client/test/workoutPlan.test.js`

**Interfaces:**
- Produces:
  - `VENUES: {[cafeId]: {category: "fullBody"|"hiit"|"core"|"strength", material: "marble"|"bronze"|"sandstone"|"granite"}}` (frozen)
  - `figuresAt(venueId: string, presets: Plan[]): string[]` — distinct exercise ids, first-appearance order
  - `venueRoute(venueId: string, routes: {id: string, start: {x, y}}[], cafes: {id, x, y}[]): string | null`
  - `Plan.venue: string | null` (from `createPlan`; unknown id throws `"Unknown venue."`; missing → `null`)

- [ ] **Step 1: Write failing tests** in `venues.test.js`:
  - `figuresAt("valley-cafe", PRESETS)` deep-equals `["squats","situps","pushups","jumping_jacks","plank","burpees"]`; `"hill-cafe"` → `["squats","burpees"]`; `"beach-cafe"` → `["situps","plank","pushups"]`; `"forge-hut"` → `[]`.
  - `venueRoute`: cafes `[{id:"beach-cafe",x:700,y:-3220},{id:"valley-cafe",x:0,y:0}]`; routes `[{id:"a",start:{x:0,y:0}},{id:"b",start:{x:710,y:-3200}},{id:"c",start:{x:700,y:-3220}}]` → `"b"` for beach (first within 30 m), `"a"` for valley; a café 31 m from every start → `null`; unknown venue → `null`.
  - Every preset's `venue` is a key of `VENUES`.
  - In `workoutPlan.test.js`: `createPlan({..., venue: "nowhere"})` throws `/Unknown venue/`; without `venue` the plan has `venue === null`.
- [ ] **Step 2: Run** `$NODE node --test test/venues.test.js test/workoutPlan.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `venues.js`; `createPlan` validates `venue` against `VENUES` (import from `venues.js`; `venues.js` must not import `plan.js` to avoid a cycle); add `venue` to the three presets.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5: Commit** "Give each workout preset a venue café".

### Task 2: Gyms know their café and statue row

**Files:**
- Modify: `client/public/js/view3d/features.js` (`buildOutdoorGym`), `client/public/js/view3d/world.js:1030-1051` (carry café id)
- Test: `client/test/world3.test.js`

**Interfaces:**
- Produces: a gym is `{center, yaw, spots, cafeId: string | null, statueRow: {position: number[3], yaw: number}}`. `statueRow.position` = gym-local `(0, 0, 8)` in world space at pad height (`base`); `statueRow.yaw` = gym `yaw`. `buildOutdoorGym(route, terrain, {..., cafeId = null})`.

- [ ] **Step 1: Write failing tests** in `world3.test.js` (gym section):
  - `buildOutdoorGym(route, null, {..., cafeId: "valley-cafe"}).cafeId === "valley-cafe"`; default `null`.
  - `statueRow.position` is 8 m (±0.01) from `center` horizontally, on the side away from the road (`lateralOf(frame, statueRow.position) > lateralOf(frame, gym.center)`), and `statueRow.yaw === gym.yaw`.
  - `occupancy.blocked(...)` at the statue row's ends (local x ±7.5, z 8) is true.
  - Map world: every gym's `cafeId` is one of the network's café ids, and the ids are distinct.
- [ ] **Step 2: Run** `$NODE node --test test/world3.test.js` — FAIL.
- [ ] **Step 3: Implement.** In `world.js` make the café list yield `{road, cafeId}` (network: `cafe.id`; route files: `null`) and pass `cafeId` to `buildOutdoorGym`. In `buildOutdoorGym` reserve the strip with `occupancy.add` at local `(±5, 8)` radius 4 plus `(0, 8)`, and return `cafeId`, `statueRow`. `worldScene.js` already passes `gyms` through.
- [ ] **Step 4: Run** — PASS (whole file, to catch the existing gym tests).
- [ ] **Step 5: Commit** "Tell each outdoor gym its café and statue row".

### Task 3: Statue figures and meshes

**Files:**
- Modify: `client/public/js/view3d/clips.js` (export `STATUE_MOMENT`)
- Create: `client/public/js/view3d/statues.js`
- Test: `client/test/clips.test.js`, `client/test/statues.test.js`

**Interfaces:**
- Produces:
  - `STATUE_MOMENT: {[exercise]: {t: number, plinth: "upright"|"lying"}}` — squats: bottom (`t` 1.2), pushups: down (1.0), plank: 0, situps: halfway up (≈0.6), jumping_jacks: open (0.5), burpees: jump top (2.75); upright: squats, jumping_jacks, burpees; lying: pushups, plank, situps.
  - `STATUE_MATERIALS: {[material]: {figure: rgb, plinth: rgb, accent?: rgb}}`
  - `statueSlots(count: number): {x: number}[]` — local x of each plinth
  - `buildStatues(figures: string[], material: string): {mesh: Mesh, glows: Mesh[], tops: number[]}` — in the row's local frame (origin row centre, figures face −z); `glows[i]` is the ring around plinth `i`'s top; `tops[i]` its plinth height.

- [ ] **Step 1: Write failing tests:**
  - `clips.test.js`: every key of `EXERCISES` has a `STATUE_MOMENT` entry with `t` in `[0, clip.loopS]` and `plinth` in `{"upright","lying"}`.
  - `statues.test.js`: `statueSlots(1)` → `[{x:0}]`; `statueSlots(6)` → x from −7.5 to 7.5 in steps of 3; `statueSlots(2)` → `[-1.5, 1.5]` (spacing capped at 3); `buildStatues(["squats","plank"], "marble")` has `glows.length === 2`, `tops` `[1.0, 0.6]`; every figure vertex has `y >= tops[i] - 0.01` within its slot (the body never sinks into its plinth); the figure colour equals `STATUE_MATERIALS.marble.figure`; unknown material throws.
- [ ] **Step 2: Run** `$NODE node --test test/clips.test.js test/statues.test.js` — FAIL.
- [ ] **Step 3: Implement.** Pose with `settle(poseAt(CLIPS[id], t), CLIPS[id].plant)` → `bodyTransforms`; append each body part mesh (built once per material by recolouring the `riderModel` part builders' meshes to the figure colour) with `placement([x, top, 0]) · scaling(1.15) · model` via `MeshBuilder.append`. Plinth via `box`, darker colour; bronze adds an `accent` band; granite varies the plinth colour per face. Glow ring: four thin boxes 0.06 m tall around the plinth top, colour warm `[1, 0.78, 0.4]`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Build stone statues of the workout figures".

### Task 4: Statue layer in the 3D view

**Files:**
- Modify: `client/public/js/view3d/view3d.js`, `client/public/js/workout/venues.js` (add `statueRows`)
- Test: `client/test/view3d.test.js`, `client/test/venues.test.js`

**Interfaces:**
- Consumes: `buildStatues`, gym `statueRow`, `figuresAt`, `VENUES`.
- Produces:
  - `statueRows(gyms, presets, override = null): {gym, figures: string[], material: string}[]` — one row per gym with a known `cafeId` and ≥1 figure; `override = {gym, plan}` replaces that gym's figures with `figuresAt`-style distinct exercises of `plan` and the material of `plan.venue`.
  - `View3D.setStatues(rows)` (uploads, disposes previous, keyed by gym), `View3D.setStatueGlow(gym | null, index | null)`, `View3D.statueTargets(gym): {position: number[3], yaw: number, top: number}[]` (world-space plinth tops, for the camera).

- [ ] **Step 1: Write failing tests:**
  - `venues.test.js`: three map gyms with cafeIds valley/hill/forge → rows for valley (6 figures, marble) and hill (2, bronze), none for forge; override of the valley gym with the Core preset → its row has `["situps","plank","pushups"]`, `sandstone`.
  - `view3d.test.js` (with `StubRenderer`): after `setStatues(rows)` a render draws the statue mesh and casts its shadow; no glow drawn; after `setStatueGlow(gym, 1)` exactly one `drawBright` with that ring's handle; `setStatues([])` disposes the previous handles; `dispose()` disposes statue handles too; `statueTargets(gym)[0].position` lies 8 m behind the gym centre.
- [ ] **Step 2: Run** `$NODE node --test test/venues.test.js test/view3d.test.js` — FAIL.
- [ ] **Step 3: Implement** following `setHighlights`: model matrix `placement(row.gym.statueRow.position, row.gym.statueRow.yaw)`; draw statues in the lit pass after the chunks and as shadow casters within `shadowRange`; the active ring via `drawBright(handle, model, 0.9)`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Draw the gyms' statues and their glow".

### Task 5: Menu camera statue shot

**Files:**
- Modify: `client/public/js/view3d/menuCamera.js`
- Test: `client/test/menu.test.js` (where `gymPose`/`showGym` are tested)

**Interfaces:**
- Produces: `MENU_CAMERA.statueDistance = 4.5`, `statueHeight = 2`, `statueSwing = 0.349`, `statueRate = 0.25` (rad/s of the swing phase); `statuePose(target: {position, yaw, top}, overview, phase): {eye, target}`; `MenuCamera.showStatue(target)`; `view` becomes `"statue"`.

- [ ] **Step 1: Write failing tests:** `statuePose(t, flatOverview, 0)`: eye 4.5 m (±0.05) horizontally from the plinth, on its road side (−z of the row's local frame), eye height `top + 2`, target at the figure chest (`top + 0.9` ± 0.2) above the plinth; over phases `0…2π` the eye's angle off the plinth's facing stays within ±0.349; a hill under the eye lifts it (`>= ground + 1.2`). `showStatue` then `update(10)` lands at the statue pose; `showGym(gym)` afterwards flies back (`view === "gym"`); with `reducedMotion` it cuts in one update.
- [ ] **Step 2: Run** `$NODE node --test test/menu.test.js` — FAIL.
- [ ] **Step 3: Implement** `statueShot(ctx, target)` like `gymShot`: angle = facing + `statueSwing · sin(phase)`, phase advancing at `statueRate` once landed. `main.js` `lensFor`: treat `"statue"` like `"gym"`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Add a close shot of a gym statue to the menu camera".

### Task 6: Workout cards, block strip and figure chips

**Files:**
- Create: `client/public/js/view/workoutCards.js`
- Modify: `client/public/index.html:112-117` (replace the `<select>` and summary by `<div id="workout-cards" role="radiogroup">` and `<p id="workout-hint" class="field-hint">`), `client/public/js/main.js:656-680` (`initWorkoutSetup`, `fillWorkoutPresets`, `summariseWorkoutPreset`, `joinWorkout`'s preset lookup), `client/public/styles.css`, `client/public/js/i18n/en.js`, `de.js`
- Test: `client/test/workoutCards.test.js`

**Interfaces:**
- Consumes: `VENUES`, `figuresAt`, `planDuration`, `EXERCISES`.
- Produces:
  - `EXERCISE_COLORS: {[exercise]: string}` (CSS colours, one per `EXERCISES` key)
  - `blockStrip(plan): {fraction, kind: "exercise"|"rest", exercise: string|null, label: string, seconds: number}[]`
  - `workoutCard(plan, {cafeName}): {id, name, minutes, tag, cafe, description, strip, figures: {exercise, label, color}[]}`
  - `renderWorkoutCards(container, plans, {selectedId, cafeNames, onSelect(id), onFigure(id, index | null), figureIndex})` — radio group (`role="radio"`, `aria-checked`, arrow keys move and select); the selected card shows the chips (`aria-pressed`); a strip segment has `title` and `aria-label` "Push-ups 40 s" and on click writes that text into `#workout-hint`.
  - i18n keys: `workout.category.fullBody|hiit|core|strength`, `workout.minutes` ("{n} min"), `workout.figures` ("Figures"), `workout.figureHint` ("Pick a figure to see its statue"). Remove `workout.circuit`, `workout.option` if unused.

- [ ] **Step 1: Write failing tests** (pure functions plus a minimal fake DOM as other tests use):
  - `blockStrip(tabata)`: 16 segments, fractions sum to 1 (±1e-9), even segments `kind "exercise"`, odd `"rest"`; no 30 s get-ready segment.
  - `workoutCard(fullBody, {cafeName: "Valley Café"})`: `tag === t("workout.category.fullBody")`, `cafe === "Valley Café"`, `minutes === 12`, six `figures` in order with `color === EXERCISE_COLORS[exercise]`.
  - Every `EXERCISES` key has a colour.
  - Render: selected id `"core"` → that card `aria-checked="true"`, only it has chips; unknown saved id → first card selected; ArrowRight on card 1 calls `onSelect("core")` (preset order); clicking a chip calls `onFigure(id, index)`, clicking the pressed chip calls `onFigure(id, null)`.
  - After `setLanguage("de")` and re-render, the tag reads the German text and the selection stays.
- [ ] **Step 2: Run** `$NODE node --test test/workoutCards.test.js` — FAIL.
- [ ] **Step 3: Implement** the module and the CSS (cards reuse `.route-card` spacing; strip a 10 px flex row with 2 px gaps; chips coloured dot + label). In `main.js` keep the selected id in `app.workoutPick` (from `profile.workoutPreset` or the first preset), re-render on language change where `fillWorkoutPresets` was called, and use it in `joinWorkout`. Café names come from the map network nodes (`MenuStage` exposes `cafeNames(): Map<cafeId, name>`, empty until loaded; the card then omits the café line). Add en and de strings.
- [ ] **Step 4: Run** `$NODE node --test test/workoutCards.test.js test/i18nGerman.test.js test/i18nSweep.test.js` — PASS.
- [ ] **Step 5: Commit** "Show workouts as cards with a block strip and figures".

### Task 7: Menu stage flies to the workout's gym and statues; join at the venue

**Files:**
- Modify: `client/public/js/view/menuStage.js` (`select`, `#showGym`, `#selectedOrFirst`, `#build`), `client/public/js/main.js` (`joinWorkout`, card callbacks, statues for the ride view)
- Test: `client/test/menu.test.js` (MenuStage tests)

**Interfaces:**
- Consumes: `venueRoute`, `statueRows`, `View3D.setStatues`/`statueTargets`, `MenuCamera.showStatue`.
- Produces:
  - `MenuStage.showWorkout(plan, figureIndex | null)` — remembers the pick; when the workout tab is shown, targets the gym of `venueRoute(plan.venue, …) ?? first route`, sets statue rows (with override when falling back), and calls `showGym` or `showStatue(view.statueTargets(gym)[figureIndex])`.
  - `MenuStage.workoutRouteId(plan): string | null` — `venueRoute` over the offered routes' geometries and the map network's cafés; `null` when unknown.
  - `MenuStage.cafeNames(): Map<string, string>`.
  - `joinWorkout` uses `app.menu?.workoutRouteId(plan) ?? workoutRoute(app.info)`.

- [ ] **Step 1: Write failing tests** with the existing MenuStage fakes:
  - Workout tab with Tabata picked on a map with a route starting at the hill café → camera `showGym` with the gym whose `cafeId === "hill-cafe"`; switching to Full body → the valley gym.
  - `showWorkout(fullBody, 2)` → `showStatue` with `statueTargets(valleyGym)[2]`; `showWorkout(fullBody, null)` → back to `showGym(valleyGym)`.
  - Routes offered only at the valley café, Tabata picked → `workoutRouteId(tabata) === null`, camera on the valley gym, and the view's statue rows for that gym hold `["squats","burpees"]` in bronze; picking Full body afterwards restores six marble figures.
  - Two picks in a row while the scene is still building (resolve the build after the second) → the camera ends on the second pick's gym; the disposed view got no `setStatues` after disposal.
- [ ] **Step 2: Run** `$NODE node --test test/menu.test.js` — FAIL.
- [ ] **Step 3: Implement.** Route starts come from `#geometries` (`positionAt(0)`), cafés from the cached network (`network.cafes()`); routes not yet fetched don't match (fallback). In `#build` call `view.setStatues(statueRows(scene.gyms, PRESETS, override))`. In `main.js`, card `onSelect` saves nothing yet but calls `app.menu.showWorkout(plan, null)`; `onFigure` calls `showWorkout(plan, index)`; Escape on the workout tab clears the figure. After the ride's `View3D` is created, `setStatues(statueRows(gyms, PRESETS, fallbackOverride))`.
- [ ] **Step 4: Run** `$NODE node --test test/menu.test.js test/startMenu.test.js` — PASS.
- [ ] **Step 5: Commit** "Fly to the picked workout's gym and train there".

### Task 8: Glow of the next figure during rests

**Files:**
- Modify: `client/public/js/view/workoutStudioView.js` (add `highlightedFigure`), `client/public/js/main.js` (per-frame call during a workout)
- Test: `client/test/workoutStudioView.test.js`

**Interfaces:**
- Consumes: `planPositionAt`, `View3D.setStatueGlow`, the gym's row figures.
- Produces: `highlightedFigure(position, figures: string[]): number | null`.

- [ ] **Step 1: Write failing tests:** with `withGetReady(fullBody)`: at 0 s (get-ready) → `0` (squats); at 30 s (first exercise) → `null`; in the first rest (75 s) → `1` (sit-ups); finished → `null`; in a rest whose next exercise is not in `figures` → `null`; after `session.skip()` from a rest into an exercise (via the position the session reports) → `null`.
- [ ] **Step 2: Run** `$NODE node --test test/workoutStudioView.test.js` — FAIL.
- [ ] **Step 3: Implement** the function; in `main.js`'s frame where the workout HUD is drawn, call `app.view3d.setStatueGlow(gym, highlightedFigure(position, rowFigures))` (store `rowFigures` when setting statues); clear with `setStatueGlow(null, null)` on end.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** "Light the next figure's statue during rests".

### Task 9: Docs, changelog and UI check

**Files:**
- Modify: `docs/workouts.md`, `CHANGELOG.md`
- Create: `docs/adr/0019-workout-venues-as-client-data.md`

- [ ] **Step 1: Write docs.** `workouts.md`: replace "always runs at the start café of the default route" with the venues table (café, category, material, presets) and the fallback; new sections "Statues" and "Picking a workout" (cards, strip, figures, camera); HUD section gains the glow; "Not yet" gains server-side venues and Core's move to Forge Hut with yoga. ADR 0019: context (one gym, preview), decision (category per gym as client data, statues as a main-thread layer, local glow), alternatives (server venues, live posed riders, baked chunks), consequences (no protocol change; Beach is temporary for core). CHANGELOG `[Unreleased]` → Added: "Workouts at their own café gym with statues of their figures, workout cards with a block strip (#26)".
- [ ] **Step 2: Gate.** Run `make check` from the repo root. Expected: ESLint clean, all node tests pass, cargo tests pass.
- [ ] **Step 3: UI check.** `make dev` with all routes (`.env.dev`), then screenshots per AGENTS.md (Playwright image `v1.64.1-noble`, host network): workout tab with each card picked (valley, hill, beach gyms), a statue close-up via a chip, and the get-ready glow after **Start workout**. Look at each image; fix anything off (statues clipping scenery, row hidden by the café, glow invisible by day) before going on.
- [ ] **Step 4: Commit** "Document workout venues and statues".
- [ ] **Step 5: Push and open the PR** (`git push -u origin feat/workout-venues`; `gh pr create` with a short why, assignee RalfLeonFasler).
