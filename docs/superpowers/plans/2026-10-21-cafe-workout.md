# Café workout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bodyweight workout without a bike: pick the Workout card, pick a preset, do a timed circuit at the outdoor gym next to the start café while the avatar does the exercise, visible to everyone.

**Architecture:** The client runs the plan (pure modules under `client/public/js/workout/`) and tells the server only the current exercise. The server keeps a `workout` rider permanently parked at the route start (a sim flag on top of the #89 park), refuses riding messages with `in_workout`, and echoes `riders[].exercise`. The 3D view splits the rider mesh, adds a keyframe clip player, builds an outdoor gym at each café and poses workout riders on its mat.

**Tech Stack:** Rust (sim + server crates, serde, tokio), plain ES modules, `node --test`, own WebGL renderer.

**Spec:** `docs/superpowers/specs/2026-10-21-cafe-workout-design.md`

## Global Constraints

- Protocol stays version 2; every change is additive (`docs/protocol.md` gets a version-history line "Workouts (#77) added …").
- Exercise ids, exactly: `squats`, `situps`, `pushups`, `jumping_jacks`, `plank`, `burpees`. Display names: Squats, Sit-ups, Push-ups, Jumping jacks, Plank, Burpees.
- Plan limits: 1–200 blocks, each 1–600 s, at most 2 h total; `kind` is `exercise` or `rest`.
- Get-ready: a 30 s `rest` block labelled "Get ready", added by `withGetReady`, never stored in presets.
- New error codes: `in_workout`, `not_in_workout`, `unknown_exercise`. A workout join to the spin studio gets `unknown_route`.
- `sim` crate stays pure: no I/O, async or third-party deps; it knows a "workout rider" flag, never exercise ids.
- Client tests are plain node with injected clocks/fakes, no browser, no sleeps; one reason to fail per test (CONTRIBUTING.md).
- Commit messages imperative, prefixed like the repo (`Client: …`, `Server: …`, `Docs: …`), ending with `(#77)` and the `Co-Authored-By` line.
- Commands (Docker, per this repo's practice; the host has no node):
  - `NODE_T` = `docker run --rm -v "$PWD":/app -w /app/client node:22 node --test "test/**/*.test.js"`
  - `NODE_LINT` = `docker run --rm -v "$PWD":/app -w /app/client node:22 npx eslint .`
  - `RUST_T` = `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'`
  - Single client file: replace the glob with the file, e.g. `node --test test/workoutPlan.test.js`.

## Review Focus

1. **Reconnect mid-workout**: after a dropped connection and a resume (same or fresh rider), the avatar must be parked at the café again and show the current exercise — the client re-sends `workout`, and a fresh rider is re-flagged as a workout rider (Task 3 test `a_reattached_workout_rider_keeps_its_flag_and_exercise`; Task 7 manual check with the server restarted mid-workout).
2. **A workout rider is never pulled into riding** by a race countdown started by someone else on the same route, an event lobby, or a vehicle code in its join — `start_race` by another rider must not enter or unpark it (Task 2 test).
3. **Pause straddling a block boundary**: pausing at 0.2 s left and resuming must not skip the next block or send its exercise twice (Task 5 test).
4. **Tab closed or End pressed during get-ready**: no history record when no exercise block was done; a record when at least one was (Task 5 test).
5. **More than 8 workout riders at one gym**, and riders leaving: spots stay deterministic by id, overflow stands beside the mat, and nobody jumps spots unless someone with a lower id leaves (Task 10 test).

---

### Task 1: Plan model and presets

**Files:**
- Create: `client/public/js/workout/plan.js`, `client/public/js/workout/presets.js`
- Test: `client/test/workoutPlan.test.js`

**Interfaces:**
- Produces:
  - `EXERCISES: Readonly<Record<string, {name: string}>>` (the six ids → display names)
  - `createPlan({id, name, description?, blocks}) → Plan` (throws `Error` with a readable message); `Plan = {id, name, description, blocks: Block[]}`, `Block = {kind: "exercise"|"rest", exercise?: string, seconds: number, label: string}` (`label` = display name, `"Rest"`, or `"Get ready"`)
  - `withGetReady(plan) → Plan` (new plan, 30 s rest "Get ready" first)
  - `planDuration(plan) → number` (seconds)
  - `planPositionAt(plan, elapsedS) → {finished, index, block, blockRemainingS, next, elapsedS, remainingS}` (`block`/`next` null when absent)
  - `planSummary(plan) → string` e.g. `"Squats 40 s · Rest 20 s · …"` (first 6 blocks, then `"…"`)
  - `PRESETS: Plan[]` with ids `full-body`, `core`, `tabata`

- [ ] **Step 1: Write the failing tests**

```js
test("a plan keeps its blocks and labels them", () => {
  const plan = createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "situps", seconds: 40 }, { kind: "rest", seconds: 20 }] });
  assert.deepEqual(plan.blocks.map((b) => b.label), ["Sit-ups", "Rest"]);
});
test("a plan refuses unknown exercises, empty and too long plans", () => {
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: [] }), /at least one block/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "pullups", seconds: 30 }] }), /Block 1/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: [{ kind: "rest", seconds: 601 }] }), /Block 1/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: Array(13).fill({ kind: "rest", seconds: 600 }) }), /2 hours/);
  assert.throws(() => createPlan({ id: "p", name: "P", blocks: Array(201).fill({ kind: "rest", seconds: 1 }) }), /200/);
});
test("get ready adds 30 s in front", () => {
  const plan = withGetReady(createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 }] }));
  assert.deepEqual([plan.blocks[0].label, plan.blocks[0].seconds, planDuration(plan)], ["Get ready", 30, 70]);
});
test("the position names the block, what is left and what comes next", () => {
  const plan = createPlan({ id: "p", name: "P", blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 }, { kind: "rest", seconds: 20 }] });
  const at = planPositionAt(plan, 35);
  assert.deepEqual([at.index, at.blockRemainingS, at.next.label, at.remainingS, at.finished], [0, 5, "Rest", 25, false]);
  assert.equal(planPositionAt(plan, 60).finished, true);
});
test("presets validate and last as long as they say", () => {
  const minutes = Object.fromEntries(PRESETS.map((p) => [p.id, planDuration(p) / 60]));
  assert.equal(minutes["full-body"], 12);
  assert.equal(minutes.tabata, 4);
  assert.ok(minutes.core >= 7 && minutes.core <= 9);
});
test("the summary lists the first blocks", () => {
  assert.match(planSummary(PRESETS.find((p) => p.id === "tabata")), /^Squats 20 s · Rest 10 s · Burpees 20 s/);
});
```

- [ ] **Step 2: Run** `NODE_T` with `test/workoutPlan.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `plan.js` (validation in the style of `createWorkout` in `ride/workout.js`) and `presets.js`: `full-body` = 2 rounds of the six exercises, each 40 s on + 20 s rest (12 min); `tabata` = 8 × (20 s on, 10 s rest) alternating squats/burpees, starting with squats; `core` = 2 rounds of sit-ups 45 s, rest 15 s, plank 60 s, rest 30 s, push-ups 40 s, rest 50 s (8 min). Presets are built with `createPlan` at module load.
- [ ] **Step 4: Run** `NODE_T` — expect PASS.
- [ ] **Step 5: Commit** `Client: workout plan model and presets (#77)`

---

### Task 2: Sim — a workout rider that stays parked

**Files:**
- Modify: `server/crates/sim/src/world.rs` (`Rider`, `park`/`unpark`, `count_on`, `start_race`, `join_race`, `lock_turns`)

**Interfaces:**
- Produces:
  - `Rider.workout: bool` (pub, default false)
  - `World::start_workout(&mut self, id: RiderId) -> Result<(), WorldError>`: sets `workout = true` and parks the rider (same lane target as `park`); `Err(PauseRejected)` if the rider is entered or seated
  - `unpark` is a no-op for a workout rider; `count_on` leaves workout riders out of `humans`; `start_race(.., Some(starter))`, `join_race` and `lock_turns(true)` never clear `parked` of a workout rider, and `join_race` returns `Err(WorldError::InEvent)` for one

- [ ] **Step 1: Write the failing tests** (in `world.rs` tests, next to the #89 park tests)

```rust
#[test]
fn a_workout_rider_is_parked_and_stays_parked() {
    // join a human, start_workout, unpark, tick 5 s with 300 W telemetry
    // assert parked, speed == 0.0, position unchanged
}
#[test]
fn workout_riders_are_not_counted_as_humans() {
    // two humans on route 0, one start_workout → count_on(0).0 == 1
}
#[test]
fn a_race_started_by_another_rider_leaves_a_workout_rider_alone() {
    // anna workout, ben start_race(1, Some(ben)) → anna not entered, still parked;
    // join_race(anna) during countdown → Err(InEvent), still parked
}
```

- [ ] **Step 2: Run** `RUST_T` — expect FAIL (no `start_workout`).
- [ ] **Step 3: Implement** the flag and the guards listed under Interfaces.
- [ ] **Step 4: Run** `RUST_T` — expect PASS.
- [ ] **Step 5: Commit** `Sim: workout riders stay parked and are not counted as humans (#77)`

---

### Task 3: Server — `workout` device, message and `riders[].exercise`

**Files:**
- Modify: `server/crates/server/src/protocol.rs`, `session.rs`, `runtime.rs`, `connection.rs`, `game.rs`, `stats.rs`, `http.rs` (only if the `match` needs an arm), `studio.rs` (only for the changed `state_message` callback if it calls it)
- Test: unit tests in those files; e2e in `server/crates/server/tests/websocket_flow.rs`
- Docs: `docs/protocol.md`

**Interfaces:**
- Consumes: `World::start_workout`, `Rider.workout` (Task 2)
- Produces:
  - `DeviceKind::Workout` (`"workout"`); `stats.rs` counts no distance for it; seats: the trainer pool
  - `pub enum Exercise { Squats, Situps, Pushups, JumpingJacks, Plank, Burpees }`, serde `snake_case`, `Exercise::from_id(&str) -> Option<Exercise>`
  - `ClientMessage::Workout { #[serde(default)] exercise: Option<String> }`
  - `PlayerCommand::Workout { exercise: Option<Exercise> }`, `Command::Workout { rider_id, exercise }`, `GameHandle` trait `fn workout(&mut self, _rider_id: RiderId, _exercise: Option<Exercise>) {}`
  - `RiderState.exercise: Option<Exercise>` with `skip_serializing_if = "Option::is_none"`
  - `state_message(.., tags_of: &dyn Fn(RiderId) -> RiderTags)` replacing `device_of`, with `pub struct RiderTags { pub device: DeviceKind, pub exercise: Option<Exercise> }` (all call sites updated)
  - `GameCore::set_device(id, Workout)` calls `world.start_workout(id)`; `GameCore::workout(id, exercise)` stores it on `Client.exercise` or replies `not_in_workout`
  - `GameCore` replies `in_workout` ("you are doing a workout") instead of acting, for a workout rider, in `input`, `start_race`, `join_race`, `join_event`, `turn`, `create_vehicle`, `board_vehicle`, `pause`; `telemetry` is ignored silently
- Session rules for `join` with `device: "workout"`: `route_id == Some(STUDIO_ID)` → `unknown_route` error; `vehicle_code` and `resume` are dropped (set to `None`). `workout` with an unknown id → `unknown_exercise` reply (no forward).

- [ ] **Step 1: Write the failing tests**
  - `session.rs`: `a_workout_join_drops_vehicle_codes_and_resume_points` (join with `"device":"workout","vehicle_code":"ABC","resume":{…}` → `Action::Join` with both `None`); `a_workout_join_to_the_studio_is_refused` (→ error `unknown_route`); `an_unknown_exercise_is_refused` (`{"type":"workout","exercise":"pullups"}` → `unknown_exercise`); `a_known_exercise_and_null_are_forwarded`.
  - `game.rs`: `a_workout_rider_spawns_parked`; `riding_messages_get_in_workout` (each listed message → exactly one `Error{code:"in_workout"}`); `workout_from_a_rider_gets_not_in_workout`; `the_exercise_shows_in_riders` (JSON contains `"exercise":"burpees"`, then after `workout(None)` no `"exercise"`); `a_workout_rider_is_not_in_route_riders_humans`; `a_reattached_workout_rider_keeps_its_flag_and_exercise` (use `game_with_grace`: detach, reattach with the token → still parked, device `Workout`, exercise kept).
  - `protocol.rs`: `the_workout_device_and_exercises_parse` (round trip of all six ids).
  - `tests/websocket_flow.rs`: `a_workout_is_seen_by_other_riders` — client A joins with `"device":"workout"`, sends `{"type":"workout","exercise":"squats"}`; client B joins normally; within a few `state` frames B sees A with `"parked":true`, `"device":"workout"`, `"exercise":"squats"`. Use the existing `start_server`, `connect`, `hello`, `send`, `expect_type` helpers; loop over `state` frames with a frame cap, not a sleep.
- [ ] **Step 2: Run** `RUST_T` — expect FAIL (compile errors on the new names).
- [ ] **Step 3: Implement** the Interfaces. In `connection.rs` the existing `SetDevice` after a successful join carries `Workout` (it is not a trainer), which parks the rider; on `reattach` the rider is still flagged. Map `PlayerCommand::Workout` in `to_command`.
- [ ] **Step 4: Update `docs/protocol.md`**: `join.device` gains `workout`; new `workout` row in Client → server ("the exercise being done now, or `null` for rest; only for a `workout` rider"); `riders[]` gains `exercise`; the three error codes; the version-history line.
- [ ] **Step 5: Run** `RUST_T` — expect PASS.
- [ ] **Step 6: Commit** `Server: workout riders, the workout message and riders[].exercise (#77)`

---

### Task 4: Client protocol and connection

**Files:**
- Modify: `client/public/js/net/protocol.js`, `client/public/js/net/connection.js`
- Test: `client/test/net.test.js`

**Interfaces:**
- Produces: `ClientMessages.workout(exercise) → {type: "workout", exercise: exercise ?? null}`; `GameConnection#workout(exercise)`; `ClientMessages.join` passes `device: "workout"` through (it already passes any non-trainer device — add the test only).

- [ ] **Step 1: Write the failing tests**: `workout messages carry the exercise or null` (`ClientMessages.workout("plank")` → `{type:"workout",exercise:"plank"}`, `ClientMessages.workout()` → `exercise: null`); `a workout join sends the workout device` (`ClientMessages.join({name:"A",weightKg:70,device:"workout"}).device === "workout"`).
- [ ] **Step 2: Run** `NODE_T` (`test/net.test.js`) — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `Client: the workout message (#77)`

---

### Task 5: Workout session state machine and history record

**Files:**
- Create: `client/public/js/workout/workoutSession.js`
- Test: `client/test/workoutSession.test.js`

**Interfaces:**
- Consumes: `withGetReady`, `planPositionAt`, `planDuration` (Task 1)
- Produces:
  - `new WorkoutSession({plan, now})` — `plan` without get-ready (the session adds it); `now: () => seconds`
  - `state: "ready"|"block"|"paused"|"done"`, `position()` (a `planPositionAt` result on the get-ready plan), `currentExercise() → string|null`
  - `tick() → Action[]`, `pause() → Action[]`, `resume() → Action[]`, `skip() → Action[]`, `end() → Action[]`, where `Action` is `["send", exercise|null]`, `["cue"]` or `["finished"]`
  - `heartRate(bpm)` — records a sample (ignored when not finite)
  - `record() → object|null` — `{version: 2, kind: "workout", id, planId, planName, startedAt, endedAt, durationS, activeS, blocksDone, blocksSkipped, hr: {avg, max}|null, measured: false}`, `blocksDone` = exercise blocks completed, `blocksSkipped` = exercise blocks skipped (rest blocks count in neither); `null` when `blocksDone === 0`. `startedAt`/`endedAt` in ms (`now()*1000`), `id = String(startedAt)`, `activeS` = seconds spent in exercise blocks (not paused).

- [ ] **Step 1: Write the failing tests** (fake clock `let t = 0; const now = () => t;`)

```js
test("starts with get ready and sends rest");                 // first tick → [["send", null]], state "ready"
test("sends each exercise once when its block starts");       // t=30 tick → ["send","squats"]; t=31 tick → no send
test("cues each of the last three seconds of a block");       // ticks at blockRemaining 3,2,1 → one ["cue"] each, none at 4
test("pause freezes the clock and sends rest");               // pause() → [["send",null]]; t += 100; position unchanged
test("resume re-sends the block's exercise");                 // resume() → [["send","squats"]]
test("a pause at a block's end neither skips nor repeats the next block"); // Review Focus 3
test("skip ends the block and counts it as skipped");
test("the end of the plan finishes once");                    // ["finished"] exactly once, state "done"
test("end during get ready leaves no record");                 // Review Focus 4
test("a finished workout makes a history record");            // deepEqual on the record fields, hr {avg,max} from heartRate()
test("a record without heart rate has hr null");
```

- [ ] **Step 2: Run** `NODE_T` (`test/workoutSession.test.js`) — expect FAIL.
- [ ] **Step 3: Implement.** Pattern after `ride/ftpTestSession.js` (clock injected, actions returned, `main.js` executes them). Track elapsed plan time as `sum of unpaused intervals`; send only when `currentExercise()` differs from the last sent value.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `Client: workout session and its history record (#77)`

---

### Task 6: Start menu — Workout card, preset picker, join without a trainer

**Files:**
- Modify: `client/public/js/view/startMenu.js`, `client/public/index.html` (profile form), `client/public/styles.css`, `client/public/js/main.js` (`renderStartMenu`, `joinRide` dispatch, new `joinWorkout`)
- Test: `client/test/startMenu.test.js`

**Interfaces:**
- Consumes: `PRESETS`, `planSummary`, `planDuration` (Task 1); `connection.workout` (Task 4)
- Produces:
  - `routesOf(info)` appends `{id: "workout", kind: "workout", name: "Workout"}` after the studio when the server reports at least one route
  - `WORKOUT_TAGLINE = "Bodyweight circuit at the café's outdoor gym. No bike needed."`; `renderRoutes` shows the tag "Workout" and that description for `kind === "workout"`, and the stats line `"3 workouts · 4–12 min"` from `workoutTagline(PRESETS)`
  - `workoutRoute(info) → string|null` — the id of the first real route (the world to join)
  - In `index.html`: the Devices fieldset gets `id="devices"`; a new `<fieldset id="workout-setup" hidden>` with `<select id="workout-preset">`, `<p id="workout-preset-summary" class="field-hint">`, `<label class="check"><input id="workout-cues" type="checkbox" checked> Beep in the last 3 seconds</label>` ; the heart-rate row stays where it is: every other row of `#devices` (and its explanatory notes) gets class `trainer-only`, and `#profile-form.workout .trainer-only { display: none }` leaves only the heart-rate row visible in workout mode
  - `main.js`: with the workout card picked, `#profile-form` gets class `workout`, `#workout-setup` is shown, the join button reads `Start workout`; `joinRide()` calls `joinWorkout()` for `kind === "workout"` before its trainer checks; `joinWorkout()` loads the route file of `workoutRoute(app.info)`, joins with `device: "workout"`, sets `app.workout = new WorkoutSession(...)`, `app.ride = {…}`, and starts the ride view without `RideSession` (Task 7 fills the HUD). Profile gains `workoutPreset` and `workoutCues` (saved with `profiles.save`).

- [ ] **Step 1: Write the failing tests**: `the workout card follows the routes and the studio` (`routesOf({routes, studio}).at(-1).kind === "workout"`; `routesOf({routes: []})` has no workout); `the workout joins the first route` (`workoutRoute({routes}) === "rolling-hills"`, `workoutRoute(null) === null`); `the workout tagline counts presets and their lengths` (`workoutTagline(PRESETS) === "3 workouts · 4–12 min"`).
- [ ] **Step 2: Run** `NODE_T` (`test/startMenu.test.js`) — expect FAIL.
- [ ] **Step 3: Implement** `startMenu.js` helpers and the HTML/CSS/`main.js` wiring.
- [ ] **Step 4: Run** `NODE_T` and `NODE_LINT` — expect PASS.
- [ ] **Step 5: Commit** `Client: Workout card and preset picker on the start screen (#77)`

---

### Task 7: Workout HUD, pause / skip / end, cues, summary, reconnect — usable

**Files:**
- Create: `client/public/js/view/workoutStudioView.js`, `client/public/js/workout/cue.js`
- Modify: `client/public/index.html` (`#workout-hud`, `#workout-summary` inside `#ride`), `client/public/styles.css` (`body.working-out` hides the ride HUD panels, shows `#workout-hud`), `client/public/js/main.js` (`startWorkout`, `workoutFrame`, `endRide`, `rejoin`, `reconnected`, error handler)
- Test: `client/test/workoutStudioView.test.js`

**Interfaces:**
- Consumes: `WorkoutSession` (Task 5), `connection.workout` (Task 4), `RideHistory.save(record)`
- Produces:
  - `workoutHudText(position, {state, heartRate}) → {exercise, time, next, block, elapsed, remaining, hr}` — pure: `exercise` is the block label (`"Rest"` shows as `"Rest"`), `time` `"0:35"`, `next` `"Next: Burpees 40 s"` or `"Last block"`, `block` `"Block 5/25"` (counting the get-ready block), `hr` `"142 bpm"` or `""`; paused: `exercise` `"Paused"`
  - `summaryText(record, plan) → {title, worked, blocks, hr}` e.g. `worked: "11:20 of 12:00"`, `blocks: "23 done · 1 skipped"`, `hr: "Avg 138 · max 171 bpm"` or `""`
  - `class WorkoutStudioView { constructor(root); render(text); dispose() }` — writes the text into `#workout-hud` elements; the ring is a CSS `conic-gradient` driven by a `--progress` custom property
  - `createCue({audioContext, vibrate}) → () => void` — a 60 ms 880 Hz beep plus `vibrate(30)`; both injected, missing ones skipped
  - `main.js`: `workoutFrame()` ticks the session every frame, executes actions (`send` → `app.connection.workout(x)`, `cue` → cue if `profile.workoutCues`, `finished` → `finishWorkout()`), renders the HUD, and renders the 3D world as `frame()` does (my rider still drawn parked on its bike here); buttons Pause/Resume, Skip block, End workout; `finishWorkout()` saves `app.workout.record()` when not null and shows `#workout-summary` with **Back to menu** (→ `endRide()` + `openStartMenu()`); `rejoin` sends `device: "workout"` when `app.workout`; `reconnected` calls `connection.workout(app.workout.currentExercise())` when `app.workout`; HR samples from `app.heartRateMonitor.on("data")` go to `app.workout.heartRate`
  - `beforeunload` while a workout runs saves `app.workout.record()` if not null

- [ ] **Step 1: Write the failing tests** for `workoutHudText` (exercise block, rest block with next, last block, paused, hr shown/hidden) and `summaryText` (with and without hr, skipped count), and `createCue` (calls the injected oscillator start once and `vibrate(30)`; works with neither).
- [ ] **Step 2: Run** `NODE_T` (`test/workoutStudioView.test.js`) — expect FAIL.
- [ ] **Step 3: Implement** the view, the cue and the `main.js` wiring.
- [ ] **Step 4: Run** `NODE_T`, `NODE_LINT` — expect PASS.
- [ ] **Step 5: Manual check**: `make dev`, then `make screenshot ARGS="--out ~/.cache/openradlr/screenshots/workout-menu.png"` with the card picked and one of the HUD (see AGENTS.md for the Playwright docker recipe). Start a Tabata, pause, resume, skip, end: summary shows.
- [ ] **Step 6: Commit** `Client: workout HUD, pause, skip, end and summary (#77)`

---

### Task 8: Split the rider mesh (refactor, riding pose unchanged)

**Files:**
- Modify: `client/public/js/view3d/riderModel.js`, `client/public/js/view3d/view3d.js`, `client/public/js/view3d/studioScene.js`
- Test: `client/test/riderModel.test.js` (new)

**Interfaces:**
- Produces:
  - `buildBike(look)`; `buildPelvis(look)`, `buildTorso(look)` (chest, shoulders, neck), `buildHead(look)` (head, helmet, visor), `buildUpperArm(look)`, `buildForearm(look)`; existing `buildThigh`, `buildShin`, `buildFoot` unchanged
  - `BODY_JOINTS`: the joint origins in the bike frame (pelvis at `RIDER_GEOMETRY.hip`, spine base, neck, shoulders at `[±0.18, 1.34, -0.28]`, elbows), and `RIDING_POSE` (spine, neck, shoulder and elbow angles that reproduce today's torso and arms)
  - `ridingBodyParts(look) → {mesh: string, model: Mat4}[]` — local transforms of the upper-body parts in the riding pose (legs stay on `legPose`)
  - `buildBikeAndBody` is removed; `view3d.js` and `studioScene.js` draw `bike` + `ridingBodyParts`
- Test: `the riding pose matches the old one-piece rider` — keep a copy of the old `buildBikeAndBody` in the test file as the reference; the union of `buildBike` and the posed upper-body parts has the same vertex count and every vertex within 1 mm of the reference (compare sorted vertex lists).

- [ ] **Step 1: Write the failing test.**
- [ ] **Step 2: Run** `NODE_T` (`test/riderModel.test.js`) — expect FAIL.
- [ ] **Step 3: Implement** the split; build each part in its own local frame (joint at the origin) so later poses rotate about the joint.
- [ ] **Step 4: Run** `NODE_T` — expect PASS (also `view3d.test.js`, `studio3d.test.js`).
- [ ] **Step 5: Screenshot** a ride before (on `main`) and after; they must look the same.
- [ ] **Step 6: Commit** `3D: split the rider into bike and body parts (#77, #90)`

---

### Task 9: Clip player and forward kinematics

**Files:**
- Create: `client/public/js/view3d/riderPose.js`
- Test: `client/test/riderPose.test.js`

**Interfaces:**
- Consumes: `BODY_JOINTS`, `RIDER_GEOMETRY`, part names (Task 8)
- Produces:
  - `JOINTS = ["spine","neck","shoulderL","shoulderLz","elbowL","shoulderR","shoulderRz","elbowR","hipL","hipLz","kneeL","ankleL","hipR","hipRz","kneeR","ankleR"]` — plain names rotate about the body's X axis (swing forward/back); the `…z` names rotate about Z (raise sideways, for jumping jacks)
  - Clip shape `{loopS: number, keys: [{t: number, root: {y: number, pitch: number}, joints: Partial<Record<Joint, number>>}]}` (missing joints = 0, angles in radians; `root.pitch` tips the whole body, e.g. π/2 lies it down for sit-ups and plank)
  - `poseAt(clip, t) → Pose` — loops `t % loopS`, smoothstep between neighbouring keys
  - `blend(a: Pose, b: Pose, w: number) → Pose`
  - `bodyTransforms(pose, look) → {mesh: string, model: Mat4}[]` — every body part (pelvis, torso, head, both arms, both legs incl. feet) in the standing frame: origin on the ground between the feet, forward −Z
  - `validClip(clip) → boolean` — known joints only, keys sorted, first key equals last key at `t = loopS`

- [ ] **Step 1: Write the failing tests**: `a pose between keys eases`; `a clip loops`; `blend at 0 and 1 gives either pose`; `the standing pose puts the head on top` (for the all-zero pose, the head part's origin is the highest of all parts and its y is between 1.55 and 1.8); `a bent knee moves the foot back`; `validClip refuses unknown joints and open loops`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `3D: rider clip player and forward kinematics (#77, #90)`

---

### Task 10: The outdoor gym at every café and its spots

**Files:**
- Modify: `client/public/js/view3d/features.js` (`buildOutdoorGym`), `client/public/js/view3d/world.js` (call it after each `buildBikeCafe`, return `gyms`), `client/public/js/view3d/worldWorker.js` (only if `gyms` must be passed through explicitly)
- Create: `client/public/js/workout/gymSpots.js`
- Test: `client/test/gymSpots.test.js`, `client/test/world3.test.js` (gym present)

**Interfaces:**
- Produces:
  - `buildOutdoorGym(route, terrain, {structures, occupancy, avoid}) → {center: [x,y,z], yaw: number, spots: {position: [x,y,z], yaw: number}[]} | null` — placed on the café side (`side = 1`), about 20 m further along the road than `CAFE_DISTANCE`, set back like the café; skipped (null) when `avoid(...)` says so or `occupancy` is taken; mat ≈ 8 × 5 m, pull-up bar, parallel bars, inclined bench, low beam, sign; 8 spots, 2 rows of 4, 1.8 m apart, facing the road
  - World result gains `gyms: {center, yaw, spots}[]`
  - `assignSpots(riderIds: number[], gym) → Map<number, {position, yaw}>` — ids sorted ascending take `gym.spots` in order; the 9th and later stand in a third row 1.8 m behind the mat (beside it, still deterministic)
  - `nearestGym(gyms, [x, z]) → gym | null` (within 120 m, else null)

- [ ] **Step 1: Write the failing tests**: `spots go by rider id`; `the ninth rider stands beside the mat` (Review Focus 5); `riders keep their spot when a higher id leaves`; `no gym nearby gives null`; in `world3.test.js`: `every café gets an outdoor gym` (the bundled world has `gyms.length >= 1` and each has 8 spots).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `NODE_T` — expect PASS.
- [ ] **Step 5: Screenshot** the café from the menu camera or a ride start: the gym is there, not in a tree or on the road.
- [ ] **Step 6: Commit** `3D: an outdoor gym at every café (#77)`

---

### Task 11: The clips, and workout riders on the mat

**Files:**
- Create: `client/public/js/view3d/clips.js`
- Modify: `client/public/js/view3d/view3d.js` (`render`, a gym camera), `client/public/js/view3d/chaseCamera.js` only if the camera interface needs it, `client/public/js/main.js` (`stampExercise`, camera switch in `startWorkout`)
- Test: `client/test/clips.test.js`, `client/test/view3d.test.js`

**Interfaces:**
- Consumes: `poseAt`, `blend`, `bodyTransforms`, `validClip` (Task 9); `gyms`, `assignSpots`, `nearestGym` (Task 10); `riders[].device`, `riders[].exercise`
- Produces:
  - `CLIPS: Record<"idle"|Exercise, Clip>` with loops: idle 4 s, squats 2.5 s, situps 2.5 s (lying on the back on the mat, knees bent, torso curls up), pushups 2 s, jumping_jacks 1 s, plank 4 s (forearm plank, breathing), burpees 3.5 s (squat, kick back to plank, push-up, jump)
  - `clipFor(exercise|null|undefined) → Clip` (`idle` for null/unknown)
  - Riders passed to `view3d.render` may carry `exerciseSince` (seconds, like `parkedSince`); `main.js` stamps it per rider id when `exercise` changes; my own rider gets the session's block start instead
  - In `render`: riders with `device === "workout"` are placed by `assignSpots` at `nearestGym(gyms, roadPosition)`; their bike is drawn at the gym's bike-rack point (`gym.center` offset 3 m towards the road) and their body by `bodyTransforms(blend(prev, poseAt(clipFor(exercise), timeS - exerciseSince), w))` with a 0.3 s crossfade on change; riders with no gym in range keep the parked-on-bike drawing
  - `View3D#workoutMode(gym)` — a fixed camera: eye 7 m from the mat centre on its road side, 2.2 m up, looking at the mat centre; `reduced motion` → set at once, else ease over 1.5 s from the chase camera
- [ ] **Step 1: Write the failing tests**: `every clip is valid and loops` (all `CLIPS` pass `validClip`, loop lengths as listed); `unknown exercises fall back to idle`; `sit-ups lie on the mat` (in `situps` at t = 0 the pelvis y < 0.25 m and the head y < 0.5 m); `a workout rider is drawn at its gym spot, not on the road` (view3d test with a stub renderer: the body part model's translation equals the assigned spot ± 1 cm).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the clips (hand-keyed angles) and the render path.
- [ ] **Step 4: Run** `NODE_T`, `NODE_LINT` — expect PASS.
- [ ] **Step 5: Screenshots**: one per clip mid-loop (squats, sit-ups, push-ups, jumping jacks, plank, burpees, idle) with the gym camera; and a second browser riding past the café sees the workout rider.
- [ ] **Step 6: Commit** `3D: exercise clips and workout riders at the café gym (#77, #90)`

---

### Task 12: Docs and the final check

**Files:**
- Create: `docs/adr/0015-workouts-as-parked-riders.md` (context, decision, consequences — the server knows only the current exercise; the plan is client data; studio and circuit modes reuse `riders[].exercise` and the clips)
- Create: `docs/workouts.md` (what a workout is, presets, exercise ids, where it runs, what is stored, what is not yet: Strava/FIT, studios, rep sets)
- Modify: `README.md` ("What's in the POC" list and the Documentation list), `CHANGELOG.md` (`[Unreleased]` → Added: "Café workouts: timed bodyweight circuits at the outdoor gym next to the start café, no bike needed (#77)"; "Outdoor gyms at cafés (#77)"; Changed: "The rider is drawn from separate bike and body parts (#90)")

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `make check` (or `NODE_T`, `NODE_LINT` and `RUST_T`) — expect everything green.
- [ ] **Step 3: Commit** `Docs: café workouts, ADR 0015 (#77)`
- [ ] **Step 4: Publish** the screenshots from Tasks 7, 10 and 11 on an Artifact page for the PR.
