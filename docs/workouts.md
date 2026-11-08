# Café workouts

OpenRadlr can run a bodyweight workout without a bike: pick **Workout** on the
start screen, pick a workout card, and do a timed circuit at the outdoor gym of
its café while your avatar does the exercise on the mat. Everyone passing the
café sees you work out. Design:
[the spec](superpowers/specs/2026-10-21-cafe-workout-design.md) and
[ADR 15](adr/0015-workouts-as-parked-riders.md). Venues and statues:
[the spec](superpowers/specs/2026-11-05-workout-venues-design.md) and
[ADR 19](adr/0019-workout-venues-as-client-data.md).

This is the first slice of #77; the circuit mode (rides with exercise blocks)
and the workout and cross studios build on the same plan format, clips and
parked rider.

## Starting a workout

1. On the start screen pick the **Workout** card (after the studio card).
2. Pick a workout card and decide whether you want a beep in the last three
   seconds of each block. No trainer is needed; a heart-rate strap is used if
   one is connected.
3. **Start workout** joins the first route in `/api/info` whose start lies
   within 30 m of the workout's café, or the default route (the first in
   `/api/info`) if none does, as a `workout` rider. Your avatar is parked at
   that café's outdoor gym for the whole session.

A workout is solo and on-demand, and there is no in-ride entry in this slice.

## Presets

| Preset | Shape | Length |
| --- | --- | --- |
| Full body | Two rounds of the six exercises, 40 s on and 20 s rest | 12 min |
| Core | Two rounds of sit-ups 45 s, plank 60 s, push-ups 40 s, with longer rests | 8 min |
| Tabata | Eight rounds of 20 s on, 10 s rest, alternating squats and burpees | 4 min |

Every plan starts with a 30 s **Get ready** rest that is added by the client
and never stored in a preset. A plan is validated on load: 1 to 200 blocks,
each 1 to 600 s, at most 2 hours in total. Each preset names its venue (see
below); an unknown venue fails the load, like an unknown exercise.

## Venues

Each café has its own gym, and a gym hosts a category of workout. The venues
are client data in `client/public/js/workout/venues.js`; the server does not
know them.

| Café | Category | Statue material | Presets held here |
| --- | --- | --- | --- |
| Valley Café | Full body | marble | Full body |
| Hilltop Café | HIIT | bronze | Tabata |
| Beach Café | Core | sandstone | Core |
| Forge Hut | Strength | granite | none yet |

A venue's statues show the distinct exercises of the presets it holds, in the
order they first appear: Valley has the six exercises, Hilltop squats and
burpees, Beach sit-ups, plank and push-ups. A venue without presets keeps its
gym as scenery, without statues, and nothing in the menu points to it.

**Fallback.** When a workout's café has no offered route, the workout joins
the default route and runs at the default gym. In the start menu that gym's
statue row then shows the picked workout's figures in its venue's material, so
the preview matches what you will do. The row goes back to its own figures
when another card is picked.

## Statues

Each gym has a row of statues behind its exercise pad, facing the road: one
plinth per figure, spread evenly, the statue of each exercise frozen at a
defining moment of its clip (squats at the bottom, push-ups with the arms bent
and the chest low, the plank in its hold, sit-ups halfway up, jumping jacks
with arms and legs out, burpees at the top of the jump). Upright figures stand
on a 0.9 × 0.9 m plinth, 1 m tall. Lying figures lie along the row on a
2 × 0.8 m plinth, 0.6 m tall; push-ups are scaled down a little to fit their
plinth. Statues are flat colours per material, the plinth a darker shade of the
figure's: marble warm white, bronze dark gold with a green patina band at the
top edge, sandstone ochre, granite speckled grey. The look is the same in
every biome.

The row is drawn on the main thread, separately from the world's chunks, so it
can be rebuilt when the picked workout changes. It is built once the world is
ready.

## Picking a workout

The workout tab shows the workouts as cards, a radio group: arrow keys move
between them, and the saved preset is preselected, the first one otherwise.
Each card shows the name, the duration, the category tag, the café's name from
the map, the description and a **block strip**: one segment per block of the
plan, in its exercise's colour, rests pale. Hovering or focusing a segment
shows its exercise and length ("Push-ups 40 s"); on touch, tapping one writes
that text into the card's hint line. The selected card lists its figures as
chips, one per exercise, in the strip's colours.

The camera follows the selection. Picking a card flies the drone to its gym.
Picking a figure flies close to its statue, swinging gently; picking it again,
picking another card or pressing Escape returns to the gym's orbit. With
reduced motion the camera cuts instead of flying.

## The HUD

- The exercise name and the time left in the block, with a countdown ring.
- "Next: Burpees 40 s", "Block 5/24", elapsed and remaining, and your heart
  rate if a strap is connected. During rest: "Rest · Next up: Push-ups".
- During every rest, get-ready included, the statue of the next exercise glows
  at the gym, if this venue has one. It is off during exercise blocks and
  stays as it is while paused. The glow is local: other riders at the gym see
  their own highlight or none, and no message goes over the wire.
- **Pause / Resume** freezes the plan clock and sends rest; **Skip block** ends
  the current block (counted as skipped); **End workout** finishes early.
- A beep (60 ms) and a short vibration in each of the last three seconds of a
  block, if you left it on.
- The camera swings to a close side view framing your own spot on the gym mat,
  with the picture shifted down clear of the timer card; with reduced motion it
  cuts instead of swinging. The clips still play.

A dropped connection comes back like a ride does: the plan clock keeps running
on the client, the client re-sends its current `workout`, and the avatar is
parked at the gym again with the right clip.

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
- **Server-side venues**: the venues are client data, so every client must
  ship the same table.
- **Yoga**: the Beach Café's core workout moves to Forge Hut when yoga arrives,
  and Forge Hut gets its first preset then.
- **Rep-based sets**, custom plans and plan import.
- **Equipment exercises** (dips, pull-ups, step-ups) and equipment spots; in
  this slice the gym is scenery and no exercise uses it.
- The #90 pause clips (dismount, stretch, drink, remount) and walking.
