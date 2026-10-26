# Shared vehicles: tandems and beer bikes — design

Date: 2026-10-17 · Issue: #55 · Status: agreed in discussion, awaiting spec review

## Goal

Friends ride **together on one vehicle**: a **tandem** (2 seats) or a **beer
bike** (5, 7 or 9 seats). Everyone's real power is added up, the vehicle has
one speed and one position, and nobody gets dropped. Every trainer feels the
vehicle's grade. A host creates a vehicle from the ride menu and gets a short
code; friends board with it. Bots can fill the free seats.

## Decisions

| Question | Decision |
| --- | --- |
| How to get aboard | Free ride with a code. Hopping onto open seats in the world comes later |
| Gears | A gear per rider: virtual gear and difficulty only change your own resistance |
| Steering | The captain (the creator, front seat) decides lanes and junction turns |
| Events and races | Not in v1: seated riders can't join them, entrants can't board |
| Free seats | The host picks the vehicle and "Bots fill free seats" (on by default) |
| 3D | Proper tandem and beer bike models in v1 |
| Sim model | Seats stay normal riders; a `Vehicle` links them and does one physics step |

## Scope

In:

- Vehicle model, physics, steering, seat bots and lifecycle in `crates/sim`.
- Codes, protocol messages, join with a code, culling in the server.
- Create, board and aboard panels, HUD line, steering lockout, summary.
- Tandem and beer bike 3D models; vehicle markers in the 2D views.

Out (follow-up issues):

- Hopping onto open seats in the world.
- Vehicles in events, races and party rides (#45, #46).
- A vote on turns.
- Vehicle cosmetics.
- Keeping vehicles across a server restart.
- Vehicles in the spin studio.

## Simulation (`crates/sim`)

### `vehicle.rs` (new)

- `VehicleKind`: `Tandem` (2 seats) or `BeerBike { seats }` with `seats` in
  {5, 7, 9} (the captain plus 4, 6 or 8 riders, so both sides of the table
  fill evenly); anything else is rejected.
- `Vehicle { id, kind, seats: Vec<Option<RiderId>>, captain: RiderId,
  bots_fill: bool, code: String }`. Seat 0 is the front seat.
- `VehicleParams` in `SimConfig` (tunable):

  | | Frame mass | CdA | Crr | Draft behind it |
  | --- | --- | --- | --- | --- |
  | Tandem | 18 kg | 0.43 m² | 0.004 | the normal draft |
  | Beer bike | 250 kg + 40 kg per seat | 2.5 m² | 0.012 | up to −50 % CdA |

  Nine riders at about 135 W ride a beer bike at about 20 km/h on the flat.
- Pure helpers: summed power, combined mass (seat masses plus frame), each
  seat's share of the summed power (0 when the sum is 0).

`physics::StepInput` gets the frame mass, CdA and Crr from the caller instead of
the fixed `PhysicsParams` values, so a vehicle and a bike share
`step_speed`. Solo riders pass today's values, and their results are unchanged.

### `World`

API:

- `create_vehicle(captain, kind, bots_fill) -> Result<VehicleId>`: the captain
  sits in seat 0; with `bots_fill`, every other seat gets a seat bot.
- `board(vehicle, rider) -> Result<seat>`: takes the first empty seat, else
  replaces the first bot (the bot is removed). The rider is moved to the
  vehicle: route, position, off-route state, lane, turn, speed.
- `leave_vehicle(rider)`: also called from `leave`. See *Leaving*.
- `vehicle_of(rider)`, `vehicle(id)`, `vehicles()`.

Errors (`WorldError`): `NoSuchVehicle`, `VehicleFull`, `NotCaptain`,
`AlreadyAboard`, `InEvent` (entered in a race or event, or seated when trying
to join one).

Tick:

1. **Power** as today for every rider, seated or not: telemetry timeout for
   humans, the brain for bots.
2. **Solo riders** run physics as today; seated riders are skipped.
3. **Each vehicle** runs one physics step: power is the sum of its seats'
   `power`, mass the seats' masses plus the frame, CdA the vehicle's CdA times the
   draft factor of the gap ahead of the vehicle. It advances along the
   captain's road (captain's `turn`), moves the lane towards the captain's
   `target_lane`, then copies speed, position, odometer increment, lane,
   route, off-route state and turn to every seat.

Because every seat shares one position, `grade_for(seat)` is the vehicle's
grade and every trainer gets the same hill (scaled by each rider's own
difficulty and gear on the client).

Drafting and lanes:

- A vehicle is one `Slot`, at the captain. Seats other than the captain have no
  slot, so seats never draft each other and riders draft the vehicle once.
- Behind a beer bike the draft factor uses its stronger curve (down to 0.5).
- The beer bike is wide: its same-lane check uses a half-width of one lane, so
  riders in either neighbouring lane are "behind" or "in front of" it.

Steering:

- `shift_lane` and `choose_turn` from a seat other than the captain return
  `NotCaptain` and change nothing.

Seat bots:

- Bot controller with the steady group-ride pace at the average W/kg of the
  vehicle's humans (2.8 W/kg with none), cadence 85, names from `names.rs`.
- Not counted by and never removed by `balance_population`.
- Re-levelled when a human boards or leaves.

Leaving:

- A human who leaves (or disconnects) is replaced by a seat bot when
  `bots_fill`, otherwise the seat becomes empty (0 W, no mass).
- If the captain leaves, the next human in seat order becomes captain and steers.
- When the last human leaves, the vehicle and its bots are removed.
- Someone who leaves the vehicle but stays connected rides on solo from the
  same spot, at the vehicle's speed.

Events: `WorldEvent::Vehicle { id, change }` with `Created`, `Boarded(rider)`,
`Left(rider)`, `CaptainChanged(rider)`, `Dissolved`.

## Server

### Codes

- 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, drawn from the world's
  `RandomSource`, unique per server, valid while the vehicle exists.
- `VehicleCodes`: a small registry (`Mutex<HashMap<code, world id>>`) shared by
  `Worlds`. A game inserts the code on create and removes it on dissolve; on a
  clash with another world's code it draws again before creating.

### Protocol (additive)

Client → server:

| Message | |
| --- | --- |
| `create_vehicle { kind: "tandem" \| "beer_bike", seats, bots }` | The sender becomes captain |
| `board_vehicle { code }` | Board in this world. A code of another world fails with `vehicle_elsewhere` and that world's `route_id` |
| `leave_vehicle` | |
| `join { …, vehicle_code }` | Optional. The server picks the world from the registry (ignoring `route_id`) and boards on join |

Server → client:

- `RiderState.vehicle`: optional `{ id, kind, seat, seats }`;
  `RiderState.cadence` for seated riders, so each seat pedals at its own rate.
- `State.vehicle`: my vehicle only,
  `{ id, code, kind, captain, bots, seats: [{ rider_id, name, is_bot, power,
  share }] }` with `null` for an empty seat.
- `GameEvent`: `vehicle_boarded`, `vehicle_left`, `captain_changed`, sent to
  the route.
- Errors through the existing error reply: `unknown_vehicle`, `vehicle_full`,
  `vehicle_elsewhere`, `not_captain`, `in_event`, `invalid_vehicle`, `already_aboard`.

Culling: when any seat of a vehicle is in a client's view, every seat is sent.

Messages fall under the existing message rate limits. Lane and turn inputs
from non-captains are dropped silently (the client already hides them).

### Unchanged on purpose

- Resistance updates: the per-rider grade already follows the vehicle.
- Telemetry, FIT/TCX recording and Strava: your own real power with your
  rider's speed and distance, which are the vehicle's.
- The community distance counters: per human, as before.

## Client

New modules (logic out of `main.js`, which only wires them):

- `ride/vehicle.js` (pure): groups riders by `vehicle.id`, finds my vehicle
  and whether I am captain, seat shares, code input normalising and
  validation, kJ per seat over the ride.
- `view/vehicleView.js`:
  - **Create:** tandem or beer bike (5, 7 or 9 seats), "Bots fill free seats".
  - **Board:** 6-character code field.
  - **Aboard:** the code with a Copy button; the seats with name, watts and
    share bar (bots marked, paddle badge); "Captain: Anna steers"; Leave.
- `view3d/vehicleModel.js`:
  - **Tandem:** long frame, two wheels, two riders. Body parts come from
    `riderModel.js`, and each crank gets the `legPose` IK at its own seat's cadence.
  - **Beer bike:** flat cart on 4 wheels, roof on posts, bar counter with a
    barrel and taps, riders in pairs facing inwards on both sides with pedals
    under the counter. The captain sits at the rear end of the counter, facing
    forward along the table towards the others, with the steering wheel in front
    of them. A beer mug at every seat, the captain's included. Empty seats are
    bare stools.
  - Jersey tints as today: me orange, humans blue, bots grey.

Wiring:

- Start menu: "Board with code" joins with `vehicle_code`.
- Ride menu: "Create tandem / beer bike" and "Board with code". On
  `vehicle_elsewhere` the client rejoins that world with the code, as when
  switching routes.
- While aboard: Join event and Start race hidden. For non-captains the junction
  prompt is hidden, lane keys and controller buttons do nothing, and a short
  hint shows "The captain steers".
- Cockpit: the power gauge stays my power, plus `Vehicle 980 W · you 21 %`.
  The broadcast layout gets the seat panel.
- 3D: riders sharing a `vehicle.id` are drawn as one model at the captain's
  smoothed position, with a name label per seat. The chase camera sits higher
  and further back behind a beer bike.
- 2D views and minimap: one larger marker per vehicle, labelled
  "Anna's beer bike" / "Anna's tandem".
- Summary: "Beer bike with Anna, Ben, Chris" and each seat's kJ.

## Edge cases

- Off the route: the whole vehicle follows the captain's turns, and the seats copy
  the off-route state, so it never splits.
- Boarding a moving vehicle puts you straight in the seat at its speed.
- Paddles and the sim trainer can board; their power is summed like any other.
- Stale telemetry: the seat drops to 0 W after 3 s as today; only a disconnect
  hands the seat to a bot.
- Full vehicle (bots off, all seats human): `vehicle_full`.
- Server restart: vehicles are gone; riders reconnect solo.

## Testing

- Sim, pure `vehicle.rs`: power sum, mass, shares, kind validation.
- Sim, `World`: summed power moves the vehicle; all seats share position and
  grade; non-captain steering rejected; dropout becomes a bot; boarding replaces
  a bot; captain hand-over; dissolve with the last human; seat bots ignored by
  population balance; boarding refused in races and events; off-route vehicle
  stays together; solo physics unchanged.
- Server: protocol round-trips; game tests for create, board by code,
  `vehicle_elsewhere`, join with `vehicle_code`, non-captain lane input
  ignored, seats culled together.
- Client: unit tests for `ride/vehicle.js`; a build test for `vehicleModel.js`
  (geometry produced, one pose per seat). Run in the node:22 container.
- Manual: Playwright, a sim-trainer rider creates a beer bike with bots, a
  second page boards with the code; screenshots of the 3D view and the seat
  panel shared on an Artifact page.

## Delivery

One PR on `feat/beer-bike`, as ordered commits:

1. Sim: `vehicle.rs` model and constants; `StepInput` takes frame mass, CdA, Crr.
2. Sim: `World` create/board/leave, vehicle physics step, steering, seat
   bots, dissolve.
3. Server: protocol, `VehicleCodes`, game core (culling, events, errors), join
   with `vehicle_code`.
4. Client: `ride/vehicle.js` and protocol wiring.
5. Client: panels, HUD line, menu entries, steering lockout, summary.
6. Client: tandem and beer bike 3D models, 2D markers.
7. Docs: `docs/vehicles.md`, `protocol.md`, `architecture.md`, ADR 0014
   "Shared vehicles as linked riders", CHANGELOG.
