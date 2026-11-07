# Physics Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calibrate road physics against a table of simulated riders, scale air drag with rider weight, give the client the server's physics numbers for virtual shifting, and turn Climb feel off while virtual shifting is on.

**Architecture:**
- **Calibration** is a pure module in `sim` that solves steady-state speeds with the real `physics::acceleration`, and its tests pin the target feel.
- **Rider drag:** `PhysicsParams` gets a reference mass, and every solo bike's CdA comes from `rider_cda`.
- **One source for the numbers:** the server sends `physics` in `joined`, and the client's `effectiveGrade` uses it instead of hand-copied constants.

**Tech Stack:** Rust (sim, server crates; no new deps), plain ES modules client, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-04-physics-calibration-design.md`

## Global Constraints

- `sim` stays pure: no I/O, async or third-party deps (ADR 0001).
- `PhysicsParams::default()`: `crr` 0.005, `cda` 0.40 (at `cda_reference_kg`), `cda_reference_kg` 75.0, `bike_mass_kg` 10.0, `air_density` 1.225, `max_speed` 30.0, `min_speed_for_power` 1.0.
- `rider_cda = cda · (clamp(m, 30, 200) / cda_reference_kg)^(2/3)`.
- Protocol stays version 2; `joined.physics` is additive: `{ mass_kg, cda_m2, crr, air_density }`, `mass_kg` = rider + bike.
- The client falls back to today's constants when `physics` is missing: CdA 0.32, Crr 0.004, ρ 1.225, mass = weight + 9.
- UI text lives in `client/public/js/i18n/en.js` and `de.js` (ADR 0017); both get every new string.
- One reason to fail per test, no sleeps; time, RNG and I/O injected (CONTRIBUTING.md).
- Rust runs in Docker: `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c "rustup component add rustfmt clippy && cargo test --workspace"`.
- Node runs in Docker: `docker run --rm -v "$PWD":/w -w /w/client node:22-alpine node --test "test/**/*.test.js"`.
- `make check` before claiming done.

## Review Focus

- **Seated in a vehicle:** the ride still uses the solo `joined.physics` for the gear maths (spec: vehicles out of scope). Nothing may break when `me.vehicle` is set. Task 4 adds a test that `effectiveGrade` inputs don't depend on the vehicle.
- **Reconnect (`resume_token`):** the resumed `joined` must carry the same `physics` as the first one, or a resumed ride silently falls back to the old constants. Task 3 tests the world and studio reattach paths.
- **Older server without `physics`:** virtual shifting must behave exactly as today. Task 4 pins `effectiveGrade` defaults to today's outputs, and the connection test pins `physics === null`.
- **Extreme weights (30 kg, 200 kg, and out-of-range values that never pass `valid_weight`):** `rider_cda` clamps, so CdA never goes to 0 or explodes. Task 2 tests both ends.
- **Toggling virtual shifting in the start menu after the trainer connects:** the Climb feel slider and gear settings must follow every toggle. They must also reappear when a trainer that can't control resistance hides the shifting row. Task 5 tests the pure rule for all four combinations.

---

### Task 1: Calibration solver and table

**Files:**
- Create: `server/crates/sim/src/calibration.rs`
- Create: `server/crates/sim/examples/calibration.rs`
- Modify: `server/crates/sim/src/lib.rs` (add `pub mod calibration;`)

**Interfaces:**
- Consumes: `physics::{acceleration, step_speed, Body, PhysicsParams, StepInput}`, today's `Body::bike(&params)`.
- Produces:
  - `pub fn steady_speed(params: &PhysicsParams, rider_mass_kg: f64, power_watts: f64, grade_percent: f64) -> f64` (m/s)
  - `pub struct Row { pub rider_kg: f64, pub cda: f64, pub flat_200w_kmh: f64, pub flat_2_5wkg_kmh: f64, pub climb_4pct_3wkg_kmh: f64, pub climb_8pct_3wkg_kmh: f64, pub coast_4pct_kmh: f64, pub coast_8pct_kmh: f64, pub ratio_200w_90rpm: f64 }`
  - `pub fn table(params: &PhysicsParams, riders: &[f64]) -> Vec<Row>`
  - `pub const RIDERS: [f64; 5] = [55.0, 70.0, 75.0, 90.0, 100.0];`
  - `pub fn markdown(rows: &[Row]) -> String`

- [ ] **Step 1: Write the failing tests** in `calibration.rs` `mod tests`:
  - `steady_speed_matches_stepping`: step `step_speed` from 0 with dt 0.05 for 600 s (75 kg, 200 W, 0 %, `cda_factor` 1.0, the body `steady_speed` uses). Assert `(stepped - steady_speed(..)).abs() < 0.05`.
  - `coasting_downhill_has_a_steady_speed`: `steady_speed(&p, 75.0, 0.0, -8.0) > 10.0`.
  - `no_power_on_the_flat_has_no_speed`: `steady_speed(&p, 75.0, 0.0, 0.0) < 0.01`.
  - `table_has_a_row_per_rider`: `table(&p, &RIDERS).len() == 5` and the `rider_kg` values are in order.
- [ ] **Step 2: Run them, expect a compile failure** (module missing): `cargo test -p openradlr-sim calibration`.
- [ ] **Step 3: Implement.**
  - `steady_speed` bisects on `[0, params.max_speed]` for 60 iterations: `acceleration > 0` means the speed is too low. On the flat at 0 W, `acceleration` is ≤ 0 everywhere, so the result is ~0.
  - Row fields: km/h = m/s × 3.6. `ratio_200w_90rpm = v_flat_200w / (1.5 rev/s × 2.1 m)`. `cda` = the body's CdA from the same body helper `steady_speed` uses (keep that in one private `fn body(params, mass) -> Body`, so Task 2 changes one line).
  - `markdown` renders a header and one line per row, one decimal for speeds, three for CdA, two for the ratio.
  - `examples/calibration.rs` prints `markdown(&table(&PhysicsParams::default(), &RIDERS))`.
- [ ] **Step 4: Run tests, expect PASS**; run `cargo run -p openradlr-sim --example calibration`, expect a 5-row table with 200 W flat ≈ 34 km/h (today's baseline).
- [ ] **Step 5: Commit** "Add a calibration table for the road physics (#22)".

### Task 2: Weight-scaled CdA and retuned constants

**Files:**
- Modify: `server/crates/sim/src/physics.rs` (params, `rider_cda`, `rider_physics`, `Body::bike`, tests)
- Modify: `server/crates/sim/src/calibration.rs` (target tests, body helper)
- Modify: callers of `Body::bike`: `server/crates/sim/src/world.rs:887`, `server/crates/sim/src/studio.rs:561`, `server/crates/sim/src/world/vehicles.rs:911`, `physics.rs` tests
- Modify: `server/crates/sim/src/world.rs`, `server/crates/sim/src/studio.rs` (`rider_physics` accessors)

**Interfaces:**
- Consumes: Task 1's `steady_speed`, `table`, `RIDERS`.
- Produces:
  - `PhysicsParams { .., pub cda_reference_kg: f64 }`
  - `pub fn rider_cda(params: &PhysicsParams, rider_mass_kg: f64) -> f64`
  - `Body::bike(params: &PhysicsParams, rider_mass_kg: f64) -> Body`
  - `pub struct RiderPhysics { pub mass_kg: f64, pub cda_m2: f64, pub crr: f64, pub air_density: f64 }` (in `physics.rs`), with `pub fn rider_physics(params: &PhysicsParams, rider_mass_kg: f64) -> RiderPhysics` (`mass_kg` = rider + bike)
  - `World::rider_physics(&self, id: RiderId) -> Option<RiderPhysics>` (from `rider.mass_kg`)
  - `Studio::rider_physics(&self, id: RiderId) -> Option<RiderPhysics>` (from the seated rider's `weight_kg`)

- [ ] **Step 1: Write the failing target tests** in `calibration.rs`, using `table(&PhysicsParams::default(), &RIDERS)`, one per check:
  - `two_hundred_watts_flat_suits_a_75_kg_rider`: 75 kg row `flat_200w_kmh` in `31.0..=32.0`
  - `two_hundred_watts_flat_suits_a_90_kg_rider`: 90 kg row in `29.0..=31.0`
  - `heavier_riders_are_slower_at_the_same_watts`: `flat_200w_kmh` strictly decreasing over rows
  - `heavier_riders_are_faster_at_the_same_watts_per_kg`: `flat_2_5wkg_kmh` strictly increasing
  - `three_watts_per_kg_climbs_eight_percent_plausibly`: every row's `climb_8pct_3wkg_kmh` in `10.0..=13.0`
  - `descents_stay_in_a_sane_band`: every `coast_8pct_kmh` in `54.0..=62.0`
  - `heavier_riders_coast_faster`: `coast_8pct_kmh` strictly increasing

  In `physics.rs` tests:
  - `rider_cda_is_cda_at_the_reference_weight`: `rider_cda(&p, 75.0) == p.cda`
  - `rider_cda_grows_with_two_thirds_of_mass`: `(rider_cda(&p, 150.0) - p.cda * 2f64.powf(2.0 / 3.0)).abs() < 1e-12`
  - `rider_cda_clamps_light_and_heavy_riders`: `rider_cda(&p, 10.0) == rider_cda(&p, 30.0)` and `rider_cda(&p, 500.0) == rider_cda(&p, 200.0)`
  - `rider_physics_adds_the_bike`: `rider_physics(&p, 90.0).mass_kg == 100.0`, `cda_m2 == rider_cda(&p, 90.0)`
- [ ] **Step 2: Run, expect FAIL** (targets out of band, `rider_cda` missing).
- [ ] **Step 3: Implement.**
  - The new defaults (Global Constraints) and `rider_cda`, `rider_physics`.
  - `Body::bike(params, mass)` uses `rider_cda`; update every caller with the mass it already has (`rider.mass_kg`, `rider.weight_kg`, the test's mass).
  - Calibration's body helper calls `Body::bike(params, mass)`.
  - Drop `two_hundred_watts_on_the_flat_is_a_realistic_speed` (the calibration tests replace it).
  - Add the two `rider_physics` accessors.
- [ ] **Step 4: Run** `cargo test --workspace`. Expect: calibration and physics tests pass.

  For any other failure (world, race, studio, bots, server e2e): read the test, and decide whether it pins a speed or time the retune legitimately changes.
  - If it does, update the expected value and add a one-line comment: "calibrated physics, #22".
  - If it fails for another reason, it's a bug: fix the code, not the test.

  List the changed tests in the commit message.
- [ ] **Step 5: Run the example**: the table should match the spec's expected table to ±0.3 km/h.
- [ ] **Step 6: Add `World::rider_physics`/`Studio::rider_physics` tests**: a joined 90 kg rider gives `mass_kg` 100; an unknown id gives `None`. Run, pass.
- [ ] **Step 7: Commit** "Scale air drag with the rider's weight and retune the physics (#22)".

### Task 3: `joined.physics` on the server

**Files:**
- Modify: `server/crates/server/src/protocol.rs` (`ServerMessage::Joined`, new `PhysicsWire`, serialisation test near line 1230)
- Modify: `server/crates/server/src/game.rs:393` (join), `:439` (reattach)
- Modify: `server/crates/server/src/studio.rs:140` (join), `:185` (reattach)
- Modify: every test that matches `ServerMessage::Joined { rider_id, resume_token }` (`game.rs`, `studio.rs`; add `..`)
- Modify: `docs/protocol.md` (`joined` row; Compatibility line)

**Interfaces:**
- Consumes: `World::rider_physics`, `Studio::rider_physics`, `RiderPhysics` (Task 2).
- Produces: wire JSON `"physics": { "mass_kg", "cda_m2", "crr", "air_density" }` on every `joined`; `PhysicsWire: From<RiderPhysics>`.

- [ ] **Step 1: Write the failing tests:**
  - `protocol.rs`: `joined_carries_the_rider_physics` asserts the serialised JSON has `physics.mass_kg == 100.0` and `physics.cda_m2`, `crr`, `air_density`.
  - `game.rs`: `joined_tells_the_rider_their_physics`: a 90 kg join delivers `Joined` with `physics.mass_kg == 100.0`.
  - `game.rs`: `reattach_sends_the_same_physics`: resume yields an equal `physics`.
  - `studio.rs`: the same two tests for the studio.
- [ ] **Step 2: Run, expect FAIL** (no field).
- [ ] **Step 3: Implement.**
  - Add `physics: PhysicsWire` to `Joined`.
  - At each `Joined` delivery, build it from `rider_physics(rider_id)`. The rider exists at that point; `expect` with a message, or return early as the surrounding code does for a missing client.
- [ ] **Step 4: Run** `cargo test --workspace`, expect PASS. Run clippy and `rustfmt --check` (as `make check` does).
- [ ] **Step 5: Update `docs/protocol.md`:**
  - In the `joined` row, add: "`physics` (`mass_kg` rider plus bike, `cda_m2`, `crr`, `air_density`: what the server rides you with on a solo bike)".
  - In Compatibility, add: "Physics calibration (#22) added `physics` to `joined` within version 2."
- [ ] **Step 6: Commit** "Tell the rider their physics on join (#22)".

### Task 4: Client uses the server's physics for virtual shifting

**Files:**
- Modify: `client/public/js/net/connection.js:47-52`
- Modify: `client/public/js/ride/virtualShifting.js` (`effectiveGrade`, drop `DRAG`, doc comment)
- Modify: `client/public/js/ride/rideSession.js:155` (pass `crr`)
- Modify: `client/public/js/ble/devices.js:258-260` (`setGrade` takes `crr`)
- Modify: `client/public/js/main.js` `resistanceModel` (~line 1575)
- Test: `client/test/shifting.test.js`, `client/test/net.test.js`, `client/test/ride.test.js`, `client/test/ble.test.js`

**Interfaces:**
- Consumes: wire `joined.physics` (Task 3).
- Produces:
  - `connection.physics`: `{mass_kg, cda_m2, crr, air_density} | null`
  - `effectiveGrade({ gradePercent, ratio, referenceRatio, speed, massKg, cda = 0.32, crr = 0.004, airDensity = 1.225, dragFactor, floorGrade, minGrade, maxGrade })`
  - resistance commands `{ grade, cw?, crr? }`
  - `SmartTrainer.setGrade(gradePercent, { cw?, crr? })`

- [ ] **Step 1: Write the failing tests:**
  - `shifting.test.js`:
    - `defaults reproduce today's grades`: for 3 fixed inputs (flat at 9 m/s, 6 % at 4 m/s, −5 % at 15 m/s; 84 kg, ratio = reference), assert the results equal the values today's code gives. Compute them once from the current code before changing it, and paste them in.
    - `a larger drag area makes speed harder`: same input at 9 m/s on the flat; `cda: 0.45` gives a higher grade than `cda: 0.32`.
    - `the given crr is what the trainer is assumed to add`: on a steep climb (no floor, no clamp), raising `crr` by 0.001 changes the grade by less than 0.05 points. The road's Crr and the trainer's cancel out.
  - `net.test.js`:
    - `keeps the physics from joined`: a fake socket sends `joined` with `physics`; `connection.physics` deep-equals it.
    - `physics is null when the server sends none`.
  - `ride.test.js`: `passes crr to the trainer with the grade`: `resistanceModel` returns `{ grade: 2, cw: 0, crr: 0.005 }`; the fake trainer's last options deep-equal `{ cw: 0, crr: 0.005 }`. A command without `cw` or `crr` still gives `{}`.
  - `ble.test.js`: `setGrade sends the given crr`: the encoded byte 5 is `50` for `crr: 0.005`.
  - `shifting.test.js` (Review Focus, vehicles): `effectiveGrade does not look at a vehicle`. The test builds the inputs the way `main.js` does via an exported helper, `shiftingInputs({ physics, profile, me })`, in `virtualShifting.js`. A `me` with `vehicle` set gives the same inputs as without.
- [ ] **Step 2: Run** `node --test test/shifting.test.js test/net.test.js test/ride.test.js test/ble.test.js`, expect FAIL.
- [ ] **Step 3: Implement.**
  - `effectiveGrade` computes drag as `0.5 · airDensity · cda · dragFactor · v²`.
  - `shiftingInputs({ physics, profile, me }) -> { massKg, cda, crr, airDensity }`: `physics` fields if present, else `massKg: profile.weightKg + 9` and the others `undefined`, so the defaults apply.
  - `connection` stores `message.physics ?? null` on `joined`.
  - `RideSession` passes `{ cw, crr }`, each only if present in the command.
  - `setGrade` spreads finite `cw`/`crr` into `encodeSimulationParameters`.
  - `main.js`:
    - the gear path spreads `shiftingInputs(...)` into `effectiveGrade` and returns `{ grade, cw: SHIFTING_CW, ...(crr && { crr }) }`
    - the non-gear path returns `{ grade: applyDifficulty(roadGrade, difficulty), ...(physics?.crr && { crr: physics.crr }) }`
- [ ] **Step 4: Run** the full client suite in Docker, expect PASS.
- [ ] **Step 5: Commit** "Shift with the server's physics numbers (#22)".

### Task 5: Climb feel is off with virtual shifting

**Files:**
- Modify: `client/public/js/main.js` (`resistanceModel` gear path; the toggle at ~line 597; the trainer-capability update at ~line 1222; ride start where `app.gearbox` is set)
- Modify: `client/public/index.html:224` (give the start-menu Climb feel label `id="difficulty-row"`) and `:704` (`id="ride-difficulty-panel"` on its `.panel`)
- Create: `client/public/js/ride/climbFeel.js`
- Modify: `client/public/js/i18n/en.js:655`, `de.js:655`
- Test: `client/test/climbFeel.test.js`, `client/test/shifting.test.js`

**Interfaces:**
- Consumes: Task 4's gear path in `resistanceModel`.
- Produces:
  - `export function climbFeelVisible({ shiftingOffered, shiftingChecked }) -> boolean` (true unless both are true)
  - `export function shiftingCommand({ roadGrade, gearbox, profile, physics, me, dragFactor }) -> { grade, cw, crr? }` in `virtualShifting.js`; `main.js`'s gear path calls it

- [ ] **Step 1: Write the failing tests:**
  - `climbFeel.test.js`: one test per combination of `shiftingOffered` × `shiftingChecked`; only `true/true` hides the slider.
  - `shifting.test.js`: `gears get the road grade without climb feel`: `shiftingCommand({ roadGrade: 8, gearbox, profile: { difficulty: 0.5, ... }, physics, me, dragFactor: 1 })` returns the same `grade` as `effectiveGrade` with `gradePercent: 8` and the same other inputs.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `climbFeelVisible`.
  - `shiftingCommand`: Task 4's gear path moves into it, with no `applyDifficulty`.
  - In `main.js`, wherever `#gear-settings` visibility is set, also set `$("difficulty-row").hidden = !climbFeelVisible({ shiftingOffered: could, shiftingChecked: $("virtual-shifting").checked })`. For the toggle handler, `shiftingOffered` is `!$("virtual-shifting").disabled`.
  - At ride start, `$("ride-difficulty-panel").hidden = Boolean(app.gearbox)`.
  - Append to `start.howMuchOfEach`:
    - en: " Not used with virtual shifting: the gears do it."
    - de: " Nicht bei virtuellem Schalten: Das übernehmen die Gänge."
- [ ] **Step 4: Run** the full client suite, including the i18n parity/sweep tests, expect PASS.
- [ ] **Step 5: UI check.**
  - `make dev`, then the Playwright screenshot recipe from AGENTS.md.
  - The start menu with the simulated trainer and virtual shifting checked: no Climb feel slider. Unchecked: the slider is back.
  - Keep the screenshots in `~/.cache/openradlr/screenshots/`.
- [ ] **Step 6: Commit** "Leave climb feel to the gears with virtual shifting (#22)".

### Task 6: Docs, ADR, changelog

**Files:**
- Create: `docs/adr/0018-calibrated-physics.md`
- Modify: `docs/devices.md` (FTMS paragraph line ~15–16; Virtual shifting section ~51–73), `docs/adr/0006-virtual-shifting-over-ftms.md` (dated consequence), `CHANGELOG.md` `[Unreleased]`, spec status → implemented

- [ ] **Step 1: Write ADR 0018** (context, decision, consequences), per the spec's Docs section. Include the calibration example command.
- [ ] **Step 2: Update `docs/devices.md`:**
  - Crr is the server's.
  - Difficulty only without gears.
  - Gear maths uses `joined.physics`.
- [ ] **Step 3: ADR 0006:** add the line "2026-11-04: drag area, Crr and mass come from the server (`joined.physics`); Climb feel does not apply with gears (#22)."
- [ ] **Step 4: CHANGELOG `[Unreleased]` → Changed:**
  - "Riding speeds are calibrated: 200 W on the flat is about 31 km/h for 75 kg, descents are slower, and heavier riders have more air drag (#22)."
  - "Climb feel no longer applies with virtual shifting; the gears do it (#22)."
- [ ] **Step 5: Run** `make check`, expect all green.
- [ ] **Step 6: Commit** "Document the calibrated physics (#22)".
- [ ] **Step 7:** Comment on #22 to correct the `cw` claim (spec: Scope, Out). Do this only with the user's go, since it's outward-facing.
