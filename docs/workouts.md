# Café workouts

OpenRadlr can run a bodyweight workout without a bike: pick **Workout** on the
start screen, pick a preset, and do a timed circuit at the outdoor gym next to
the start café while your avatar does the exercise on the mat. Everyone passing
the café sees you work out. Design:
[the spec](superpowers/specs/2026-10-21-cafe-workout-design.md) and
[ADR 15](adr/0015-workouts-as-parked-riders.md).

This is the first slice of #77; the circuit mode (rides with exercise blocks)
and the workout and cross studios build on the same plan format, clips and
parked rider.

## Starting a workout

1. On the start screen pick the **Workout** card (after the studio card).
2. Pick a preset and decide whether you want a beep in the last three seconds
   of each block. No trainer is needed; a heart-rate strap is used if one is
   connected.
3. **Start workout** joins the server's default route (the first in
   `/api/info`) as a `workout` rider. Your avatar is parked at the café's
   outdoor gym for the whole session.

A workout is solo and on-demand. It always runs at the **start café of the
default route**, and there is no in-ride entry in this slice.

## Presets

| Preset | Shape | Length |
| --- | --- | --- |
| Full body | Two rounds of the six exercises, 40 s on and 20 s rest | 12 min |
| Core | Two rounds of sit-ups 45 s, plank 60 s, push-ups 40 s, with longer rests | 8 min |
| Tabata | Eight rounds of 20 s on, 10 s rest, alternating squats and burpees | 4 min |

Every plan starts with a 30 s **Get ready** rest that is added by the client
and never stored in a preset. A plan is validated on load: 1 to 200 blocks,
each 1 to 600 s, at most 2 hours in total.

## Exercises

Time-based sets only; the display name is what you see, the id is what goes on
the wire and picks the animation.

| Id | Name |
| --- | --- |
| `squats` | Squats |
| `situps` | Sit-ups |
| `pushups` | Push-ups |
| `jumping_jacks` | Jumping jacks |
| `plank` | Plank |
| `burpees` | Burpees |

The server knows only the id of the exercise you do *now*. It keeps no plan
and checks no timing, so the clock, pause, skip and early end are all handled
by the client. The rider is a **workout rider**: parked at the route start for
the whole session, left out of `route_riders.humans`, and refused every riding
message with `in_workout`. See the [protocol](protocol.md#client--server) for
the `workout` message, `riders[].exercise` and the error codes.

## The HUD

- The exercise name and the time left in the block, with a countdown ring.
- "Next: Burpees 40 s", "Block 5/24", elapsed and remaining, and your heart
  rate if a strap is connected. During rest: "Rest · Next up: Push-ups".
- **Pause / Resume** freezes the plan clock and sends rest; **Skip block** ends
  the current block (counted as skipped); **End workout** finishes early.
- A beep (60 ms) and a short vibration in each of the last three seconds of a
  block, if you left it on.
- The camera swings to a fixed side view of the gym mat with your avatar on it;
  with reduced motion it cuts instead of swinging. The clips still play.

A dropped connection comes back like a ride does: the plan clock keeps running
on the client, the client re-sends its current `workout`, and the avatar is
parked at the gym again with the right clip.

## What is stored

The end screen shows the plan, the active time worked against the plan, blocks
done and skipped, and the average and maximum heart rate. **Back to menu**
leaves the world.

A finished workout (or one with at least one exercise block done that you end
early or that ends when the tab closes) is kept in the local history as
a record:

```js
{ version: 2, kind: "workout", id, planId, planName, startedAt, endedAt,
  durationS, activeS, blocksDone, blocksSkipped,
  hr: { avg, max } | null, measured: false }
```

It is for the later fitness work (#48); nothing lists it yet, and the FTP
estimate ignores it (no power curve). Get-ready rest and a workout ended
before any exercise block leaves no record. Everything stays in the browser
(IndexedDB); clearing site data removes it.

## Not yet

- **FIT export and Strava upload** (a strength sub-sport); a workout stays in
  OpenRadlr like a paddle ride.
- **The workout studio and the cross studio** (server-side plans, a timetable,
  a coach) and **the circuit mode** (exercise blocks inside a ride, the in-ride
  entry).
- **Rep-based sets**, custom plans and plan import.
- **Equipment exercises** (dips, pull-ups, step-ups) and equipment spots; in
  this slice the gym is scenery and no exercise uses it.
- The #90 pause clips (dismount, stretch, drink, remount) and walking.
