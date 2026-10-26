# 15. Workouts as parked riders with an exercise field

Date: 2026-10-21 · Status: accepted

## Context

#77 asks for bodyweight workouts without a bike: a circuit of timed exercises
(squats, sit-ups, plank…) that a rider does at an outdoor gym, visible to
everyone passing it. The sim already knows how to keep a rider parked
off the road (#89, [ADR 14](0014-shared-vehicles-as-linked-riders.md) links
riders into vehicles and the pause work pulls a rider onto the shoulder).
A workout rider does not ride at all, and the exercises run on a timer the
rider controls. Two shapes were on the table:

- **A server-owned session:** the server holds the plan, broadcasts the current
  block and the remaining seconds, and everyone's clocks agree.
- **A client-owned plan:** the server knows only that a rider is working out
  and which exercise it does right now; the plan and the clock are client data.

The plan format, the exercise clips and the parked-off-the-bike rider are also
meant to be reused by the later circuit mode (ride blocks plus exercises) and
the workout and cross studios, so the first slice should not lock the design to
one server-side schedule.

## Decision

- **A workout is a rider with a flag.** `join` with `device: "workout"` makes
  the rider a *workout rider*: it spawns at the route start (a resume is
  ignored for workout joins) and is parked from the first tick — stopped, on the shoulder,
  out of drafting. `Rider.workout` is a plain boolean in `crates/sim`; the sim
  never sees an exercise id.
- **The server knows only the current exercise.** A new `workout` message
  (`{exercise: string | null}`, `null` for rest) stores the exercise on the
  client and echoes it in `riders[].exercise`, left out when there is none.
  The server keeps no plan and checks no timing.
- **A workout rider is not a rider of the road.** It is left out of
  `route_riders.humans`, and any riding message (`input`, `telemetry`,
  `start_race`, `join_race`, `join_event`, `turn`, `create_vehicle`,
  `board_vehicle`, `pause`, `resume`) gets `in_workout`; `telemetry` is
  silently ignored (no error); a `workout` from a rider who did not join as one gets
  `not_in_workout`, an unknown id `unknown_exercise`. The studio refuses the
  join with `unknown_route`, and `vehicle_code` and `resume` are dropped.
- **The plan is client data.** `client/public/js/workout/plan.js` validates and
  positions the plan; `workoutSession.js` runs the clock (pause, skip, early
  end) and `main.js` executes its actions. The plan format, the `withGetReady`
  block and the presets live in the client.
- **The clip is chosen by the exercise id.** `riders[].exercise` picks the
  clip (`client/public/js/view3d/clips.js`); no exercise is the idle stand.
  Clip time for other riders is the time since this client first saw the new
  value (like `parkedSince`), so everyone animates the same rider without a
  shared clock. The circuit mode and the studios reuse `riders[].exercise` and
  the same clips.
- **The gym is scenery every client agrees on.** `buildOutdoorGym` places a
  gym at every café; the spot layout (`assignSpots`) is computed on each client from the
  rider ids it sees, so no server state is needed (the `max_visible_riders`
  limit can make two clients see different riders and so disagree on who
  stands where). More
  riders than spots stand in extra rows behind the mat. Without a gym at the
  route start the workout has no stage: the HUD sits over the chase camera and
  the avatar stays parked on its bike. In v1 the equipment is not used by any
  exercise.
- **Keepalive.** A workout sends no telemetry and the server closes a joined
  connection after 120 s of silence, so the client repeats its current
  `workout` message every 30 s while the workout runs.
- **Heart rate** samples include paused time; the summary shows their average
  and maximum.

## Alternatives

- **A server-owned schedule that everyone follows.** Would need a plan
  format, a clock and pause handling on the server, and a wire change for
  every block. Rejected: the first slice is solo and on-demand, the plan is
  presentation data, and the client already owns the timers of the ftp test
  and the workouts in ERG mode.
- **A workout as a new kind of world entity rather than a rider.** Would
  duplicate the rider plumbing (telemetry, recording, culling, population,
  reconnection, the nearby panel) that a parked rider already reuses.
  Rejected.
- **Animating the workout from timestamps the server sends.** Ties the
  animation rate to the state broadcast rate and needs a server clock per
  block. Rejected in favour of "time since I first saw this exercise".

## Consequences

- Additive protocol change (`device: "workout"` in `join`, the `workout`
  message, `riders[].exercise`, the `in_workout`, `not_in_workout` and
  `unknown_exercise` errors); the version stays 2. Older clients see the
  workout rider as an ordinary parked rider (they ignore the unknown device
  and exercise field).
- The sim stays pure: it knows a workout rider never moves, not what a squat
  is. No I/O or third-party dependency is added to `crates/sim`.
- A dropped connection reconnects as any ride does; the client re-sends its
  current `workout` and a fresh rider is re-flagged, so the avatar is parked
  at the café with the right clip again. The plan clock keeps running on the
  client across the gap.
- The workout does not appear in a ride file or on Strava (no FIT/TCX/GPX, no
  upload); the result is a summary card and a local history record for the
  later fitness work (#48). The `workout` history kind is ignored by the FTP
  estimate (no `curve`).
- The rider is drawn from separate bike and body parts (#90); on the bike the
  parts are posed to match the previous one-piece mesh within 1 mm.
- Follow-ups that this design leaves open: the workout and cross studios, the
  circuit mode and the in-ride entry, rep-based sets, equipment exercises, and
  a separate `workout` count in `route_riders`.
