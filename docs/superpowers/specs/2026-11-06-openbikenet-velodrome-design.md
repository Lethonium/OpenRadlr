# OpenBikeNet Velodrome: Design

Date: 2026-11-06 · Status: draft for review

## Goal

OpenRadlr riders meet riders from other apps (Incyclist, VeloPopuli, …) on a shared 250 m
velodrome. Each app keeps its own physics; positions are exchanged through an
[OpenBikeNet](https://github.com/OpenBikeNet/protocol) server (protocol v0, "Level 0": shared
presence). OpenRadlr is the first app to use it.

## Decisions

- **One new route, `velodrome`**: a flat 250 m oval, a world of its own (no `map`). Its route
  file names the shared route: `"openbikenet": "velodrome-250"`. A world with such a route has
  **no bots**, so every app sees the same riders. It has an explicit empty `zones` list (no
  scenery on the track), which the server now passes on as `[]` instead of dropping it.
- **Off unless configured.** `OPENRADLR_OBN_URL` (for example `wss://obn.example.org/v0`) turns the
  link on. Without it the velodrome is an ordinary local track and nothing leaves the server.
- **Picking the route is the opt-in.** With the link on, the start menu marks the velodrome
  *Shared with other apps* and says what is sent. No other route is ever shared.
- **What is sent** for every human on the velodrome, once per second: the display name, `lap`,
  `distance`, `speed`, `power`, `cadence`. Heart rate never leaves the client, as today. Bots are
  never sent. The protocol `rider` value is `r<rider id>`, never anything personal. Every value
  is clamped to the spec's range (speed 0–30 m/s, power 0–3000 W, cadence 0–250 rpm), so the
  OpenBikeNet server never drops an entry or closes the link for repeated errors. Names already
  fit the spec (at most 24 characters, no control characters; Strava names are first name and
  initial).
- **One outgoing connection per OpenRadlr server**, room `public`. It sends `hello` with
  `app.id = "openradlr"`, the server version, name `OpenRadlr` and `https://openradlr.com`, then
  subscribes to `velodrome-250`. On a drop it reconnects after 1, 2, 4, … up to 60 s and joins
  its riders again. Local riding never waits for it.
- **Remote riders live in the game core, not the sim.** They have no physics, don't draft, can't
  race and don't count towards caps. The game core keeps their last state, moves them on by their
  speed between updates (at most 2 s ahead) and adds them to the state messages of riders on the
  velodrome, after the local riders. A `snapshot` replaces all remote riders of the room. A
  remote rider not updated for 10 s is dropped; all remote riders are dropped when the link goes
  down.
- **Wire (OpenRadlr protocol, additive, version stays 2):** a remote rider is a normal
  `RiderState` with `is_bot: false`, a new `app` field (the other app's ID, for example
  `"incyclist"`), and ID from a reserved range (`0xF000_0000` and up, never reused while running).
  `route_riders` gains `remote` (count of remote riders on the route). `/api/info` routes gain
  `shared: true` when the route is shared and the link is configured.
- **Client:** remote riders get their own tint and a label `Ben · incyclist`; panels show the app
  as a badge. Names from other apps are shown as text, never as HTML.
- **Distances.** OpenRadlr's oval is 250 m to within a centimetre; positions are scaled by
  `250 / route length` and kept below 250. `lap` counts line crossings since the rider joined
  OpenBikeNet; a reconnect is a new join, so it starts again at 0. A line crossing is a position
  more than half a lap behind the last one, so moving a rider back by over half a lap (a start
  grid) counts as a lap; good enough for v0, since apps place riders by `distance`.

## Not now

- A per-rider switch to stop sharing power and cadence (the spec says apps SHOULD offer one).
  The follow-up issue is filed before this feature is merged.
- More shared routes, rooms other than `public`, chat across apps, remote riders in races.
- Showing which apps are online in the menu.

## Docs

ADR 0020 *Sharing riders with OpenBikeNet*; `docs/protocol.md` (new fields), `docs/routes.md`
(`openbikenet` field), `docs/deploy.md` and `.env.example` (`OPENRADLR_OBN_URL`), CHANGELOG.
