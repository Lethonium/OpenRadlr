# Architecture

OpenRadlr follows the model of games like Minecraft: the same server software
runs on a laptop, a home server or a public VPS. Clients connect to whichever
server they like. Central services (accounts, server directory) are optional
and come after the proof of concept.

```text
 Trainer / HR strap / Click
          │ Bluetooth LE
          ▼
 ┌──────────────────────┐   WebSocket (JSON)   ┌───────────────────────────────┐
 │ Browser client       │ ───────────────────► │ openradlr-server               │
 │ devices · 2D views   │ ◄─────────────────── │ http · connection · runtime   │
 └──────────────────────┘                      │ game core                     │
                                               │ ┌───────────────────────────┐ │
                                               │ │ openradlr-sim (pure Rust)  │ │
                                               │ │ world · physics · bots    │ │
                                               │ └───────────────────────────┘ │
                                               └───────────────────────────────┘
```

## Server layers

From the outside in. Each layer only depends on the ones below it.

| Layer | Module | Responsibility |
| --- | --- | --- |
| HTTP | `http.rs` | Routes `/healthz`, `/api/info`, `/api/route`, `/api/map`, `/api/studio`, `/ws`, static client; origin, per-IP and Strava checks before the WebSocket upgrade |
| Accounts | `auth.rs`, `strava.rs`, `strava_api.rs` | Optional "Connect with Strava": OAuth, in-memory sessions, ride uploads |
| Protection | `guard.rs` | Token buckets, counted slots (player cap, per IP, per athlete), client IP behind a proxy |
| Connection | `connection.rs`, `session.rs` | Per-socket state machine `AwaitingHello → AwaitingJoin → Joined`, message and chat rate limits, timeouts |
| Worlds | `worlds.rs` | One game per map (shared by its routes; a route without a map is its own) plus the spin studio; a join picks a route by `route_id` |
| Runtime | `runtime.rs` | One Tokio task owns the game (anything implementing `Game`); timer ticks and a command channel drive it |
| Game core | `game.rs`, `studio.rs` | Connected clients, state culled per client to the riders in view, events per route, resistance updates, input validation; `studio.rs` does the same per studio room |
| Protocol | `protocol.rs` | Message types and mapping from simulation state |
| Vehicles | `vehicle_codes.rs` | Boarding codes of all worlds, so a code finds its world |
| Reconnecting | `resume.rs` | Resume tokens of all worlds, so a token finds its rider's world; per game the detached riders and their grace period |
| Simulation | `crates/sim` | Route, physics, drafting, lanes, bots, races, shared vehicles, the studio's timetable and rooms — deterministic, no I/O |

Each map's game is owned by a single task, so there are no locks around game
state. Worlds are independent; only the player caps (`OPENRADLR_MAX_PLAYERS` for trainers,
`OPENRADLR_MAX_PADDLE_PLAYERS` for phone paddles) are shared, as one seat per
joined connection.
Connections send commands through a channel and receive messages through
their own bounded channel; a slow client loses state updates rather than
slowing everyone down.

A connection that ends without `leave` detaches its rider instead of removing
them (#73): the game swaps their message sink for a null sink, sets their power
to 0 and removes them through the usual `leave` only after `grace_s`. Every
attach has an epoch, and `Leave`/`Detach` commands carry it, so a connection
that died after its rider was taken over by a new one can't touch the rider.

## One tick (20 Hz)

1. The race advances its countdown or clock. Races are opt-in: the rider who
   starts one, riders who join during the countdown and about 60 % of the
   bots line up at the start, in rows of one rider per lane 2.5 m apart (the
   race counts from the line for every row); everyone else keeps riding and is
   never moved.
2. Every rider gets power: humans from their latest telemetry (zero after 3 s
   without data), bots from their brain.
3. Drafting: the nearest rider up to 6.5 m ahead in the same lane reduces CdA by up to 30 %,
   most from 2 m (a bike length, middle to middle) in
   (on your route, or on the same road in the same direction on another route).
4. Physics integrates speed; position advances and wraps around the loop.
   Nobody rides through the wheel ahead: closing in, a rider slows to sit on
   it 2 m behind, and pulls out into a free neighbouring lane to pass when it
   would be faster than that rider even in clear air (humans too: the server
   steers them out).
   Seated riders are skipped: each shared vehicle ([ADR 14](adr/0014-shared-vehicles-as-linked-riders.md))
   takes one step with the summed power and mass of its seats along the
   captain's road, then copies speed, position and lane to every seat.
5. Lanes move towards their target lane (one lane per second).
6. Finishers are recorded; the race completes when every participant finished.
7. Bots are spawned or removed to keep the target rider count.
8. The game core sends events to their route, every fifth tick each client the
   state of the riders around them, and new resistance
   whenever a rider's grade changed by at least 0.1 %.

## Accounts and protection

Local profiles stay the default. A server can add "Connect with Strava":
the server does the OAuth exchange, keeps tokens in memory and gives the
browser only an HttpOnly session cookie. With `OPENRADLR_REQUIRE_STRAVA` the
WebSocket upgrade needs that cookie and one athlete can hold one connection —
the account is the bot hurdle. Uploading a ride stays the rider's choice after
each ride (the client builds a TCX file; the server forwards it). See
[ADR 0008](adr/0008-strava-as-optional-account.md) and [deploying](deploy.md).

## Server authority

Clients only send raw measurements (power, cadence) and inputs. The server
computes speed and position. Trainer data is trusted in the POC, but this
split keeps the door open for plausibility checks later. Heart rate never
leaves the client.

## Identity

Each client generates an ECDSA key pair on first start and sends the public key
with `join`. In `open` mode (the only mode in the POC) servers ignore it. A later
auth server can sign these keys so that servers in `verified` mode can check
riders offline. See [ADR 0003](adr/0003-key-based-identity.md).

## Client

Plain ES modules without a build step. `main.js` is the composition root; all
logic lives in small modules with injected dependencies and unit tests:
BLE codecs (`ble/`), the connection (`net/`), ride logic (`ride/`), route maths
(`route/`) and views (`view/`). The client renders at 60 fps by dead-reckoning
riders between 4 Hz server snapshots and blending out corrections.

### Training (ERG and workouts)

`ride/trainingControl.js` decides how the trainer is driven: *Road (sim)* sends
the grade (difficulty, virtual shifting), *ERG* sends a target power, set by hand
or by a running workout. `ride/workout.js` holds the workout model (steady blocks,
ramps, intervals as fractions of FTP), the player (pauses when the rider stops
pedalling) and a parser for the `.zwo` format. Like gears, ERG is purely a client
concern: power still drives the in-game speed, so riders in ERG ride together with
everyone else.

### 3D view

`view3d/` renders the ride with a small WebGL 2 renderer and no third-party
dependencies (see [ADR 0005](adr/0005-own-webgl-renderer.md)):

| Module | Role |
| --- | --- |
| `world.js` | Roads with verge, markings and roadside posts; terrain blended to every road of the map (fine near the roads, coarse to the horizon) with farmland patches; firs, leafy trees, bushes and rocks in small woods; arches; the sea with far-off islands, clouds and baked tree shadows — all from the route files and their seeds. Routes on one map ([ADR 0010](adr/0010-one-connected-world.md)) are drawn together: shared terrain from the map seed, every road and every route's scenery; markers, arches and spectators only for the ridden route |
| `island.js` | The map as an island: coast a seeded margin beyond the outermost roads, beaches, cliffs, sea floor |
| `menuCamera.js`, `highlight.js` | Start menu: drone orbit over the island, glide down to the picked route and follow it (cuts with reduced motion); glowing band on the picked route with climbs, sprints and a start beacon |
| `worldScene.js`, `worldWorker.js` | Build the world in a module worker and hand the meshes over without copying (falls back to building in place) |
| `riderModel.js` | Low-poly cyclist; jersey parts are tinted (me orange, humans blue, bots grey); skin, helmet, bike and size vary per rider (deterministic from the id); cranks turn, legs follow the pedals by two-bone IK (`legPose`), spoked wheels spin |
| `zones.js` | Scenery zones from the route file, or seeded defaults (village, river, forest) |
| `features.js` | River carving and water, stone bridge, village (houses, church, pavements, lamps, signs), farms with animals, wind turbines, spectators, guard rails, warning signs, flamme rouge |
| `structures.js` | Low-poly models placed by `features.js` (houses, church, barn, silo, bales, lamps, signs, turbines, cows, sheep, spectators) |
| `chunks.js` | Splits the static world into 300 m tiles; only tiles in view are drawn and only tiles near the rider cast shadows |
| `lighting.js` | Time-of-day presets (day, golden hour, dusk, auto by local clock) and the sun's shadow frustum |
| `chaseCamera.js` | Road-anchored cameras: chase, close, drone and TV side, with blended switching |
| `renderer.js` | Shadow-map pass (depth from the sun), sky pass (gradient + sun glow), lit pass (PCF-filtered sun shadows, hemisphere light, rim light, distance and height fog, tone mapping), blended pass (water, contact shadows) |
| `view3d.js` | Puts it together per frame; HTML name labels over the canvas |

The 3D view consumes exactly the same smoothed rider list as the 2D views, so
no server or protocol change was needed. The world is built right after
joining, in a worker (a few seconds for the bundled map of three routes), while
the ride already shows the 2D view. <kbd>V</kbd> toggles 3D and 2D, <kbd>C</kbd>
cycles cameras, <kbd>T</kbd> cycles the time of day; *Graphics: Low* turns off the
shadow map and grass for weaker GPUs. Devices without WebGL 2 fall back to 2D.

### Ride screen

The 3D (or 2D) view fills the window and the HUD is an overlay. `#ride` carries
`data-layout`, and CSS shows the matching layout block:

| Layout | When (auto) | Shows |
| --- | --- | --- |
| `cockpit` | free ride | power gauge with W/kg, zone and ERG target; speed, cadence, grade, heart rate; road ahead |
| `broadcast` | only when chosen | metric bar, nearby riders, minimap, lap elevation strip with all riders |
| `training` | a workout is running | workout chart, target vs. power, block and workout time, average power; the 3D view shrinks to the upper part |
| `race` | a race I take part in is counting down or running | position, lap, race timeline, groups and time gaps, riders around me, sprint/KOM banner |

`js/view/hud.js` holds the pure logic: `chooseLayout` (a fixed choice wins;
auto prefers race over workout over free ride), `raceStanding` (positions,
groups split at 15 m gaps, time gaps from my speed), `nextMarker` and the
gauge maths. Each layout has its own copy of a metric; elements are marked
`data-m="power"` and `MetricBinder` writes all copies, skipping unchanged
values. Only the canvases of the visible layout are drawn each frame.
Controls that aren't needed while riding live in two drawers: the menu
(training, race, view, difficulty, diagnostics, keys) and riders/chat.

### Start menu, ride export and app install

The start screen polls `/api/info` every 5 s: server name, riders online and
room left, the routes with their riders, and whether Strava is offered or
required. The chosen route is remembered and sent as `route_id` in `join`.

Behind the menu the 3D island is seen from a drone (`view/menuStage.js`). The
route list, a 2D map of the island (`view/mapPreview.js`) and the picked
route's profile show at once; the world is built in the worker and fades in.
Picking a route flies the camera down to it and highlights it; the world is
rebuilt for that route once the pick settles. The ride's own 3D canvas sits in
the menu's background until joining, so the built view carries straight into
the ride. Without WebGL 2, with *Graphics: Low* or with *Data saver* on, the
menu shows the 2D map instead and builds nothing up front.

While riding, `ride/rideAutosave.js` writes the recorder (with its pauses),
the ride's route and the resume token to IndexedDB every 10 s and when the
page is hidden; photos go in as they are taken. After a crash the start menu
offers *Continue*, *Save* or *Discard*; Continue marks the gap as a pause, so
FIT, TCX and GPX stay valid. When the socket closes mid-ride the ride session
keeps running and `net/reconnector.js` rejoins with the resume token (1, 2, 4,
8 s, then every 15 s, for up to 3 minutes) before offering *Finish and save*.

`ride/rideRecorder.js` samples the ride once per second (distance, power,
cadence, heart rate, speed, elevation, and latitude/longitude from
`route/geo.js`). *Finish ride* shows a summary and offers `.tcx` and `.gpx`
downloads and, with a connected Strava account, an upload (`net/strava.js`).

The client is an installable PWA: `manifest.webmanifest`, icons and `sw.js`.
The service worker is network-first so `make update` reaches riders right
away; it only falls back to its cache offline, and never caches `/api`,
`/auth` or `/ws`.

Trainers without a control point (power meters, some basic trainers) are
"power only": the ride works the same, but ERG and virtual shifting are off,
and workouts run *guided* (targets shown, resistance unchanged).
