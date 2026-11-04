# Physics calibration and virtual shifting — design

Date: 2026-11-04 · Issue: #22 · Status: draft

## Goal

Riding feels believable for riders of any size, and the feel is checked by code
instead of by guesswork. Today 200 W on the flat gives about 34 km/h whatever
the rider weighs, descents run to 61–75 km/h at −8 %, and with virtual shifting
the flats need a high gear while climbs feel easy.

Calibration is a deterministic table of simulated riders (55–100 kg) that pins
down target speeds. The constants are retuned until it passes. Air drag grows
with the rider's weight. The client's virtual-shifting maths takes the same
numbers from the server instead of hand-copied ones. Climb feel no longer
applies while virtual shifting is on.

## Decisions

| Question | Decision |
| --- | --- |
| Target flat speed at 200 W | 75 kg: 31–32 km/h. 90 kg: 29–31 km/h. Reference: a 90 kg rider averages 25–30 km/h on a gravel bike outdoors; the road in the game is a bit faster |
| Rider size | No height field. CdA is scaled from the rider's weight: `CdA = cda · (m / 75 kg)^(2/3)` |
| Constants | CdA 0.40 at 75 kg (was 0.32 for everyone), Crr 0.005 (was 0.004), bike 10 kg (was 9). Final values are whatever passes the calibration table; these are the starting point |
| Climb feel with virtual shifting | Ignored and its sliders hidden (option B in #22). Riders shifting real gears keep it |
| Start gear | Stays gear 12 |
| Gear table | Unchanged (`GEAR_RATIOS`, 0.75–5.0). Revisit after riding the retuned physics |
| Trainer air drag without virtual shifting | Unchanged (FTMS default `cw` 0.51). See Scope, Out |

## Scope

In:

- A calibration module in `sim` with steady-state solvers and the target table as tests, plus an example that prints the table.
- Weight-scaled CdA for every solo bike rider (humans, bots, studio riders).
- Retuned `PhysicsParams` defaults.
- An additive `physics` object in `joined` (protocol version stays 2).
- The client's `effectiveGrade` uses the server's mass, CdA, Crr and air density. The Crr sent to the trainer matches.
- Climb feel option B.
- Docs: `docs/devices.md`, `docs/protocol.md`, ADR 0006 note, new ADR 0018, CHANGELOG.

Out:

- **Rider height** in the profile or protocol.
- **Vehicles in the gear maths.** Tandems and beer bikes keep their own fixed body (`vehicle.rs`), but the client's gear maths keeps using the rider's solo values while seated. A vehicle's force is shared among seats; that needs its own design.
- **Trainer `cw` without virtual shifting.** #22 claimed the FTMS default 0.51 kg/m is 2.6× the game's drag. That assumed FTMS `cw` means ½·ρ·CdA. Under the ANT+ FE-C convention it is ρ·CdA (default 0.40 m² × 1.275 kg/m³). Then 0.51 is close to the retuned CdA (ρ·0.40 = 0.49), not 2.6× off. The search for this design could not confirm either reading from the FTMS or FE-C specs, so this stays as it is until it is checked against the specs or a trainer. The issue gets a correction.
- **Trainer power check.** Not verified: whether trainers apply the force we ask for, and which rider mass a trainer assumes when it turns a grade into force (FTMS *Set Indoor Bike Simulation Parameters* carries no mass). Both are worth a measurement, not code.
- Changes to drafting, the 30 m/s cap, wind or air density by altitude.

## Physics model (`server/crates/sim/src/physics.rs`)

The equation stays:

```text
m · dv/dt = P / v − m·g·(sin θ + Crr·cos θ) − ½·ρ·CdA·v²
```

`PhysicsParams` changes:

| Field | Now | New |
| --- | --- | --- |
| `crr` | 0.004 | 0.005 |
| `cda` | 0.32, drag area of every rider | 0.40, drag area **of a rider of `cda_reference_kg`** |
| `cda_reference_kg` | — | 75.0 |
| `bike_mass_kg` | 9.0 | 10.0 |

New function:

```rust
/// Drag area of a solo rider: `cda · (m / cda_reference_kg)^(2/3)`.
/// The rider grows alike in every direction: frontal area scales with
/// length², length with mass^(1/3). `m` is clamped to 30–200 kg (the
/// weights a join accepts).
pub fn rider_cda(params: &PhysicsParams, rider_mass_kg: f64) -> f64
```

Why not estimate a height from BMI and use a height/weight formula: that comes
out at about m^0.79. It grows too fast for heavy riders, who aren't
proportionally taller.

`Body::bike(params)` becomes `Body::bike(params, rider_mass_kg)`, with
`cda: rider_cda(params, rider_mass_kg)`. All callers already have the mass at
hand:

- `world.rs`, the rider step: `rider.mass_kg`
- `world/vehicles.rs`, tests: the rider's mass
- `studio.rs`, the rider step: `rider.weight_kg`
- `physics.rs`, tests: the rider's mass

Vehicles keep `VehicleParams::body`, with fixed values.

Bots ride the same physics. At the same watts they get slower, heavy ones most.
Bot targets are in W/kg, so a bot group's spread barely changes. Existing world,
race and studio tests that pin a speed or a finishing order may need new
expected values; each such change is checked, not just updated.

## Calibration (`server/crates/sim/src/calibration.rs`)

Pure functions on the real physics, no copy of the equation:

```rust
/// Speed (m/s) where `physics::acceleration` is zero at `power_watts` on
/// `grade_percent`: bisection between 0 and `max_speed`.
pub fn steady_speed(params: &PhysicsParams, rider_mass_kg: f64, power_watts: f64, grade_percent: f64) -> f64

/// One row of the calibration table.
pub struct Row { rider_kg, cda, flat_200w_kmh, flat_2_5wkg_kmh, climb_4pct_3wkg_kmh,
                 climb_8pct_3wkg_kmh, coast_4pct_kmh, coast_8pct_kmh, ratio_200w_90rpm }

/// The table for `riders` (kg), with the given parameters.
pub fn table(params: &PhysicsParams, riders: &[f64]) -> Vec<Row>
```

- Coasting is `steady_speed` with 0 W on a negative grade.
- `ratio_200w_90rpm` is the gear ratio (chainring/cog) that gives the 200 W flat speed at 90 rpm on a 2.1 m wheel. It's informative only: it maps to the client's gear table, which the server doesn't know.

Tests in the module pin the targets, for riders 55 / 70 / 75 / 90 / 100 kg
with default parameters:

| Check | Target |
| --- | --- |
| 200 W flat, 75 kg | 31–32 km/h |
| 200 W flat, 90 kg | 29–31 km/h |
| 200 W flat | strictly slower with each heavier rider |
| 2.5 W/kg flat | strictly faster with each heavier rider |
| 3 W/kg at 8 % | 10–13 km/h for every rider |
| Coasting at −8 % | 54–62 km/h for every rider, rising with weight |
| `steady_speed` agrees with stepping | stepping `step_speed` for 600 s from rest ends within 0.05 m/s of `steady_speed` (75 kg, 200 W, flat) |

Each check is one test with one reason to fail (CONTRIBUTING.md).

`cargo run -p openradlr-sim --example calibration` prints the table as Markdown,
so a retune shows up readably in review.

Expected table with the new defaults (from the design calculation; the test is
the authority):

| Rider | CdA | 200 W flat | 2.5 W/kg flat | 3 W/kg at 8 % | Coasting −8 % |
| --- | --- | --- | --- | --- | --- |
| 55 kg | 0.325 | 34.1 km/h | 29.6 km/h | 10.7 km/h | 56 km/h |
| 75 kg | 0.400 | 31.5 km/h | 30.7 km/h | 11.1 km/h | 57 km/h |
| 90 kg | 0.452 | 29.9 km/h | 31.3 km/h | 11.3 km/h | 59 km/h |
| 100 kg | 0.485 | 29.1 km/h | 31.7 km/h | 11.4 km/h | 59 km/h |

Existing tests that change:

- `two_hundred_watts_on_the_flat_is_a_realistic_speed`: 32–37 km/h becomes the new band. The calibration tests replace it; drop it there.
- `climbing_is_slower_than_riding_flat`: 250 W at 6 %, 12–20 km/h; still holds, keep.
- `beer_bike_cruises_near_20_kmh`: vehicle body, unaffected.

## Protocol (`joined`, additive)

`joined` gains `physics`, the numbers the server rides this rider with on a
solo bike:

```json
{ "type": "joined", "rider_id": 7, "resume_token": "…",
  "physics": { "mass_kg": 100.0, "cda_m2": 0.452, "crr": 0.005, "air_density": 1.225 } }
```

- `mass_kg` is rider plus bike.
- Sent on every `joined`: world, studio and resume.
- An older client ignores it; a newer client against an older server falls back to today's constants.
- `docs/protocol.md`: the field in the table, and a line in Compatibility ("Physics calibration (#22) added `physics` to `joined` within version 2").

Server: `ServerMessage::Joined` gets `physics: PhysicsWire`, built from
`PhysicsParams` and the rider's weight in `game.rs` and `studio.rs` where
`Joined` is delivered. A `rider_physics(params, weight_kg)` helper in `sim`
returns all four values, so the server just converts it to the wire type.

## Client

### Connection (`net/connection.js`)

On `joined`, keep `this.physics = message.physics ?? null`.

### Virtual shifting (`ride/virtualShifting.js`)

`effectiveGrade` takes `cda`, `crr` and `airDensity` instead of the module
constant `DRAG`:

- `massKg` stays as an input.
- Defaults are today's values (`cda` 0.32, `crr` 0.004, `airDensity` 1.225), so an older server keeps today's behaviour.
- `DRAG` goes.
- The doc comment no longer claims to mirror the server's numbers; it says where they come from.

`main.js`, `resistanceModel`:

```js
const physics = connection.physics;          // null on an older server
effectiveGrade({
  gradePercent: roadGrade,                   // option B: no applyDifficulty with gears
  ratio, referenceRatio, speed, dragFactor,
  massKg: physics?.mass_kg ?? app.profile.weightKg + 9,
  cda: physics?.cda_m2, crr: physics?.crr, airDensity: physics?.air_density,
});
return { grade, cw: SHIFTING_CW, crr: physics?.crr };
```

### Crr sent to the trainer

`effectiveGrade` subtracts the Crr it assumes the trainer adds. So the command
carries `crr`, and `RideSession` passes it on:

- `setGrade(grade, { cw, crr })`
- `encodeSimulationParameters` (already takes `crr`)

Without gears, the road command also sends the server's `crr`. `cw` stays at
the FTMS default (see Scope, Out).

### Climb feel (option B)

- **Trainer:** with a gearbox, the road grade goes to `effectiveGrade` unscaled (no `applyDifficulty`). Without one, nothing changes.
- **Start menu:** the Climb feel slider (`#difficulty` in its `label`) is hidden while the virtual-shifting checkbox is checked and offered. It follows the same toggle that shows `#gear-settings`.
- **In-game menu:** the Training page's Climb feel panel (`#ride-difficulty`) is hidden when the ride has a gearbox.
- **Stored value:** kept, so turning shifting off brings the rider's setting back.
- **Text:** the hint `start.howMuchOfEach` (en + de) gets one more sentence: "Not used with virtual shifting: the gears do it."

`difficulty.js` keeps its `descents` option; the gearbox path no longer calls it.

## Testing

- **Sim:**
  - the calibration tests above
  - `rider_cda` (75 kg gives `cda`; 150 kg gives `cda · 2^(2/3)`; below 30 kg clamps)
  - `Body::bike` uses the rider's CdA
- **Server:** a `joined` test asserts the `physics` object (world and studio), and protocol serialisation round-trips it.
- **Client (`node --test`):**
  - `effectiveGrade` uses the given `cda`/`crr`/`airDensity`: a higher CdA at speed gives a higher grade; defaults reproduce today's results
  - `connection` keeps `physics` from `joined` and is `null` without it
  - `RideSession` passes `crr` through to `setGrade`
  - the Climb feel visibility rule, as a pure function (`climbFeelVisible({ shiftingOffered, shiftingChecked })`) if the DOM wiring otherwise can't be tested
- `make check` passes.
- A ride on the retuned physics with a Cog trainer confirms the feel. That's done by the rider; the PR says so.

## Docs

- `docs/devices.md`:
  - Virtual shifting: the numbers come from the server; Climb feel doesn't apply with gears
  - FTMS: the Crr sent is the server's
  - correct "positive grades × difficulty" to say it's only without gears
- ADR 0006: a dated consequence line (drag and mass from the server; Climb feel off with gears).
- New ADR `docs/adr/0018-calibrated-physics.md`. Context: uncalibrated constants, one CdA for everyone. Decision: a calibration table in tests; CdA scaled by weight with exponent 2/3; the server is the one source for the constants. Consequences: bots slow down; a retune is a reviewed table change.
- `docs/protocol.md`: `joined.physics`.
- CHANGELOG `[Unreleased]` (#22):
  - Changed: riding speeds are calibrated, and heavier riders have more drag
  - Changed: Climb feel is off with virtual shifting
- #22: a comment correcting the `cw` claim.

## Order of work (one PR, ordered commits)

1. Calibration module (`steady_speed`, `table`) and the example, with today's constants. Only the solver tests come in here: the example prints today's numbers as the baseline.
2. The target tests (failing), then `rider_cda`, `Body::bike(params, mass)` and the retuned defaults until they pass; fix the affected world, race and studio tests.
3. `joined.physics` on the server, protocol doc.
4. Client: connection, `effectiveGrade` inputs, Crr to the trainer.
5. Climb feel option B, with i18n.
6. Docs, ADR 0018, CHANGELOG.

## Open points for the plan

- Where the existing world, race and studio tests pin speeds or orders: list them in step 2 after the first test run, not guessed upfront.
