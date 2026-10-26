# 14. Shared vehicles as linked riders

Date: 2026-10-17 · Status: accepted

## Context

Friends with different fitness can't ride together: the strong ride away
(group rides in [ADR 13](0013-scheduled-events.md) only help with a lobby and
a timetable). #55 asks for tandems and beer bikes, where several riders add up
their power on one vehicle, share its speed and nobody is dropped. Everything a
rider has today (telemetry, resistance, recording, culling, population) is
built around a rider with a position.

## Decision

- **Seats stay riders; a vehicle links them.** Every seat is an ordinary human
  or bot rider. A `Vehicle` in `crates/sim` holds the seats, the captain and a
  boarding code. Seated riders skip the solo physics step; the vehicle takes
  one step with the summed power, the combined mass and its own CdA and Crr
  along the captain's road, then copies speed, position, lane and turn to
  every seat. Everything keyed on a rider keeps working, and the grade each
  trainer feels is simply the vehicle's.
- **The captain steers.** Lane changes and turns of other seats are rejected
  (`not_captain`); when the captain leaves, the next human takes over.
- **Gears stay per rider.** Difficulty and virtual gear only change your own
  resistance, so a vehicle needs no agreement on them.
- **Free ride with a code.** The creator gets a 6-character code from a
  server-wide registry (`VehicleCodes`); `board_vehicle` or `join` with
  `vehicle_code` boards. A code of another world answers `vehicle_elsewhere`
  with the route to rejoin.
- **Seat bots.** Optional, at the humans' average W/kg; a newcomer replaces a
  bot, a leaver is replaced by one. They are not counted by population balance.
- **Not in events or races** for now.

## Alternatives

- **A vehicle as a new kind of world entity that replaces its riders.**
  Cleaner on paper, but it would duplicate the rider plumbing for telemetry,
  resistance, recording, culling and population. Rejected.
- **A vehicle simulated client-side, with riders merely following the
  captain.** Breaks the authoritative server
  ([ADR 2](0002-authoritative-server-json-websocket.md)): speed and position
  would come from a client. Rejected.

## Consequences

- Additive protocol change (`create_vehicle`, `board_vehicle`,
  `leave_vehicle`, `vehicle_code` in `join`, `state.vehicle`,
  `riders[].vehicle`, three game events, vehicle error codes); the version
  stays 2. Older clients see the seats as separate riders at one spot.
- Solo physics are unchanged; the physics step takes mass, CdA and Crr as
  input so riders and vehicles share it.
- Recording and Strava keep the rider's real power with the vehicle's speed.
- Vehicles live in memory and are gone after a restart.
- Hopping onto open seats on the road, events and a vote on turns remain
  follow-ups.
