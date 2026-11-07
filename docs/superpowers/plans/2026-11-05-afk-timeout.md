# AFK Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riders who send 0 W for 30 min get up to three "Still riding?" warnings (Stay / Leave now, 2 min each), then a final Leave-only warning, then are removed with `afk_timeout`; every step is counted in a Prometheus counter shown on the Grafana dashboard.

**Architecture:** A pure `AfkWatch` state machine in a new `server/crates/server/src/afk.rs`, owned by `Session` and polled on the connection loop's existing 1 s tick; the connection loop sends warnings, removes timed-out riders like `leave`, and counts outcomes in a shared `AfkStats`. The client gets a pure `AfkPrompt` module plus a small alertdialog wired in `main.js`. Grafana panels go to the Monitoring repo in their own PR.

**Tech Stack:** Rust (axum, tokio, serde), plain ES modules + `node:test`, Prometheus text format, Grafana JSON.

**Spec:** `docs/superpowers/specs/2026-11-05-afk-timeout-design.md`

## Global Constraints

- Away = every `telemetry` since then had `power == 0` (raw power; pause counts as away). Back = any `telemetry` with `power > 0`: resets clock, warning count, closes an open warning.
- First warning after `OPENRADLR_AFK_TIMEOUT_S` (default 1800) away; after Stay the next after `OPENRADLR_AFK_REMINDER_S` (default 600). `OPENRADLR_AFK_TIMEOUT_S=0` turns it all off.
- Answer window 120 s per warning; no answer → `afk_timeout`.
- Three warnings with `can_stay: true`; the fourth has `can_stay: false`; `stay` is ignored then and when no warning is open.
- Removal = `Command::Leave` (no grace, no resume). Workout riders (`device: workout`) are exempt.
- Wire format: server `{ "type": "afk_warning", "leave_in_s": 120, "can_stay": true }`; client `{ "type": "stay" }`; error code `afk_timeout`. Additive, `PROTOCOL_VERSION` stays 2.
- Metric `openradlr_afk_events_total{event}` with `event` ∈ `warning`, `stayed`, `left`, `timeout`; all four printed from 0.
- UI text in `js/i18n/en.js` and `de.js` (ADR 0017). No sleeps in unit tests (CONTRIBUTING.md).
- Run Rust via Docker from the repo root: `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo test -p openradlr-server <filter>'`. Node: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js"; npx eslint .'`.

## Review Focus

1. A rider who pedals while the final (Leave-only) warning is open must not be removed — power resets everything. (Task 1 test `power_during_final_warning_resets`.)
2. A resumed connection (`resume_token`) must start a fresh away clock, not inherit nothing/garbage — `joined` is called on both join paths. (Task 3 test `reattached_rider_gets_a_fresh_clock` via `joined`; Task 4 wires both call sites.)
3. After `afk_timeout`, the client must not reconnect and take the seat back. (Task 6 Step: `afk_timeout` ends the ride before the socket's `close` fires.)
4. `stay` sent with no warning open (stale double-click, old dialog) must not push the next warning out. (Task 1 test `stay_without_a_warning_is_ignored`.)
5. A rider who presses Leave now in the dialog leaves at once (no grace) and is counted as `left`, not `timeout`. (Task 4 e2e `stay_then_leave_counts_each_outcome`.)

---

### Task 1: `AfkWatch` state machine

**Files:**
- Create: `server/crates/server/src/afk.rs`
- Modify: `server/crates/server/src/lib.rs` (add `pub mod afk;`)

**Interfaces:**
- Produces:
  - `pub const AFK_STAYS: u32 = 3;`
  - `pub enum AfkEvent { Warn { leave_in_s: u32, can_stay: bool }, Expire }` (`Debug, Clone, Copy, PartialEq`)
  - `pub struct AfkWatch` with
    - `pub fn new(timeout_s: f64, reminder_s: f64, answer_s: f64, now_s: f64) -> Self` (`timeout_s <= 0` → inert)
    - `pub fn inert() -> Self`
    - `pub fn on_power(&mut self, power: f64, now_s: f64)`
    - `pub fn on_stay(&mut self, now_s: f64) -> bool` (true when accepted)
    - `pub fn warning_open(&self) -> bool`
    - `pub fn poll(&mut self, now_s: f64) -> Option<AfkEvent>` (each `Warn` returned once; `Expire` once the open warning's answer window has passed)

- [ ] **Step 1: Write the failing tests** in `afk.rs` `#[cfg(test)] mod tests`, with `fn watch() -> AfkWatch { AfkWatch::new(1800.0, 600.0, 120.0, 0.0) }`:
  - `no_warning_before_the_timeout`: `poll(1799.0) == None`.
  - `warns_after_the_timeout`: `poll(1800.0) == Some(Warn { leave_in_s: 120, can_stay: true })`, then `poll(1801.0) == None` (once only).
  - `power_resets_the_clock`: `on_power(150.0, 1000.0)`; `poll(2799.0) == None`; `poll(2800.0)` is a `Warn`.
  - `zero_power_does_not_reset`: `on_power(0.0, 1000.0)`; `poll(1800.0)` is a `Warn`.
  - `unanswered_warning_expires`: warn at 1800; `poll(1919.0) == None`; `poll(1920.0) == Some(Expire)`.
  - `stay_moves_the_next_warning_by_the_reminder`: warn at 1800; `on_stay(1850.0) == true`; `!warning_open()`; `poll(2449.0) == None`; `poll(2450.0)` is `Warn { can_stay: true, .. }`.
  - `fourth_warning_is_final`: three cycles of poll-warn then `on_stay`; the fourth `Warn` has `can_stay: false`; `on_stay` then returns false and `poll(+120)` is `Expire`.
  - `stay_without_a_warning_is_ignored`: `on_stay(100.0) == false`; `poll(1800.0)` still a `Warn`.
  - `power_during_final_warning_resets`: reach the final warning, `on_power(80.0, t)`, `!warning_open()`, `poll(t + 120.0) == None`, next `Warn` at `t + 1800.0` has `can_stay: true`.
  - `zero_timeout_is_inert`: `AfkWatch::new(0.0, 600.0, 120.0, 0.0).poll(1e9) == None`; same for `AfkWatch::inert()`.

- [ ] **Step 2: Run** `cargo test -p openradlr-server afk::` → FAIL (module missing).

- [ ] **Step 3: Implement `AfkWatch`.** Fields: the three durations, `since_s` (start of the current away stretch), `threshold_s` (timeout, or reminder after a Stay), `stays: u32`, `open: Option<(f64 /*opened_s*/, bool /*can_stay*/)>`, `inert: bool`. A warning opens when `now - since >= threshold`, with `can_stay = stays < AFK_STAYS`. `on_stay` accepted: `stays += 1`, `since = now`, `threshold = reminder`, close. `on_power(p > 0)`: `since = now`, `threshold = timeout`, `stays = 0`, close. `leave_in_s` = `answer_s.round() as u32`. Module doc comment: what counts as away, pointing at the spec.

- [ ] **Step 4: Run** the same command → all PASS.

- [ ] **Step 5: Commit** `git add server/crates/server/src/afk.rs server/crates/server/src/lib.rs && git commit -m "Add the AFK watch state machine"`

### Task 2: `AfkStats` counter and metric export

**Files:**
- Modify: `server/crates/server/src/afk.rs`, `server/crates/server/src/http.rs` (`AppState`, `metrics`, `metrics_body`, `metrics_tests`), `server/crates/server/src/app.rs:273` (construct `AfkStats::default()`)

**Interfaces:**
- Produces:
  - `pub enum AfkOutcome { Warning, Stayed, Left, Timeout }`
  - `#[derive(Clone, Default)] pub struct AfkStats` (an `Arc` of four `AtomicU64`) with `pub fn record(&self, outcome: AfkOutcome)` and `pub fn snapshot(&self) -> AfkCounts`
  - `#[derive(Debug, Clone, Copy, Default, PartialEq)] pub struct AfkCounts { pub warning: u64, pub stayed: u64, pub left: u64, pub timeout: u64 }`
  - `AppState.afk: AfkStats`; `metrics_body(..., afk: AfkCounts)` as last parameter.

- [ ] **Step 1: Write failing tests.** In `afk.rs`: `stats_count_each_outcome_and_share_one_total` — clone a `AfkStats`, record `Warning` twice on one handle and `Timeout` on the clone; `snapshot() == AfkCounts { warning: 2, timeout: 1, ..Default::default() }`. In `http.rs` `metrics_tests`: extend `metrics_export_only_aggregate_operational_stats` to pass `AfkCounts { warning: 3, stayed: 2, left: 1, timeout: 0 }` and assert the output contains `# TYPE openradlr_afk_events_total counter\n` and the four lines `openradlr_afk_events_total{event="warning"} 3\n`, `…{event="stayed"} 2\n`, `…{event="left"} 1\n`, `…{event="timeout"} 0\n`.
- [ ] **Step 2: Run** `cargo test -p openradlr-server afk:: metrics_tests` → FAIL (compile).
- [ ] **Step 3: Implement.** HELP text: `AFK warnings and their outcomes since the server started.` Fix every `AppState { .. }` literal the compiler points at (app.rs, test helpers) with `afk: AfkStats::default()`.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `"Export AFK events as a Prometheus counter"`

### Task 3: Protocol messages, config and `Session` wiring

**Files:**
- Modify: `server/crates/server/src/protocol.rs` (`ClientMessage::Stay`, `ServerMessage::AfkWarning { leave_in_s: u32, can_stay: bool }`), `guard.rs` (`ConnectionLimits`), `config.rs` (fields, env parsing, `connection_limits()`, config tests), `session.rs` (own an `AfkWatch`), `.env.example`

**Interfaces:**
- Consumes: Task 1 `AfkWatch`, `AfkEvent`.
- Produces:
  - `ConnectionLimits` gains `afk_timeout_s: f64` (1800.0), `afk_reminder_s: f64` (600.0), `afk_answer_s: f64` (120.0).
  - `Config` gains `afk_timeout_s`, `afk_reminder_s` (from `OPENRADLR_AFK_TIMEOUT_S`, `OPENRADLR_AFK_REMINDER_S`) and `afk_answer_s` (no env var, default 120.0, for tests); `connection_limits()` copies all three.
  - `Session::joined(&mut self, rider_id: RiderId, device: DeviceKind, now_s: f64)` — starts a fresh `AfkWatch` (inert for `DeviceKind::Workout`).
  - `Session::poll_afk(&mut self, now_s: f64) -> Option<AfkEvent>`, `Session::afk_warning_open(&self) -> bool`.
  - `Action::Stayed` — returned for an accepted `stay`; a rejected `stay` returns `Action::Ignore`.

- [ ] **Step 1: Write failing tests.**
  - protocol.rs: `{"type":"stay"}` parses to `ClientMessage::Stay`; `ServerMessage::AfkWarning { leave_in_s: 120, can_stay: false }.to_json()` equals `{"type":"afk_warning","leave_in_s":120,"can_stay":false}`.
  - config.rs (next to the `grace_s` asserts at :552): defaults 1800.0 / 600.0; `OPENRADLR_AFK_TIMEOUT_S=0` accepted; `OPENRADLR_AFK_TIMEOUT_S=-1` and `OPENRADLR_AFK_REMINDER_S=0` are errors with that key; `connection_limits().afk_timeout_s` mirrors the config.
  - session.rs, with limits `afk_timeout_s: 30.0, afk_reminder_s: 10.0, afk_answer_s: 5.0`:
    - `zero_power_telemetry_warns_after_the_timeout`: join, `joined(id, Trainer, 0.0)`, telemetry `power 0` at 10.0; `poll_afk(30.0)` is a `Warn`.
    - `pedalling_postpones_the_warning`: telemetry `power 120` at 20.0; `poll_afk(30.0) == None`.
    - `accepted_stay_is_reported`: after the warning, `on_text({"type":"stay"}, 31.0) == Action::Stayed`; a second one `== Action::Ignore`.
    - `workout_riders_never_warn`: `joined(id, Workout, 0.0)`; `poll_afk(1e6) == None`.
    - `reattached_rider_gets_a_fresh_clock`: `joined(id, Trainer, 0.0)`, then `joined(id, Trainer, 100.0)`; `poll_afk(129.0) == None`, `poll_afk(130.0)` is a `Warn`.
  - Update existing callers of `joined(rider_id)` in session tests.
- [ ] **Step 2: Run** `cargo test -p openradlr-server session:: config:: protocol::` → FAIL.
- [ ] **Step 3: Implement.** Validation messages like `grace_s`: timeout "must be a finite number of seconds (0 or more)", reminder "must be a finite number of seconds above 0". `Session` feeds `afk.on_power(power, now_s)` in the `Telemetry` arm before forwarding, and handles `(Phase::Joined(_), ClientMessage::Stay)`. Before `joined`, `poll_afk` returns `None` (`AfkWatch::inert()` from `new`). Add both env vars, commented, to `.env.example` next to `OPENRADLR_GRACE_S`.
- [ ] **Step 4: Run** → PASS; also `cargo clippy --all-targets -- -D warnings` clean except the not-yet-updated `connection.rs` call sites, which Task 4 fixes — if the crate doesn't compile, update the two `session.joined(...)` calls in `connection.rs` here with the `device` from `Action::Join` and `now()`.
- [ ] **Step 5: Commit** `"Watch for riders who stopped pedalling in the session"`

### Task 4: Connection loop and end-to-end tests

**Files:**
- Modify: `server/crates/server/src/connection.rs` (`checks.tick()` arm at :185, the `Action::Leave` arm, new `Action::Stayed` arm)
- Test: `server/crates/server/tests/websocket_flow.rs`

**Interfaces:**
- Consumes: `Session::poll_afk`, `Session::afk_warning_open`, `Action::Stayed`, `AfkStats::record`, `ServerMessage::AfkWarning`, `Config.afk_*`.

- [ ] **Step 1: Write failing e2e tests** using `test_config(0)` with `afk_timeout_s: 0.5, afk_reminder_s: 0.5, afk_answer_s: 0.5` and `expect_type`/`http_get`:
  - `afk_rider_is_warned_then_removed_without_grace`: Anna joins and sends nothing; `expect_type("afk_warning")` has `can_stay == true`; then `expect_type("error")` has `code == "afk_timeout"`; Ben connects and joins; his first `state` lists no rider named `"Anna"`; `/internal/metrics` contains `openradlr_afk_events_total{event="timeout"} 1` and `{event="warning"} 1`.
  - `stay_then_leave_counts_each_outcome`: warning → send `{"type":"stay"}` → a second `afk_warning` → send `{"type":"leave"}`; metrics show `warning` 2, `stayed` 1, `left` 1, `timeout` 0.
- [ ] **Step 2: Run** `cargo test -p openradlr-server --test websocket_flow afk` → FAIL.
- [ ] **Step 3: Implement** in the tick arm, after `expired()`: `match session.poll_afk(now())` — `Warn { leave_in_s, can_stay }` → `state.afk.record(Warning)`, send `ServerMessage::AfkWarning`; `Expire` → `record(Timeout)`, send `ServerMessage::error("afk_timeout", "no pedalling for too long")`, `leaving = true`, `break`. `Action::Stayed` → `record(Stayed)`. `Action::Leave` → `record(Left)` if `session.afk_warning_open()` before setting `leaving`. Log `tracing::info!` on timeout (no rider name).
- [ ] **Step 4: Run** the e2e filter, then the full server suite + fmt + clippy → PASS.
- [ ] **Step 5: Commit** `"Warn and remove AFK riders on the connection"`

### Task 5: Client protocol and `AfkPrompt`

**Files:**
- Modify: `client/public/js/net/protocol.js` (`stay` builder, `"afk_warning"` in `SERVER_TYPES`), `client/public/js/net/connection.js` (`stay()` next to `pause()`)
- Create: `client/public/js/ride/afkPrompt.js`, `client/test/afkPrompt.test.js`
- Test: `client/test/net.test.js` (builder + parse)

**Interfaces:**
- Produces:
  - `ClientMessages.stay() → { type: "stay" }`; `GameConnection#stay()`.
  - `export class AfkPrompt` — `constructor({ stay, leave, now })` (`stay()` sends to the server, `leave()` ends the ride, `now()` ms); `open({ leave_in_s, can_stay })`; getters `visible: boolean`, `canStay: boolean`; `secondsLeft(): number` (ceil, ≥ 0); `power(watts)` (closes when `watts > 0`); `pressStay()` (calls `stay`, closes; no-op if `!canStay`); `pressLeave()` (closes, calls `leave`).

- [ ] **Step 1: Write failing tests** (`node:test`, fake `now`):
  - `opens with the server's countdown`: `open({ leave_in_s: 120, can_stay: true })` at 0 → `visible`, `secondsLeft() === 120`; at `now = 30_500` → `90`; past the end → `0`.
  - `pedalling closes it`: `power(0)` keeps it open; `power(95)` → `!visible`, no `stay`/`leave` call.
  - `stay sends and closes`: `pressStay()` → `stay` called once, `!visible`.
  - `the final warning has no stay`: `open({ leave_in_s: 120, can_stay: false })` → `canStay === false`; `pressStay()` doesn't call `stay` and stays visible.
  - `leave ends the ride`: `pressLeave()` → `leave` called once, `!visible`.
  - net.test.js: `ClientMessages.stay()` deep-equals `{ type: "stay" }`; `parseServerMessage('{"type":"afk_warning","leave_in_s":120,"can_stay":true}')` is not null.
- [ ] **Step 2: Run** node tests → FAIL.
- [ ] **Step 3: Implement** the module (JSDoc header like `ride/rideSession.js`).
- [ ] **Step 4: Run** node tests + eslint → PASS.
- [ ] **Step 5: Commit** `"Add the AFK prompt and stay message to the client"`

### Task 6: Client dialog and `afk_timeout` handling

**Files:**
- Modify: `client/public/index.html` (dialog markup next to `#reconnecting` at :804), `client/public/styles.css`, `client/public/js/i18n/en.js`, `client/public/js/i18n/de.js`, `client/public/js/main.js`

**Interfaces:**
- Consumes: `AfkPrompt`, `GameConnection#stay()`, existing `finishRide()` (main.js:2402), `notify()`, `t()`.

- [ ] **Step 1: Add markup:** `<div id="afk-prompt" class="afk-prompt" role="alertdialog" aria-labelledby="afk-title" hidden>` with `<h2 id="afk-title" data-i18n="afk.title">`, `<p id="afk-text">`, buttons `#afk-stay` (`class="primary"`, `data-i18n="afk.stay"`) and `#afk-leave` (`class="secondary"`, `data-i18n="afk.leave"`). Style it like `.finish-confirm` (centred card over the ride).
- [ ] **Step 2: Add i18n keys** (exact copy):

  | key | en | de |
  | --- | --- | --- |
  | `afk.title` | Still riding? | Fährst du noch? |
  | `afk.body` | No pedalling for a while. Your ride ends in {time}. | Eine Weile kein Treten. Deine Fahrt endet in {time}. |
  | `afk.finalBody` | Still no pedalling. Your ride ends in {time}. | Immer noch kein Treten. Deine Fahrt endet in {time}. |
  | `afk.stay` | Stay | Bleiben |
  | `afk.leave` | Leave now | Jetzt verlassen |
  | `afk.removed` | You were removed after a long time without pedalling. | Du wurdest nach langer Zeit ohne Treten entfernt. |

- [ ] **Step 3: Wire `main.js`.** In ride start (next to `initFinish()` at :1908) create `app.afkPrompt = new AfkPrompt({ stay: () => app.connection?.stay(), leave: () => finishRide(), now: () => Date.now() })` and hook the two buttons. In `wireConnection`: `on("afk_warning", (m) => { app.afkPrompt.open(m); $("afk-stay").focus() /* or #afk-leave when !can_stay */ })`. In the ride loop at :1915 call `renderAfkPrompt()` after `draw()`: feeds `app.session?.latest.power` to `power()`, toggles `#afk-prompt` hidden and `#afk-stay` hidden by `canStay`, writes `afk.body`/`afk.finalBody` with `formatDuration(secondsLeft())`. In the `on("error")` handler, first: `if (code === "afk_timeout") { app.afkPrompt?.pressLeave(); notify(t("afk.removed"), "error"); return; }` — `finishRide()` clears `app.connection` before the socket's `close`, so `connectionLost` does not reconnect; confirm by reading `connectionLost` and `finishRide`, and if the close still reconnects, guard `connectionLost` with `if (lost !== app.connection) return`.
- [ ] **Step 4: Run** node tests + eslint (i18nParity/i18nHtml tests cover the keys) → PASS.
- [ ] **Step 5: UI check.** Start `make dev` with `OPENRADLR_AFK_TIMEOUT_S=5` (via `.env.dev`), ride with the simulated trainer at 0 W, take a screenshot per AGENTS.md (Playwright Docker recipe) of the warning, and of the final one after pressing Stay three times with `OPENRADLR_AFK_REMINDER_S=5`. Not committed.
- [ ] **Step 6: Commit** `"Show the AFK warning and end the ride on afk_timeout"`

### Task 7: Docs, changelog and PR

**Files:**
- Modify: `docs/protocol.md` (timeouts paragraph at :28; `stay` row in client table; `afk_warning` in server messages; `afk_timeout` in the error list at :159; a line in the version-2 history next to :231 "AFK warnings added `afk_warning`, `stay` and `afk_timeout` within version 2"), `CHANGELOG.md` (`[Unreleased]` → Added), spec `Status: implemented`

- [ ] **Step 1: Write the docs** with the exact values from Global Constraints.
- [ ] **Step 2: Run** `make check` (or the two Docker commands) → all green.
- [ ] **Step 3: Commit** `"Document AFK warnings"`, push `feat/afk-timeout`, open the PR with `gh pr create` (why: idle riders hold seats forever; link the spec), assign `RalfLeonFasler`, do not merge.

### Task 8: Grafana panels (Monitoring repo, separate PR)

**Files:**
- Modify: `../Monitoring/grafana/dashboards/openradlr.json` on a new branch `feat/openradlr-afk-panels` from `origin/main` (the local checkout sits on stale `fix/grafana-port`; check `git status` is clean first)

- [ ] **Step 1: Add two panels** below the existing ones (`y: 21`): id 9, `stat`, "AFK removals · selected range", `w: 6, h: 8`, expr `increase(openradlr_afk_events_total{event="timeout"}[$__range])`; id 10, `timeseries`, "AFK warnings and outcomes", `x: 6, w: 18, h: 8`, expr `sum by (event) (increase(openradlr_afk_events_total[1h]))`, `legendFormat: "{{event}}"`. Match the existing panels' `datasource` and `fieldConfig` style.
- [ ] **Step 2: Validate** `python3 -m json.tool grafana/dashboards/openradlr.json >/dev/null` → no output.
- [ ] **Step 3: Commit, push, open the PR** (mention it shows "No data" until OpenRadlr with the counter is deployed; link the OpenRadlr PR), assign `RalfLeonFasler`, do not merge.
