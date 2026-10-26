# Events, Group Rides and Matched Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scheduled races and group rides on route worlds, with power sharing on group rides and bots matched to the riders' level.

**Architecture:** A pure `Schedule` (shared with the studio's `Timetable`) tells when each event is in lobby or running. A new `sim::events::Events` drives the lifecycle against the `World` (races via the existing race state machine, group rides via a pure `sharing` module). `GameCore` owns one `Events` per world, adds `join_event`/`leave_event`, an `event` field in `state` and three game events; `/api/info` lists upcoming events. The client estimates the rider's level, lists events, shows the lobby banner, the sharing line and results.

**Tech Stack:** Rust (sim crate without dependencies, server with axum/tokio/serde), vanilla JS ES modules, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-16-events-group-rides-design.md`

## Commands (Docker; `cargo`, `npm`, `make` are not on the host)

```bash
# Rust tests (whole workspace or a filter)
RUST='docker run --rm -v /root/projects/Open-Ride:/src -w /src/server -v openradlr-cargo-registry:/usr/local/cargo/registry -v openradlr-cargo-target:/src/server/target rust:1-bookworm'
$RUST cargo test --workspace
$RUST sh -c 'rustup component add clippy rustfmt >/dev/null 2>&1; cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings'
# Client tests and lint (mount the whole repo: tests read routes/)
docker run --rm -v /root/projects/Open-Ride:/src -w /src/client node:22-alpine npm test
docker run --rm -v /root/projects/Open-Ride:/src -w /src/client node:22-alpine npm run lint
```

## Global Constraints

- Protocol stays **version 2**; every change is additive (new optional fields, new message types).
- `sim` stays free of I/O, clocks and dependencies; time comes in as `now_s: f64` (Unix seconds).
- The studio behaves exactly as before; existing studio tests pass unmodified.
- Bots never change strength after they spawn; event bots are drawn once, at the event start.
- Power sharing: threshold **15 s**, ramp **30 s**, max give share **0.40**, easing time constant **3 s**, receiver cap **+100 %** of own power, gap speed floor **3 m/s**, computed once per second. Watts given = watts received, every computation.
- Bot mix: **70 %** pack bots at **0.95–1.10 ×** a human's W/kg, **30 %** field bots from `min(2.0, slowest)` to `max(4.5, fastest)`; more than **8** humans → 8 quantile bands. Human level: `level_w`, else `ftp_w`, else **2.8 W/kg** × weight. Intensity: free 0.70, race 0.95, group ride **0.75**.
- Event bots: `bots_per_entrant` **4**, `max_event_bots` **24**; bots-only event: `max_event_bots / 2`.
- Lobby default **600 s** (`OPENRADLR_EVENT_LOBBY_S`). Built-ins: group ride hourly at :00 (45 min, 18 km); race every 2 h at **:20** (25 min, laps = max(1, round(12 000 m / route length))) on the route of the *next* hour's group ride, so its window (:10–:45) sits between that route's group rides; single-route world: race every 2 h at :00 replacing that hour's group ride.
- Level estimate: rides ≥ 20 min raise it toward best-20-min × 0.95 by at most 5 %, never lower it; races move it toward the race average by at most 5 % either way; changing FTP resets it.
- Copy (exact): `Group ride starts in 9:12 · J to join`, `Race starts in 9:12 · J to join`, `−50 W → Anna, Ben`, `+30 W from Chris`, `Lobby opens 13:50`, `in 12:40`, `Riding level 3.1 W/kg (from your rides)`, ride name `OpenRadlr group ride · <route>` / `OpenRadlr race · <route>`. The minus sign is U+2212.
- Serde: `GameEvent` is tagged by `kind`, so payload fields of new game events must not be named `kind` (use `event_kind`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One branch `feat/events`, one PR, assignee `RalfLeonFasler`, never merge.

Decisions made here that refine the spec (implementers follow these):
- `Schedule` reports `Upcoming | Lobby | Running` only; the end of an event is decided by `Events` (race finished, distance covered, or time up), not by the schedule.
- The built-in race starts at :20, not :30: on a route that has a group ride the hour after, a race at :30 (until :55) would overlap that ride's lobby (from :50).
- No `OPENRADLR_EVENT_SPEEDUP`: e2e tests use an events file with short times instead.
- `state.event` carries `starts_in_s` (negative once running) instead of absolute times, so client clock skew doesn't matter; `/api/info` carries `now_s` alongside absolute `starts_at_s` for the menu.

## Review Focus

1. **A manual opt-in race running or announced on a route when an event's lobby opens or the event starts** → manual `start_race` is refused during an event's lobby/run (`event_scheduled`), and a manual race still running at the event start is aborted without results so the event can start. Test in Task 5.
2. **A race event that never finishes** (an entrant stops pedalling) → the event is force-finished at `ends_at + 600 s`: finishers keep their places, everyone else is DNF. Test in Task 6.
3. **A rider who disconnects mid group ride while they give or receive power** → sharing is recomputed without them on the next computation, totals stay exact, no stale `power_adjust` remains on anyone. Test in Task 6.
4. **The route wrap**: group gaps must use distance since the event start, not lap position, so a rider just past the line is not "a lap behind". Test in Task 6.
5. **A rider who signs up and then switches route via a junction turn** → entrants can't turn during lobby or run (same as race entrants, `WorldError::Racing`), so they are always on the event's route at the start. Test in Task 5.

---

### Task 1: Shared `Schedule`; studio `Timetable` on top of it

**Files:**
- Create: `server/crates/sim/src/schedule.rs`
- Modify: `server/crates/sim/src/lib.rs` (add `pub mod schedule;`)
- Modify: `server/crates/sim/src/studio.rs:84-130` (`Timetable` uses `Schedule`)

**Interfaces:**
- Produces:
  ```rust
  pub enum Schedule {
      Every { every_s: f64, offset_s: f64, lobby_s: f64, duration_s: f64 },
      Once { starts_at_s: f64, lobby_s: f64, duration_s: f64 },
  }
  pub enum Phase { Upcoming, Lobby, Running }
  pub struct Occurrence { pub index: u64, pub lobby_opens_at_s: f64, pub starts_at_s: f64, pub ends_at_s: f64, pub phase: Phase }
  impl Schedule {
      pub fn at(&self, now_s: f64) -> Option<Occurrence>; // window [lobby_open, end) containing now, else the next one; None: Once after its end
      pub fn occurrence(&self, index: u64) -> Option<Occurrence>; // phase relative to its own start: Upcoming
      pub fn overlaps(&self, other: &Schedule) -> bool; // windows [lobby_open, end) intersect within one week from Unix 0 (Every) or at the Once
  }
  ```
  `Every`: occurrence `k` starts at `k·every_s + offset_s`; current `k = floor((now − offset + lobby) / every)`, clamped ≥ 0.

- [ ] **Step 1: Write failing tests in `schedule.rs`** (`#[cfg(test)] mod tests`)
  - `every_reports_lobby_running_and_next`: `Every{every 3600, offset 0, lobby 600, duration 2700}` → at 3000 s: index 1, `Lobby`, `starts_at_s == 3600.0`; at 3600: `Running`; at 6299: `Running`; at 6300: index 2, `Upcoming`, `lobby_opens_at_s == 6600.0`.
  - `offset_moves_the_start`: offset 1800 → at 0: index 0 `Upcoming` starts 1800; at 1300: `Lobby`.
  - `once_ends`: `Once{starts_at 1000, lobby 100, duration 50}` → at 0 `Upcoming`, at 950 `Lobby`, at 1049 `Running`, at 1050 `None`.
  - `overlap_detection`: hourly :00 lobby 600 duration 2700 vs every 7200 offset 1800 lobby 600 duration 1500 → `true`; vs every 7200 offset 3600 (odd hours) duration 2700 with the hourly every 7200 offset 0 → `false`.
- [ ] **Step 2: Run** `$RUST cargo test -p openradlr-sim schedule` → FAIL (module missing).
- [ ] **Step 3: Implement `schedule.rs`.**
- [ ] **Step 4: Rebuild `Timetable` on `Schedule::Every { every_s: SLOT_S, offset_s: LOBBY_S, lobby_s: LOBBY_S, duration_s: CLASS_S }`**: `Timetable::at` maps `Occurrence.index → Clock.slot`, `starts_at_s`, `elapsed_s = now − starts_at_s`; `class_index = index % classes.len()`. Public API of `Timetable`/`Clock` unchanged.
- [ ] **Step 5: Run** `$RUST cargo test -p openradlr-sim` → all pass, studio tests untouched.
- [ ] **Step 6: Commit** `Extract a shared Schedule; the studio timetable uses it`.

### Task 2: Matched bots and rider levels on the server

**Files:**
- Modify: `server/crates/sim/src/bot.rs` (matching, level helper, group-ride intensity)
- Modify: `server/crates/sim/src/world.rs` (`Rider.level_wkg`, `set_level`, `spawn_bot` uses matching)
- Modify: `server/crates/server/src/protocol.rs` (`join.level_w`), `runtime.rs` (`Game::join`, `Command::Join` carry `level_w`), `game.rs`, `studio.rs` (accept and ignore `level_w`), `connection.rs`/session where `Join` is dispatched

**Interfaces:**
- Produces (sim):
  ```rust
  pub const DEFAULT_LEVEL_WKG: f64 = 2.8;
  pub fn human_level_wkg(level_w: Option<f64>, ftp_w: Option<f64>, weight_kg: f64) -> f64; // first positive of level_w, ftp_w, else 2.8×weight; ÷ weight; clamped 1.0..=7.0
  pub fn pack_levels(levels_wkg: &[f64]) -> Vec<f64>; // ≤ 8: unchanged; > 8: sort, 8 equal-count bands, each band's median
  impl BotProfile { pub fn matched(levels_wkg: &[f64], rng: &mut dyn RandomSource) -> Self; } // empty → random()
  pub struct BotSituation { pub grade_percent: f64, pub racing: bool, pub group_ride: bool, pub distance_to_finish: Option<f64> }
  impl World { pub fn set_level(&mut self, id: RiderId, level_wkg: f64) -> Result<(), WorldError>; pub fn human_levels(&self) -> Vec<f64>; }
  pub struct Rider { /* … */ pub level_wkg: Option<f64> } // None for bots
  ```
- Produces (server): `Game::join(&mut self, name, weight_kg, ftp_w: Option<f64>, level_w: Option<f64>, route_id, sink)`; `ClientMessage::Join { …, level_w: Option<f64> }` (`#[serde(default)]`).

- [ ] **Step 1: Failing tests in `bot.rs`**
  - `human_level_prefers_level_then_ftp_then_default`: `(Some(280), Some(250), 70)` → 4.0; `(None, Some(210), 70)` → 3.0; `(None, None, 70)` → 2.8; `(Some(0.0), None, 70)` → 2.8.
  - `pack_levels_bands_above_eight`: 8 inputs → same 8; 16 inputs `1.0..=16.0` → 8 values, each the median of a pair (1.5, 3.5, …, 15.5).
  - `matched_mixes_pack_and_field`: levels `[2.5]`, 2000 draws with `SplitMix64::new(7)`: share with `ftp_wkg ∈ [2.375, 2.75]` is between 0.68 and 0.80; every draw within `[2.0, 4.5]`.
  - `matched_field_widens_to_the_humans`: levels `[5.5]` → every draw ≤ 6.05 and the max over 2000 draws > 4.5.
  - `group_ride_intensity`: flat, not racing, `group_ride: true` → `target_intensity == 0.75`; racing still 0.95.
- [ ] **Step 2: Failing test in `world.rs`** `new_bots_match_the_humans`: world with `target_riders: 12`, a human with `set_level(id, 2.0)`, then 60 leave/spawn cycles of a bot (call `leave` on a bot id each time); ≥ 60 % of the bots spawned after `set_level` have `ftp_wkg ∈ [1.9, 2.2]`. And `existing_bots_keep_their_profile`: profiles of bots present before `set_level` are unchanged after it (compare `profile().ftp_wkg`).
- [ ] **Step 3: Run** `$RUST cargo test -p openradlr-sim` → FAIL.
- [ ] **Step 4: Implement** the sim items; `spawn_bot` calls `BotProfile::matched(&pack_levels(&self.human_levels()), rng)`; `tick` sets `group_ride` from `rider.in_group_ride` (field added in Task 5; until then `false`). Expose `Controller::Bot(brain)` profile via `BotBrain::profile()` (exists).
- [ ] **Step 5: Server:** parse `level_w`, carry it through `Command::Join`/`GameHandle::join`/`Game::join`; `GameCore::join` calls `world.set_level(id, human_level_wkg(level_w, ftp_w, weight_kg))` after `join_human_on`. Test in `protocol.rs`: `{"type":"join","name":"Anna","weight_kg":70,"level_w":245}` parses with `level_w: Some(245.0)`; old JSON without it still parses (`None`).
- [ ] **Step 6: Run** `$RUST cargo test --workspace` and the fmt/clippy command → PASS.
- [ ] **Step 7: Commit** `Bots match the riders' level; join carries level_w`.

### Task 3: Client riding level

**Files:**
- Create: `client/public/js/profile/level.js`
- Modify: `client/public/js/profile/profileStore.js` (`levelW: null` in `DEFAULT_PROFILE`; saving a different `ftp` resets `levelW` to `null`)
- Modify: `client/public/js/net/protocol.js` (`join` sends `level_w`), `client/public/js/main.js` (send level, update after ride, show in profile), `client/public/js/view/profileView.js` (level line)
- Test: `client/test/level.test.js`, `client/test/net.test.js`

**Interfaces:**
- Produces:
  ```js
  export const LEVEL_STEP = 0.05;
  export function levelOf(profile) // profile.levelW ?? profile.ftp
  export function best20MinPower(samples) // samples [{t (ms), power}], ~1 Hz; null if < 20 min covered
  export function levelAfterRide(level, samples) // raises toward best20×0.95 by ≤ 5 %, never lowers
  export function levelAfterRace(level, avgPower) // toward avgPower by ≤ 5 % either way
  export function levelLabel(levelW, weightKg) // "Riding level 3.1 W/kg (from your rides)"
  ```
  `ClientMessages.join({…, level})` adds `level_w` when finite and > 0.

- [ ] **Step 1: Failing tests** in `level.test.js`:
  - `best20MinPower` of 1200 samples at 200 W, 1 s apart → 200; of 1100 samples → `null`; a 25-min ride with 20 min at 250 and 5 min at 100 → 250.
  - `levelAfterRide(200, ride at 300 W best 20)` → 210 (capped +5 %); `levelAfterRide(200, best 20 at 205)` → 200 (0.95 × 205 = 194.75 < 200, never lowers); a 15-min ride → 200.
  - `levelAfterRace(200, 150)` → 190; `levelAfterRace(200, 203)` → 203.
  - `levelOf({ftp: 250, levelW: null})` → 250; `levelLabel(217, 70)` → `"Riding level 3.1 W/kg (from your rides)"`.
  - In `net.test.js`: `ClientMessages.join({name:"A", weightKg:70, level: 245}).level_w === 245`; with `level: undefined` the key is absent.
  - Profile store: saving `{…, ftp: 250}` over a saved `{ftp: 200, levelW: 230}` stores `levelW: null`.
- [ ] **Step 2: Run** client tests → FAIL.
- [ ] **Step 3: Implement** `level.js`, the store reset, `protocol.js`.
- [ ] **Step 4: Wire in `main.js`:** join passes `level: levelOf(profile)`; in `endRide()` (before the recorder is dropped) apply `levelAfterRide` to the recorder's samples and save the profile when it changed; the profile/setup screen shows `levelLabel` under the FTP field (element `#level-label` in `index.html`).
- [ ] **Step 5: Run** client tests and lint → PASS.
- [ ] **Step 6: Commit** `Estimate the rider's level from rides and send it with join`.

### Task 4: Power sharing math (`sim/src/sharing.rs`)

**Files:**
- Create: `server/crates/sim/src/sharing.rs`; Modify: `lib.rs`

**Interfaces:**
- Produces:
  ```rust
  pub struct SharingTuning { pub threshold_s: f64, pub ramp_s: f64, pub max_share: f64, pub ease_s: f64, pub max_boost: f64, pub min_speed: f64 } // Default: 15, 30, 0.40, 3, 1.0, 3.0
  pub struct Member { pub id: RiderId, pub distance_m: f64, pub speed: f64, pub power: f64 } // distance since the event start
  pub struct Flow { pub id: RiderId, pub gap_s: f64, pub given_w: f64, pub received_w: f64, pub to: Vec<(RiderId, f64)>, pub from: Vec<(RiderId, f64)> } // to/from sorted by watts desc, at most 3
  #[derive(Default)] pub struct Sharing { /* eased g and w per rider */ }
  impl Sharing { pub fn update(&mut self, members: &[Member], tuning: &SharingTuning, dt: f64) -> Vec<Flow>; } // one Flow per member, same order
  ```
  Algorithm (the part the tests don't pin): median member by `distance_m` (lower median for even counts); `gap_s = (d − d_median) / max(speed_median, min_speed)`; targets `g = max_share·clamp((gap−threshold)/ramp, 0, 1)`, `w = clamp((−gap−threshold)/ramp, 0, 1)`; ease each toward its target with `x += (target − x)·(1 − exp(−dt/ease_s))`; drop eased state of ids not in `members`; `P = Σ g·p`; if `Σw == 0` → nobody gives; `r_j = min(P·w_j/Σw, max_boost·p_j)`; `R = Σ r_j`; `given_i = g_i·p_i·R/P`; pairwise `given_i·r_j/R` for `to`/`from`.

- [ ] **Step 1: Failing tests:**
  - `nobody_off_the_front_shares_nothing`: 5 members within 10 s → all flows 0.
  - `given_equals_received`: members at gaps +40 s, 0, 0, −40 s, −20 s (speeds 10 m/s, powers 300/200/200/150/180), after 20 updates of `dt = 1` → `|Σgiven − Σreceived| < 1e-9` and the −40 s rider receives more than the −20 s rider.
  - `share_ramps_with_the_gap`: a lone giver at +45 s with one receiver at −45 s, power 300 and 300, after 30 updates → `given_w ≈ 120` (0.40 × 300, within 1 W).
  - `receiver_cap_scales_givers_down`: giver +45 s at 1000 W, receiver −45 s at 50 W → `received_w ≤ 50 + 1e-9` and `given_w == received_w`.
  - `easing_takes_seconds`: first update with dt 1 → giver gives < 30 % of the settled value.
  - `leaving_member_is_forgotten`: after a member is removed, the next update returns no flow for it and totals still balance.
  - `no_receivers_no_giving`: one rider +60 s, rest together → 0.
- [ ] **Step 2: Run** `$RUST cargo test -p openradlr-sim sharing` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; fmt/clippy clean.
- [ ] **Step 5: Commit** `Power sharing for group rides`.

### Task 5: World hooks for events

**Files:**
- Modify: `server/crates/sim/src/race.rs` (`start_now`, `abort`), `server/crates/sim/src/world.rs`

**Interfaces:**
- Consumes: Task 2 `BotProfile::matched`, `pack_levels`.
- Produces:
  ```rust
  impl Race { pub fn start_now(&mut self, laps: u32) -> Result<RaceEvent, RaceError>; /* Idle|Finished → Running, returns Started */ pub fn abort(&mut self); /* → Idle, results cleared */ }
  pub enum WorldError { /* … */ EventScheduled }
  pub struct Rider { /* … */ pub in_group_ride: bool, pub power_adjust: f64 }
  impl World {
      pub fn reserve_route(&mut self, route: RouteIndex, reserved: bool); // reserved: start_race_on → Err(EventScheduled)
      pub fn start_scheduled_race(&mut self, route: RouteIndex, laps: u32, entrants: &[RiderId]) -> Result<(), WorldError>; // aborts a manual race, sets entrants, start_now, lines them up, pushes WorldEvent::Race Started
      pub fn line_up(&mut self, route: RouteIndex, ids: &[RiderId]); // position 0, speed 0, lanes spread
      pub fn place_at(&mut self, id: RiderId, position: f64); // late joiner at the back
      pub fn spawn_event_bots(&mut self, route: RouteIndex, count: usize, levels_wkg: &[f64]) -> Vec<RiderId>; // matched to levels, not despawned while entered or in_group_ride
      pub fn set_group_ride(&mut self, id: RiderId, on: bool); // also clears power_adjust when off
      pub fn set_power_adjust(&mut self, id: RiderId, watts: f64);
      pub fn lock_turns(&mut self, id: RiderId, locked: bool); // choose_turn → Err(Racing) while locked; clears a picked turn
  }
  ```
  Physics uses `(rider.power + rider.power_adjust).max(0.0)`; `rider.power` stays the real power (state messages, recording). `balance_population` never removes bots that are race entrants or `in_group_ride`.

- [ ] **Step 1: Failing tests (world.rs / race.rs):**
  - `reserved_route_refuses_manual_races`: `reserve_route(0, true)` → `start_race(3, Some(me)) == Err(EventScheduled)`; after `false` → Ok.
  - `scheduled_race_aborts_a_manual_one_and_starts_at_once`: manual race running; `start_scheduled_race(0, 2, &[me])` → `race(0).phase()` is `Running{laps: 2, ..}`, entrants are exactly `[me]`, `me` at position 0, no results from the manual race.
  - `power_adjust_changes_speed_not_power`: two identical humans at 200 W on a flat route, one with `set_power_adjust(+100)`; after 30 s it is ahead and both report `power == 200`.
  - `event_bots_stay_while_in_the_event`: spawn 6 event bots above `target_riders`, mark them `set_group_ride(true)`; after 60 s ticks with no human nearby they are all still there; after `set_group_ride(false)` surplus bots may go.
  - `locked_riders_cannot_turn`: `lock_turns(me, true)` → `choose_turn(me, Some(edge)) == Err(Racing)`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** sim tests, fmt, clippy → PASS.
- [ ] **Step 5: Commit** `World hooks for scheduled events`.

### Task 6: Event lifecycle (`sim/src/events.rs`)

**Files:**
- Create: `server/crates/sim/src/events.rs`; Modify: `lib.rs`, `world.rs` (`SimConfig.bots_per_entrant = 4`, `max_event_bots = 24`, `sharing: SharingTuning`)

**Interfaces:**
- Consumes: Task 1 `Schedule`, Task 4 `Sharing`, Task 5 world hooks, Task 2 levels (`Rider.level_wkg`).
- Produces:
  ```rust
  pub enum EventKind { Race, GroupRide }
  pub enum EventLength { Laps(u32), Distance(f64) }
  pub struct EventDef { pub id: String, pub name: String, pub kind: EventKind, pub route: RouteIndex, pub length: EventLength, pub schedule: Schedule }
  pub enum EventError { Unknown, NotOpen, Closed, NotOnRoute } // codes: unknown_event, event_not_open, event_closed, not_on_route
  pub struct EventInfo { pub id: String, pub name: String, pub kind: EventKind, pub route: RouteIndex, pub lobby_opens_at_s: f64, pub starts_at_s: f64, pub phase: Phase, pub entrants: usize }
  pub struct EventView { pub id: String, pub name: String, pub kind: EventKind, pub phase: Phase, pub starts_in_s: f64, pub length: EventLength, pub entrants: Vec<(RiderId, String)>, pub entered: bool, pub sharing: Option<Flow> }
  pub struct EventResult { pub rider_id: RiderId, pub name: String, pub is_bot: bool, pub place: Option<usize>, pub time_s: Option<f64>, pub distance_m: f64, pub avg_wkg: f64, pub given_kj: f64, pub received_kj: f64 }
  pub enum EventNotice { Lobby { route: RouteIndex, id: String, name: String, kind: EventKind, starts_in_s: f64 }, Started { route: RouteIndex, id: String }, Finished { route: RouteIndex, id: String, kind: EventKind, results: Vec<EventResult>, announce: bool } }
  impl Events {
      pub fn new(defs: Vec<EventDef>) -> Self;
      pub fn sync(&mut self, world: &mut World, now_s: f64, dt: f64); // call after every world.tick(dt)
      pub fn join(&mut self, world: &mut World, rider: RiderId, id: &str, now_s: f64) -> Result<(), EventError>;
      pub fn leave(&mut self, world: &mut World, rider: RiderId); // withdraw (no result)
      pub fn rider_gone(&mut self, world: &mut World, rider: RiderId); // disconnect: DNF in a race; call before world.leave
      pub fn view_for(&self, world: &World, rider: RiderId, now_s: f64) -> Option<EventView>; // the event in lobby/running on the rider's route
      pub fn infos(&self, now_s: f64) -> Vec<EventInfo>; // next occurrence of each def
      pub fn drain_notices(&mut self) -> Vec<EventNotice>;
  }
  ```
  Lifecycle per def (track the occurrence index you are handling):
  - Lobby reached → `reserve_route(true)`, `Lobby` notice once.
  - Start reached → place human entrants and spawn `min(bots_per_entrant × humans, max_event_bots)` bots matched to the entrants' `pack_levels` (bots-only: `max_event_bots / 2`, `levels = []`); race → `start_scheduled_race` with all entrants; group ride → `line_up`, `set_group_ride(true)` + `lock_turns(true)` for all, record each member's start odometer. `Started` notice.
  - Running, race: done when `world.race(route)` reaches `Finished`/`Idle`, or at `ends_at + 600 s` (then `race.complete()` and unfinished entrants are DNF).
  - Running, group ride: every ≥ 1 s of accumulated `dt`, `Sharing::update` over members (distance = odometer − start odometer), `set_power_adjust(received − given)`, add to kJ tallies; done when every human member covered `Distance` (or `Laps × route length`) or at `ends_at`.
  - Per entrant: integrate real `power × dt` for `avg_wkg` (÷ mass ÷ time).
  - Finish → results (race: place/time from `race.results()`, others DNF with `place: None`; group ride: `time_s` when they covered the length, else `None`), `Finished` notice with `announce = any human entrant`, clear `set_group_ride`/`lock_turns`/`power_adjust`, `reserve_route(false)`.
  - Join: lobby → `Ok`; running group ride → `Ok`, `place_at` the last member's position − 5 m with start odometer set so their distance equals the last member's; running race → `Closed`; upcoming → `NotOpen`; other route → `NotOnRoute`. Joining locks turns.

- [ ] **Step 1: Failing tests** (small `World` on a 2 km test route, `SplitMix64`, fake `now_s` advanced with ticks of 0.05 s):
  - `lobby_then_race_with_matched_bots`: def race 1 lap, `Every{every 600, offset 300, lobby 120, duration 300}`; at `now = 200` notice `Lobby`; human joins (level 3.0); at 300 `Started`, 4 event bots exist with `ftp_wkg ∈ [2.0, 4.5]`, human at position 0; feed 250 W until finish → `Finished` with the human placed.
  - `race_is_closed_once_running`: second human joins at 310 → `Err(Closed)`; joining at 100 → `Err(NotOpen)`.
  - `stuck_race_is_force_finished` (Review Focus 2): entrant at 0 W, bots removed; at `ends_at + 600` → `Finished`, human `place: None`.
  - `group_ride_shares_and_finishes`: def group ride `Distance(3000)`; two humans 400 W and 120 W; after the start, `view_for(strong)` eventually shows `given_w > 0` and `view_for(weak)` `received_w > 0`; Σgiven == Σreceived at every sync; both finish → results with `given_kj > 0` for the strong rider.
  - `late_joiner_starts_at_the_back`: third human joins at start + 60 s → `Ok`, placed 5 m behind the last member.
  - `disconnect_clears_sharing` (Review Focus 3): `rider_gone(weak)` then `world.leave(weak)` → next sync: strong rider's `power_adjust == 0`.
  - `gaps_use_event_distance` (Review Focus 4): members at odometer distance 1990 m and 2010 m on a 2000 m route → `|gap| < 15 s`, nobody shares.
  - `entrants_cannot_turn` (Review Focus 5): after `join` in the lobby, `choose_turn` → `Err(Racing)`.
  - `bots_only_event_runs_quietly`: nobody joins → `Finished` with `announce == false`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** sim tests, fmt, clippy → PASS.
- [ ] **Step 5: Commit** `Scheduled events on route worlds: lobby, races, group rides, results`.

### Task 7: Events config and built-ins

**Files:**
- Create: `server/crates/server/src/events_file.rs` (parse, built-ins, validation); Modify: `config.rs`, `lib.rs`

**Interfaces:**
- Consumes: Task 6 `EventDef`, Task 1 `Schedule::overlaps`.
- Produces:
  ```rust
  pub enum EventsSetting { Default, Off, File(PathBuf) } // OPENRADLR_EVENTS, default Default
  // Config gains: events: EventsSetting, event_lobby_s: f64 (OPENRADLR_EVENT_LOBBY_S, default 600)
  pub struct EventEntry { id, name, kind: "race" | "group_ride", route_id, laps: Option<u32>, distance_m: Option<f64>, every_s: f64, offset_s: f64, lobby_s: Option<f64>, duration_s: f64 } // serde, deny_unknown_fields
  pub fn builtin_events(routes: &[(String, String, f64)] /* id, name, length_m */, lobby_s: f64) -> Vec<EventEntry>;
  pub fn resolve(entries: &[EventEntry], world_routes: &[String], lobby_s: f64) -> Result<Vec<EventDef>, ConfigError>; // the entries whose route_id is in this world
  pub fn validate(entries: &[EventEntry], all_route_ids: &[String]) -> Result<(), ConfigError>; // unknown route, laps xor distance, zero length/duration, every_s > 0, duplicate id, overlaps per route
  ```
  Built-ins for a world with routes `r0..rN−1` (N ≥ 2): group ride on `r_i` every `N·3600` s at offset `i·3600` (45 min = 2700 s, `Distance(18000)`, name `Group ride · <route name>`); race on `r_j` at hours `h` even with `(h + 1) mod N == j`: every `lcm(2, N)·3600`, offset of the first such `h`·3600 + 1200 (:20), 1500 s, laps `max(1, round(12000 / length))`, name `Race · <route name>`. N = 1: group ride every 7200 at offset 3600, race every 7200 at offset 0. Built-ins are generated per world (each map's routes).

- [ ] **Step 1: Failing tests:**
  - `builtins_never_overlap`: for N = 1, 2, 3, 4 → `validate` passes and each hour has exactly one group ride or race-in-place-of-it start at :00.
  - `race_avoids_the_group_ride_route`: N = 3, for each even hour `h` in 0..12 the race route ≠ the group ride route of hour `h`.
  - `file_entries_validate`: unknown route → error naming it; `laps` and `distance_m` both → error; two overlapping on one route → error naming both ids; `OPENRADLR_EVENTS=off` → no events; bad path → error.
  - `lobby_default_applies`: entry without `lobby_s` gets `event_lobby_s`.
- [ ] **Step 2: Run** `$RUST cargo test -p openradlr-server events_file config` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Events config: built-in schedule, events file, validation`.

### Task 8: Server wiring: game loop, protocol, `/api/info`

**Files:**
- Modify: `server/crates/server/src/game.rs`, `protocol.rs`, `runtime.rs`, `session.rs` (dispatch), `app.rs` (build `Events` per world, wall clock), `http.rs` (`events`, `now_s`), `worlds.rs` (unique games)
- Test: `game.rs` tests, `server/crates/server/tests/websocket_flow.rs`

**Interfaces:**
- Consumes: Task 6 `Events` API, Task 7 `resolve`.
- Produces:
  - `ClientMessage::JoinEvent { event_id: String }`, `ClientMessage::LeaveEvent`.
  - `ServerMessage::State { …, #[serde(skip_serializing_if = "Option::is_none")] event: Option<EventState> }` with `EventState { id, name, kind: "race"|"group_ride", phase: "lobby"|"running", starts_in_s, laps: Option<u32>, distance_m: Option<f64>, entrants: Vec<EntrantState{rider_id, name}>, entered: bool, sharing: Option<SharingState{gap_s, given_w, to: Vec<String>, received_w, from: Vec<String>}> }` (watts rounded to whole numbers).
  - `GameEvent::EventLobby { event_id, name, event_kind, starts_in_s }`, `GameEvent::EventStarted { event_id }`, `GameEvent::EventFinished { event_id, event_kind, results: Vec<EventResultState> }` (fields as `EventResult`, names snake_case). Finished with `announce == false` is not sent.
  - Errors: `unknown_event`, `event_not_open`, `event_closed`, `not_on_route`; manual race refusal stays `race_rejected` with the `EventScheduled` message.
  - `GameCore::with_events(self, events: Events, wall_clock: fn() -> f64) -> Self`; `tick` runs `events.sync(&mut world, now, dt)` after `world.tick`; `leave` calls `events.rider_gone` first.
  - `Game::join_event`, `Game::leave_event`, `Game::event_infos(&self) -> Vec<EventInfoWire>` (defaults: no-op / empty); `Command::JoinEvent`/`LeaveEvent`; `GameHandle::events() -> Vec<EventInfoWire>` from an `Arc<Mutex<Vec<_>>>` refreshed by `run` once per second of ticks.
  - `/api/info` gains `now_s: f64` and `events: Vec<EventInfoWire { id, name, kind, route_id, lobby_opens_at_s, starts_at_s, phase: "upcoming"|"lobby"|"running", entrants }>` sorted by `starts_at_s`, collected once per game (not once per route entry).

- [ ] **Step 1: Failing tests:**
  - `protocol.rs`: `{"type":"join_event","event_id":"x"}` and `{"type":"leave_event"}` parse; `EventFinished` serialises as `{"type":"event","event":{"kind":"event_finished","event_id":"x","event_kind":"race","results":[]}}`; `State` without an event has no `event` key.
  - `game.rs` with a fake clock (`static` `AtomicU64` behind a `fn() -> f64`): join, `join_event` during the lobby → next state has `event.entered == true`; at the start an `event_started` reaches the route's riders; `join_event` for an unknown id → error `unknown_event`.
  - `websocket_flow.rs`: server built with an events file (one group ride, every 60 s, lobby 30 s, `distance_m: 200`) → `/api/info` lists it with `phase` and `now_s`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `$RUST cargo test --workspace`, fmt, clippy → PASS.
- [ ] **Step 5: Commit** `Serve scheduled events: join_event, event state, /api/info events`.

### Task 9: Client protocol and event view helpers

**Files:**
- Create: `client/public/js/view/events.js`
- Modify: `client/public/js/net/protocol.js`, `client/public/js/net/connection.js`, `client/public/js/view/panels.js` (`describeEvent` for the three new events)
- Test: `client/test/events.test.js`, `client/test/net.test.js`, `client/test/ui.test.js` (wherever `describeEvent` is tested)

**Interfaces:**
- Produces:
  ```js
  // protocol.js
  ClientMessages.joinEvent(id) // {type: "join_event", event_id: id}
  ClientMessages.leaveEvent()  // {type: "leave_event"}
  // connection.js
  GameConnection#joinEvent(id), GameConnection#leaveEvent()
  // view/events.js
  export function formatCountdown(seconds) // 760 → "12:40", 3725 → "1:02:05", negative → "0:00"
  export function eventRows(info, nowMs = Date.now(), locale) // from /api/info: [{id, icon: "🏁"|"👥", name, routeId, routeName, startLabel: local "HH:MM", countdown: "in 12:40", entrants, joinable, note}] sorted by start; note "Lobby opens 13:50" while upcoming; times shifted by (info.now_s·1000 − nowMs) so server time counts
  export function eventBanner(event) // state.event in lobby, not entered → "Group ride starts in 9:12 · J to join" | "Race starts in 9:12 · J to join"; entered → "Group ride starts in 9:12 · you're in"; otherwise null
  export function sharingLine(sharing) // given ≥ 5 → "−50 W → Anna, Ben"; received ≥ 5 → "+30 W from Chris"; else ""
  export function eventRideName(kind, routeName) // "OpenRadlr group ride · Riverside Flats" | "OpenRadlr race · Riverside Flats"
  export function eventResultRows(results, kind, myId) // race: "#1 Anna · 23:41 · 3.4 W/kg", DNF "DNF Ben"; group ride: "Anna · 18.0 km · 2.9 W/kg · gave 12 kJ"; "You" for myId; bots get " (bot)"
  ```
  `describeEvent`: `event_lobby` → `"<name> starts in 10:00 · J to join"`, `event_started` → `"Event started — go!"`, `event_finished` → `"Event finished"`, for a group ride with someone who gave ≥ 1 kJ: `"Event finished · thanks Anna for sharing 12 kJ"` (the top giver).

- [ ] **Step 1: Failing tests** for every function above with the exact strings listed (use a fixed `locale: "de-CH"` / `timeZone` via `Intl` options passed through `eventRows`’ `locale` argument so tests are deterministic; check `startLabel` with `starts_at_s` = 0 and `timeZone: "UTC"` → `"00:00"`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** tests and lint → PASS.
- [ ] **Step 5: Commit** `Client: event messages and view helpers`.

### Task 10: Client UI wiring

**Files:**
- Modify: `client/public/index.html` (start menu `<section id="events">` with `<ul id="event-list">`; ride menu `<ul id="ride-event-list">`; HUD `#event-call`, `#sharing-line`; results overlay reuses `#results` with a title), `client/public/css/*.css` (styles next to the race call), `client/public/js/main.js`

**Interfaces:**
- Consumes: Task 9 helpers, Task 3 `levelAfterRace`.
- Behaviour:
  - Start menu renders `eventRows(info)` every second with the info timer; **Join** (joinable rows only) selects the route and starts `joinRide({eventId})`; after `joined`, `connection.joinEvent(eventId)`.
  - Ride menu lists the same rows; Join on the rider's route → `connection.joinEvent`; on another route → `endRide()` then the start-menu join path for that event.
  - `toggleRace` (key J, controller, button) first handles `state.event`: lobby or running group ride and not entered → `joinEvent(id)`; entered → `leaveEvent()`; otherwise the existing race logic.
  - `#event-call` shows `eventBanner(state.event)`; `#sharing-line` shows `sharingLine(state.event?.sharing)`; the group panel shows `gap_s` formatted with the existing `formatGap`.
  - On `event_finished`: render `eventResultRows` into the results overlay; if `event_kind === "race"` and I'm in the results, apply `levelAfterRace` with my average power from the recorder samples between `event_started` and now, and save the profile.
  - `rideName()` returns `eventRideName(kind, route)` when the ride included an event I entered, else the existing name.
- [ ] **Step 1:** Implement the wiring (no new unit tests; logic lives in Task 9 helpers).
- [ ] **Step 2: Run** client tests and lint → PASS.
- [ ] **Step 3: E2E (scratch, not committed)** in `/tmp/claude-0/-root-projects-Open-Ride/7ec2f3b8-a366-4fd3-a741-22a2c58839fb/scratchpad/e2e/events.mjs` against a server image built from the branch, `OPENRADLR_EVENTS=/events.json` with one group ride (every 120 s, lobby 40 s, duration 60 s, `distance_m: 300`) and one race on another route; checks: the Events list shows both with a countdown; Join from the menu → banner `· you're in`; at the start the HUD shows the event running; with the fake trainer at 400 W and a second browser at 100 W, the sharing lines appear with opposite signs; results overlay appears; no page errors.
- [ ] **Step 4: Commit** `Client: events list, lobby banner, sharing line, results`.

### Task 11: Docs and wrap-up

**Files:**
- Create: `docs/adr/0013-scheduled-events.md` (context, decision: schedule shared with the studio, events on route worlds, opt-in, power sharing instead of speed caps, bots matched once; consequences)
- Create: `docs/events.md` (for riders and hosts: how events work, lobby, J, power sharing explained, `OPENRADLR_EVENTS` file format with an example, `OPENRADLR_EVENT_LOBBY_S`)
- Modify: `docs/protocol.md` (new messages, `state.event`, game events, errors, `/api/info` fields), `CHANGELOG.md` (Added: events, group rides with power sharing, matched bots, riding level), `README.md` (link to `docs/events.md` where features are listed), `.env.example` (the two variables, commented)

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2: Full check:** `$RUST cargo test --workspace`, fmt + clippy, client `npm test` and `npm run lint` → all PASS.
- [ ] **Step 3: Commit** `Docs: ADR 0013, events guide, protocol`.
- [ ] **Step 4:** `git push -u origin feat/events`; `gh pr create --assignee RalfLeonFasler` titled `Scheduled events and group rides with power sharing; bots matched to riders (#46)`, body: summary, what to try on real hardware, test results, `Closes #46` is **not** used (private events remain), `Part of #46`.
