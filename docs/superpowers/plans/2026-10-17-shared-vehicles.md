# Shared Vehicles (Tandems and Beer Bikes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends ride one tandem (2 seats) or beer bike (5/7/9 seats) together: summed real power, one speed and position, captain steers, bots fill free seats, boarded with a 6-character code.

**Architecture:** Seats stay ordinary `Rider`s in the sim; a `Vehicle` links them and runs one physics step per tick, copying the result to every seat. The server adds three messages, a `vehicle_code` on `join` and a cross-world code registry. The client groups riders by `vehicle.id` and draws one vehicle model.

**Tech Stack:** Rust (crates `openradlr-sim`, `openradlr-server`, axum/tokio), plain ES modules client with `node --test`, own WebGL renderer.

**Spec:** `docs/superpowers/specs/2026-10-17-shared-vehicles-design.md`

## Global Constraints

- Branch `feat/beer-bike`, one PR, one commit per task, messages end with `(#55)` and the `Co-Authored-By` line.
- Rust checks only via Docker, repo root mounted at `/w`:
  `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'`
  (narrow with `cargo test -p openradlr-sim <filter>` while iterating). Referred to below as **RUST(cmd)**.
- Client checks only via Docker: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js"; npx eslint .'` — referred to as **NODE**.
- `crates/sim` stays dependency-free and deterministic (randomness only through `RandomSource`).
- Kinds: `Tandem` = 2 seats; `BeerBike` seats ∈ {5, 7, 9} (captain + an even number of riders); anything else is invalid.
- Physics: tandem frame 18 kg, CdA 0.43, Crr 0.004; beer bike frame 250 kg + 40 kg/seat, CdA 2.5, Crr 0.012, draft behind it up to −50 % CdA (`max_reduction` 0.5); beer bike same-lane half-width 1.0 lane.
- Seat bots: steady group-ride pace at the average W/kg of the vehicle's humans, 2.8 W/kg with none, cadence 85.
- Code alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 6, unique per server.
- Error codes (wire): `unknown_vehicle`, `vehicle_full`, `vehicle_elsewhere`, `not_captain`, `in_event`, `invalid_vehicle`, `already_aboard`.
- Wire messages: `create_vehicle {kind, seats, bots}`, `board_vehicle {code}`, `leave_vehicle`, `join.vehicle_code`; `kind` is `"tandem"` or `"beer_bike"`.
- Copy: `Vehicle 980 W · you 21 %`, `Captain: Anna steers`, `The captain steers`, `Anna's beer bike` / `Anna's tandem`, `Beer bike with Anna, Ben, Chris`, `Bots fill free seats`, `Board with code`, `Vehicle full`.
- `PROTOCOL_VERSION` stays 2: every change is additive.
- Solo riders' physics results must not change.

## Review Focus

1. A rider boards while the vehicle is off its route on the network: the new seat must take the vehicle's off-route road and offset, not split onto the route (test in Task 3).
2. A rider leaves the vehicle mid-ride and stays connected: they keep the vehicle's speed, position and lane and ride on solo, not restart from rest or from the start line (test in Task 2).
3. All humans leave a vehicle with bots: no seat bot stays in the world and the code disappears from the registry, so the code can't board a ghost vehicle (tests in Tasks 2 and 5).
4. `join` with a `vehicle_code` whose vehicle dissolved between the registry lookup and the join: the join fails with `unknown_vehicle` and leaves no rider and no player slot behind (test in Task 5).
5. A code typed as ` abc 23k ` or with a confusable `0`/`O`, `1`/`I`: normalised to upper case without spaces, and confusables rejected with a clear message rather than sent (test in Task 6).

---

### Task 1: Vehicle model and per-body physics

**Files:**
- Create: `server/crates/sim/src/vehicle.rs`
- Modify: `server/crates/sim/src/lib.rs` (add `pub mod vehicle;`)
- Modify: `server/crates/sim/src/physics.rs` (`Body`, `StepInput.body`)
- Modify: `server/crates/sim/src/world.rs:720`, `server/crates/sim/src/studio.rs:559` (pass `Body::bike`)
- Modify: `server/crates/sim/src/world.rs` `SimConfig` (add `vehicles: VehicleParams`)

**Interfaces:**
- Produces:
  - `physics::Body { frame_mass_kg: f64, cda: f64, crr: f64 }`, `Body::bike(params: &PhysicsParams) -> Body` (bike_mass_kg, cda, crr from params). `StepInput` gains `body: Body`; `acceleration` uses `input.body` instead of `params.bike_mass_kg/cda/crr`. `rider_mass_kg` is the riders' mass only.
  - `vehicle::VehicleId = u32`
  - `vehicle::VehicleKind { Tandem, BeerBike { seats: u8 } }` with `VehicleKind::new(kind: &str, seats: u8) -> Option<VehicleKind>` (`"tandem"` ignores `seats` and gives 2; `"beer_bike"` needs 5/7/9), `seats(&self) -> usize`, `wire_name(&self) -> &'static str`.
  - `vehicle::VehicleParams { tandem: Body, beer_bike_base: Body, beer_bike_kg_per_seat: f64, beer_bike_draft: DraftParams, beer_bike_lane_half_width: f64 }`, `Default` from Global Constraints; `VehicleParams::body(&self, kind) -> Body`; `VehicleParams::draft(&self, kind, normal: &DraftParams) -> DraftParams` (beer bike: normal with `max_reduction` 0.5).
  - `vehicle::Vehicle { id, kind, code: String, seats: Vec<Option<RiderId>>, captain: RiderId, bots_fill: bool }`
  - `vehicle::summed_power(powers: &[f64]) -> f64`, `vehicle::shares(powers: &[f64]) -> Vec<f64>` (each / sum, all 0 when the sum ≤ 0).
  - `vehicle::CODE_ALPHABET: &str`, `vehicle::draw_code(rng: &mut dyn RandomSource) -> String`.

- [ ] **Step 1: Write failing tests** in `vehicle.rs` and `physics.rs`:
  - `kinds_validate`: `new("tandem", 0) == Some(Tandem)` with 2 seats; `new("beer_bike", 6)` has 6 seats; `new("beer_bike", 5)`, `new("beer_bike", 10)`, `new("bus", 4)` are `None`.
  - `beer_bike_mass_grows_with_seats`: `params.body(BeerBike{seats:9}).frame_mass_kg == 610.0`, `seats:5 → 450.0`.
  - `shares_add_up`: `shares(&[300.0, 100.0]) == [0.75, 0.25]`; `shares(&[0.0, 0.0]) == [0.0, 0.0]`.
  - `codes_use_the_alphabet`: 100 draws with `SplitMix64::new(7)` are 6 chars, all in `CODE_ALPHABET`.
  - `beer_bike_cruises_near_20_kmh` (physics.rs): step `step_speed` for 120 s at 1200 W, `rider_mass_kg` 600, `body` beer bike 9 seats, grade 0 → final speed in 5.0..=6.5 m/s.
  - Existing physics tests stay unchanged except for adding `body: Body::bike(&params)`.
- [ ] **Step 2:** RUST(`cargo test -p openradlr-sim`) → compile failure (no `vehicle`, no `Body`).
- [ ] **Step 3:** Implement the interfaces above; update the three `StepInput` callers to `body: Body::bike(&config.physics)`.
- [ ] **Step 4:** RUST(full check) → all green, including every pre-existing sim and studio test.
- [ ] **Step 5:** Commit `Sim: vehicle model and per-body physics (#55)`.

### Task 2: World vehicle lifecycle (create, board, leave, seat bots)

**Files:**
- Create: `server/crates/sim/src/world/vehicles.rs` (`impl World` block for vehicles; declared from `world.rs` with `mod vehicles;` so it sees private fields)
- Modify: `server/crates/sim/src/world.rs` (fields, `WorldError`, `WorldEvent`, `leave`, `balance_population`, `join_race`/event entry checks)
- Modify: `server/crates/sim/src/events.rs` (refuse event entry for seated riders: `join` returns the new error)

**Interfaces:**
- Consumes: Task 1 types.
- Produces (on `World`):
  - fields `vehicles: BTreeMap<VehicleId, Vehicle>`, `seat_of: BTreeMap<RiderId, VehicleId>`, `next_vehicle_id`.
  - `create_vehicle(&mut self, captain: RiderId, kind: VehicleKind, bots_fill: bool, code_taken: &dyn Fn(&str) -> bool) -> Result<VehicleId, WorldError>` — draws codes until `!code_taken(c)` and no local vehicle has it.
  - `board(&mut self, vehicle: VehicleId, rider: RiderId) -> Result<usize, WorldError>` (seat index).
  - `leave_vehicle(&mut self, rider: RiderId)` (no-op when not seated).
  - `vehicle(&self, id) -> Option<&Vehicle>`, `vehicle_of(&self, rider) -> Option<&Vehicle>`, `vehicle_by_code(&self, code: &str) -> Option<VehicleId>`, `vehicles(&self) -> impl Iterator<Item=&Vehicle>`.
  - `WorldError::{NoSuchVehicle, VehicleFull, NotCaptain, AlreadyAboard, InEvent}` with `Display` texts.
  - `WorldEvent::Vehicle { id: VehicleId, route: RouteIndex, change: VehicleChange }`, `VehicleChange::{Created, Boarded(RiderId), Left(RiderId), CaptainChanged(RiderId), Dissolved { code: String }}`.
  - `Rider.vehicle: Option<VehicleId>` is NOT added; seat membership lives only in `seat_of`.

Rules (from the spec): boarding takes the first empty seat, else replaces the first bot seat (bot removed with `RiderLeft`); boarding copies route, position, off_route, lane, target_lane, turn, speed from the captain and sets `turns_locked` for non-captains; humans entered in a race (`is_entered`) or an event (`in_group_ride`) get `InEvent`; seat bots are spawned through a new `spawn_seat_bot(route, level_wkg)` (BotProfile at that level, `in_group_ride = true` for the steady pace — first check that `events.rs`/`sharing.rs` pick group members from their own entrant lists, not from `in_group_ride`; if they read the flag, add a `steady_pace: bool` to `BotSituation` instead) and re-levelled (`BotBrain` profile replaced) whenever a human boards or leaves; a leaving human is replaced by a seat bot when `bots_fill`, otherwise `None`; captain leaving → next human in seat order, `turns_locked` cleared for them; last human leaving → remove all seat bots and the vehicle, push `Dissolved`. `World::leave` calls `leave_vehicle` first. `balance_population` ignores seated riders when counting and never picks them as despawn candidates.

- [ ] **Step 1: Write failing tests** in `world/vehicles.rs` (`#[cfg(test)]`, reuse `world_with`/`empty_world`/`ride` by making them `pub(super)` in `world.rs` tests or a shared `test_support` mod):
  - `creating_seats_the_captain_up_front`: seat 0 is the captain, `vehicle_of(captain).kind == Tandem`, event `Created`.
  - `bots_fill_the_free_seats`: beer bike 7 with bots → 6 bot riders seated, `riders().count()` grows by 6.
  - `seat_bots_match_the_humans`: captain level 3.5 W/kg → each seat bot's `profile().ftp_wkg == 3.5`; with a second human at 2.5 boarded, remaining bots re-levelled to 3.0.
  - `boarding_replaces_a_bot`: board a second human → seat 1, the replaced bot is gone from `riders()`.
  - `boarding_moves_the_rider_to_the_vehicle`: captain at position 500, lane 2 (after `place_at`/`shift_lane` and a tick); boarder joined at 0 → same position, lane, speed.
  - `a_full_vehicle_refuses_boarders`: tandem without bots + 2 humans → third gets `VehicleFull`.
  - `boarding_twice_is_refused`: `AlreadyAboard`.
  - `racers_cannot_board_and_seated_cannot_race`: entrant → `InEvent`; seated rider `join_race` → `InEvent`.
  - `a_dropout_becomes_a_bot`: bots on, human 2 `leave` → seat 1 holds a bot; bots off → seat 1 `None`.
  - `the_captain_hands_over`: captain leaves → next human is captain, event `CaptainChanged`, their `turns_locked` false.
  - `the_last_human_dissolves_the_vehicle`: bots on, every human leaves → `vehicles().count() == 0`, no seat bots left, event `Dissolved { code }`. (Review Focus 3)
  - `leaving_the_vehicle_rides_on_solo`: ride 20 s at 200 W each, then `leave_vehicle(ben)` → Ben keeps the vehicle's position, lane and speed (> 4 m/s), `turns_locked` false. (Review Focus 2)
  - `seat_bots_are_not_population`: `target_riders` 12, beer bike 9 with bots → route still has exactly 12 non-seated riders after 200 ticks, seat bots untouched.
  - `codes_avoid_taken_ones`: `code_taken` rejecting the first drawn code → a different code is stored.
- [ ] **Step 2:** RUST(`cargo test -p openradlr-sim vehicles`) → fails to compile.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** RUST(full check) → green.
- [ ] **Step 5:** Commit `Sim: create, board and leave vehicles with seat bots (#55)`.

### Task 3: World vehicle physics, drafting and steering

**Files:**
- Modify: `server/crates/sim/src/world.rs` (`tick`, `slot`/`Field`, `shift_lane`, `choose_turn`)
- Modify: `server/crates/sim/src/world/vehicles.rs` (`fn step_vehicles(&mut self, dt, field)`, tests)

**Interfaces:**
- Consumes: Task 2 fields and `VehicleParams` from Task 1.
- Produces: `shift_lane`/`choose_turn` return `Err(WorldError::NotCaptain)` for seated non-captains. No new public API.

Tick order: (1) power for everyone as today; (2) physics only for riders not in `seat_of`; (3) `step_vehicles`: per vehicle, power = `summed_power` of seated riders' `power + power_adjust` (clamped ≥ 0), `rider_mass_kg` = sum of seated riders' `mass_kg`, `body` = `VehicleParams::body(kind)`, `cda_factor` from the gap ahead of the captain's slot using `VehicleParams::draft(kind, …)`; advance the captain with `roads.advance` and its lane step, then copy speed, position, off_route, lane, target_lane, turn, route and the odometer increment to every seat. Slots: seated non-captains produce no `Slot` (filter them out of `slots` and skip their bot `choose_lane`); a beer bike's slot uses `beer_bike_lane_half_width` when others test `same_lane` against it (add `half_width: f64` to `Slot`, default `draft.lane_tolerance`).

- [ ] **Step 1: Write failing tests:**
  - `summed_power_moves_the_vehicle`: tandem, two humans at 150 W for 60 s on a flat loop → its speed is higher than a solo human at 150 W ridden alongside in another world with the same seed (the tandem's CdA per rider is lower).
  - `every_seat_shares_one_place`: beer bike 5 with bots, 30 s → all seats have equal `position`, `lane`, `speed`, `odometer` increments equal.
  - `every_seat_feels_the_same_grade`: on `square_loop` with a climb (use the hilly helper if present, else a `RouteSpec` with elevation), `grade_for` equal for all seats.
  - `seats_do_not_draft_each_other`: beer bike vs. the same total power computed by `physics::step_speed` directly with `cda_factor` 1.0 → equal speed (no rider ahead).
  - `riders_draft_behind_a_beer_bike`: a solo human 2 m behind a beer bike in the neighbouring lane (lane +1) gets `cda_factor` ≈ 0.6 (0.5 at min gap, linear) — check via speed against the same human alone.
  - `only_the_captain_steers`: non-captain `shift_lane` → `Err(NotCaptain)` and the vehicle lane unchanged; captain `shift_lane(1)` → all seats move after 1 s.
  - `the_vehicle_turns_together` (network world from `network::tests`): captain `choose_turn` onto a side road, ride past the junction → every seat has the same `off_route` road. Non-captain `choose_turn` → `NotCaptain`.
  - `boarding_off_route_joins_the_vehicle_there`: vehicle already off-route; a new human boards → their `off_route` equals the captain's (Review Focus 1).
  - `solo_physics_is_unchanged`: one human 200 W for 60 s → odometer equals the value from before this task (record it from `main` in the test as a literal).
  - `huge_power_is_capped`: 9 seats at 2500 W → speed ≤ `physics.max_speed`.
- [ ] **Step 2:** RUST(`cargo test -p openradlr-sim vehicles`) → new tests fail.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** RUST(full check) → green.
- [ ] **Step 5:** Commit `Sim: one physics step per vehicle, the captain steers (#55)`.

### Task 4: Protocol and game core

**Files:**
- Modify: `server/crates/server/src/protocol.rs` (messages, `RiderState`, `State.vehicle`, `GameEvent`s, `event_message`)
- Modify: `server/crates/server/src/session.rs` (dispatch), `connection.rs` (`to_command`), `runtime.rs` (`Game` trait defaults, `Command`s)
- Modify: `server/crates/server/src/game.rs` (`create_vehicle`, `board_vehicle`, `leave_vehicle`, `input`/`turn` ignore `NotCaptain`)
- Create: `server/crates/server/src/vehicle_codes.rs` (`VehicleCodes`), register in `lib.rs`

**Interfaces:**
- Consumes: Task 2/3 `World` API.
- Produces:
  - `ClientMessage::{CreateVehicle { kind: String, #[serde(default)] seats: u8, #[serde(default = true)] bots: bool }, BoardVehicle { code: String }, LeaveVehicle}`; `Join` gets `#[serde(default)] vehicle_code: Option<String>`.
  - `RiderState.vehicle: Option<SeatRef { id, kind: &'static str, seat: usize, seats: usize }>` and `RiderState.cadence: Option<f64>` (only for seated riders), both `skip_serializing_if = "Option::is_none"`.
  - `ServerMessage::State.vehicle: Option<VehicleState { id, code, kind, captain, bots, seats: Vec<Option<SeatState>> }>`, `SeatState { rider_id, name, is_bot, power, share }` (share rounded to 0.01) — only the viewer's own vehicle.
  - `GameEvent::{VehicleBoarded { vehicle_id, rider_id, name }, VehicleLeft { vehicle_id, rider_id, name }, CaptainChanged { vehicle_id, rider_id, name }}`.
  - `VehicleCodes` (`Arc`, `std::sync::Mutex<HashMap<String, String>>` code → world id): `insert(&self, code, world_id)`, `remove(&self, code)`, `world_of(&self, code) -> Option<String>`, `is_taken(&self, code) -> bool`.
  - `GameCore::with_vehicle_codes(self, codes: VehicleCodes, world_id: String) -> Self`; `GameCore::{create_vehicle(rider, kind, seats, bots), board_vehicle(rider, code), leave_vehicle(rider)}` and the same names on `Game` (default no-op) and as `Command`s.
  - Errors via `ServerMessage::error(code, message)` with the wire codes from Global Constraints; `board_vehicle` with a code of another world replies `vehicle_elsewhere` with the message containing that world's route id (format: `"vehicle_elsewhere"` code, message `route:<id>`; the client parses after `route:`).

Seats are culled together for free (they share a position); `state_message` also includes every seat of the viewer's own vehicle unconditionally. On `WorldEvent::Vehicle { Dissolved { code } }` the game calls `codes.remove(code)`; on `Created` it calls `codes.insert`.

- [ ] **Step 1: Write failing tests:**
  - protocol.rs: `create_vehicle_parses` (`{"type":"create_vehicle","kind":"beer_bike","seats":7}` → bots defaults true), `board_vehicle_parses`, `join_takes_a_vehicle_code`, `state_with_a_vehicle_serialises` (JSON contains `"vehicle":{"id":…,"code":"ABC234",…}` and seated riders carry `"cadence"`), `solo_riders_have_no_vehicle_field` (no `"vehicle"` / `"cadence"` keys).
  - vehicle_codes.rs: `insert_lookup_remove`.
  - game.rs: `creating_a_vehicle_sends_its_state` (next `State.vehicle.code` is 6 chars, `codes.world_of` = world id), `boarding_by_code` (second client boards; both states list two human seats), `unknown_codes_are_refused` (`unknown_vehicle`), `codes_of_other_worlds_point_there` (code inserted for `"other-route"` → `vehicle_elsewhere`, message `route:other-route`), `invalid_kinds_are_refused` (`invalid_vehicle` for seats 6), `racers_get_in_event`, `non_captain_lane_input_is_ignored` (no error message, lane unchanged), `boarding_events_reach_the_route` (`vehicle_boarded` event), `a_dissolved_vehicle_frees_its_code` (both leave → `codes.world_of` is `None`) (Review Focus 3).
- [ ] **Step 2:** RUST(`cargo test -p openradlr-server vehicle`) → fails.
- [ ] **Step 3:** Implement; map `WorldError` → wire code in one `fn vehicle_error_code(&WorldError) -> &'static str` in game.rs.
- [ ] **Step 4:** RUST(full check) → green.
- [ ] **Step 5:** Commit `Server: vehicle messages, codes and state (#55)`.

### Task 5: Join with a vehicle code

**Files:**
- Modify: `server/crates/server/src/worlds.rs` (hold `VehicleCodes`; `vehicle_world(&self, code) -> Option<&WorldEntry>`)
- Modify: `server/crates/server/src/app.rs` (create one `VehicleCodes`, hand it to every route game via `with_vehicle_codes` and to `Worlds`)
- Modify: `server/crates/server/src/session.rs` (`Action::Join` carries `vehicle_code`), `connection.rs` (pick the world by code first), `runtime.rs` (`Command::Join.vehicle_code`, `Game::join` gains `vehicle_code: Option<&str>`; studio ignores it)
- Modify: `server/crates/server/src/game.rs` (`join` boards after `join_human_on`; on failure removes the rider and returns the error)

**Interfaces:**
- Consumes: Task 4 `VehicleCodes`, `board_vehicle` logic.
- Produces: `JoinError::{UnknownVehicle, VehicleFull}` with codes `unknown_vehicle`, `vehicle_full`.

- [ ] **Step 1: Write failing tests:**
  - game.rs `joining_with_a_code_boards` (Anna creates; Ben joins with the code → Ben's first `State` has `vehicle`, Ben's position equals Anna's).
  - game.rs `joining_with_a_stale_code_leaves_nothing_behind` (code of a dissolved vehicle → `Err(UnknownVehicle)`, `player_count()` unchanged, no rider named Ben in the world) (Review Focus 4).
  - game.rs `joining_a_full_vehicle_fails` (`VehicleFull`, no rider left behind).
  - worlds.rs `codes_find_their_world`.
- [ ] **Step 2:** RUST(`cargo test -p openradlr-server join`) → fails.
- [ ] **Step 3:** Implement. In `connection.rs`, when `vehicle_code` is set: `state.worlds.vehicle_world(code)` → that entry's game and route; unknown → reply `unknown_vehicle` without taking a seat permit.
- [ ] **Step 4:** RUST(full check) → green.
- [ ] **Step 5:** Commit `Server: join straight onto a vehicle with its code (#55)`.

### Task 6: Client vehicle logic and protocol

**Files:**
- Create: `client/public/js/ride/vehicle.js`
- Modify: `client/public/js/net/protocol.js`
- Test: `client/test/vehicle.test.js`, `client/test/net.test.js`

**Interfaces:**
- Produces:
  - `ClientMessages.createVehicle({ kind, seats, bots })`, `ClientMessages.boardVehicle(code)`, `ClientMessages.leaveVehicle()`; `ClientMessages.join({ …, vehicleCode })` adds `vehicle_code` when set.
  - `ride/vehicle.js`:
    - `VEHICLE_KINDS` = `[{ kind: "tandem", seats: [2] }, { kind: "beer_bike", seats: [5, 7, 9] }]`
    - `normaliseCode(text) -> { code: string|null, error: string|null }` (strip whitespace, upper-case; 6 chars from the alphabet; `0 O 1 I` → error `"Codes don't use 0, O, 1 or I"`; wrong length → `"Codes have 6 characters"`).
    - `groupVehicles(riders) -> Map<vehicleId, { kind, seats: rider[] (by seat), captainSeat: rider }>`; riders without `vehicle` are not included.
    - `vehicleLabel(kind, captainName) -> "Anna's beer bike" | "Anna's tandem"`.
    - `aboardLine(vehicleState, myId) -> "Vehicle 980 W · you 21 %"` (sum of seat powers, my share rounded).
    - `isCaptain(vehicleState, myId) -> boolean`.
    - `class SeatEnergy { add(vehicleState, dtS); perSeat() -> [{ name, isBot, kj }]; summaryLine(kind) -> "Beer bike with Anna, Ben, Chris" }` (humans only in the line, in seat order).
    - `elsewhereRoute(errorMessage) -> string|null` (parses `route:<id>`).

- [ ] **Step 1: Write failing tests** in `vehicle.test.js` for each function: `normaliseCode(" abc 23k ")` → `{ code: "ABC23K", error: null }`; `normaliseCode("abc23")` → error `Codes have 6 characters`; `normaliseCode("ABO234")` → confusable error (Review Focus 5); grouping orders by seat; `aboardLine` with powers 200/300/480 and me 200 → `"Vehicle 980 W · you 20 %"`; `SeatEnergy` 10 s at 300 W → 3 kJ; `summaryLine("beer_bike")` → `"Beer bike with Anna, Ben, Chris"`; `elsewhereRoute("route:coast")` → `"coast"`. In `net.test.js`: the three builders and `join` with `vehicleCode`.
- [ ] **Step 2:** NODE → new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** NODE → green, eslint clean.
- [ ] **Step 5:** Commit `Client: vehicle logic and messages (#55)`.

### Task 7: Client panels, HUD and menus

**Files:**
- Create: `client/public/js/view/vehicleView.js`
- Modify: `client/public/index.html` (create/board/aboard panels, menu buttons, HUD line `data-m="vehicle"`, broadcast seat panel), `client/public/styles.css`
- Modify: `client/public/js/main.js` (wiring only), `client/public/js/view/startMenu.js` ("Board with code")
- Test: `client/test/ui.test.js` (or a new `client/test/vehicleView.test.js` following `ui.test.js`'s DOM fakes)

**Interfaces:**
- Consumes: Task 6 functions and builders.
- Produces: `VehicleView` with `constructor(root, { onCreate({kind, seats, bots}), onBoard(code), onLeave() })`, `showCreate()`, `showBoard()`, `update(vehicleState, myId)` (renders code + Copy, seats with name, watts, share bar, bot/paddle marks, `Captain: Anna steers`, Leave; hides itself for `null`).

Wiring in `main.js`: send builders on the callbacks; on `error` with `vehicle_elsewhere`, rejoin the world of `elsewhereRoute(message)` with `vehicleCode` the same way the route switch reconnects; while `state.vehicle` is set, hide Join event / Start race, and for non-captains hide the junction prompt, ignore lane keys and controller lane buttons, and show `The captain steers` as a short hint when they press them; feed `SeatEnergy` each state and add `summaryLine` and per-seat kJ to the ride summary. Start menu "Board with code" opens the board panel and joins with `vehicleCode`.

- [ ] **Step 1: Write failing tests** for `VehicleView`: `update` with a 5-seat state renders 5 rows (one empty stool row reads `Free seat`), the captain line, the code; Copy calls `navigator.clipboard.writeText` with the code; the board form calls `onBoard` with the normalised code and shows the `normaliseCode` error instead for bad input; `update(null)` hides the panel.
- [ ] **Step 2:** NODE → fail.
- [ ] **Step 3:** Implement the view, HTML, CSS and wiring.
- [ ] **Step 4:** NODE → green.
- [ ] **Step 5:** Commit `Client: create, board and ride a vehicle from the menus (#55)`.

### Task 8: Tandem and beer bike in 3D and 2D

**Files:**
- Create: `client/public/js/view3d/vehicleModel.js`
- Modify: `client/public/js/view3d/view3d.js` (upload vehicle meshes, draw vehicles), `client/public/js/view3d/chaseCamera.js` (higher/further for a beer bike), `client/public/js/view/pelotonView.js`, `client/public/js/view/minimapView.js` (one larger marker + label per vehicle)
- Test: `client/test/view3d.test.js`

**Interfaces:**
- Consumes: `groupVehicles`, `vehicleLabel` (Task 6); `riderModel.js` exports (`buildThigh`, `buildShin`, `buildFoot`, `buildCrankset`, `buildWheel`, `legPose`, `variantLook`, `riderLook`).
- Produces:
  - `buildTandemFrame() -> mesh` (long frame, two saddles, two bars), `buildBeerBike(seats) -> mesh` (cart, 4 wheels as part of the mesh or via `buildWheel`, roof on posts, bar counter, barrel, taps, steering wheel at the front, stools), `buildSeatedBody(look) -> mesh` (torso, arms, head, helmet — no bike).
  - `vehicleLayout(kind, seats) -> { seats: [{ hip: [x,y,z], bottomBracket: [x,y,z], yaw: number }], wheels: [[x,y,z]], wheelRadius, cameraBack, cameraUp }` — the tandem's two seats along −Z on the centre line; beer bike riders in pairs facing inwards across the counter (yaw ±π/2, seats 1..n−1 split exactly evenly), captain seat 0 at the rear end of the counter facing forward (yaw 0) with the steering wheel in front, a mug at every seat.
  - In `view3d.js`: `#vehicleParts(group, position, forward, dt)` reuses the leg IK of `#riderParts` with each seat's `hip`/`bottomBracket`/`yaw`; extract the leg block of `#riderParts` into `#legs(model, look, phase, hip, bottomBracket)` so both use it. Seated riders are drawn only through their vehicle but keep their own name label, placed over their seat; their cadence comes from `rider.cadence ?? (power > 0 ? 85 : 0)`.

- [ ] **Step 1: Write failing tests:** `vehicleLayout("tandem", 2).seats.length === 2`, front seat ahead of the rear (smaller z); `vehicleLayout("beer_bike", 9)` has 9 seats, seat 0 rearmost with yaw 0, seats 1..8 split exactly 4/4 left/right with opposite yaws; `buildBeerBike(7)` and `buildTandemFrame()` produce non-empty position arrays with matching normal/colour lengths (follow the mesh checks already in `view3d.test.js`); `buildSeatedBody(variantLook(0))` has no wheel vertices below `RIDER_GEOMETRY.wheelRadius`·0.5 height (no bike parts).
- [ ] **Step 2:** NODE → fail.
- [ ] **Step 3:** Implement models and drawing; 2D views draw one marker per `groupVehicles` entry at the captain's place with `vehicleLabel`.
- [ ] **Step 4:** NODE → green.
- [ ] **Step 5:** Commit `Client: tandem and beer bike models (#55)`.

### Task 9: Docs and end-to-end check

**Files:**
- Create: `docs/vehicles.md`, `docs/adr/0014-shared-vehicles-as-linked-riders.md`
- Modify: `docs/protocol.md`, `docs/architecture.md` (tick step for vehicles, module table rows), `CHANGELOG.md`, `README.md` feature list if it lists ride features

- [ ] **Step 1:** Write the docs from the spec (players' guide in `vehicles.md`: creating, codes, seats and bots, captain, what's not possible yet; ADR: context, decision "seats stay riders, a vehicle links them", alternatives 2 and 3 from the spec discussion, consequences).
- [ ] **Step 2:** RUST(full check) and NODE → both green.
- [ ] **Step 3:** Playwright check per the `ui-check-with-playwright-docker` recipe: page A joins with the sim trainer, creates a beer bike (6 seats, bots on), reads the code; page B joins with the start menu's "Board with code". Screenshot A's 3D view, A's seat panel and B's cockpit line; confirm both show the same vehicle and B's lane keys show `The captain steers`. Publish screenshots on an Artifact page.
- [ ] **Step 4:** Commit `Docs: shared vehicles, ADR 0014 (#55)`.
