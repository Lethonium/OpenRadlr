# Second-screen cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone paired once with a code shows the tablet's ride live as rider-chosen tiles, through a relay on the server.

**Architecture:** The server gets two in-memory registries: `PairCodes` (code → screen key) and `Screens` (screen key → one host connection, up to 4 watchers). The host's connection copies every message it writes to its socket into its hub; the game cores don't change. The tablet adds opaque `display` frames (HR, gradient, workout, `liveStats`). The phone runs a separate page, `cockpit.html`, without any 3D code.

**Tech Stack:** Rust (tokio, axum, serde) server crate `openradlr-server`. Plain ES modules client with no build step, tests in plain `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-12-second-screen-cockpit-design.md` (read it with this plan).

## Global Constraints

- Protocol stays version 2. Every addition is an optional message or field.
- Screen key: 32 lowercase hex characters (128 bits), generated on the tablet, localStorage `openradlr.screenKey`.
- Pair code: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Valid 300 s, works once.
- `display.data`: a JSON object of at most 2048 bytes serialised, at most 2 per second. Anything over is dropped silently.
- At most 4 watchers per key. The fifth gets `error { code: "too_many_screens" }` and is closed.
- Error code for a bad claim: `pair_code_invalid`.
- localStorage keys:
  - `openradlr.screenKey`
  - `openradlr.screenPaired`
  - `openradlr.cockpit` (`{ key, name }`)
  - `openradlr.cockpit.layout`
- All UI text in `client/public/js/i18n/en.js` and `de.js` under `screens.*` and `cockpit.*`. No hard-coded English in JS or HTML.
- Tests are written first, with one reason to fail per test, no sleeps, and time, sockets and storage injected.
- Don't edit `CHANGELOG.md`.
- **Commands** (run from the repo root):
  - Rust: `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo test -p openradlr-server <filter>'`
  - Client: `docker run --rm -v "$PWD":/app -w /app/client node:22 node --test <files>`
  - Full gate: Rust with `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`; client with `node --test "test/**/*.test.js"; npx eslint .`

## Review Focus

1. **The tablet starts a new ride.** Each ride is a new connection. The phone must go `live: false` → `live: true` and get the new rider's state, not stay stuck on the old rider id. *Pinned in Task 3's e2e test.*
2. **The phone is open before the tablet rides, or after the server restarted.** The phone must show "waiting", not an error, and go live when the tablet joins. *Pinned in Task 2 (`watch` before any host) and Task 7 (status `waiting`).*
3. **A slow or dead watcher.** It must never block or slow the host's ride. Copies to watchers use `try_send` and drop when full. *Pinned in Task 2 (`a_full_watcher_does_not_block_the_host`).*
4. **Corrupt or old localStorage on the phone** (a layout with removed tile ids, or a non-JSON string). The cockpit must open with valid tiles. *Pinned in Task 8.*
5. **The tablet in the spin studio.** The `data` view must cut `studio_state.riders` to the host's seat, and the cockpit must show power and cadence from it. *Pinned in Task 2 (studio filter) and Task 7 (model from `studio_state`).*

---

### Task 1: Pairing codes (server)

**Files:**
- Create: `server/crates/server/src/pair_codes.rs`
- Modify: `server/crates/server/src/lib.rs` (add `pub mod pair_codes;` and a module doc line next to `vehicle_codes`)

**Interfaces:**
- Produces:
  - `pub struct PairCodes` (Clone; shares `Arc<Mutex<…>>` like `VehicleCodes`)
  - `PairCodes::new() -> Self`
  - `pub fn offer(&self, key: String, name: String, notify: mpsc::Sender<ServerMessage>, replaces: Option<&str>, now_s: f64) -> String`: returns a new code, removes the `replaces` code and sweeps expired ones. `notify` is the offering connection's outbox.
  - `pub fn claim(&self, code: &str, now_s: f64) -> Option<(String, String)>`
    - Returns `(key, name)` and removes the code.
    - `try_send`s `ServerMessage::PairClaimed` to the stored `notify`.
    - Codes are trimmed and upper-cased before lookup.
- New `ServerMessage` variants in `protocol.rs`, added here because the registry and Task 2 need them:
  - `PairCode { code: String, expires_in_s: f64 }`
  - `Paired { key: String, name: String }`
  - `PairClaimed`
  - `WatchStatus { live: bool, name: String }`
  - `Display { data: serde_json::Value }`

  The serde tag is snake_case like the existing ones.
  - `pub const PAIR_CODE_TTL_S: f64 = 300.0`
  - `pub const PAIR_ALPHABET: &[u8]`

  The code generator takes an injected `FnMut() -> u8`-style random source in a private constructor `with_random`; `new()` uses `secure_random::random_bytes`.

- [ ] **Step 1: Write the failing tests** (in `pair_codes.rs` `#[cfg(test)]`):
  - `codes_are_six_characters_from_the_alphabet`
  - `a_code_claims_its_key_and_name_once` (the second claim gives `None`; the offering outbox receives `PairClaimed`)
  - `a_code_expires_after_five_minutes` (claimable at 299.9 s, `None` at 300.0 s)
  - `a_new_offer_replaces_the_old_code`
  - `claims_ignore_case_and_spaces` (`" ab3k9z "` finds `AB3K9Z`)
  - `codes_do_not_repeat_while_live` (a fake random source that repeats a code first; the second offer still gets a different code)
- [ ] **Step 2:** Run `cargo test -p openradlr-server pair_codes`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the module.
- [ ] **Step 4:** Run the same command. Expected: PASS, 6 tests.
- [ ] **Step 5:** Commit: `feat(server): Add pairing codes for second screens`

---

### Task 2: Screens relay hub (server)

**Files:**
- Create: `server/crates/server/src/screens.rs`
- Modify: `server/crates/server/src/lib.rs` (module and doc line)

**Interfaces:**
- Consumes: `ServerMessage` (`Clone`), `RiderId`, `tokio::sync::mpsc::Sender<ServerMessage>`.
- Produces:
  - `pub enum WatchView { Data, World }`: serde `snake_case`, `Deserialize`, `Default = Data`.
  - `pub struct Screens` (Clone, shared registry) and `Screens::new()`.
  - `pub fn host(&self, key: &str, rider_id: RiderId, name: String) -> HostGuard`
    - Registers the host, replacing any earlier one.
    - Sends `WatchStatus { live: true, name }` to every watcher.
  - `pub fn watch(&self, key: &str, view: WatchView, outbox: mpsc::Sender<ServerMessage>) -> Result<WatchGuard, TooManyScreens>`
    - Sends `WatchStatus { live, name }` right away. With no host it is `live: false` and `name: ""`.
    - At most `MAX_WATCHERS = 4`.
  - `HostGuard::publish(&self, message: &ServerMessage)`
    - Skips `Welcome`, `Joined` and `Error`.
    - Applies the view filter per watcher.
    - Uses `try_send`, dropping when full.
  - `HostGuard::display(&self, data: serde_json::Value)`: sends `ServerMessage::Display { data }` to all watchers.
  - On drop, `HostGuard` sends `WatchStatus { live: false, name }` if it is still the current host, and removes the entry when empty. On drop, `WatchGuard` removes its watcher.
  - `pub fn data_view(message: &ServerMessage, rider_id: RiderId) -> ServerMessage`:
    - `State.riders` keeps only `id == rider_id`.
    - `StudioState.riders` keeps only the host's id, and `road_riders` is emptied.
    - Everything else is cloned unchanged.
- Consumes from Task 1: the `WatchStatus` and `Display` variants.

- [ ] **Step 1: Write the failing tests** (in `screens.rs`):
  - `a_watcher_without_a_host_waits` (first message `WatchStatus { live: false }`)
  - `a_host_arriving_tells_its_watchers` (`live: true` with the host's name)
  - `the_host_stream_reaches_watchers` (a `Resistance` arrives)
  - `the_host_handshake_and_errors_are_not_copied` (`Welcome`, `Joined` and `Error` are not received)
  - `the_data_view_keeps_only_the_host_rider` (a `State` with 3 riders arrives with 1)
  - `the_data_view_keeps_only_the_host_seat_in_the_studio` (`StudioState` riders cut, `road_riders` empty)
  - `the_world_view_passes_everything`
  - `display_reaches_every_watcher`
  - `the_fifth_watcher_is_refused`
  - `a_newer_host_replaces_the_older` (the old guard's drop sends no `live: false`)
  - `the_host_leaving_tells_its_watchers`
  - `the_entry_is_gone_when_empty` (an internal `len()` for tests)
  - `a_full_watcher_does_not_block_the_host` (a watcher channel of capacity 1, not drained; 10 publishes return at once and a second watcher gets all 10)
- [ ] **Step 2:** Run `cargo test -p openradlr-server screens`. Expected: FAIL.
- [ ] **Step 3:** Implement, using a `std::sync::Mutex` for the map (no await inside).
- [ ] **Step 4:** Run the same command. Expected: PASS, 13 tests.
- [ ] **Step 5:** Commit: `feat(server): Relay a rider's messages to paired screens`

---

### Task 3: Watcher and pairing sessions, wiring, info (server)

**Files:**
- Modify:
  - `server/crates/server/src/protocol.rs`
  - `server/crates/server/src/session.rs`
  - `server/crates/server/src/connection.rs`
  - `server/crates/server/src/http.rs` (`AppState`, `InfoResponse`)
  - `server/crates/server/src/app.rs` (construct both registries)
- Test: `session.rs` tests; `server/crates/server/tests/websocket_flow.rs`

**Interfaces:**
- Consumes: Task 1 `PairCodes`, Task 2 `Screens`, `WatchView`, `HostGuard`, `WatchGuard`.
- Produces (protocol):
  - `ClientMessage::PairOffer { key, name }`
  - `ClientMessage::PairClaim { code }`
  - `ClientMessage::Watch { key, #[serde(default)] view: WatchView }`
  - `ClientMessage::Display { data: serde_json::Value }`
  - `Join` gains `#[serde(default)] screen_key: Option<String>`

  A key that isn't 32 lowercase hex characters is answered with `error { code: "bad_screen_key" }`.
- Session:
  - New `Phase::Watching`.
  - New `Action::PairOffer { key, name }`, `Action::PairClaim { code }`, `Action::Watch { key, view }` and `Action::Display(serde_json::Value)`.
  - `Action::Join` gains `screen_key`.
  - `PairOffer` and `PairClaim` are accepted in `AwaitingJoin` and keep the phase.
  - `Watch` in `AwaitingJoin` moves to `Watching`.
  - In `Watching`, only `Leave` is acted on; everything else gives `Ignore`.
  - `Display` in `Joined` passes through a new `TokenBucket` (burst 2, 2/s) and a 2048-byte check on `data.to_string().len()`. Otherwise it gives `Ignore`.
  - `expired()` and AFK never fire in `Watching`.
- Connection:
  - Holds `Option<HostGuard>` behind `Arc<std::sync::Mutex<…>>`, shared with the write task. The write task calls `publish(&message)` before sending each message to its socket.
  - After a successful join or reattach with `screen_key`, set `state.screens.host(key, rider_id, name)`.
  - `Action::Watch` calls `state.screens.watch(key, view, outbox.clone())` and keeps the `WatchGuard`. On `TooManyScreens` it sends the error and breaks.
  - `Action::PairOffer` calls `state.pair_codes.offer(key, name, outbox.clone(), last_code, now)`, replies `PairCode { code, expires_in_s: 300.0 }` and keeps the code as `last_code`.
  - `Action::PairClaim` replies `Paired { key, name }` or `pair_code_invalid`.
  - Watchers take no player seat.
- Info: `InfoResponse.screens: bool`, always `true` on this server.

- [ ] **Step 1: Write the failing session tests:**
  - `pairing_needs_no_join`
  - `watch_moves_to_watching`
  - `a_watcher_cannot_ride` (telemetry gives `Ignore`)
  - `a_watcher_never_times_out`
  - `display_over_2048_bytes_is_dropped`
  - `display_beyond_two_per_second_is_dropped`
  - `a_bad_screen_key_is_refused`
- [ ] **Step 2: Write the failing e2e test** `a_paired_phone_follows_the_tablets_rides` in `tests/websocket_flow.rs`, using the existing `start_server`, `connect`, `send` and `expect_type`:
  1. The tablet sends hello and `pair_offer` and gets `pair_code`.
  2. The phone sends hello and `pair_claim` and gets `paired` with the same key. The tablet gets `pair_claimed`.
  3. The phone sends `watch` and gets `watch_status` with `live: false`.
  4. The tablet (a new socket) joins with `screen_key`. The phone gets `watch_status` with `live: true`, then a `state` whose `riders` has length 1 and the tablet's id.
  5. The tablet sends `display {"data":{"hr":120}}`, and the phone gets it.
  6. The tablet closes. The phone gets `live: false`.
  7. A new tablet socket joins with the same key, and the phone gets `live: true` again.
- [ ] **Step 3: Write the failing e2e tests:**
  - `info_announces_screens`
  - `an_unknown_pair_code_is_refused` (`pair_code_invalid`)
- [ ] **Step 4:** Run `cargo test -p openradlr-server` (all). Expected: the new tests FAIL.
- [ ] **Step 5:** Implement the wiring.
- [ ] **Step 6:** Run the full Rust gate (fmt, clippy, test). Expected: all PASS.
- [ ] **Step 7:** Commit: `feat(server): Pair second screens and let them watch a ride`

---

### Task 4: Docs

**Files:**
- Modify: `docs/protocol.md`
  - Client → server table: `pair_offer`, `pair_claim`, `watch`, `display`, and `join.screen_key`.
  - Server → client table: `pair_code`, `paired`, `pair_claimed`, `watch_status`, `display`.
  - New section `### Second screens`: the relay, the `data` and `world` views, the limits, and that nothing is stored.
  - `/api/info`: `screens`.
- Create: `docs/adr/0026-second-screens-through-a-server-relay.md`: context, decision and consequences per spec "Docs". Include the privacy note on heart rate and "one composition root per page".
- Modify:
  - `AGENTS.md`: "`main.js` is the only composition root" → "one composition root per page (`main.js`, `gallery.js`, `cockpit/main.js`)".
  - `client/public/js/ride/rideSession.js`: the class comment line "Heart rate is shown locally only and never sent to the server." → "Heart rate is never sent to the game; with a paired second screen it is forwarded to that screen only (ADR 0026)."

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Check that `grep -n "pair_offer\|watch_status\|screen_key" docs/protocol.md` finds all three.
- [ ] **Step 3:** Commit: `docs: Record the second-screen relay`

---

### Task 5: Tablet pairing (client)

**Files:**
- Modify:
  - `client/public/js/net/protocol.js`: `ClientMessages.pairOffer({ key, name })`, `pairClaim(code)`, `watch(key, view = "data")`, `display(data)`; `join` adds `screen_key` when given `screenKey`.
  - `client/public/js/net/connection.js`: `sendDisplay(data)`.
- Create: `client/public/js/net/screenPairing.js`
  - `export function screenKey(storage, randomBytes) -> string`: reads `openradlr.screenKey` or creates and stores 32 hex characters.
  - `export function renewScreenKey(storage, randomBytes) -> string`: always creates a new key and clears `openradlr.screenPaired`.
  - `export function isPaired(storage) -> boolean`
  - `export class PairingSession extends Emitter`, constructed with `{ url, createSocket, key, name, storage }`:
    - `start()` sends hello and `pair_offer`.
    - It emits `code` with `{ code, expiresInS }`, `claimed` (and sets `openradlr.screenPaired = "1"`) and `error`.
    - `renew()` sends a new offer. `close()` closes it.
  - `export function claimCode({ url, createSocket, code }) -> Promise<{ key, name }>`: hello, `pair_claim`; rejects with `code` on `pair_code_invalid`.
- Create: `client/public/js/view/screensDialog.js`: the dialog behaviour (code, countdown, New code, Unpair all with `confirm`). DOM and clock are injected like the other `view/` dialogs.
- Modify:
  - `client/public/index.html`: a `<details id="screens" class="diagnostics" hidden>` after `#diagnostics`, with:
    - a `screens.title` summary;
    - a `screens.pair` button "Pair a second screen";
    - a `screens.useAsCockpit` button "Use this device as a cockpit";
    - a `<dialog id="screens-dialog">` with `#screens-code`, `#screens-countdown`, `#screens-renew`, `#screens-unpair` and `#screens-status`.
  - `client/public/js/main.js`:
    - unhide `#screens` when `info.screens`;
    - wire the dialog;
    - pass `screenKey` to `join` when `isPaired(localStorage)`;
    - `screens.useAsCockpit` runs Task 7's `startCockpit` flow: prompt for the code if `openradlr.cockpit` is missing, `claimCode`, store it, then `location.href = "cockpit.html"`.
  - `client/public/js/i18n/en.js` and `de.js`: `screens.*` strings, including the error text for `pair_code_invalid`: "Code not valid. Get a new one from the tablet." / "Code ungültig. Hol dir am Tablet einen neuen."
- Test: `client/test/screenPairing.test.js`
  - `the screen key is created once and kept`
  - `renewing makes a new key and forgets the pairing`
  - `a pairing session shows the code and marks the tablet paired when claimed` (fake socket)
  - `claiming an unknown code rejects with pair_code_invalid`
  - `join carries screen_key only when given` (in `protocol` terms)
- Test: `client/test/screensDialog.test.js`
  - `the countdown runs out and offers a new code`
  - `unpair asks first and renews the key`

- [ ] **Step 1:** Write the failing tests.
- [ ] **Step 2:** Run `node --test test/screenPairing.test.js test/screensDialog.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire. The i18n tests (`i18nHtml`, `i18nParity`) must stay green.
- [ ] **Step 4:** Run the full client gate. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(client): Pair a second screen from the start menu`

---

### Task 6: Display frames from the tablet (client)

**Files:**
- Create: `client/public/js/display/displayFrame.js`
  - `export function displayFrame({ heartRate, grade, ftp, recording, workout }) -> object`
    - `recording` is `{ summary, samples, pauses }` (as `overviewRecording()` in `main.js`).
    - `workout` is `app.training.workoutState()` plus the workout, or null.
    - Returns `{ hr?, grade?, ftp, stats, zones_s, workout? }`:
      - `stats` = `liveStats({ ...recording, ftp })`;
      - `zones_s` = an array of 6 numbers, the seconds in power zones 1–6 from `recording.samples` using `powerZone` (`view/hud.js`). Samples with zone 0 (no FTP) aren't counted;
      - `workout` = `{ id, step, step_elapsed_s, target_w, cadence }`.
    - Missing values are left out, never `null`.
  - `export function workoutPlanFrame(workout, ftp) -> { workout_plan: { id, name, steps: [{ s, from_w, to_w }] } }`
  - `export const DISPLAY_LIMIT_BYTES = 2048`
  - `id` is a stable string, `workout.name`.
- Modify: `client/public/js/main.js`
  - While riding with `isPaired`, a 1 s timer sends `app.connection.sendDisplay(displayFrame(...))`.
  - It sends `workoutPlanFrame` once when a workout starts and once right after joining if a workout is running.
  - It stops with the ride.
  - Heart rate comes from `app.session.latest.heartRate`, grade from `app.session.serverGrade`.
- Test: `client/test/displayFrame.test.js`
  - `a frame carries heart rate, grade and live stats`
  - `a frame without heart rate or workout leaves them out`
  - `time in zones adds up to the ridden seconds`
  - `the workout step and target come from the training state`
  - `every frame of a 2-hour ride stays under the limit`
  - `the plan of the longest preset workout stays under the limit` (over `PRESET_WORKOUTS`, `JSON.stringify(...).length <= DISPLAY_LIMIT_BYTES`)

- [ ] **Step 1:** Write the failing tests.
- [ ] **Step 2:** Run `node --test test/displayFrame.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run the full client gate. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(client): Send live ride data to paired screens`

---

### Task 7: Cockpit page with the default layout (client)

**Files:**
- Create: `client/public/cockpit.html`
  - Own `<link rel="stylesheet" href="cockpit.css">`.
  - `<script type="module" src="js/cockpit/main.js">`.
  - Texts via `data-i18n` like `index.html`.
- Create: `client/public/cockpit.css`. Use the custom properties and fonts from `styles.css`, with no duplicated selectors. Layout:
  - a CSS grid of 2 columns;
  - `big` and `wide` tiles span 2 columns, `half` spans 1.
- Create: `client/public/js/cockpit/cockpitConnection.js`
  - `export class CockpitConnection extends Emitter`, constructed with `{ url, createSocket, key, schedule }`.
  - `start()` sends hello and `watch {key, view: "data"}`.
  - It emits:
    - `status` with `{ live, name }`;
    - `state` with the message (`state` or `studio_state`);
    - `display` with `data`;
    - `invalid` on a `bad_screen_key` error.
  - It reconnects after close with backoff 1, 2, 4, 8, then 10 s, through the injected `schedule(fn, ms)`. `stop()` ends it.
- Create: `client/public/js/cockpit/cockpitModel.js`
  - `export class CockpitModel`, constructed with `{ now }`.
  - `onStatus(status)`, `onState(message, riderName)` and `onDisplay(data)`.
  - The rider comes from `state.riders[0]` or `studio_state.riders[0]`. The data view leaves only the host.
  - Getters:
    - `live` (status live and the last message < 3 s old);
    - `status`: one of `"waiting" | "live" | "stale"`;
    - `name`, `power3s`, `power`, `cadence`, `speed` (m/s);
    - `hr`, `grade`, `stats`, `zonesS`, `workout`, `plan`, `race`;
    - `history`: `{ power: number[], hr: number[], cadence: number[] }`, 1 Hz, at most 1200 entries.
- Create: `client/public/js/cockpit/tiles.js`
  - `export const TILES`: a frozen array of `{ id, labelKey, sizes, value?(model, format), draw?(ctx, model, w, h), hidden?(model) }` for these ids:
    - `power3s`, `heartRate`, `cadence`, `speed`, `grade`, `elapsed`, `workout`, `zones`, `avgPower`, `np`, `kj`, `distance`;
    - `efforts`, `load`, `climbed`, `avgHeartRate`, `powerGraph`, `hrGraph`, `laps`, `raceGaps`.
  - `export const DEFAULT_LAYOUT`: the spec's list of `{ id, size }`.
  - `export function tileById(id)`
  - Values use `util/format.js` (`formatSpeed`, `formatDistance`, `formatDuration`, `formatGrade`, `formatNumber`) for units, after `setUnits` from the stored profile's `units`.
  - The `power3s` tile carries `zone` (from `powerZone(power, ftp)`) for its colour class.
- Create: `client/public/js/cockpit/main.js` (the composition root)
  - Reads `openradlr.cockpit`. Without it, it shows the "not paired" message with a link to `index.html`.
  - Builds the connection, model and tile views.
  - Renders the tiles at 4 Hz from the model, and graph tiles on canvas at 1 Hz.
  - Wake lock through `util/wakeLock.js` while live.
  - A "Forget this tablet" button clears `openradlr.cockpit` and returns to `index.html`.
  - i18n through `i18n/apply.js` like the main page.
- Modify:
  - `client/public/sw.js`: add `/cockpit.html`, `/cockpit.css` and `/js/cockpit/main.js` to `SHELL`, and bump `CACHE` to `openradlr-shell-v3`.
  - `client/test/i18nHtml.test.js`: also scan `cockpit.html`.
  - en and de: the `cockpit.*` strings (tile labels, waiting "Waiting for {name}'s ride…", "Not live", "Forget this tablet", "not paired").
- Tests:
  - `client/test/cockpit/cockpitConnection.test.js`
    - `watching starts with hello and watch`
    - `status, state and display are emitted`
    - `a dropped connection retries with growing delays up to 10 s`
    - `a bad key stops retrying`
  - `client/test/cockpit/cockpitModel.test.js`
    - `waiting until the host is live`
    - `stale after 3 s without a message`
    - `the rider comes from state or studio_state`
    - `3 s power averages the last three seconds`
    - `history keeps 20 minutes`
  - `client/test/cockpit/tiles.test.js`
    - `every default tile exists and allows its size`
    - `number tiles read the model` (one assertion per tile in a table-driven loop with named cases)
    - `heart rate hides without data`
    - `workout hides outside a workout`

- [ ] **Step 1:** Write the failing tests.
- [ ] **Step 2:** Run `node --test test/cockpit/*.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the modules and the page.
- [ ] **Step 4:** Run the full client gate. Expected: PASS.
- [ ] **Step 5:** Manual check: run `make dev`, then take a Playwright screenshot of `cockpit.html` at 390×844, 1×, after pairing in a second page (recipe in AGENTS.md / memory).
- [ ] **Step 6:** Commit: `feat(client): Show a paired ride on a cockpit page`

---

### Task 8: Choose, reorder and resize tiles (client)

**Files:**
- Create: `client/public/js/cockpit/layout.js`
  - `export function loadLayout(storage) -> Array<{id, size}>`: parses `openradlr.cockpit.layout`. It drops unknown ids, sizes the tile doesn't allow, and duplicates. It returns a copy of `DEFAULT_LAYOUT` when the result is empty or doesn't parse.
  - `export function saveLayout(storage, layout)`
  - Pure, each returning a new array:
    - `moveTile(layout, from, to)`
    - `addTile(layout, id)` (appended with the tile's first size; a no-op if already shown)
    - `removeTile(layout, index)`
    - `resizeTile(layout, index)` (cycles through `tileById(id).sizes`)
    - `hiddenTiles(layout)` (`TILES` not in the layout, in catalogue order)
- Create: `client/public/js/cockpit/editMode.js`
  - `export class EditMode`, constructed with `{ root, onChange }`. It handles:
    - the pencil toggle (`#cockpit-edit`);
    - pointer-event dragging on `.tile-handle` (it computes the drop index from the pointer's position over tile rectangles, a pure `dropIndex(rects, x, y)` export);
    - ✕ and the size toggle per tile;
    - the "+" sheet (`#cockpit-add`) listing `hiddenTiles`;
    - "Reset" with `confirm`;
    - "Done", which calls `saveLayout`.
  - Outside edit mode, the handles and buttons are not rendered.
- Modify:
  - `client/public/js/cockpit/main.js`: use `loadLayout` instead of `DEFAULT_LAYOUT`, and wire `EditMode`.
  - `cockpit.html` and `cockpit.css`: the edit controls.
  - en and de: `cockpit.edit`, `cockpit.done`, `cockpit.add`, `cockpit.reset`, `cockpit.resetConfirm`, `cockpit.remove`, `cockpit.resize`.
- Tests:
  - `client/test/cockpit/layout.test.js`
    - `a first start gets the default layout`
    - `a saved layout loads back the same`
    - `unknown ids and bad sizes are dropped`
    - `corrupt storage gives the default`
    - `moving, adding, removing and resizing` (one test each)
    - `hidden tiles are the ones not shown`
  - `client/test/cockpit/editMode.test.js`
    - `dropIndex picks the slot under the pointer` (pure, rectangles as data)

- [ ] **Step 1:** Write the failing tests.
- [ ] **Step 2:** Run `node --test test/cockpit/layout.test.js test/cockpit/editMode.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run the full gate (Rust and client). Expected: PASS.
- [ ] **Step 5:** Screenshots at 1×: the pairing dialog, the cockpit live during a workout, and edit mode.
- [ ] **Step 6:** Commit: `feat(client): Choose, reorder and resize cockpit tiles`
