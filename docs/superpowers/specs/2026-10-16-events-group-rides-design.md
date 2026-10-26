# Events, group rides and matched bots — design

Date: 2026-10-16 · Issue: #46 · Status: agreed in discussion, awaiting spec review

## Goal

Rides that happen **at a set time with other people** on a route: scheduled
**races** and **group rides**. A rider opens the menu, sees *"Group ride on
Riverside Flats, starts in 12:40"*, joins, waits in a lobby with a countdown,
rides together or races, and sees results at the end. The spin studio keeps
working unchanged.

Two additions came out of the discussion:

- **Bots matched to the riders.** Most bots ride at or a little above the
  humans' level, so there is always a group to chase. They never adapt during
  a ride: you can out-sprint or escape them, and they can drop you.
- **Power sharing instead of a speed cap** on group rides: riders off the
  front give part of their real power to riders at the back, and both see it
  (*"−50 W → Anna"*, *"+30 W from Chris"*). The group's total stays what the
  riders really put out.

## Scope

In:

- Bundled, recurring events from server config (no private events yet).
- Event lifecycle on route worlds: lobby, start, run, results.
- Races (reusing opt-in races, ADR 0009) and group rides (new).
- Power sharing on group rides.
- Rider level estimate and matched bots, on free rides and in events.
- Events list in the start menu and ride menu, lobby HUD, results.

Out (later specs):

- Private events with join codes, persistence (#46 step 4).
- Tandems and beer bikes (#55).
- Party rides (#45), accounts (#47), push notifications.

Identity stays as today: key-based profile with a display name (ADR 0003);
events don't need accounts.

## Server

### `sim/src/schedule.rs` (new, shared)

A pure, unit-tested schedule with no clock and no I/O.

- `Slot { every_s, offset_s, lobby_s, duration_s }`: recurring, aligned to
  Unix time (`every_s = 3600, offset_s = 0` is every hour at :00).
- One-off start times (`Vec<f64>`, Unix seconds), so private events can use the
  same type later.
- `Schedule::at(unix_s) -> Occurrence { index, starts_at, phase }` with
  `phase ∈ Upcoming | Lobby | Running | Done`. The occurrence returned is the
  one in lobby or running, else the next upcoming one. `Done` is reported for
  exactly the first query after an occurrence ends, so the caller can close it.
- The studio's `Timetable` is rebuilt on top of it (`every 1800 s, lobby 300 s,
  duration 1500 s`). **No behaviour change**: existing studio tests stay green
  unmodified.

### `sim/src/events.rs` (new)

```text
EventDef {
  id: String,             // stable, e.g. "hourly-group-ride"
  name: String,           // shown in menus and as the ride name
  kind: Race | GroupRide,
  route: RouteIndex,
  length: Laps(u32) | Distance(f64),
  schedule: Schedule,
}
```

`Events` drives each definition's lifecycle against the `World`, from wall
time (`sync(now_s)`, called every tick with the server's clock):

| Phase | What happens |
| --- | --- |
| Upcoming | Listed in `/api/info` and the menus with its start time. |
| Lobby (from `lobby_s` before the start, default 600 s) | Riders on the event's route sign up with `join_event`. They ride anywhere on the route. Free riders are not affected. |
| Start | Entrants are placed on the start line. Matched event bots are spawned (see *Bots*). A race starts through the existing opt-in race (`start_race_on` + entrants, no extra countdown). A group ride creates a `GroupRide` state. |
| Running | Races take no new entrants (`event_closed`). Group rides accept late joiners, placed at the back of the group. Power sharing runs in `GroupRide`. |
| Finished | A race ends when its race finishes; a group ride when every entrant has covered the length or `duration_s` passed. Results go out as `event_finished`. Entrants carry on as free riders; event bots ride on and are retired like other surplus bots. |

- One event at a time per route: overlapping definitions on one route are a
  config error.
- An event nobody signs up for still runs with bots; its results are not
  announced in the feed.
- A rider who disconnects during a race is DNF. In a group ride they leave the
  group and their sharing stops at once.
- A rider whose devices drop (#43) stays entered and rides on at 0 W while the
  client reconnects.

### `GroupRide` and power sharing

Computed once per second over the group's riders (human entrants and event
bots that are still riding):

1. **Gap** of each rider to the group's median rider, in seconds:
   distance gap ÷ median rider's speed (at least 3 m/s). Positive = ahead.
2. **Giver share** `g = 0.40 × clamp((gap − 15) / 30, 0, 1)` of the rider's
   real power `p`.
3. **Receiver weight** `w = clamp((−gap − 15) / 30, 0, 1)`.
4. `g` and `w` are eased toward their targets with a 3 s time constant.
5. **Pot** `P = Σ g·p` over givers (eased values). If no rider has `w > 0`,
   the pot is 0: no receivers, no giving.
6. Each receiver gets `P · w / Σw`, at most +100 % of their own `p`. What the cap
   leaves over is not taken from the givers: givers' contributions are scaled
   down in proportion, so **watts given = watts received** every second.
7. Effective power for physics: `p − given + received`, held until the next
   computation. Recording (FIT), the board's W/kg and the level estimate use
   the real `p`. Trainer resistance is unchanged.
8. Per rider: current `given_w`/`received_w`, the top 3 names on the other side,
   and running kJ given and received for the results.

Constants (`15 s`, `30 s`, `0.40`, `3 s`, `+100 %`) live in a `SharingTuning`
with these defaults. Sharing applies only to group rides.

### Bots

Today `BotProfile::random` draws FTP evenly from 2.0–4.5 W/kg, regardless of
the humans.

**Human levels.** Each human's level in W/kg is `level_w`, else `ftp_w`, else
2.8 W/kg × weight, divided by their weight. `level_w` is a new optional `join`
field (see *Client*).

**`BotProfile::matched(levels_wkg, rng)`**:

- 70 % *pack* bots: pick a human level (with more than 8 humans, the levels are
  first grouped into 8 quantile bands and a band is picked), then FTP uniform in
  0.95–1.10 × that level.
- 30 % *field* bots: uniform from `min(2.0, slowest)` to `max(4.5, fastest)`.
- No humans: as today (`random`).

**Fixed for life.** A bot's profile never changes after it spawns.

- Free rides: only bots spawned from now on (replacements as riders come and
  go) use the matched mix of the humans on that world at that moment.
- Events: event bots are drawn **once, at the start**, from the entrants'
  levels: `bots_per_entrant` (default 4) per human entrant, capped by
  `max_event_bots` (default 24). A bots-only event gets `max_event_bots / 2`
  field bots.

**Intensity** (fraction of FTP, before noise and style adjustments): free ride
0.70 (unchanged), race 0.95 (unchanged), group ride 0.75 (new). Bots give and
receive power in group rides like humans.

### Config

- `OPENRADLR_EVENTS`: `default` (built-in events), `off`, or a path to a JSON
  events file (same shape as the built-ins: id, name, kind, route id, laps or
  distance, every/offset/lobby/duration).
- Built-ins:
  - **Hourly group ride** at :00, rotating through the server's routes by hour,
    about 45 min long (distance set per route).
  - **Race** every 2 h at :30, about 25 min (laps set per route).
  - The race runs on a different route from that hour's group ride. A server
    with a single route has no room for both, so there the race replaces the
    group ride every 2 h (at :00) instead.
- `OPENRADLR_EVENT_LOBBY_S` (default 600) and `OPENRADLR_EVENT_SPEEDUP`
  (development only: divides every duration and lobby, for e2e tests).
- Validation at start (clear error, like other config errors): unknown route,
  zero length or duration, overlapping occurrences on one route. Two
  occurrences overlap when their windows from lobby open to end overlap.

### HTTP

`GET /api/info` gains `events: [{id, name, kind, route_id, starts_at, lobby_opens_at, phase, entrants}]`
for the next occurrence of each event, so the start menu can list events
without joining.

No persistence: events come from config, so a restart loses nothing that
matters (a running event restarts as Upcoming for its next slot).

## Protocol (additive; version stays 2)

Client → server:

| `type` | Fields | When |
| --- | --- | --- |
| `join` | + `level_w`? | rider's estimated level |
| `join_event` | `event_id` | during the lobby (or a running group ride) |
| `leave_event` | — | withdraw |

Server → client:

- `state` gains `event`: the event on the rider's route, if any is in lobby
  or running:
  `{id, name, kind, phase, starts_at, elapsed_s?, length, entrants: [{rider_id, name}], entered, sharing?}`
  with `sharing = {gap_s, given_w, to: [names], received_w, from: [names]}` for
  entrants of a running group ride.
- `event` (game event) gains `event_lobby {id, name, kind, starts_at}`,
  `event_started {id}`, `event_finished {id, kind, results}`.
  - Race results: `{rider_id, name, is_bot, place, time_s, avg_wkg}` (DNF has
    no place).
  - Group ride results: `{rider_id, name, is_bot, time_s, distance_m, avg_wkg, given_kj, received_kj}`.
- Errors: `event_closed`, `unknown_event`, `not_on_route`.

## Client

**Level estimate** (`profile/level.js`, stored in the profile):

- `level_w` starts at FTP; changing FTP by hand resets it to the new FTP.
- After a ride of ≥ 20 min: candidate = best 20 min average × 0.95. If higher,
  the level moves toward it by at most 5 %. Easy rides never lower it.
- After a race: candidate = average race power; the level moves up or down by
  at most 5 %.
- Sent as `level_w` with `join`. The profile shows *Riding level 3.1 W/kg (from
  your rides)*.

**Start menu:** an **Events** list from `/api/info`: kind (🏁 race, 👥 group
ride), name, route, local start time, countdown (*in 12:40*), riders signed up.
Before the lobby: *Lobby opens 13:50*. During the lobby (and a running group
ride): **Join**, which joins the ride on that route and sends `join_event` once
joined.

**During a ride:**

- When an event's lobby opens on your route: HUD banner *Group ride starts in
  9:12 · J to join*; <kbd>J</kbd>, the button and the controller work like the
  opt-in race join. The ride menu lists the events too; joining another
  route's event goes through *Back to menu* (no reload since #51).
- Lobby: countdown in the HUD. At the start the rider is placed on the line.
- Group ride: a small group panel with the gap to the group's centre and the
  sharing line, *−50 W → Anna, Ben* or *+30 W from Chris* (eased, hidden below
  5 W).
- Finish: a results overlay (the race results view, extended for group rides
  with kJ given and received); the feed thanks the riders who shared most.
- Times are shown in local time; countdowns use the server's clock offset like
  the studio's class clock.

**Recording:** the FIT file keeps real measured power, game speed and distance.
The ride is named after the event (*OpenRadlr group ride · Riverside Flats*)
for the FIT file and the Strava title.

## Testing

- `sim`:
  - `Schedule`: phases and edges (lobby open, start, end, `Done` once, wrap).
  - Event lifecycle on a small `World`: sign-up, start line, bots spawned,
    late join to a group ride, `event_closed` for a race, results, DNF.
  - Bot matching: 70/30 split over many draws, pack range 0.95–1.10, bands
    above 8 humans, profile unchanged after spawn.
  - Power sharing: given = received to the watt, thresholds at 15 s, +100 %
    cap with proportional scaling, easing, no receivers ⇒ no giving.
- `server`: config parsing and validation; `/api/info` events; websocket flow
  lobby → `join_event` → start → `event_finished` with a fake clock.
- Client (Node test runner): level estimate rules; events list formatting and
  countdown; sharing line text.
- E2E (scratch Playwright, not committed): server with
  `OPENRADLR_EVENT_SPEEDUP`, join from the menu, lobby, start, results.

## Delivery

One PR (`feat/events`), built and committed in this order so each step is
green on its own:

1. `Schedule` extracted; studio on top of it, no behaviour change.
2. Bot levels: `level_w`, matched bots on free rides, level in the profile.
3. Scheduled races: config, `/api/info` events, Events list, lobby, results.
4. Group rides with power sharing, HUD line and results.

Docs in the same PR: ADR 0013 *Scheduled events and power sharing*,
`docs/protocol.md`, an *Events* section for riders, CHANGELOG.
