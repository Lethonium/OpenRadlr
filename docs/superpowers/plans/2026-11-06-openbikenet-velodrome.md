# OpenBikeNet Velodrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 250 m velodrome route whose human riders are shared with other apps through an OpenBikeNet server, and whose riders from other apps ride along in OpenRadlr.

**Architecture:** A new `server/crates/server/src/obn/` module: `wire.rs` (OpenBikeNet v0 messages), `outbox.rs` (pure: local riders → `join`/`update`/`leave`), `remote.rs` (pure: incoming messages → remote riders, extrapolated), `link.rs` (the one outgoing WebSocket with reconnect). The velodrome's `GameCore` hands a frame of its riders to the link once per second and gets incoming messages back as `Command::Remote`; remote riders are appended to state messages and never enter the sim.

**Tech Stack:** Rust (axum, tokio, tokio-tungstenite with rustls, serde), plain ES modules + `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-06-openbikenet-velodrome-design.md`. Protocol: `https://github.com/OpenBikeNet/protocol/blob/main/spec/v0.md` (sections 3–7 and 10).

## Global Constraints

- Work on branch `feat/openbikenet`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.
- `OPENRADLR_OBN_URL` empty or unset = link off: nothing is sent, the velodrome is a local track. Room is always `public`; OpenBikeNet route ID comes from the route file's `openbikenet` field.
- `hello`: `{"type":"hello","app":{"id":"openradlr","version":<CARGO_PKG_VERSION>,"name":"OpenRadlr","url":"https://openradlr.com"}}`.
- Sent per rider: `rider` = `"r<RiderId>"`, `name`, `lap`, `distance`, `speed` (m/s, 2 decimals, clamped 0–30), `power` (integer, clamped 0–3000), `cadence` (integer, clamped 0–250, left out when `None`). Never `heart_rate`. Only humans (`!rider.is_bot()`) on the shared route, not `workout` riders.
- `distance` sent = `position * 250 / route_length`, then `min(249.99)`; incoming `distance` → `distance * route_length / 250`. `250` is the OpenBikeNet route's `length`; the velodrome is the only shared route, so pass it as a constant `OBN_LENGTH_M = 250.0` beside the route ID.
- Frames once per second (`tick % tick_hz == 0`); reconnect delays 1, 2, 4, 8, 16, 32, 60, 60 … s, reset after a `welcome`.
- Remote riders: IDs from `REMOTE_ID_BASE = 0xF000_0000`, counting up, never reused; extrapolate `distance + speed * min(age, 2.0)` wrapped into `[0, length)`; dropped after 10 s without an update, all dropped on `Reset`; a `snapshot` replaces all of them (riders it no longer lists are gone, riders it lists again keep their RiderId). Lane = `(id % lanes)` as f64.
- OpenRadlr wire is additive: `PROTOCOL_VERSION` stays 2. New fields: `RiderState.app: Option<String>` (skip if none), `RouteRiders.remote: usize` (skip if 0), `RouteSummary.shared: bool` (skip if false).
- The game loop never awaits the link: frames go through `mpsc::Sender::try_send` (capacity 8), a full channel drops the frame.
- UI text in `client/public/js/i18n/en.js` and `de.js` (ADR 0017). No sleeps in unit tests; time is passed in (CONTRIBUTING.md).
- Rust: `cd server && cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings`. Node (not installed on the host): `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js" && npx eslint .'`. Before the last commit: `make check`.

## Review Focus

1. **A rider crosses the line** (position 249.9 → 0.4): `lap` goes up by exactly one and `distance` is never ≥ 250, even if the route length is 250.004 m. Pinned by `outbox::tests::lap_counts_line_crossings` and `distance_stays_below_length` (Task 2).
2. **The OpenBikeNet server is down or hangs:** OpenRadlr starts, riding works, frames are dropped rather than queued, and the link retries with backoff. Pinned by `game::tests::full_link_channel_never_blocks_the_tick` (Task 3) and `tests/openbikenet.rs::reconnects_and_joins_again` (Task 4).
3. **The link drops while remote riders are shown:** they vanish at the next state message, not after 10 s of riding on by themselves. Pinned by `remote::tests::reset_clears_everyone` and `extrapolates_at_most_two_seconds` (Task 3).
4. **A remote name like `<img src=x onerror=alert(1)>`** shows as text in the 3D label, panels and 2D view. Pinned by `client/test/remoteRiders.test.js` (Task 5).
5. **A rider leaves, detaches or finishes their ride** on the velodrome: `leave` goes out in the next frame; a detached rider (grace period) is still sent until they are removed. Pinned by `outbox::tests::missing_rider_leaves` (Task 2).
6. **Values out of the spec's range** (a vehicle at 31 m/s, power spikes, cadence 300): clamped before sending, so the OpenBikeNet server never drops entries or closes the link for `too_many_errors`. Pinned by `outbox::tests::values_are_clamped_and_rounded` (Task 2).

---

### Task 1: Velodrome route without bots

**Files:**
- Create: `tools/velodrome-route.mjs`, `routes/velodrome.json`
- Modify: `server/crates/server/src/route_file.rs` (field `openbikenet: Option<String>`; `zones` becomes `Option<Vec<ZoneFile>>` so an explicit `[]` is passed on), `server/crates/server/src/app.rs` (bots off), `client/public/js/route/geometry.js` (explicit empty zones), `docs/routes.md`
- Test: `route_file.rs` tests, `app.rs` tests, `client/test/world3.test.js` (where the `resolveZones` tests live)

**Interfaces:**
- Produces: `RouteFile.openbikenet: Option<String>`, `RouteFile.zones: Option<Vec<ZoneFile>>`; `routes/velodrome.json` with `id` `velodrome`.

- [ ] **Step 1: Write the generator and the route.** `node tools/velodrome-route.mjs > routes/velodrome.json`: an oval of two 50 m straights and two semicircles, polyline points every ~2.5 m on the bends, elevation 40, scaled so the closed polyline (including the closing segment) is 250 m to within 0.01 m. Fields: `id` `velodrome`, `name` `Velodrome`, `description` `250 m oval, shared with riders from other apps when this server is connected to OpenBikeNet.`, `loop` true, `lanes` 4, `seed` 250, `openbikenet` `velodrome-250`, `markers` `[{"type":"start_finish","distance":0}]`, `zones` `[]`. No `map`.
- [ ] **Step 2: Failing tests.**
  - `route_file::tests::velodrome_is_250_m_and_shared`: loads `routes/velodrome.json`; `openbikenet == Some("velodrome-250")`, `(route.length() - 250.0).abs() < 0.01`.
  - `app::tests::shared_route_world_has_no_bots`: build from a routes dir with the velodrome and one other route, `target_riders` 3; after a few ticks the velodrome has 0 bots, the other route 3.
  - `route_file::tests::an_explicit_empty_zones_list_is_passed_on`: a file with `"zones":[]` serialises with `"zones":[]`; one without `zones` still serialises without the key (the existing `json_routes_without_zones_serialise_without_the_key` keeps passing). Today `skip_serializing_if = "Vec::is_empty"` drops the empty list, so the client never sees it.
  - `route_file::tests::routes_without_openbikenet_serialise_without_the_key`: no `openbikenet` key (not `null`) for every other route.
  - `world3.test.js` › `an explicit empty zones list means no scenery`: build the route geometry from a file with `zones: []` the way the client does (through `geometry.js`, not by calling `resolveZones` with a hand-made object), then `resolveZones` of it has no villages, rivers, forests or cliffs.
- [ ] **Step 3: Run** `cargo test -p openradlr-server velodrome shared_route` and the node tests: fail.
- [ ] **Step 4: Implement.** `#[serde(default, skip_serializing_if = "Option::is_none")] openbikenet` in `RouteFile`, like `map` and `geo`. `zones: Option<Vec<ZoneFile>>` with `#[serde(default, skip_serializing_if = "Option::is_none")]` (adjust the two test lines that index `file.zones`). In `app.rs`, a group whose files have any `openbikenet` gets `SimConfig { target_riders: 0, .. }`. In `geometry.js`, set `this.explicitZones = Array.isArray(file.zones)` beside `this.zones`, so a `zones` array (even empty) counts as explicit, as `network.js` already does for roads. Routes with zones are unaffected (they already have valid zones); no bundled route has `"zones": []`.
- [ ] **Step 5: Run** all Rust and node tests: pass. Start `make dev` with `OPENRADLR_ROUTE_FILE=routes/velodrome.json` and `OPENRADLR_ROUTES_DIR=../routes` and look at it in 3D (screenshot as in AGENTS.md): an oval, no village on the track.
- [ ] **Step 6: Document** the `openbikenet` field and the velodrome in `docs/routes.md`, then commit `Add the velodrome route`.

### Task 2: OpenBikeNet messages and the outbox

**Files:**
- Create: `server/crates/server/src/obn/mod.rs`, `obn/wire.rs`, `obn/outbox.rs`
- Modify: `server/crates/server/src/lib.rs` (`pub mod obn;`)

**Interfaces:**
- Produces:
  - `wire::AppMessage` (`Serialize`, `#[serde(tag = "type", rename_all = "snake_case")]`): `Hello { app: AppInfo }`, `Subscribe { route: String, room: String }`, `Join { rider: String, route: String, room: String, name: String, #[serde(flatten)] state: RiderState }`, `Update { riders: Vec<RiderEntry> }`, `Leave { rider: String }`.
  - `wire::RiderState { lap: u32, distance: f64, speed: f64, power: Option<u32>, cadence: Option<u32> }` (options skipped when `None`); `RiderEntry { rider: String, #[serde(flatten)] state: RiderState }`.
  - `wire::ServerMessage` (`Deserialize`, unknown fields ignored): `Welcome {}`, `Snapshot { route, room, riders: Vec<RemoteView> }`, `Joined { route, room, rider: RemoteView }`, `Updated { route, room, riders: Vec<RemoteUpdate> }`, `Left { route, room, id }`, `Error { code, message, fatal: bool }`; `RemoteView { id, app, name, lap, distance, speed, power: Option<f64>, cadence: Option<f64> }`, `RemoteUpdate { id, lap, distance, speed, power, cadence }`. Unknown `type` → `serde_json` error, which the link logs and skips.
  - `pub const OBN_LENGTH_M: f64 = 250.0;`
  - `outbox::LocalRider { id: RiderId, name: String, position: f64, speed: f64, power: f64, cadence: Option<f64> }`
  - `outbox::Outbox::new(route: String, route_length_m: f64)`, `fn frame(&mut self, riders: &[LocalRider]) -> Vec<AppMessage>` (joins for new riders, one `Update` for all present, leaves for missing; empty when nothing to say), `fn reset(&mut self)` (forget who joined and their laps).

- [ ] **Step 1: Failing tests** in `wire.rs`: `hello_matches_the_spec_shape`, `join_flattens_the_state` (`{"type":"join","rider":"r7",…,"lap":0,"distance":0.0,"speed":0.0}` with no `power` key when `None`), `parses_spec_examples` (the `welcome`, `snapshot`, `joined`, `updated`, `left`, `error` JSON blocks of spec 7.1–7.6, pasted verbatim), `unknown_type_is_an_error`.
- [ ] **Step 2: Failing tests** in `outbox.rs`:
  - `first_frame_joins_then_updates`: one rider → `[Join, Update]`; same rider next frame → `[Update]`.
  - `missing_rider_leaves`: rider gone → `[Leave { rider: "r7" }]`, then `[]`.
  - `lap_counts_line_crossings`: positions 240, 249.9, 0.4, 120 → laps 0, 0, 1, 1.
  - `distance_stays_below_length`: route length 250.004, position 250.0 → distance 249.99; position 125.002 → 125.0 (±0.01).
  - `values_are_clamped_and_rounded`: power 3456.7 → 3000, power -5 → 0, cadence 91.6 → 92, cadence 300 → 250, speed 11.876 → 11.88, speed 31.2 → 30.0, speed -0.1 → 0.0. (An out-of-range entry is dropped by the OpenBikeNet server with an error, and repeated errors end in a fatal `too_many_errors`.)
  - `reset_joins_everyone_again_from_lap_0`: after `reset` the next frame joins every rider with `lap` 0 (a reconnect is a new join, and `lap` counts laps since joining).
- [ ] **Step 3: Run** `cargo test -p openradlr-server obn::`: fail. **Step 4: Implement.** A line crossing = the new position is more than half a lap behind the last one. **Step 5: Run**: pass; clippy clean.
- [ ] **Step 6: Commit** `Add OpenBikeNet messages and the outbox`.

### Task 3: Remote riders in the game

**Files:**
- Create: `server/crates/server/src/obn/remote.rs`
- Modify: `server/crates/server/src/runtime.rs` (`Command::Remote`, `Game::remote`), `game.rs` (`with_openbikenet`, frames, state), `protocol.rs` (`RiderState.app`, `RouteRiders.remote`, `RiderState::remote`)

**Interfaces:**
- Consumes: `wire::ServerMessage`, `outbox::LocalRider`, `OBN_LENGTH_M` (Task 2).
- Produces:
  - `remote::RemoteEvent { Message(wire::ServerMessage), Reset }`
  - `remote::Remotes::new(route_length_m: f64)`, `fn apply(&mut self, event: RemoteEvent, now_s: f64)`, `fn riders(&mut self, now_s: f64) -> Vec<RemoteRider>` (also drops riders older than 10 s), `fn len(&self) -> usize`.
  - `remote::RemoteRider { id: RiderId, app: String, name: String, distance: f64, speed: f64, power: f64, cadence: Option<f64> }` (distance already in OpenRadlr metres).
  - `GameCore::with_openbikenet(self, route: RouteIndex, frames: mpsc::Sender<Vec<LocalRider>>) -> Self`; `Command::Remote(RemoteEvent)`; `Game::remote(&mut self, _event: RemoteEvent) {}` (default no-op).

- [ ] **Step 1: Failing tests** in `remote.rs`: `snapshot_adds_riders_with_new_ids` (IDs `0xF000_0000`, `0xF000_0001`), `a_new_snapshot_replaces_the_room` (snapshot with A and B, then one with B and C → B keeps its RiderId, A is gone, C gets a new one), `updated_moves_a_known_rider`, `left_removes`, `reset_clears_everyone`, `extrapolates_at_most_two_seconds` (speed 10, age 5 s → +20 m), `wraps_past_the_line`, `stale_riders_are_dropped` (age 10.1 s), `ids_are_never_reused` (left then joined again with the same OBN id → a new RiderId), `distance_is_scaled_to_the_local_length`.
- [ ] **Step 2: Failing tests** in `game.rs`:
  - `sends_a_frame_per_second_of_humans_on_the_shared_route`: one human, one bot on a world with `with_openbikenet`; after `tick_hz` ticks the receiver has one frame with one `LocalRider` (the human).
  - `full_link_channel_never_blocks_the_tick`: channel capacity 1, never read; 5 s of ticks return.
  - `remote_riders_appear_in_state`: after `remote(Message(snapshot with Ben))`, the viewer's next `State` has a rider with `app == Some("incyclist")`, `is_bot == false`, and `route_riders.remote == 1`.
  - `reset_removes_remote_riders_from_state`.
- [ ] **Step 3: Run**: fail. **Step 4: Implement.** `RiderState::remote(r: &RemoteRider, route_id: &str, lanes: u8) -> RiderState` in `protocol.rs`. In `GameCore::tick`, after building each viewer's `State` on the shared route, append `remotes.riders(clock_s)` up to `max_visible_riders` and set `route_riders.remote`. **Step 5: Run** all Rust tests: pass.
- [ ] **Step 6: Commit** `Show riders from other apps on the shared route`.

### Task 4: The link, config and wiring

**Files:**
- Create: `server/crates/server/src/obn/link.rs`, `server/crates/server/tests/openbikenet.rs`
- Modify: `server/crates/server/Cargo.toml` (`tokio-tungstenite = { version = "0.29", default-features = false, features = ["connect", "rustls-tls-webpki-roots"] }` as a normal dependency; remove the `tokio-tungstenite` line from `[dev-dependencies]`, the e2e tests use the normal one), `config.rs` (`obn_url: Option<String>` from `OPENRADLR_OBN_URL`, empty = `None`, must start with `ws://` or `wss://`; `obn_backoff_unit: Duration`, 1 s, not read from the environment), `app.rs` (start the link for the world with a shared route), `http.rs` (`RouteSummary.shared`), `.env.example`, `docs/deploy.md`

**Interfaces:**
- Consumes: `Outbox`, `RemoteEvent`, `GameHandle::send(Command::Remote(..))`, `with_openbikenet` (Tasks 2–3).
- Produces: `link::spawn_link(url: String, route: String, route_length_m: f64, backoff_unit: Duration, frames: mpsc::Receiver<Vec<LocalRider>>, game: GameHandle) -> JoinHandle<()>`; `link::backoff(attempt: u32, unit: Duration) -> Duration`.

- [ ] **Step 1: Failing tests.**
  - `link::tests::backoff_doubles_to_a_minute`: unit 1 s, attempts 0..8 → 1, 2, 4, 8, 16, 32, 60, 60 s; unit 10 ms → 10, 20, … 600 ms.
  - `config::tests::obn_url_must_be_websocket`: `https://x` → error; `""` → `None`; `wss://obn.example/v0` → `Some`.
  - `tests/openbikenet.rs` (a fake OpenBikeNet server on `127.0.0.1:0` with `tokio_tungstenite::accept_async`):
    - `hello_subscribe_and_join`: start the app with `OPENRADLR_OBN_URL=ws://<fake>/v0` and the velodrome; the fake receives `hello` (app id `openradlr`), `subscribe` `velodrome-250`/`public`; after a client joins the velodrome over `/ws`, the fake receives `join` with `name` and then `update`s.
    - `remote_rider_reaches_the_client`: the fake sends `welcome`, then `joined` with Ben from `incyclist`; the OpenRadlr client's next `state` contains Ben with `app: "incyclist"`.
    - `reconnects_and_joins_again`: the fake closes the socket; on the second accepted connection it receives `hello`, `subscribe` and `join` for the same rider again. The test sets `obn_backoff_unit` to 10 ms, so the reconnect comes within ~10 ms; the test itself waits on the fake's `accept`, with a timeout, never a sleep. Don't use `tokio::time::pause()` here: with the clock paused tokio jumps ahead whenever it is idle, so the game's tick loop races and the 10 s stale-rider drop and the AFK timer can fire mid-test.
    - `api_info_marks_the_route_shared`: `/api/info` has `"shared": true` for `velodrome` only, and no `shared` key without `OPENRADLR_OBN_URL`.
- [ ] **Step 2: Run**: fail. **Step 3: Implement.** One task: connect; send `hello` and `subscribe`; then `select!` over incoming messages (`Message` → `game.send(Command::Remote(Message(..)))`, `fatal` error → log and reconnect) and frames (`outbox.frame(..)` → send each). On any disconnect: `game.send(Command::Remote(Reset))`, `outbox.reset()`, sleep `backoff(attempt, backoff_unit)`. Log connects and drops with `tracing` (`info`), never rider names. **Step 4: Run** all tests: pass; clippy clean.
- [ ] **Step 5: Document** `OPENRADLR_OBN_URL` in `.env.example` (commented, empty, one line on what is sent) and a short *OpenBikeNet* section in `docs/deploy.md`. Commit `Connect the velodrome to OpenBikeNet`.

### Task 5: Client, docs and changelog

**Files:**
- Create: `client/public/js/view/remoteRiders.js`, `client/test/remoteRiders.test.js`, `docs/adr/0020-sharing-riders-with-openbikenet.md`
- Modify: `client/public/js/view/startMenu.js` (shared badge and note), `view/panels.js`, `view/pelotonView.js`, `view/canvas.js` + `styles.css` (`--remote` colour), `view3d/riderModel.js` / `view3d/view3d.js` (tint and label), `js/i18n/en.js`, `js/i18n/de.js`, `docs/protocol.md`, `docs/architecture.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `rider.app`, `route_riders.remote`, `route.shared` (Tasks 3–4).
- Produces: `remoteRiders.js`: `isRemote(rider) -> boolean`, `riderLabel(rider, t) -> string` (`Ben · incyclist`; bots and local humans as today).

- [ ] **Step 1: Failing tests** in `remoteRiders.test.js`: `remote riders are labelled with their app`, `local riders keep their label`, `a remote name with markup stays text` (render the panel row and the 3D label into a fake DOM from `test/helpers.js`; `innerHTML` contains `&lt;img`, no `img` element). In `startMenu.test.js`: `a shared route shows the shared badge and note` (from `route.shared`), `other routes don't`.
- [ ] **Step 2: Run** the node tests: fail. **Step 3: Implement.** Tint `remote` (a teal distinct from me orange, humans blue, bots grey) in 3D and 2D; panels show the app as a badge like the bot badge; the riders count line adds remote riders. Start menu: badge `Shared` and the note `Riders from other apps ride here too. Shared with them: your name, position, speed, power and cadence.` (en and de). **Step 4: Run** node tests and eslint: pass; screenshot the menu and the velodrome with the fake app from the OpenBikeNet server repo (`make fake` there, pointed at a local `obn-server`) and check the label.
- [ ] **Step 5: Docs.** ADR 0020 (context: OpenBikeNet Level 0; decision: the spec's *Decisions*; consequences: no drafting or races with remote riders, link optional). `docs/protocol.md`: `app`, `route_riders.remote`, `/api/info` `shared`. `docs/architecture.md`: add `obn/` to the layer table. `CHANGELOG.md` under `[Unreleased]`.
- [ ] **Step 6: Run** `make check`: pass. Commit `Show riders from other apps and mark the shared route`.
- [ ] **Step 7: Follow-up issue.** Draft an issue for the per-rider switch to stop sharing power and cadence (spec 10: apps SHOULD offer one) and ask the user before filing it on GitHub; it is filed before this feature is merged.
