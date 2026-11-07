# 20. Sharing riders with OpenBikeNet

Date: 2026-11-06 · Status: accepted

## Context

[OpenBikeNet](https://github.com/OpenBikeNet/protocol) (protocol v0, "Level 0")
lets indoor-cycling apps show each other's riders: each app keeps its own
physics and worlds, and a server relays name, position, speed, power and
cadence per shared route. Riders of OpenRadlr and of other apps could meet,
but a shared route needs a place that looks the same everywhere and a clear
promise about what leaves the server.

## Decision

- **One new route, `velodrome`**: a flat 250 m oval, a world of its own. Its
  route file names the shared route (`"openbikenet": "velodrome-250"`). A world
  with such a route has no bots, so every app sees the same riders.
- **Off unless configured.** `OPENRADLR_OBN_URL` turns the link on. Without it
  the velodrome is an ordinary local track and nothing leaves the server.
- **Picking the route is the opt-in.** With the link on, the start menu marks
  the velodrome *Shared* and says what is sent. No other route is ever shared.
- **What is sent**, per human on the velodrome, once per second: display name,
  `lap`, `distance`, `speed`, `power`, `cadence`. Never heart rate, never bots;
  the protocol `rider` value is `r<rider id>`. Values are clamped to the spec's
  ranges so the OpenBikeNet server never drops an entry. Riders doing a workout
  and riders off the route are not sent either. `ws://` is unencrypted: use
  `wss://` beyond a trusted network.
- **One outgoing connection per server**, room `public`, reconnecting with
  backoff from 1 s to 60 s. Local riding never waits for it. After 20 s without
  anything from the server the link sends `ping`; 10 s more of silence count as a
  dropped connection (spec 3.5), which also catches a half-open one.
- **Remote riders live in the game core, not the sim.** They have no physics,
  don't draft, can't race and don't count towards caps. The core keeps their
  last state, moves them on by their speed (at most 2 s) and adds them to the
  state messages of riders on the velodrome. A remote rider silent for 10 s
  is hidden until their next update (forgotten after 5 minutes); all of them
  go when the link drops. Messages for another route or room are ignored.
- **Wire (additive, protocol version stays 2):** a remote rider is a normal
  `RiderState` with `is_bot: false`, an `app` field and an id from `0xF000_0000`;
  `route_riders` gains `remote`; `/api/info` routes gain `shared`.
- **Client:** remote riders get their own tint and a label with their app;
  panels show the app as a badge. Names from other apps are written as text,
  never as HTML.

## Consequences

- No drafting and no races with remote riders; the velodrome is for riding
  together, not for racing across apps.
- The link is optional: servers without it behave as before, and an
  OpenBikeNet outage only removes the remote riders.
- Power and cadence are shared with other apps while riding the velodrome.
  A per-rider switch to stop sharing them is planned as a follow-up (the spec
  says apps SHOULD offer one): #36.
- Positions are approximate: lap counting and distances are scaled to the
  250 m oval, which is good enough for v0 presence.
