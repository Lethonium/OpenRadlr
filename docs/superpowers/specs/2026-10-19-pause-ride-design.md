# Pause a ride — design

Date: 2026-10-19 · Issue: #89 · Status: agreed in discussion, awaiting spec review

## Goal

A rider can pause a ride: with a pause button or key, or automatically when
they stop. The ride timer stops, the ride file gets a pause, and the rider
pulls over to the side of the road so the world shows them stopped instead of
standing in a lane. Riding on resumes the ride.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Pause, auto-pause and pulling over. The off-bike animation (dismount, stretch, drink) is a separate, general animation system, shared later with circuit training (#77) |
| Who decides to pause | The client (button, key, auto-pause); the server only parks and unparks the rider |
| Auto-pause trigger | Speed-based: under 1 km/h for 3 s. Rolling downhill is riding |
| Auto-pause and pulling over | After 10 s auto-paused the rider is parked (pulls over) too |
| Resume | Button or key; or pedalling (≥ 30 W for 2 s) when parked; speed over 1 km/h when only auto-paused |
| Long pauses | After 30 min paused the client leaves the world; the autosave offers *Continue* |
| Where pausing is off | Races, events, shared vehicles, the spin studio |
| Default | Auto-pause off; the button is always there where pausing is allowed |

## Scope

In:

- Server: `pause` / `resume` messages, a parked rider in the sim (brakes to 0,
  ignores power, moves to the shoulder, out of drafting), `parked` in
  `riders[]`, `pause_rejected`.
- Client: a pause state machine, recorder and workout pause, a pause button,
  key and pill, the auto-pause setting, the 30-minute leave.
- An animation seam: everything a later pose system needs to animate a parked
  rider is on the rider state the view already gets (see below).
- Docs: `docs/protocol.md`, CHANGELOG.

Out:

- Off-bike poses and animation (dismount, standing, stretching, drinking,
  remount). Follow-up issue: a general rider animation system for #89 and #77.
- A pause on a Zwift controller button (no free button decided yet).

## Server

### Sim (`server/crates/sim/src/world.rs`)

`Rider` gets `parked: bool`.

- `World::park(id)` / `World::unpark(id)`. `park` fails with a new
  `WorldError::PauseRejected` when the rider is entered in a race on their
  route, in a scheduled event, or seated in a vehicle. Both are idempotent.
- In `tick`, for a parked rider:
  - power for the physics is 0, and the speed drops by a brake deceleration
    (`SimConfig::park_brake_mps2`, default 3 m/s²) on top of `step_speed`, never
    below 0. The brake holds the rider at 0 on a descent.
  - the lane moves (at the usual lane-change rate) to
    `lanes − 1 + SimConfig::park_lane_offset` (default 0.7), past the rightmost
    lane onto the shoulder; `target_lane` stays the rightmost lane, so
    `unpark` merges back from there.
  - the rider's slot is left out of the drafting and lane-gap field, so nobody
    drafts behind or is blocked by a parked rider.
- `join_race` and entering an event unpark the rider first.
- A dropped rider (grace period) keeps the flag; a resumed rider is still
  parked until the client sends `resume`.

### Protocol (`server/crates/server/src/protocol.rs`, `game.rs`)

| Message | Direction | Fields |
| --- | --- | --- |
| `pause` | client → server | – |
| `resume` | client → server | – |
| `riders[].parked` | server → client | `true` while parked; left out otherwise |
| `error {code: "pause_rejected"}` | server → client | in a race, event or vehicle |

The spin studio ignores both messages. Additive: protocol version stays 2.

## Client

### Pause state machine (`client/public/js/ride/ridePause.js`)

Pure, no DOM or network. `RidePause` with `update({now, speed, power, offline})`
called every HUD tick, `toggle(now)` for the button, and `allowed` set by
the caller. It returns the actions to take; the caller performs them.

States:

- `riding`
- `stopped`: auto-paused, timer stopped, still in the lane.
- `parked`: pulled over.

| From | Event | To | Actions |
| --- | --- | --- | --- |
| `riding` | `toggle` | `parked` | `pauseTimer`, `park` |
| `riding` | auto-pause on, speed < 0.28 m/s for 3 s | `stopped` | `pauseTimer` |
| `stopped` | speed ≥ 0.28 m/s | `riding` | `resumeTimer` |
| `stopped` | 10 s in `stopped` | `parked` | `park` |
| `stopped` | `toggle` | `parked` | `park` |
| `parked` | `toggle`, or power ≥ 30 W for 2 s | `riding` | `resumeTimer`, `unpark` |
| `stopped`/`parked` | 30 min since the timer stopped | – | `leave` |
| any | `allowed` turns false | `riding` | `resumeTimer`, `unpark` as needed |

While `offline` (reconnecting) no transitions happen: the rider's state is
stale. `toggle` is ignored when not `allowed`. The thresholds are named
constants at the top of the file.

### Wiring (`client/public/js/main.js`)

- `pauseTimer` / `resumeTimer`: `recorder.pause(t)` / `recorder.resume(t)`;
  the workout player's `paused` is held while the ride is paused; the HUD ride
  time freezes (`rideStartedAt` moves forward by the pause on resume, as after
  *Continue*).
- No `recorder.add` while the timer is stopped, so no samples fall inside a
  pause.
- `park` / `unpark`: send `pause` / `resume`. A `pause_rejected` error drops
  back to `riding`.
- `leave`: the same path as "leave to menu", keeping the autosave, so the start
  menu offers *Continue*.
- `allowed` = in the world (not the studio), not entered in a race or event,
  not in a vehicle.
- After a reconnect, a client that is `parked` sends `pause` again (the server
  may have lost the rider).

### UI

- A pause button in the ride HUD next to the existing ride controls, hidden
  when pausing isn't allowed; label switches to *Resume*.
- Key: Space (check it against `focusNav.js`; fall back to `KeyK` if Space is
  taken by menu focus).
- A pill while paused: "Paused · 0:42 · pedal to resume" when parked,
  "Paused · 0:12" while only auto-paused (riding off resumes).
- Profile: an *Auto-pause* checkbox (`autoPause`, default false) in
  `profileStore.js` and `profileView.js`.

### Animation seam

The view gets `parked` on each rider from `state`. The client keeps
`parkedSince` per rider id (first state with `parked: true`, cleared on the
first without) and hands it to the 3D view with the rider. Today the view
does nothing with it beyond the lane (the bike rides onto the shoulder,
pedalling stops because power is 0). A later pose system reads
`parkedSince` / the unpark time to play dismount, idle and remount clips.

## Testing

Server:

- A parked rider on a descent brakes to 0 and stays there.
- Power is ignored while parked; `unpark` rides on.
- The lane goes to the shoulder and back to the rightmost lane.
- A parked rider gives no draft and blocks nobody.
- `park` is rejected in a race, an event and a vehicle; `join_race` unparks.
- Protocol parse tests for `pause` / `resume`; a websocket flow: pause,
  `parked: true` in state, resume.

Client:

- `ridePause.js`: every transition in the table, a descent at 0 W never
  auto-pauses, offline freezes, the 30-min leave, `allowed` false forces
  `riding`.
- Recorder: a ride paused and resumed gives one pause and no samples inside.
- UI: a Playwright screenshot of a rider pulled over with the pill.

## Delivery

One PR, ordered commits, each green:

1. Server sim: parked riders.
2. Server protocol and game: `pause`, `resume`, `parked`, `pause_rejected`; docs.
3. Client: `ridePause.js` with tests.
4. Client: wiring, button, key, pill, setting.
5. Follow-up issue for the animation system.
