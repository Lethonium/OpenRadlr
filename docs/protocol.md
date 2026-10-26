# Protocol (version 2)

JSON text frames over a WebSocket at `/ws`. Every message has a `type`.
Distances are metres, speeds m/s, power watts, times seconds, grades percent.

## Handshake

```text
client                                server
  │ hello {protocol_version: 2}        │
  │ ─────────────────────────────────► │
  │ ◄───────────────────────────────── │ welcome {server_name, route_id, …}
  │ join {name, weight_kg, route_id?}  │
  │ ─────────────────────────────────► │
  │ ◄───────────────────────────────── │ joined {rider_id, resume_token}
  │ ◄───────────────────────────────── │ state, resistance, event, …
```

A wrong protocol version is answered with `error {code: "protocol_mismatch"}`
and the connection is closed. A server hosts one world per map: the routes of
a map share its roads and one simulation, a route without a map is a world of
its own ([ADR 10](adr/0010-one-connected-world.md)). `route_id` picks the
route to ride (see `GET /api/info`), without it the rider joins the default
route named in `welcome`. `route_id: "spin-studio"` joins the spin studio
([ADR 11](adr/0011-spin-studio.md)) instead: the rider gets `studio_state`
instead of `state` and no `resistance` (targets come from the class plan).

A connection must send `hello` and `join` within 15 s, and a joined
connection that sends nothing for 120 s is closed (`handshake_timeout`,
`idle_timeout`). A riding client sends telemetry about 4 times per second, so
this only catches dead connections. A workout client sends no telemetry:
it repeats its current `workout` message every 30 s as a keepalive.

## Client → server

| `type` | Fields | When |
| --- | --- | --- |
| `hello` | `protocol_version`, `client_version` | first message |
| `join` | `name` (1–24 chars), `weight_kg` (30–200), `route_id`?, `ftp_w`?, `level_w`?, `device`?, `vehicle_code`?, `public_key`? | after `welcome`; `ftp_w` sets the studio's targets (default 2.5 W/kg); `level_w` is the riding level the event bots are matched to; `device` is `trainer` (default), `sim`, `paddle` (phone paddles) or `workout` (no bike: a parked bodyweight workout at the route start; the studio refuses it with `unknown_route`, and `vehicle_code` and `resume` are ignored); `vehicle_code` boards that vehicle on joining (the server picks the world from it, `route_id` is ignored); `resume_token` and `resume` (`route_id`, `distance_m`) come back after a dropped connection, see [Reconnecting](#reconnecting) |
| `telemetry` | `power`, `cadence`? | about 4 Hz |
| `input` | `action`: `lane_left` \| `lane_right` | on key or button press |
| `start_race` | `laps` (1–`OPENRADLR_MAX_RACE_LAPS`) | any rider on a route, when no race is running there |
| `join_race` / `leave_race` | – | enter or leave the race whose countdown runs |
| `join_event` | `event_id` | enter an event whose lobby is open (a running group ride too) |
| `leave_event` | – | withdraw from the event |
| `turn` | `edge` (a road leaving the junction ahead) or `null` | before a junction: the road to take there; `null` stays on the route (straight on off it) |
| `create_vehicle` | `kind` (`tandem` \| `beer_bike`), `seats` (beer bike: 5, 7 or 9; a tandem ignores it), `bots` (default true: seat bots fill free seats) | start a [shared vehicle](vehicles.md); the sender becomes captain |
| `board_vehicle` | `code` | board the vehicle with this code (case and spaces ignored) |
| `leave_vehicle` | – | get off; you ride on solo |
| `pause` | – | pull over for a pause: the rider brakes to a stop (even downhill), ignores power and moves onto the shoulder; `riders[].parked` is then true. Refused with `pause_rejected` in a race, an event or a vehicle; the spin studio ignores it |
| `resume` | – | ride on after a pause |
| `workout` | `exercise`: `squats` \| `situps` \| `pushups` \| `jumping_jacks` \| `plank` \| `burpees` \| `null` | the exercise being done now, or `null` for rest; only for a `workout` rider (others get `not_in_workout`, an unknown id `unknown_exercise`). A workout rider gets `in_workout` for `input`, `start_race`, `join_race`, `join_event`, `turn`, `create_vehicle`, `board_vehicle`, `pause` and `resume`; `telemetry` is ignored |
| `chat` | `text` (≤ 200 chars) | at most 5 in a row, then one every 2 s |
| `leave` | – | leaving on purpose: the rider is removed at once and the server closes the connection |

## Server → client

| `type` | Fields |
| --- | --- |
| `welcome` | `protocol_version`, `server_name`, `server_version`, `auth_mode`, `route_id`, `grace_s` (how long a dropped rider is kept) |
| `joined` | `rider_id`, `resume_token` (send it back in `join` after a dropped connection) |
| `state` | `tick`, `riders[]` (the riders around you), `race` (your route's, see below), `route_riders` (`humans`, `bots`: everyone on your route), `event`? (your route's scheduled event, see below), `vehicle`? (your own vehicle, see below) — about 4 Hz |
| `studio_state` | spin studio only, for the rider's room: `tick`, `room` (0-based), `rooms`, `class` (`id`, `name`, `starts_at_s` Unix time, `elapsed_s` — negative in the lobby), `riders[]` — about 4 Hz |
| `resistance` | `grade_percent` — when the grade under the rider changes |
| `event` | `event` with a `kind` (see below) |
| `chat` | `rider_id`, `name`, `text` |
| `error` | `code`, `message` |

`riders[]` holds the riders on the server, whatever their route or distance, up
to `OPENRADLR_MAX_VISIBLE_RIDERS` (default 200). You, your vehicle's seats and
everyone entered in your route's race are always in; the rest fill up with
humans first and then bots, nearest first. Entries: `id`,
`name`, `is_bot`, `route` (the route's id; `null` off every route after a
turn), `distance` (position on the lap of *their* route; off every route the
metres since leaving it), `road` (on a road network: `edge`, `dir` 1 along the
road's points or −1 back, `offset` metres along it from where the rider
entered it, `next` the road they take at the next junction: their pick, else
their route's, straight on off every route),
`lap` (in a race, else `null`), `lane` (continuous, 0 = leftmost in riding
direction), `speed`, `power`, and `device` (`sim`, `paddle` or `workout`; left out for
trainers and bots, so clients can mark phone paddlers and workouts), `vehicle`? (`id`, `kind`, `seat`, `seats`, `captain`: true for the current captain's seat) and `cadence` (only for seated riders, so each seat pedals at its own rate) and `parked` (true while pulled over for a pause, left out otherwise; always true for a workout rider) and `exercise` (the exercise a workout rider does now, left out at rest). Riders of different routes draft each other
where they ride the same road the same way.

Studio `riders[]` entries: `id`, `name`, `is_bot`, `seat` (0–7 front row,
8–15 back row), `power`, `cadence`, `speed` and `distance` (flat-road physics,
for the ride record), `on_target_pct` (share of the class within 10 % of the
target, `null` before the class) and `class_kj`. Events and chat stay in the
room.

`race` has a `phase`:

```json
{ "phase": "idle" }
{ "phase": "countdown", "laps": 2, "remaining_s": 7.5 }
{ "phase": "running", "laps": 2, "elapsed_s": 312.4, "results": [ … ] }
{ "phase": "finished", "laps": 2, "results": [ { "rider_id": 3, "name": "Swift Fox", "is_bot": true, "time_s": 601.2 } ] }
```

Event kinds: `rider_joined`, `rider_left`, `race_countdown`, `race_started`,
`rider_finished` (`position`, `time_s`), `race_finished`. Events go to the
riders of the route they happen on; chat goes to everyone on the map.

### Scheduled events

`state.event` is present while a scheduled event of your route is in its lobby
or running ([events](events.md), [ADR 13](adr/0013-scheduled-events.md)):

```json
{ "id": "group-ride-rolling-hills", "name": "Group ride · Rolling Hills",
  "kind": "group_ride", "phase": "lobby", "starts_in_s": 552.0,
  "laps": null, "distance_m": 18000, "entered": true,
  "entrants": [ { "rider_id": 4, "name": "Anna" } ],
  "sharing": { "gap_s": 22.0, "given_w": 50, "to": ["Anna", "Ben"],
               "received_w": 0, "from": [] } }
```

`kind` is `race` or `group_ride`, `phase` `lobby` or `running`; `starts_in_s`
turns negative once running (relative times, so client clocks don't matter).
Exactly one of `laps` and `distance_m` is set. `sharing` is the power given
and received in a group ride, or `null`.

Game events (`event` message): `event_lobby` (`event_id`, `name`,
`event_kind`, `starts_in_s`), `event_started` (`event_id`, `event_kind`) and
`event_finished` (`event_id`, `event_kind`, `results[]`). Results have
`rider_id`, `name`, `is_bot`, `place`? and `time_s`? (races), `distance_m`,
`avg_wkg`, `given_kj` and `received_kj`. Event payloads use `event_kind`
because `kind` names the event type.

### Shared vehicles

`state.vehicle` is present while you sit in a vehicle ([vehicles](vehicles.md),
[ADR 14](adr/0014-shared-vehicles-as-linked-riders.md)):

```json
{ "id": 2, "code": "K7Q3MD", "kind": "beer_bike", "captain": 5, "bots": true,
  "seats": [ { "rider_id": 5, "name": "Anna", "is_bot": false, "power": 180.0, "share": 0.21 },
             null ] }
```

`kind` is `tandem` or `beer_bike`; `seats` lists every seat in order, `null`
for an empty one; `share` is the part of the vehicle's total power, rounded to
0.01. Seated riders share one speed, position and lane, and `riders[]` sends
every seat of a vehicle as soon as one is in view. Game events: `vehicle_boarded`,
`vehicle_left`, `captain_changed` (each with `vehicle_id`, `rider_id`, `name`).
Lane and turn input from anyone but the captain is dropped.

Races are per route: `start_race` starts one on your route, only its riders
can join, and laps and results count along that route.

Error codes: `bad_message`, `protocol_mismatch`, `hello_required`,
`join_required`, `already_joined`, `invalid_name`, `invalid_weight`,
`server_full`, `unknown_route`, `race_rejected`, `pause_rejected` (no pause in a race, event or vehicle), `unknown_event`, `event_not_open` (the lobby is not open yet), `event_closed` (a race has started), `not_on_route` (the event is on another route), `turn_rejected` (no such road
at the junction ahead, or entered in a race), `device_not_allowed` (the
server turned the simulated trainer or phone paddles off), `chat_rate_limited`,
`unknown_vehicle` (no vehicle has this code), `vehicle_full`, `vehicle_elsewhere` (the code
belongs to another world; `message` is `route:<id>` to rejoin with), `not_captain`, `in_event` (seated riders can't join events or races and the other way round),
`invalid_vehicle` (unsupported kind or seat count), `vehicle_rate_limited` (`create_vehicle` and `board_vehicle` share a slow per-connection limit: 3 at once, then one every 2 s), `already_aboard`, `in_vehicle` (joining an event while seated),
`in_workout` (a riding message from a workout rider), `not_in_workout` (`workout` from a rider who did not join as one), `unknown_exercise`,
`rate_limited` (connection closed), `handshake_timeout`, `idle_timeout`.

### Reconnecting

A connection that drops without `leave` (closed socket, network gone,
`idle_timeout`) doesn't end the ride straight away. The server keeps the rider
for `grace_s` seconds (`OPENRADLR_GRACE_S`, default 60): they coast at 0 W and
keep their place, race or event entry and vehicle seat. A dropped rider holds
no place under the player cap. After the grace period they leave as if they
had sent `leave`.

A `join` with the `resume_token` from `joined` gets that rider back: `joined`
answers with the **same** `rider_id` and token, followed by a fresh `state`
and `resistance`. This also works while the old connection is still open (a
second tab takes over); the old connection's late close is ignored. A
different `rider_id` means a fresh join: the token was unknown or expired, or
the server restarted.

When the token no longer works, `resume` (`route_id`, `distance_m`) starts
the new rider at that spot on that route, at 0 m/s in the default lane.
`distance_m` is clamped to the route. It only applies to a free join: with a
`vehicle_code` it is ignored, the spin studio ignores it, and it never enters a
race, event or vehicle. The browser keeps its ride in IndexedDB and only offers
to continue for 12 hours.

## Limits

Messages beyond the per-connection rate (`OPENRADLR_MESSAGES_PER_SECOND`,
default 20 per second with a burst of twice that) are dropped; after 200
dropped messages the connection is closed with `rate_limited`. Frames are
at most 16 KiB. The WebSocket upgrade itself is refused with HTTP 429 when an
IP address already has `OPENRADLR_MAX_CONNECTIONS_PER_IP` connections, with 403
when `OPENRADLR_ALLOWED_ORIGINS` is set and the page's origin isn't listed, and
— on servers that require Strava — with 401 without a connected account or
409 when that account is already riding.

## HTTP

| Route | Response |
| --- | --- |
| `GET /healthz` | `ok` |
| `GET /api/info` | name, version, protocol version, auth mode, `players` (all routes, phone riders included), `phone_players` (of those, on phone paddles), `max_players` (seats for the others) and `max_phone_players` (seats for phone riders, counted apart), `routes[]` (`id`, `name`, `description`, `length_m`, `elevation_gain_m`, `players` riding it and `phone_players` among them; default first), `route` (the default, for older clients), `studio` (`id`, `name`, `players`, `class` and `next` with `class_id`, `name`, `starts_at_s`; missing when closed), `strava` (`enabled`, `required`), `privacy_url` (the operator's privacy policy; missing unless `OPENRADLR_PRIVACY_URL` is set), `analytics` (`domain`, `script`: the page analytics the client loads, #12; missing unless the operator set `OPENRADLR_ANALYTICS_DOMAIN`), `distance_m` (`trainer`, `paddle`: metres ridden on this server in total, see below), `now_s` (the server clock, Unix time) and `events[]` (soonest first: `id`, `name`, `kind`, `route_id`, `lobby_opens_at_s`, `starts_at_s`, `phase` `upcoming` \| `lobby` \| `running`, `entrants`) |
| `GET /api/route?id=…` | a route file (see [routes](routes.md)); the default route without `id`, 404 for unknown ids |
| `GET /api/map?id=…` | a shared map's road network file, unchanged (see [routes](routes.md#road-networks)); 404 for maps without one |
| `GET /api/studio` | the spin studio: `slot_s` (1800), `lobby_s` (300), `seats_per_room`, `classes[]` (`id`, `name`, `description`, `duration_s`, `segments[]` with `duration_s`, `from`/`to` as a fraction of FTP, `cadence` `[lo, hi]`, `cue`), `schedule[]` (the current slot and the next five: `class_id`, `name`, `starts_at_s`); 404 when the studio is closed |
| `GET /auth/strava` | starts "Connect with Strava" (redirect) |
| `GET /auth/strava/callback` | Strava sends the rider back here; sets the `openradlr_session` cookie |
| `POST /auth/strava/app` | the app starts a login in the system sign-in sheet: `{url}` to open, its secret as a cookie ([app](app.md#strava-sign-in)) |
| `POST /auth/strava/app/claim` | `{ticket}` from the `openradlr://strava` URL; sets `openradlr_session` in the app's web view |
| `POST /auth/logout` | forgets the session |
| `GET /api/me` | `athlete_id`, `name`, `can_upload` — or 401 |
| `POST /api/strava/upload?name=…` | body: a FIT file (the client marks it a virtual ride) or a TCX file; uploads it, answers Strava's upload status (`id`, `status`, `error`, `activity_id`) |
| `GET /api/strava/upload/{id}` | the current upload status; once it has an `activity_id`, the server marks the activity as a *Virtual Ride* |

`distance_m` is a community counter (#65): every tick the server adds what each
human rider covers to the total of their `device`, `trainer` or `paddle`. The
simulated trainer (`sim`) and bots count toward neither; spin studio rides count
like any other. Only metres are kept, no rider names, ids or keys. The device is
the client's own claim and the server can't check it, so treat the numbers as a
vanity counter. Each server counts its own; the totals are saved in
`OPENRADLR_STATS_FILE` (default `stats.json` in `OPENRADLR_DATA_DIR`) every
minute and on shutdown, and start from zero when neither is set.

The Strava routes answer 404 (`strava_disabled`) when the server has no Strava
app configured.

## Compatibility

Additive changes (new optional fields, new message types that old peers can
ignore) keep the version. Anything else bumps `PROTOCOL_VERSION` on both sides.

Shared vehicles (#55) added `create_vehicle`, `board_vehicle`, `leave_vehicle`,
`vehicle_code` in `join`, `state.vehicle`, `riders[].vehicle` and `cadence`, the
three vehicle game events and the vehicle error codes within version 2.
Pausing (#89) added `pause`, `resume`, `riders[].parked` and `pause_rejected` within version 2.
Workouts (#77) added `device: "workout"`, the `workout` message, `riders[].exercise` and the `in_workout`, `not_in_workout` and `unknown_exercise` errors within version 2.
Security hardening added the `vehicle_rate_limited` error within version 2.
A privacy link (#12) added `privacy_url` to `/api/info` within version 2.
Opt-in analytics (#12) added `analytics` to `/api/info` within version 2.
Community distance counters (#65) added `distance_m` to `/api/info` within version 2.
Reconnecting (#73) added `leave`, `resume_token` and `resume` in `join`,
`resume_token` in `joined` and `grace_s` in `welcome` within version 2. An
older client that never sends `leave` is kept for `grace_s` after it leaves.
Scheduled events (#46) added `join_event`, `leave_event`, `state.event`, the
`event_*` game events, `level_w` in `join` and `now_s` and `events` in
`/api/info` within version 2. Turning (#15) added the `turn` message, `road.next` and `route: null`
within version 2. Version 2 (#14): one world per map. `riders[]` entries gained `route` and
`road`, `state` is culled to the riders around you and gained
`route_riders`, and events stay on their route. Version 1 clients are
refused with `protocol_mismatch`.
