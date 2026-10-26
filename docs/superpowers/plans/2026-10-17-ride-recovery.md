# Ride Recovery (Autosave, Continue, Reconnect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ride is never lost: short network drops resume the same rider (race, event, seat included), crashes offer Continue / Save / Discard from an IndexedDB autosave, long outages end in "Finish and save".

**Architecture:** The server stops removing riders when their socket dies. It detaches them (null sink, 0 W, they coast) and runs the existing `leave` only after `grace_s`. A per-attach `epoch` stops a dead connection from detaching a rider who has already reattached. Riders are found again by a random `resume_token` from `joined`, through a server-wide token → world registry. The client keeps the ride session running on `close`, reconnects with backoff, and autosaves the recorder (now with pauses) and photos to IndexedDB.

**Tech Stack:** Rust (`openradlr-server`, tokio/axum), plain ES modules client with `node --test`, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-10-17-ride-recovery-design.md`

## Global Constraints

- Branch `feat/ride-recovery`, one PR, one commit per task. Messages end with `(#73)` and the `Co-Authored-By` line.
- Rust checks only via Docker, repo root at `/w`:
  `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'`. Referred to as **RUST** (narrow with `cargo test -p openradlr-server <filter>` while iterating).
- Client checks only via Docker: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js"; npx eslint .'`. Referred to as **NODE**.
- `PROTOCOL_VERSION` stays 2: every wire change is additive.
- `grace_s` default **60**, env `OPENRADLR_GRACE_S`, finite and ≥ 0. `0` means detach = leave (today's behaviour). It lives in `GameSettings` (the game expires riders) and `ServerInfo` (for `welcome`). This is a small change from the spec, which put it in `ConnectionLimits`; the connection layer doesn't need it.
- Resume token: `strava::random_token()` (64 hex chars, `/dev/urandom`). Don't add a dependency. The spec said 32 chars; the length isn't part of the contract.
- Client reconnect: delays 1000, 2000, 4000, 8000 ms, then 15000 ms; give up 180000 ms after the drop; each attempt times out after 10000 ms.
- Autosave every 10000 ms and on `pagehide` / `visibilitychange` (hidden). Continue only if the autosave is under 12 h old (`AUTOSAVE_MAX_AGE_MS = 43200000`) and has the same server URL.
- Autosave runs only for exportable rides (`canExportRide(app.trainer)`: everything except phone paddles); photos ride along.
- Copy: `Reconnecting…`, `Connection lost.`, `Finish and save`, `Keep trying`, `Back on the road as a free rider`, ` · your race ended`, ` · your seat ended`, `Unfinished ride · {route} · {distance} · {age} ago`, `Continue`, `Save`, `Discard`.

## Review Focus

1. **Half-open socket.** The client reconnects before the server has noticed the old socket is dead. The reattach takes over the rider, and when the old connection finally ends, its `Detach`/`Leave` must **not** detach or remove the reattached rider. Test in Task 3 (`stale_epoch_detach_and_leave_are_ignored`).
2. **A reconnect attempt that hangs.** `join` never resolves (the server accepted TCP, then stalled). The attempt must time out after 10 s and the backoff go on, not freeze. Test in Task 6 (`hung_attempt_times_out_and_retries`).
3. **The ride ends during an in-flight attempt.** The rider leaves to the menu while an attempt is pending. `stop()` must stop a late success from calling `onConnected` and reviving a dead ride. Test in Task 6 (`stop_drops_a_late_success`).
4. **Autosave from another server, or too old.** It offers only Save and Discard, never a Continue that would join the wrong server or teleport after 12 h. Test in Task 7 (`continue_needs_same_server_and_fresh_save`).
5. **Storage unavailable.** Private mode or a full quota makes `put` throw. The ride must go on, with the error logged once, not once every 10 s. Test in Task 7 (`storage_errors_are_reported_once`).

---

### Task 1: Protocol, settings and session plumbing

**Files:**
- Modify: `server/crates/server/src/protocol.rs` (`ClientMessage::Join`, new `ClientMessage::Leave`, `ResumePoint`, `ServerMessage::Welcome`, `ServerMessage::Joined`)
- Modify: `server/crates/server/src/lib.rs` (`ServerInfo.grace_s`)
- Modify: `server/crates/server/src/game.rs` (`GameSettings.grace_s`, default 60.0; `Joined` constructions)
- Modify: `server/crates/server/src/studio.rs` (`Joined` construction)
- Modify: `server/crates/server/src/config.rs` (`Config.grace_s` from `OPENRADLR_GRACE_S`), `server/crates/server/src/app.rs` (pass into `GameSettings` for routes and studio, and `ServerInfo`)
- Modify: `server/crates/server/src/session.rs` (`Action::Join` fields, new `Action::Leave`, `welcome` carries `grace_s`)

**Interfaces:**
- Produces:
  - `protocol::ResumePoint { pub route_id: String, pub distance_m: f64 }` (`Debug, Clone, PartialEq, Deserialize`).
  - `ClientMessage::Join` gains `#[serde(default)] resume_token: Option<String>` and `#[serde(default)] resume: Option<ResumePoint>`. `ClientMessage::Leave` is a unit variant (`{"type":"leave"}`).
  - `ServerMessage::Welcome` gains `grace_s: f64`. `ServerMessage::Joined { rider_id: RiderId, resume_token: String }`. Until Task 3 the cores send `resume_token: String::new()`.
  - `GameSettings.grace_s: f64`, `ServerInfo.grace_s: f64`, `Config.grace_s: f64`.
  - `session::Action::Join` gains `resume_token: Option<String>, resume: Option<ResumePoint>`. `session::Action::Leave` is returned for `ClientMessage::Leave` in `Phase::Joined`. In other phases `leave` gets the existing `join_required` / `hello_required` errors.

- [ ] **Step 1: Write failing tests**
  - protocol.rs `join_parses_resume_fields`: `{"type":"join","name":"A","weight_kg":70,"resume_token":"ab","resume":{"route_id":"r","distance_m":1234.5}}` parses with `resume_token == Some("ab")` and `resume == Some(ResumePoint{route_id:"r", distance_m:1234.5})`. The old join without the fields parses with both `None`.
  - protocol.rs `leave_parses`: `{"type":"leave"}` → `ClientMessage::Leave`.
  - protocol.rs `joined_and_welcome_carry_the_new_fields`: serialised `Joined{rider_id:3, resume_token:"t"}` has `"resume_token":"t"`; `Welcome{.., grace_s:60.0}` has `"grace_s":60.0`.
  - session.rs `leave_after_join_is_an_action`: after the handshake and join, `on_text(r#"{"type":"leave"}"#)` returns `Action::Leave`. Before join it is an error reply.
  - session.rs: extend `json_handshake_then_join` so the expected `Action::Join` has `resume_token: None, resume: None`, and the welcome has `grace_s` equal to the `ServerInfo` value.
  - config.rs `grace_defaults_to_60_and_can_be_changed`: default 60.0; `OPENRADLR_GRACE_S=0` gives 0.0; `-1` and `abc` are config errors.
- [ ] **Step 2:** RUST → compile failures for the missing fields and variants.
- [ ] **Step 3:** Implement the interfaces. Fix the existing `Joined { rider_id }` patterns and constructions (12 sites, mostly tests) and `connection.rs` (match `Action::Leave` as `break` for now).
- [ ] **Step 4:** RUST → all green.
- [ ] **Step 5:** Commit `Server: resume fields, leave message and grace setting (#73)`.

### Task 2: Resume bookkeeping (`resume.rs`)

**Files:**
- Create: `server/crates/server/src/resume.rs` (declare in `lib.rs`)

**Interfaces:**
- Produces:
  - `ResumeTokens`: token → world id, cloned shares (copy the `VehicleCodes` pattern). `new()`, `insert(&self, token: &str, world_id: &str)`, `remove(&self, token: &str)`, `world_of(&self, token: &str) -> Option<String>`.
  - `JoinedRider { pub rider_id: RiderId, pub epoch: u64 }` (`Debug, Clone, Copy, PartialEq, Eq`).
  - `Attachments`, one per game: `new(grace_s: f64, registry: ResumeTokens, world_id: String)`; `set_registry(&mut self, registry: ResumeTokens, world_id: String)`;
    - `attach(&mut self, rider_id) -> (String /*token*/, u64 /*epoch*/)`: new token, registered.
    - `reattach(&mut self, token: &str) -> Option<JoinedRider>`: known token → bumps the epoch and clears detached. Works whether the rider is detached or still attached.
    - `is_current(&self, rider_id, epoch) -> bool`.
    - `detach(&mut self, rider_id, now_s: f64)`, `is_detached(&self, rider_id) -> bool`.
    - `expired(&self, now_s) -> Vec<RiderId>`: detached for strictly more than `grace_s`.
    - `token_of(&self, rider_id) -> Option<&str>`.
    - `forget(&mut self, rider_id)`: drops the rider and their token, here and in the registry.
  - Epochs start at 1 and are unique per `Attachments`.

- [ ] **Step 1: Write failing tests** in `resume.rs`:
  - `attach_registers_the_token`: after `attach(7)`, `registry.world_of(&token) == Some("w")` and the token is 64 chars.
  - `reattach_returns_the_rider_with_a_new_epoch`: `attach(7)` gives epoch e1; `detach(7, 0.0)`; `reattach(&token) == Some(JoinedRider{rider_id:7, epoch:e2})`, `e2 != e1`; `is_current(7, e1) == false`; `is_detached(7) == false`.
  - `unknown_token_is_none`: `reattach("nope") == None`.
  - `expiry_waits_for_the_grace_period`: grace 60, `detach(7, 10.0)`: `expired(70.0)` is empty, `expired(70.1) == [7]`.
  - `forget_frees_the_token`: after `forget(7)`, `reattach(&token) == None` and `registry.world_of(&token) == None`.
- [ ] **Step 2:** RUST(`cargo test -p openradlr-server resume`) → fail.
- [ ] **Step 3:** Implement with `HashMap<String, RiderId>` and `HashMap<RiderId, Entry { token, epoch, detached_at: Option<f64> }>`.
- [ ] **Step 4:** RUST → green.
- [ ] **Step 5:** Commit `Server: resume tokens and attachments (#73)`.

### Task 3: Detach, reattach and resume position in `GameCore` and the runtime

**Files:**
- Modify: `server/crates/server/src/game.rs` (`NullSink`, `Client`, `join_at`, `detach`, `reattach`, tick expiry, broadcast loops, `with_resume_tokens`)
- Modify: `server/crates/server/src/runtime.rs` (`Game` trait, `Command`, `GameHandle`, `apply`)

**Interfaces:**
- Consumes: Task 2's `Attachments`, `JoinedRider`, `ResumeTokens`.
- Produces:
  - `game::NullSink` (`MessageSink`, always `Ok`).
  - `GameCore::join_at(&mut self, name, weight_kg, ftp_w, level_w, route_id: Option<&str>, vehicle_code: Option<&str>, start_m: Option<f64>, sink) -> Result<JoinedRider, JoinError>`. The existing `GameCore::join` (7 args, returns `RiderId`) stays as a thin wrapper with `start_m: None`, so the 41 existing test calls are untouched. `start_m` is ignored when `vehicle_code` is set. Otherwise it goes through `world.place_at(id, start_m.clamp(0.0, route_length))` before the first state is sent; non-finite values become 0.0. `Joined` carries the token.
  - `GameCore::with_resume_tokens(self, tokens: ResumeTokens) -> Self`, which uses the game's `world_id` (call it after `with_vehicle_codes` in `app.rs`).
  - `Game` trait: `join` gains `start_m: Option<f64>` and returns `Result<JoinedRider, JoinError>`. New, with defaults: `fn is_attached(&self, _rider_id, _epoch: u64) -> bool { true }`, `fn detach(&mut self, rider_id) { self.leave(rider_id) }`, `fn reattach(&mut self, _token: &str, _sink) -> Option<JoinedRider> { None }`.
  - `Command::Join` gains `start_m: Option<f64>`, reply `Result<JoinedRider, JoinError>`. `Command::Leave { rider_id, epoch: u64 }`, new `Command::Detach { rider_id, epoch }` and `Command::Reattach { token: String, sink, reply: oneshot::Sender<Option<JoinedRider>> }`. `apply` runs `Leave`/`Detach` only when `core.is_attached(rider_id, epoch)`.
  - `GameHandle::join(.., vehicle_code, start_m: Option<f64>, sink) -> Result<Result<JoinedRider, JoinError>, GameStopped>`, `GameHandle::reattach(&self, token: String, sink) -> Result<Option<JoinedRider>, GameStopped>`.
  - `GameCore` behaviour:
    - `detach`: if `grace_s <= 0`, `leave`. Otherwise sink → `NullSink`, `world.set_telemetry(id, 0.0, None)`, and `attachments.detach(id, clock_s)` where `clock_s = tick as f64 * tick_seconds`.
    - `tick`: after the world step, `leave` every `attachments.expired(clock_s)`. The broadcast loops (`tick` state and resistance, `send_to_route`, `broadcast`) call `detach` instead of `leave` on a failed delivery.
    - `leave` also calls `attachments.forget`.
    - `reattach`: swap the sink, `last_grade = None`, send `Joined` (same id and token) and a fresh state.
    - `player_count` still counts detached riders: they are in the world.
- [ ] **Step 1: Write failing tests** in `game.rs` (use `RecordingSink`; add a `game_with_grace(grace_s)` helper):
  - `detached_riders_coast_and_keep_their_place`: join Anna, set 250 W telemetry, tick 2 s, `detach(anna)`, tick 10 s. Anna is still in `world()`, her speed is lower than at detach, and `player_count() == 1`.
  - `reattach_returns_the_same_rider_and_a_fresh_state`: join (keep the token from the `Joined` message), detach, `reattach(token, new_sink)` gives `Some(JoinedRider{rider_id: anna, ..})`. The new sink's first message is `Joined{rider_id: anna, resume_token: token}`, then a `State`.
  - `grace_expiry_runs_leave`: grace 1 s, detach, tick 1.5 s. Anna is gone from the world, and `reattach(token, ..)` gives `None`.
  - `detached_rider_keeps_event_entry_and_seat`: create a vehicle with Anna as captain and Ben aboard (as the existing vehicle tests do), detach Ben, tick 5 s, reattach. Ben is still seated (`world().rider(ben).vehicle` is unchanged).
  - `failed_delivery_detaches_instead_of_leaving`: `sink.close()`, tick past a broadcast. Anna is still in the world; after the grace period she's gone.
  - `stale_epoch_detach_and_leave_are_ignored` (Review Focus 1, through `runtime::apply` or a `Game`-level helper): join (epoch e1), `reattach` (epoch e2). `Detach{epoch:e1}` and `Leave{epoch:e1}` leave the rider attached; `Leave{epoch:e2}` removes them.
  - `grace_zero_leaves_at_once`: grace 0, `detach` → rider gone straight away.
  - `join_at_places_the_rider`: route length L; `start_m = 300.0` → position 300.0. `start_m = L + 50` → clamped to L, which `place_at` wraps to 0. `-5.0` → 0.0. With a `vehicle_code` set, `start_m` is ignored.
- [ ] **Step 2:** RUST(`cargo test -p openradlr-server game`) → fail.
- [ ] **Step 3:** Implement. Update `runtime.rs` tests and fakes for the new trait signature. `StudioCore` gets the new `join` signature in this task (ignore `start_m`, return `JoinedRider { rider_id, epoch: 0 }`); Task 4 gives it real attachments.
- [ ] **Step 4:** RUST → green.
- [ ] **Step 5:** Commit `Server: detach riders for a grace period and reattach by token (#73)`.

### Task 4: Studio, connection and app wiring

**Files:**
- Modify: `server/crates/server/src/studio.rs` (`Attachments`, `detach`, `reattach`, `is_attached`, expiry in `tick`, failed deliveries detach, `with_resume_tokens`)
- Modify: `server/crates/server/src/worlds.rs` (`with_resume_tokens`, `resume_game`)
- Modify: `server/crates/server/src/connection.rs`
- Modify: `server/crates/server/src/app.rs`
- Test: `server/crates/server/tests/websocket_flow.rs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `StudioCore::with_resume_tokens(self, tokens: ResumeTokens) -> Self` (world id `worlds::STUDIO_ID`). Studio detach: sink → `NullSink`, power 0 through the same call `Game::telemetry` uses, then expiry as in `GameCore`.
  - `Worlds::with_resume_tokens(self, tokens: ResumeTokens) -> Self`; `Worlds::resume_game(&self, token: &str) -> Option<&GameHandle>`, where `STUDIO_ID` maps to the studio's game and any other id goes through `get(Some(id))`.
  - Connection loop:
    - It keeps `epoch: u64` next to `game`.
    - `Action::Join` with a `resume_token` whose `resume_game` is found: acquire a seat (`server_full` otherwise), then `reattach`. On `Some(joined)`: `session.joined(joined.rider_id)` and store game, epoch and seat (no `SetDevice`; the client keeps its device). On `None`, fall through to a normal join.
    - Normal join: when `vehicle_code` is `None` and `resume` is `Some(p)`, use `route_id = Some(p.route_id)` and `start_m = Some(p.distance_m)`.
    - `Action::Leave` sets `leaving = true` and breaks.
    - After the loop: `Command::Leave { rider_id, epoch }` if leaving, else `Command::Detach { rider_id, epoch }`.
  - `app.rs`: one `ResumeTokens` shared by every `GameCore`, the studio and `Worlds`.
- [ ] **Step 1: Write failing tests**
  - studio.rs `studio_riders_reattach_within_grace`: join, detach, reattach → same id; after grace expiry the rider is gone.
  - worlds.rs `resume_tokens_find_their_world`: insert a token for world `"b"` → `resume_game` is the game of `"b"`; an unknown token → `None`.
  - websocket_flow.rs `dropped_socket_resumes_the_same_rider`: client A joins and reads `rider_id` and `resume_token` from `joined`, then drops the socket without `leave`. Client B joins with that `resume_token` and gets `joined` with the same `rider_id`.
  - websocket_flow.rs `leave_frees_the_rider_at_once`: join, send `{"type":"leave"}`, reconnect with the token → `joined` with a **different** `rider_id`.
  - websocket_flow.rs `resume_position_starts_there`: join with `resume: {route_id: "rolling-hills", distance_m: 1500}` and no token → the first `state` has my rider at `distance` 1500 ± 1.
- [ ] **Step 2:** RUST → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** RUST → green.
- [ ] **Step 5:** Commit `Server: reattach over the websocket, studio included (#73)`.

### Task 5: Recorder pauses and ride files

**Files:**
- Modify: `client/public/js/ride/rideRecorder.js`
- Modify: `client/public/js/ride/fitFile.js`
- Modify: `client/test/recorder.test.js`, `client/test/fit.test.js`
- Modify: `client/test/helpers.js` (`fitMessages`)

**Interfaces:**
- Produces:
  - `RideRecorder#pauses: {from: number, to: number}[]` (epoch ms). `pause(t)` opens a pause (no-op if one is open); `resume(t)` closes it (no-op if none is open).
  - `RideRecorder#segments() -> Sample[][]`: samples split at each closed pause; empty segments are dropped.
  - `RideRecorder#toJSON() -> {samples, pauses, intervalMs}` and `static RideRecorder.from(json) -> RideRecorder`.
  - `summary().durationS` = (last.t − first.t − closed pause time) / 1000. Average power and speed use it; `kilojoules` is unchanged.
  - `encodeFitActivity(samples, summary, { indoor, pauses = [] })`: at each pause, an event `{event: 0, eventType: 1}` (stop) at `from` and `{event: 0, eventType: 0}` (start) at `to`. Lap and session `timer` = `elapsed` − pause ms. `toFit` passes `this.pauses`.
  - TCX: one `<Track>` per segment inside the one `<Lap>`. GPX: one `<trkseg>` per segment.
  - Test helper `fitMessages(bytes) -> {global: number, values: object}[]`. It decodes what our encoder writes: normal headers, definition and data messages, little-endian, field types `enum/uint8/uint16/uint32/sint32`.
- [ ] **Step 1: Write failing tests**
  - `pause_is_left_out_of_the_duration`: samples at t = 0…60 s; pause 20 s→50 s with no samples inside; `summary().durationS == 30`.
  - `segments_split_at_pauses`: same ride → 2 segments; the first ends at t ≤ 20 s and the second starts at t ≥ 50 s.
  - `json_round_trip`: `RideRecorder.from(JSON.parse(JSON.stringify(r)))` gives equal samples, pauses and summary.
  - `tcx_has_a_track_per_segment` / `gpx_has_a_trkseg_per_segment`: count `<Track>` = 2, `<trkseg>` = 2.
  - `fit_marks_pauses_with_timer_events`: `fitMessages(r.toFit())` has 4 event messages (global 21) with event types `[0, 1, 0, 4]`; the session (global 18) `timer` field is 30000 less than `elapsed`.
  - Existing recorder and FIT tests stay green (no pauses means today's output).
- [ ] **Step 2:** NODE → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** NODE → green.
- [ ] **Step 5:** Commit `Client: pauses in the ride recorder and FIT/TCX/GPX files (#73)`.

### Task 6: Connection resume fields and the reconnector

**Files:**
- Modify: `client/public/js/net/protocol.js`, `client/public/js/net/connection.js`
- Create: `client/public/js/net/reconnector.js`
- Test: `client/test/net.test.js`, create `client/test/netReconnect.test.js`

**Interfaces:**
- Produces:
  - `ClientMessages.join({..., resumeToken, resume})` adds `resume_token` when set and `resume: {route_id, distance_m}` from `resume = {routeId, distanceM}` when set. `ClientMessages.leave() -> {type: "leave"}`.
  - `GameConnection#resumeToken` (set from `joined`), `GameConnection#graceS` (from `welcome`, default 0). `GameConnection#leave()` sends `leave`, then closes.
  - `export function reconnectDelay(attempt: number, delaysMs = [1000, 2000, 4000, 8000], maxDelayMs = 15000) -> number` (attempt 0 → 1000; 4 and later → 15000).
  - `export class Reconnector` with constructor `{ connect: () => Promise<T>, onConnected: (T) => void, onGiveUp: () => void, giveUpAfterMs = 180000, attemptTimeoutMs = 10000, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }` and methods `start()`, `stop()`, getter `running`. `start()` waits `reconnectDelay(0)` before the first attempt. A rejected or timed-out attempt schedules the next one. Past `giveUpAfterMs` since `start()` it calls `onGiveUp` once and stops. A connection that resolves after its own timeout is closed (`result.close?.()`) and ignored.
- [ ] **Step 1: Write failing tests** (fake timers: a queue `setTimer`/`clearTimer` with a manual `advance(ms)`; existing fake socket from `net.test.js`):
  - net.test.js `join_sends_resume_fields_and_keeps_the_token`: join with `{resumeToken: "t", resume: {routeId: "r", distanceM: 12}}` sends `resume_token: "t", resume: {route_id: "r", distance_m: 12}`. After `joined {rider_id: 4, resume_token: "u"}`, `connection.resumeToken === "u"`. After `welcome {grace_s: 60}`, `graceS === 60`.
  - net.test.js `leave_sends_leave_then_closes`.
  - netReconnect.test.js `backoff_follows_the_schedule`: `[0..6].map(reconnectDelay)` = `[1000, 2000, 4000, 8000, 15000, 15000, 15000]`.
  - `connects_after_failures`: `connect` rejects twice, then resolves `"c"`. Advancing 1000 + 2000 + 4000 ms gives `onConnected("c")` once, and `running === false`.
  - `gives_up_after_three_minutes`: `connect` always rejects; advance 180000 ms → `onGiveUp` called once, no more `connect` calls after that.
  - `hung_attempt_times_out_and_retries` (Review Focus 2): the first `connect` never settles. After 1000 + 10000 ms a second `connect` is scheduled; it resolves → `onConnected`.
  - `stop_drops_a_late_success` (Review Focus 3): `connect` returns a promise resolved manually; `stop()`, then resolve with `{close}` → `onConnected` is not called and `close` is called.
- [ ] **Step 2:** NODE → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** NODE → green.
- [ ] **Step 5:** Commit `Client: resume token, leave and a reconnector with backoff (#73)`.

### Task 7: Autosave store

**Files:**
- Create: `client/public/js/ride/rideAutosave.js`
- Test: `client/test/autosave.test.js`

**Interfaces:**
- Consumes: Task 5 `RideRecorder.toJSON` / `from`.
- Produces:
  - Store contract (what tests fake with a `Map`): `{ get(key) -> Promise<any>, put(key, value) -> Promise<void>, delete(key) -> Promise<void>, keys() -> Promise<string[]> }`. `export function indexedDbStore(name = "openradlr-autosave") -> store` is a thin IndexedDB adapter (one object store `"kv"`). It isn't unit tested.
  - `export const AUTOSAVE_MAX_AGE_MS = 43200000`.
  - `export class RideAutosave` with constructor `{ store, log = console.warn }`:
    - `save(snapshot) -> Promise<void>` writes key `"current"`.
    - `load() -> Promise<snapshot | null>`.
    - `addPhoto({name, blob, takenAt}) -> Promise<void>` writes key `"photo:" + name`.
    - `photos() -> Promise<{name, blob, takenAt}[]>`, sorted by `takenAt`.
    - `clear() -> Promise<void>` removes `"current"` and every `"photo:*"`.
    - Every method catches store errors and calls `log` only on the first error of the instance. `load` and `photos` then resolve `null` / `[]`.
  - Snapshot: `{version: 1, savedAt, serverUrl, routeId, routeName, studio, trainerKind, rideStartedAt, distance, resumeToken, graceS, resumePoint: {routeId, distanceM} | null, recorder: RideRecorder#toJSON()}`.
  - `export function continueAllowed(snapshot, { now, serverUrl }) -> boolean`: `now − savedAt < AUTOSAVE_MAX_AGE_MS && snapshot.serverUrl === serverUrl`.
  - `export function unfinishedLabel(snapshot, { now, formatDistance }) -> string`, e.g. `"Unfinished ride · Rolling Hills · 23.4 km · 41 min ago"`. Ages: `< 60 min` → `N min`; `< 24 h` → `N h`.
- [ ] **Step 1: Write failing tests**
  - `round_trip_with_photos`: save a snapshot plus 2 photos (Blobs) on a Map store; `load()` deep-equals the snapshot; `photos()` gives 2 in `takenAt` order with their blobs.
  - `clear_removes_everything`: after `clear()`, `load() === null`, `photos()` is empty, and the store has no keys.
  - `continue_needs_same_server_and_fresh_save` (Review Focus 4): a fresh, same-server save → `true`; another server URL → `false`; `savedAt` 12 h + 1 ms ago → `false`.
  - `storage_errors_are_reported_once` (Review Focus 5): a store whose `put` throws; `save()` three times resolves each time, and `log` is called once.
  - `label_reads_well`: 23400 m with `formatDistance = (m) => (m/1000).toFixed(1) + " km"`, saved 41 min ago, route "Rolling Hills" → the exact string above; saved 3 h ago → ends `"· 3 h ago"`.
- [ ] **Step 2:** NODE → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** NODE → green.
- [ ] **Step 5:** Commit `Client: ride autosave store (#73)`.

### Task 8: Ride wiring: reconnect, leave, autosave, Continue card

**Files:**
- Modify: `client/public/js/main.js` (`wireConnection` close handler, `reconnect()` removed, `endRide`, `joinRide`, `startRide`, `frame`/`studioFrame` recording, photo capture, finish/download/upload handlers, start menu)
- Modify: `client/public/index.html` (`#reconnecting` pill, `#disconnected` banner with `#finish-and-save` and `#keep-trying` replacing `#reload`, start-menu `#unfinished` card with `#continue-ride`, `#save-unfinished`, `#discard-unfinished`)
- Modify: the client stylesheet that styles `.banner` (pill style)

**Interfaces:**
- Consumes: Tasks 5–7.
- Behaviour (no new exported functions; main.js isn't unit tested, so Step 3 is the manual check):
  - `app.autosave = new RideAutosave({ store: indexedDbStore() })` at startup.
  - `app.offline` (bool): while it's true, `frame`/`studioFrame` record `speed: 0` and keep `distance` where it was.
  - `app.lastOnRoute = {routeId, distanceM}` updates from my rider's state whenever `route` is non-null.
  - On `close` of the current connection: no `session.stop()`. Set `app.offline = true`, show `#reconnecting`, start a `Reconnector`. Its `connect` builds a `GameConnection`, wires it and joins with `resumeToken: old.resumeToken` and `resume: app.lastOnRoute` (no `resume` in the studio). On connected: same rider id → swap `app.connection` and point the ride session at it (give `RideSession` a `setConnection(connection)` if it has none). Different id → also reset `riderId`, `smoother`, `state`, event, race and vehicle fields as `endRide` does, and `notify("Back on the road as a free rider" + (wasRacing ? " · your race ended" : "") + (wasSeated ? " · your seat ended" : ""))`. On give up: hide the pill and show `#disconnected` with **Finish and save** (`openFinish()`) and **Keep trying** (restart the reconnector).
  - `endRide` stops the reconnector and calls `app.connection?.leave()` instead of `close()`.
  - Autosave, while riding an exportable ride: `setInterval(saveRide, 10000)` plus `pagehide` and `visibilitychange` (hidden) listeners. `saveRide` writes the snapshot (Task 7 shape) once the recorder has a sample. Each new photo also goes to `app.autosave.addPhoto`. A download, a Strava upload, Discard, or the confirmed `leaveRide()` calls `app.autosave.clear()`.
  - Start menu: `renderStartMenu` loads the autosave and, if there is one, shows `#unfinished` with `unfinishedLabel`. `#continue-ride` is hidden unless `continueAllowed`.
    - **Continue**: stash `app.restored = {snapshot, photos}` and pick its route (`app.routeId = snapshot.studio ? "studio" : snapshot.routeId`). Then run `joinRide()` with `resumeToken` and `resume: snapshot.resumePoint`. `startRide` uses `RideRecorder.from(snapshot.recorder)` with `pause(snapshot.savedAt)` and `resume(Date.now())`, `rideStartedAt = snapshot.rideStartedAt`, and puts the photos back into `app.album`.
    - **Save**: restore the recorder into a detached summary: offer **Download FIT** (`toFit`), **Download photos**, and **Upload to Strava** when `app.stravaAccount?.can_upload`. For that, `uploadToStrava` takes `(recorder, name)` instead of reading `app.recorder`. Any finished download or upload clears the autosave.
    - **Discard**: `confirm()`, then clear.
- [ ] **Step 1: Write a failing test** in `client/test/ride.test.js`, `set_connection_moves_telemetry_and_resistance`. A started `RideSession` on fake connection A gets `setConnection(B)`. Then telemetry goes to B only, a `resistance` from A is ignored, and one from B updates `serverGrade`. NODE → fail.
- [ ] **Step 2:** Implement `RideSession#setConnection(connection)`: unsubscribe A's `resistance` handler, subscribe B's, and send later telemetry to B. NODE → green.
- [ ] **Step 3:** Implement the rest of the behaviour above.
- [ ] **Step 4:** NODE → green (lint included).
- [ ] **Step 5: Manual check (Playwright in Docker, sim trainer, which is exportable).** Start the server (Docker), ride 30 s, stop the server for 10 s and start it again. Expected: the `Reconnecting…` pill shows, then disappears, and the rider rejoins at the same place (after a server restart it's a new id as a free rider, with the notice). Then reload the tab mid-ride. Expected: the Unfinished ride card offers Continue. Continue → the HUD time carries on, and a FIT download contains the samples from before the reload. To test a same-id resume, drop only the socket: `page.context().setOffline(true)` for 10 s. Screenshots go on an Artifact page.
- [ ] **Step 6:** Commit `Client: reconnect mid-ride, autosave and continue (#73)`.

### Task 9: Docs

**Files:**
- Modify: `docs/protocol.md`: `leave`; `join.resume_token`, `join.resume`; `joined.resume_token`; `welcome.grace_s`; a "Reconnecting" section on the grace period, what the client sees (same `rider_id` = full resume, different = fresh join) and the free-rider rules for `resume`.
- Modify: `docs/architecture.md`: detach/reattach in the game loop, the `ResumeTokens` registry, the autosave in the client.
- Modify: `docs/deploy.md`: `OPENRADLR_GRACE_S` in the env table.
- Modify: `CHANGELOG.md`: an Unreleased entry.

- [ ] **Step 1:** Write the docs. Field names must match Task 1 exactly.
- [ ] **Step 2:** RUST and NODE once more on the whole branch → green.
- [ ] **Step 3:** Commit `Docs: reconnecting, resume and autosave (#73)`.
