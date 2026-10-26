# Pause a Ride Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rider can pause a ride (button, key, or auto-pause when stopped); the timer and ride file pause, and the rider pulls over onto the shoulder.

**Architecture:** The client decides when to pause (`ridePause.js`, a pure state machine) and tells the server `pause` / `resume`. The server sim parks the rider: brakes to 0, ignores power, moves onto the shoulder, out of drafting. The client keeps `parkedSince` per rider as the seam for a later animation system.

**Tech Stack:** Rust (sim + axum server, `cargo test`), vanilla ES modules (client, `node --test`, eslint).

**Spec:** `docs/superpowers/specs/2026-10-19-pause-ride-design.md`

## Global Constraints

- Protocol stays version 2: `pause`, `resume`, `riders[].parked`, `pause_rejected` are additive.
- `riders[].parked` is serialised only when true (`skip_serializing_if`).
- Thresholds (client, named constants at the top of `ridePause.js`): stop speed 0.28 m/s (1 km/h), 3 s to auto-pause, 10 s auto-paused → park, resume power 30 W for 2 s, leave after 30 min (1 800 s).
- Server defaults: `park_brake_mps2 = 3.0`, `park_lane_offset = 0.7`.
- No pause in races, events, vehicles or the spin studio.
- Auto-pause setting `autoPause`, default `false`.
- Checks run in Docker: Rust `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'`; client `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js"; npx eslint .'` (from the repo root).
- Commit messages: `Server: …` / `Client: …` / `Docs: …` with `(#89)`, ending with the `Co-Authored-By` line.

## Review Focus

1. Pausing while the server rider is gone (reconnecting, then a fresh rider after the grace period): the client must re-send `pause` once back, or drop to `riding` if the new rider can't park. Test in Task 4 (`reparkAfterReconnect`).
2. Entering a race countdown or event lobby while parked: the server unparks, the client must notice it is no longer `allowed` and resume the timer. Test in Task 3 (`allowed false forces riding`) and Task 1 (`join_race_unparks`).
3. Auto-pause while descending at 0 W: never pauses. Test in Task 3.
4. Pausing at a red-light-like stop for 2 s then riding on: no pause recorded (needs 3 s). Test in Task 3.
5. A parked rider on another client's screen at a junction / off-route road: lane past the edge must still render on the right side. Covered by lane semantics (`#onRoad` flips lanes for `dir < 0`); check in the Task 5 screenshot.

---

### Task 1: Sim — parked riders

**Files:**
- Modify: `server/crates/sim/src/world.rs` (`Rider`, `SimConfig`, `WorldError`, `tick`, `join_race`, `lock_turns`, `join_human_on`, tests module)

**Interfaces:**
- Produces: `Rider::parked: bool`; `World::park(&mut self, id: RiderId) -> Result<(), WorldError>`; `World::unpark(&mut self, id: RiderId) -> Result<(), WorldError>`; `WorldError::PauseRejected`; `SimConfig::park_brake_mps2: f64`, `SimConfig::park_lane_offset: f64`.

- [ ] **Step 1: Write failing tests** in the `tests` module of `world.rs`, using `world_with` and a route with a descent (build one like the existing grade tests do):
  - `a_parked_rider_brakes_to_a_stop_on_a_descent`: rider at 10 m/s on −8 %, `park`, tick 10 s at 0.25 s → `speed == 0.0`; tick 10 s more → still `0.0`, position unchanged.
  - `power_is_ignored_while_parked`: flat, `set_telemetry(300 W)` while parked, tick 5 s → `speed == 0.0`; `unpark`, tick 5 s → `speed > 1.0`.
  - `a_parked_rider_moves_onto_the_shoulder_and_back`: 3-lane route, after parking and ticking 3 s `lane == 2.7` (± 1e-9); `unpark`, tick 3 s → `lane == 2.0`.
  - `nobody_drafts_behind_a_parked_rider`: two humans in the same lane, the follower 2 m behind the parked one; follower's speed at 250 W after 5 s equals a solo rider's at 250 W (compare to a third rider alone on another world).
  - `park_is_rejected_in_a_race_an_event_and_a_vehicle`: `join_race` (during countdown) → `park` is `Err(PauseRejected)`; `lock_turns(id, true)` → `Err(PauseRejected)`; seated via `create_vehicle` → `Err(PauseRejected)`.
  - `joining_a_race_or_event_unparks`: parked, `join_race` → `!parked`; parked, `lock_turns(id, true)` → `!parked`.
- [ ] **Step 2: Run** the Rust check command → the new tests fail to compile (`park` not found).
- [ ] **Step 3: Implement.**
  - `Rider.parked` (init `false` in every constructor: `join_human_on`, bot spawn, `resume`/`place_at` paths that build riders).
  - `park`: `UnknownRider` if missing; `PauseRejected` if `is_entered(id)`, `rider.turns_locked`, or `seat_of.contains_key(&id)`; else `parked = true`. `unpark`: clears it (no-op if not parked).
  - `join_race` and `lock_turns(id, true)` set `parked = false`.
  - `tick`, non-seated loop: when parked, use `power_watts: 0.0` in `StepInput`, then `rider.speed = (rider.speed - park_brake_mps2 * dt).max(0.0)`; lane target is `f64::from(lanes - 1) + park_lane_offset` instead of `target_lane` (same `lane_step` clamp). `lanes` is the rider's route's `lanes()`.
  - Leave parked riders out of `slots` (the field used for drafting and lane gaps), but keep `own_slots` aligned with `self.riders` (the zip relies on it): filter only when building `slots`.
- [ ] **Step 4: Run** the Rust check command → all pass, clippy and fmt clean.
- [ ] **Step 5: Commit** `Server: parked riders in the sim (#89)`.

### Task 2: Server — `pause` / `resume` messages

**Files:**
- Modify: `server/crates/server/src/protocol.rs` (`ClientMessage`, `RiderState`, `rider_state`, parse tests)
- Modify: `server/crates/server/src/session.rs` (`PlayerCommand`, dispatch)
- Modify: `server/crates/server/src/connection.rs`, `runtime.rs` (`Command`, `Game` trait default no-op, dispatch)
- Modify: `server/crates/server/src/game.rs` (`GameCore::pause`)
- Test: `server/crates/server/tests/websocket_flow.rs`
- Modify: `docs/protocol.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `World::park`, `World::unpark`, `WorldError::PauseRejected`, `Rider::parked` (Task 1).
- Produces: wire messages `{"type":"pause"}`, `{"type":"resume"}`; `riders[].parked: true`; `error {code: "pause_rejected"}`.

- [ ] **Step 1: Write failing tests.**
  - `protocol.rs` parse test: `{"type":"pause"}` → `ClientMessage::Pause`, `{"type":"resume"}` → `ClientMessage::Resume`.
  - `protocol.rs` serialisation test: a `RiderState` with `parked: false` has no `parked` key; with `true`, `"parked":true`.
  - `websocket_flow.rs` `a_rider_pauses_and_resumes`: join, send `pause`, wait for a `state` where my rider has `parked == true`; send `resume`, wait for a `state` without `parked`.
  - `websocket_flow.rs` `pause_is_rejected_in_a_race`: join, `start_race {laps:1}`, `pause` → `error` with `code == "pause_rejected"`.
- [ ] **Step 2: Run** the Rust check command → fail.
- [ ] **Step 3: Implement.**
  - `ClientMessage::Pause`, `ClientMessage::Resume` (serde tags `pause`, `resume`); `PlayerCommand::Pause { on: bool }`; `Command::Pause { rider_id, on }`.
  - `Game` trait: `fn pause(&mut self, _rider_id: RiderId, _on: bool) {}` (default no-op, so the studio ignores it); `GameCore` implements it: `on` → `world.park`, else `world.unpark`; `Err(PauseRejected)` → deliver `ServerMessage::error("pause_rejected", …)`; other errors ignored.
  - `RiderState.parked: bool` with `#[serde(skip_serializing_if = "std::ops::Not::not")]`, filled from `r.parked`.
  - `docs/protocol.md`: rows for `pause` / `resume` in the client table, `parked` in the `riders[]` entry list, `pause_rejected` in the error codes, and a Compatibility line "Pausing (#89) added `pause`, `resume`, `riders[].parked` and `pause_rejected` within version 2."
  - `CHANGELOG.md` under Unreleased/Added: a **Pause** entry (button and Space, optional auto-pause, pulls over onto the shoulder, timer and ride files pause, back to the menu after 30 min with *Continue*; not in races, events, vehicles or the studio).
- [ ] **Step 4: Run** the Rust check command → pass.
- [ ] **Step 5: Commit** `Server: pause and resume messages (#89)`.

### Task 3: Client — pause state machine

**Files:**
- Create: `client/public/js/ride/ridePause.js`
- Test: `client/test/ridePause.test.js`

**Interfaces:**
- Produces:
  ```js
  export const PAUSE = { stopSpeed: 0.28, stopS: 3, parkAfterS: 10, resumeW: 30, resumeS: 2, leaveAfterS: 1800 };
  export class RidePause {
    constructor({ autoPause = false } = {})
    autoPause;            // boolean, settable
    allowed;              // boolean, settable; default true
    state;                // "riding" | "stopped" | "parked"
    pausedAt;             // seconds (the `now` passed in) when the timer stopped, or null
    update({ now, speed, power, offline }): Action[]
    toggle(now): Action[]
    rejected(now): Action[]   // server said pause_rejected
  }
  // Action = "pauseTimer" | "resumeTimer" | "park" | "unpark" | "leave"
  ```
  `now` is in seconds. Actions are returned in the order to perform them.

- [ ] **Step 1: Write failing tests** (`node:test`, `assert/strict`), driving `update` every 0.25 s:
  - `toggle while riding parks and stops the timer` → `["pauseTimer", "park"]`, state `parked`.
  - `toggle while parked resumes` → `["resumeTimer", "unpark"]`, state `riding`.
  - `auto-pause after 3 s under 1 km/h`: autoPause on, speed 0.1 → no action at 2.75 s, `["pauseTimer"]` at 3 s, state `stopped`.
  - `a 2 s stop is no pause`: speed 0.1 for 2 s then 5 m/s → no actions at all.
  - `auto-pause is off by default`: speed 0 for 60 s → no actions.
  - `riding off from stopped resumes`: from `stopped`, speed 0.5 → `["resumeTimer"]`.
  - `stopped parks after 10 s` → `["park"]` at 10 s after the timer stopped, state `parked`.
  - `a descent at 0 W never auto-pauses`: speed 12, power 0 for 120 s → no actions.
  - `pedalling resumes a parked ride after 2 s at 30 W`: 29 W for 5 s → nothing; 30 W → `["resumeTimer", "unpark"]` after 2 s.
  - `leave after 30 min paused`: parked, `update` at `pausedAt + 1800` → `["leave"]` (once).
  - `offline freezes`: auto on, speed 0, `offline: true` for 30 s → no actions.
  - `allowed false forces riding`: parked, set `allowed = false`, `update` → `["resumeTimer", "unpark"]`; `toggle` while not allowed → `[]`; auto-pause doesn't fire while not allowed.
  - `rejected drops back to riding`: after `toggle` → `rejected(now)` → `["resumeTimer"]`, state `riding`.
- [ ] **Step 2: Run** the client check command → fail (module missing).
- [ ] **Step 3: Implement** `RidePause` per the spec's transition table. Keep timers as "since" timestamps (`#slowSince`, `#pedalSince`), reset when the condition breaks. File header comment in the style of the other `ride/` modules (what it does, that it is pure, link #89).
- [ ] **Step 4: Run** the client check command → pass.
- [ ] **Step 5: Commit** `Client: pause state machine (#89)`.

### Task 4: Client — pause in the ride

**Files:**
- Modify: `client/public/js/net/protocol.js` (`ClientMessages.pause`, `.resume`), `client/public/js/net/connection.js` (`pause()`, `resume()`)
- Modify: `client/public/js/input/keyboard.js` (`Space: "togglePause"`; `actionForKey` returns null for Space when the target is a `BUTTON`)
- Modify: `client/public/js/profile/profileStore.js` (`autoPause: false` in defaults, boolean in `validateProfile`)
- Modify: `client/public/index.html` (pause button in `.hud-actions` before `#take-photo`; `#pause-pill` status element near `#reconnecting`; *Auto-pause* checkbox below *Splits*)
- Modify: CSS file holding `.photo-button` / `.reconnecting` (pill style like `.reconnecting`)
- Modify: `client/public/js/main.js`
- Modify: the client rider smoother/state path (`wireConnection` `on("state")`) to stamp `parkedSince`
- Test: `client/test/net.test.js`, `client/test/ui.test.js` (or the test that covers `KEY_BINDINGS`), `client/test/units.test.js` / profile store test, `client/test/recorder.test.js`

**Interfaces:**
- Consumes: `RidePause`, `PAUSE` (Task 3); server messages (Task 2).
- Produces: `app.pause: RidePause | null`; rider objects passed to `view3d.render` carry `parked: boolean` and `parkedSince: number | null` (seconds, `now()` clock) — the animation seam.

- [ ] **Step 1: Write failing tests.**
  - `net.test.js`: `ClientMessages.pause()` → `{type: "pause"}`, `.resume()` → `{type: "resume"}`.
  - keyboard: `actionForKey({code: "Space", target: {tagName: "DIV"}})` → `"togglePause"`; with `tagName: "BUTTON"` → `null`.
  - profile: `validateProfile({...valid, autoPause: true})` has no errors; defaults have `autoPause === false`.
  - `recorder.test.js` `a paused stretch leaves one pause and no samples inside`: add samples 0–10 s, `pause(T0+10.5 s)`, no adds, `resume(T0+40 s)`, add 41–50 s → `pauses.length === 1`, `segments().length === 2`, FIT timer time ≈ 20 s.
- [ ] **Step 2: Run** the client check command → fail.
- [ ] **Step 3: Implement the plumbing** (protocol, connection, keyboard, profile store, HTML, CSS). Profile form: read/write `#auto-pause` next to where `#split-mode` is set (`main.js` ~296) and read (~898).
- [ ] **Step 4: Wire it in `main.js`.**
  - Ride start (`startRide`): `app.pause = new RidePause({ autoPause: app.profile.autoPause })`; `endRide` sets it to null.
  - `frame()` (each HUD tick): before `recorder.add`, set `app.pause.allowed = !app.studio && !app.vehicleId && !app.eventRide && (me?.lap ?? null) === null && !app.state?.race?.entered` (use whatever race-entry flag the client already uses for the race button), then run `app.pause.update({ now: t, speed: me?.speed ?? 0, power: power || 0, offline: app.offline })` and perform the actions via `performPause(actions, t)`.
  - `performPause`: `pauseTimer` → `app.recorder.pause(Date.now())`, hold the workout clock (`app.training.player.paused = true` and skip the cadence-based unpause in `trainingControl.js` while `app.pause.state !== "riding"`); `resumeTimer` → `app.recorder.resume(Date.now())`, `app.rideStartedAt += t - pausedAt`; `park` / `unpark` → `app.connection.pause()` / `.resume()`; `leave` → `endRide()` then show the start menu the same way `leaveRide` does, **without** `app.autosave.clear()` (so *Continue* is offered); notify "Paused for 30 min: your ride is kept, Continue from the menu."
  - Skip `app.recorder.add` while `app.pause.state !== "riding"`; freeze the HUD `time` and `avg-speed` at `pausedAt`.
  - Button `#pause-ride` and action `togglePause` → `performPause(app.pause.toggle(now()), now())`; button hidden when `!app.pause.allowed`, label *Pause* / *Resume*.
  - Pill `#pause-pill`: hidden while riding; "Paused · m:ss · pedal to resume" when parked, "Paused · m:ss" when stopped.
  - `on("error")`: `pause_rejected` → `performPause(app.pause.rejected(now()), now())`, notify "You can't pause in a race, event or vehicle."
  - `reconnected`: if `app.pause.state === "parked"`, send `connection.pause()` again (both same and fresh rider).
  - `on("state")`: keep `app.parkedSince = new Map()`; for each rider with `parked`, set the first-seen `now()`; delete ids without `parked`; attach `parkedSince` to rider objects handed to `view3d.render` (via the smoother sample or a lookup in `frame()`).
- [ ] **Step 5: Run** the client check command → pass.
- [ ] **Step 6: Commit** `Client: pause button, auto-pause and the ride timer (#89)`.

### Task 5: Check it in the browser and open the PR

**Files:** none (screenshots go to the scratchpad).

- [ ] **Step 1:** Run the server and Playwright per the `ui-check-with-playwright-docker` memory recipe. Script: start a ride with the simulated trainer, wait 3 s, click `#pause-ride`, wait 4 s, screenshot (rider on the shoulder, pill shown); press Space, wait 3 s, screenshot (back in the lane).
- [ ] **Step 2:** Publish the screenshots as an Artifact page and check: rider right of the rightmost lane, pill text, button label.
- [ ] **Step 3:** File the follow-up issue with the write-issue skill: "Rider animation system: off-bike poses and clips (pause, circuit training)", linking #89 and #77, naming the seam (`parked`, `parkedSince`) and the mesh split it needs (bike-only mesh, torso, separate arms, bottle).
- [ ] **Step 4:** Push `feat/pause-ride` and open the PR (`--assignee RalfLeonFasler`, body: summary, `Closes #89`, test commands run, screenshot link, follow-up issue). Don't merge.
