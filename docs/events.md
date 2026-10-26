# Scheduled events

Every route has events on a timetable, so there is always something to join
at a known time. Two kinds:

- **Group ride** — everybody rides together at a pace the group keeps by
  sharing power. About 45 minutes, 18 km.
- **Race** — a few laps (about 12 km), first across the line wins. About
  25 minutes.

Events are opt-in: you only take part if you join, and everybody else keeps
riding where they are.

## Taking part

The start menu lists the coming events with their start time and how many
have entered. Each event has a **lobby** that opens 10 minutes before the
start (`OPENRADLR_EVENT_LOBBY_S`). Join from the menu, or press <kbd>J</kbd>
while the banner `Group ride starts in 9:12 · J to join` is shown. In the
lobby you ride around as usual; at the start the entrants are lined up. A
group ride can also be joined while it runs (you start behind the last
rider). A race closes at its start. Turns are locked while you are in an
event.

Events you finish appear in the ride name (`OpenRadlr group ride · <route>`)
and the summary shows the results: place and time for a race, distance and
average W/kg for a group ride, plus the energy you gave and received.

### Timetable

Built in, per world:

- a group ride every hour at :00, the routes taking turns;
- a race every two hours at :20 on the route of the *next* hour's group
  ride, so a race and that route's group ride never overlap;
- with a single route: a race every two hours at :00 instead of that hour's
  group ride.

With an even number of routes only the routes at odd positions (counting from 0) get races. Race
laps are chosen to come close to 12 km.

An event that is already running when the server boots is skipped: it restarts
as upcoming for its next slot.

## Power sharing

In a group ride the strong help the weak, so nobody rides alone:

- Each second the server compares everybody's position with the group's
  *lower median*. Riders more than 15 seconds ahead of it give power to the
  riders behind; the share grows over 30 seconds of gap up to 40 % of their
  power, and changes ease in over about 3 seconds.
- What is given is exactly what is received. A receiver gets at most +100 %
  of their own power.
- It only changes the simulated physics. Your trainer's resistance, the
  power shown, and the FIT/TCX file and Strava upload keep your real power.
- It needs at least 3 riders in the group. Event bots always fill up the
  group, so it works on a quiet server too.

The ride screen shows it as `−50 W → Anna, Ben` (you give) or
`+30 W from Chris` (you receive).

## Bots in events

Event bots are drawn once, when the event starts, from the entrants' W/kg:
for each human 4 bots, up to 24 (a bots-only event has 12).

- 70 % are pack bots at 0.95–1.10 × a human's W/kg.
- 30 % are spread from 2.0 to 4.5 W/kg, widened to cover the humans.

They never change strength during the event. Bots are marked as bots in the
lists and results.

## Riding level

Events need a W/kg for each rider. The client estimates a **riding level**
and sends it when joining; it falls back to your FTP, then to 2.8 W/kg.

- Rides of 20 minutes or more can only raise it: best 20 minutes × 0.95, by
  at most 5 % per ride.
- Finished races move it by at most 5 % either way toward your race average.
- Changing your FTP resets it.

The start screen shows it as `Riding level 3.1 W/kg (from your rides)`.

## Hosting

| Variable | Default | |
| --- | --- | --- |
| `OPENRADLR_EVENTS` | `default` | `default` (the built-in timetable), `off` (no events) or the path of an events file |
| `OPENRADLR_EVENT_LOBBY_S` | `600` | Seconds the lobby opens before the start (0–3600) |

With a lobby above about 900 seconds the built-in race and the next group ride
overlap. The server refuses to start then, naming the two events.

### Events file

A JSON array replacing the built-in timetable. Each entry repeats every
`every_s` seconds, starting `offset_s` after the Unix epoch (so the hour
boundaries are `0`).

| Field | | |
| --- | --- | --- |
| `id` | required | unique |
| `name` | required | shown in menus |
| `kind` | required | `race` or `group_ride` |
| `route_id` | required | a route id from `routes/` |
| `laps` or `distance_m` | exactly one | the length |
| `every_s` | required | repeat interval |
| `offset_s` | optional, 0 | |
| `lobby_s` | optional | default `OPENRADLR_EVENT_LOBBY_S` |
| `duration_s` | required | time limit, after which the event ends |

A race needs a lobby above zero (`lobby_s`, or `OPENRADLR_EVENT_LOBBY_S` when
the entry has none), because it cannot be joined once it runs; a group ride may
have none. Unknown fields are rejected. Events on the same route must not overlap
(lobby included); unknown routes, duplicate ids and zero lengths stop the
server at startup.

```json
[
  {
    "id": "morning-flats",
    "name": "Morning ride · Riverside Flats",
    "kind": "group_ride",
    "route_id": "riverside-flats",
    "distance_m": 15000,
    "every_s": 86400,
    "offset_s": 25200,
    "duration_s": 2400
  },
  {
    "id": "col-race",
    "name": "Col race",
    "kind": "race",
    "route_id": "col-de-la-forge",
    "laps": 1,
    "every_s": 7200,
    "offset_s": 1200,
    "lobby_s": 300,
    "duration_s": 1800
  }
]
```

The first runs daily at 07:00 UTC, the second every two hours at :20.
Protocol details: [protocol](protocol.md).
