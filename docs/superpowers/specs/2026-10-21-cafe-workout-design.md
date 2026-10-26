# Café workout — design

Date: 2026-10-21 · Issue: #77 (first slice), partly #90 · Status: agreed in discussion, awaiting spec review

## Goal

A rider can do a bodyweight workout without a bike: pick the Workout card on
the start screen, pick a preset, and do a timed circuit ("40 s squats, 20 s
rest, 40 s burpees…") at the outdoor gym next to the start café. The avatar
does the exercise on the gym mat, and everyone passing the café sees it.

This is the first slice of #77. It builds the shared pieces — the plan format,
the exercise clips and the parked-off-the-bike rider — that the circuit mode
(ride blocks plus exercises) and the workout and cross studios reuse later.

## Decisions

| Question | Decision |
| --- | --- |
| First slice | Workout only, no cycling. Circuit mode and the cross studio come next |
| Session kind | On-demand and solo, at a café. The scheduled workout studio comes later |
| Sets | Time-based only. Rep-based sets come with the circuit mode |
| Entry | A Workout card on the start screen only; no in-ride entry in v1 |
| Trainer | Not needed. Heart rate is used if a monitor is connected |
| Server's role | The rider joins the route world as a parked `workout` rider; the client runs the plan and tells the server only the current exercise (approach A) |
| Visuals | Staged in one PR: plan, server and HUD first (usable with the avatar parked on its bike), then the rider mesh split, the clip player, the gym and the clips |
| Where | An outdoor gym at every café; workouts happen at the start café of the server's default route |
| Result | A summary screen and a local history record. No FIT file or Strava upload in v1 |
| Pausing | A manual pause button only; no auto-pause (no power signal) |

## Scope

In:

- Plan model, validation, positioning, three presets.
- Server: `device: "workout"`, the `workout` message, `riders[].exercise`,
  errors, docs.
- Client: workout session state machine, start-menu card and preset picker,
  join without a trainer, workout HUD with pause, skip and end, summary,
  history record.
- 3D: rider mesh split (bike separate from body, riding pose unchanged), a
  keyframe clip player with forward kinematics, an outdoor gym at every café
  with 8 mat spots, seven clips.
- Docs: `docs/protocol.md`, ADR 0015, `docs/workouts.md`, README, CHANGELOG.

Out (follow-ups):

- FIT export (training / strength sub-sport) and Strava upload; needs a test
  upload first.
- Workout studio and cross studio (server-side plans, timetable).
- Circuit mode (ride blocks, pull over at the verge), the in-ride entry.
- Rep-based sets, custom plans, plan import.
- Exercises that use equipment (dips, pull-ups, step-ups) and equipment spots.
- The #90 pause clips (dismount, stretch, drink, remount) and walking.
- A separate `workout` count in `route_riders`.

## Plan model

`client/public/js/workout/plan.js`, pure:

```js
{ id, name, description,
  blocks: [{ kind: "exercise", exercise: "squats", seconds: 40 },
           { kind: "rest", seconds: 20 }, …] }
```

- `createPlan(data)` validates and normalises, throwing readable errors like
  `createWorkout`: at least 1 and at most 200 blocks, each 1–600 s, at most
  2 h in total, `kind` is `exercise` or `rest`, an exercise block names a
  known exercise.
- `EXERCISES`: `squats`, `situps`, `pushups`, `jumping_jacks`, `plank`,
  `burpees`, each with a display name ("Sit-ups"). The server holds the same
  id list.
- `planPositionAt(plan, elapsedS)` → `{finished, index, block, blockRemainingS,
  next, elapsedS, remainingS}`.
- `withGetReady(plan)` puts a 30 s `rest` block labelled "Get ready" in front;
  the presets don't store it.

Presets (`client/public/js/workout/presets.js`, data):

| Id | Name | Shape | Length |
| --- | --- | --- | --- |
| `full-body` | Full body | 40 s on / 20 s rest through all six exercises, 2 rounds | 12 min |
| `core` | Core | sit-ups, plank, push-ups with longer holds | ~8 min |
| `tabata` | Tabata | 20 s on / 10 s rest × 8, squats and burpees alternating | 4 min |

Each preset must validate, and its total must match its stated length (tests).

## Server and protocol

Additive; the protocol version stays 2.

- **`join.device: "workout"`** (`DeviceKind::Workout`). A workout rider:
  - spawns at the route start and is parked from the first tick (the #89 sim:
    stopped, on the shoulder, out of drafting);
  - never rides off; it leaves only by leaving the world;
  - gets the new error `in_workout` for `start_race`, `join_race`,
    `join_event`, `create_vehicle`, `board_vehicle`, `pause`, `resume`,
    `turn` and `input`; `power` is silently ignored; a `vehicle_code` in its
    `join` is ignored;
  - can join route worlds only: the spin studio refuses it with
    `unknown_route`;
  - is not counted in `route_riders.humans`;
  - has `device: "workout"` in `riders[]` (the field is already sent for every
    device except `trainer`).
- **`workout`** (client → server): `{exercise: string | null}`. `null` is
  rest, get-ready or paused. An unknown id gets `unknown_exercise`; a rider
  who did not join as `workout` gets `not_in_workout`.
- **`riders[].exercise`**: the current exercise id; left out when there is
  none, like `parked`.
- The server keeps no plan and checks no timing.
- Reconnecting works as for rides; after a resume the client sends its current
  `workout` again.
- `docs/protocol.md`: the message table, the rider fields, the error codes and
  a version-history line ("Workouts (#77) added …").

## Client

### Start screen

- A **Workout** card after the studio card: tag "Workout", description
  "Bodyweight circuit at the café's outdoor gym. No bike needed."
- With the card picked, the profile form's device fieldset is replaced by a
  **preset picker** (name, total time, block list such as "Squats 40 s · Rest
  20 s · …") and the optional heart-rate connect. The Ride button reads
  **Start workout** and needs no trainer.
- It joins the server's default route (the first in `/api/info`) with
  `device: "workout"`.

### Session

`client/public/js/workout/workoutSession.js`, pure, clock injected (like
`ftpTestSession`):

- States: `ready` (the get-ready block) → `block` → … → `done`; plus `paused`.
- `tick(now)` returns actions, which `main.js` executes:
  `["send", {exercise}]` when the current exercise changes (never repeated for
  the same value), `["cue"]` in each of the last 3 s of a block, `["finished"]`.
- `pause()` freezes the plan clock and sends `exercise: null`; `resume()`
  continues and re-sends the block's exercise. `skip()` ends the current block
  (counted as skipped). `end()` finishes early.
- The cue is a short beep or vibration, behind the existing sound setting if
  there is one (checked while planning), otherwise a new on/off setting.

### HUD

`client/public/js/view/workoutStudioView.js`; the ride HUD panels are hidden in
this mode.

- Big: the exercise name and the block time left with a countdown ring or bar.
- Smaller: "Next: Burpees 40 s", "Block 5/24", elapsed and remaining time,
  heart rate when connected.
- In rest: "Rest · Next up: Push-ups".
- Buttons: Pause / Resume, Skip block, End workout.
- Camera: a fixed side view of the gym mat framing my avatar; a swing to it
  from the chase camera, a cut with reduced motion.

### End and history

- Summary card: plan name, active time worked against planned, blocks done
  and skipped, average and max heart rate when available. **Back to menu**
  leaves the world.
- History record (stored with `RideHistory`):

  ```js
  { version: 2, kind: "workout", id, planId, planName, startedAt, endedAt,
    durationS, activeS, blocksDone, blocksSkipped,
    hr: { avg, max } | null, measured: false }
  ```

  The FTP estimate already skips records without `curve` or `measured`.
  Nothing lists the history yet; the record is for later fitness work (#48).
- Ending early, or closing the tab, still saves a record if at least one
  exercise block was done. A dropped connection reconnects as for rides; the
  plan clock keeps running on the client.

## 3D

### Outdoor gym

`buildOutdoorGym` in `client/public/js/view3d/features.js`, next to
`buildBikeCafe`:

- At every café, on the side away from the road, reserved in the occupancy
  grid. If the space is not free the gym is skipped (as the café is).
- Low-poly with `MeshBuilder`: a rubber-mat floor of about 8 × 5 m, a pull-up
  bar, parallel bars, an inclined bench, a low step or beam and a small sign.
  In v1 the equipment is scenery; no exercise uses it.
- **Spots:** 8 mat spots in 2 rows of 4, each with a position and a facing.
  The workout riders in view are sorted by id and take spots in that order;
  more than 8 stand on the grass beside the mat. Every client computes the
  same layout without the server.

### Where workout riders appear

- `riders[].device === "workout"` places a rider at their gym spot, not their
  road position; their bike stands at the café's bike rack.
- `riders[].exercise` picks the clip; no exercise is the idle stand.

### Rider mesh split

`client/public/js/view3d/riderModel.js`:

- `buildBikeAndBody` becomes `buildBike(look)` plus body parts: pelvis, torso
  (chest, shoulders, neck), head with helmet, upper arm and forearm per side,
  and the existing thigh, shin and foot.
- On the bike the parts are posed so the result matches today's mesh: legs by
  the crank IK as now, torso and arms at fixed riding angles.
- A test checks the posed riding vertices against the current mesh within
  1 mm; a screenshot before and after confirms it.

### Clip player

`client/public/js/view3d/riderPose.js`, pure (no GL):

- A clip: `{loopS, keys: [{t, root: {y, pitch}, joints: {spine, neck,
  shoulderL, elbowL, shoulderR, elbowR, hipL, kneeL, ankleL, hipR, kneeR,
  ankleR}}]}`; angles in radians, hand-keyed in code, smoothstep between keys.
- `poseAt(clip, t)` → joint angles, looping. `blend(a, b, w)` crossfades over
  0.3 s when the clip changes.
- Forward kinematics turn the angles into one transform per body part.
- Clip time is the time since the block started: for other riders, since this
  client first saw the new `exercise` value (like `parkedSince`); for me, the
  session clock, so the avatar keeps step with my timer.

### Clips (v1)

| Clip | Pose | Loop |
| --- | --- | --- |
| idle | standing, breathing sway (rest, get-ready, paused) | ~4 s |
| squats | standing to thighs level and back | ~2.5 s |
| situps | lying on the back on the mat, knees bent, torso curls up and down | ~2.5 s |
| pushups | plank on the hands, chest down and up | ~2 s |
| jumping_jacks | jump to legs apart with arms up, and back | ~1 s |
| plank | forearm plank, held, breathing | ~4 s |
| burpees | squat, kick back to plank, push-up, jump | ~3.5 s |

Every clip loops cleanly (first key equals last key) and only names known
joints (tests). With reduced motion the clips still play (they are the
content); only the camera cuts instead of swinging.

## Testing

- Client, plain `node --test`: plan validation and positioning, presets, the
  session state machine (get-ready, one send per exercise change, pause and
  resume freeze the clock, skip, early end, the history record), start-menu
  helpers, gym spot layout (by id, overflow, deterministic), `poseAt`,
  `blend`, forward kinematics, the riding pose against today's mesh, clip
  validity.
- Server: sim and game units (spawns parked, stays parked through `power`,
  `in_workout` for the refused messages, not in `humans`, `workout`
  validation and errors) and one e2e WebSocket test: a workout rider sends
  `workout` and a second client sees `riders[].exercise`.
- Before the PR: `make check`, and screenshots of the card, the HUD and the
  gym.

## Commit order (one PR)

1. Plan model, presets, tests
2. Server: `DeviceKind::Workout`, `workout`, `riders[].exercise`, tests, e2e,
   `docs/protocol.md`
3. Client: workout session state machine and history record
4. Client: start-menu card, preset picker, join without a trainer
5. Client: workout HUD, pause / skip / end, summary — **usable here**, with
   the avatar parked on its bike
6. 3D: split the rider mesh, riding pose unchanged (refactor)
7. 3D: clip player and forward kinematics
8. 3D: outdoor gym at cafés and the spot layout
9. 3D: the seven clips; workout riders posed at their spots
10. Docs: ADR 0015 (workouts as parked riders with an exercise field),
    `docs/workouts.md`, README, CHANGELOG `[Unreleased]` (#77)
