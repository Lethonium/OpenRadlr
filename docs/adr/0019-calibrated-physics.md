# 19. Calibrated road physics, drag scaled by rider weight

Date: 2026-11-05 · Status: accepted

## Context

The road physics constants (CdA 0.32 m², Crr 0.004, a 9 kg bike) were starting
points that nobody had checked against riders. 200 W on the flat gave about
34 km/h whatever the rider weighed, and coasting at −8 % reached 61–75 km/h.
Every rider had the same drag area, so a heavy rider was as fast at the same
watts as a light one. With virtual shifting (ADR 0006) the fast flat pushed
riders into high gears. The client's gear maths also carried its own copy of
the constants, which could drift from the server's (#22).

## Decision

- **A calibration table in tests.** `sim::calibration` solves steady-state
  speeds with the real `physics::acceleration` for simulated riders of 55, 70,
  75, 90 and 100 kg. Its tests pin the target feel: 200 W on the flat is
  31–32 km/h for 75 kg and 29–31 km/h for 90 kg, heavier riders are slower at
  the same watts and faster at the same W/kg, 3 W/kg climbs 8 % at 10–13 km/h,
  and coasting at −8 % stays between 54 and 62 km/h, faster for heavier riders.
  `cargo run -p openradlr-sim --example calibration` prints the table.
- **Drag area scaled by weight.** `rider_cda = cda · (m / 75 kg)^(2/3)`, with
  `m` clamped to 30–200 kg: a rider grows alike in every direction, so frontal
  area goes with length² and length with mass^(1/3). There is no height field;
  weight stands in for size. A height-from-BMI formula would grow about as
  m^0.79, too fast for heavy riders, who aren't proportionally taller.
- **Retuned constants:** CdA 0.40 m² at 75 kg, Crr 0.005, bike 10 kg.
- **The server is the one source.** `joined.physics` sends the rider's mass
  (with the bike), CdA, Crr and air density. The client's virtual shifting uses
  them, and the trainer gets the same Crr.

## Consequences

- Bots ride the same physics: at the same watts they slow down, heavy ones most.
  Their targets are in W/kg, so a group's spread barely changes.
- A retune is a reviewed change to the table: the example's output shows it, and
  the tests say whether it still feels right.
- Vehicles keep their own fixed body; the client's gear maths uses the rider's
  solo values while seated.
- Not settled: the trainer's own air drag (`cw`) without virtual shifting stays at
  the FTMS default 0.51 kg/m, because it isn't clear whether FTMS means ½·ρ·CdA
  or ρ·CdA there. Whether trainers apply the force asked for, and which mass
  they assume, needs a measurement.
