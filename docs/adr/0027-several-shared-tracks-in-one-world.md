# 27. Several shared tracks in one world

Date: 2026-11-15 · Status: accepted · Amends [ADR 0020](0020-sharing-riders-with-openbikenet.md)

## Context

ADR 0020 shared exactly one route, the 250 m velodrome, as a world of its own
with no bots. OpenBikeNet now has a second shared track, Herne Hill Velodrome
(`herne-hill-450`, and `herne-hill-450-clockwise` the other way round), which
VeloPopuli rides too (#107). Both velodromes should stand on the island, so
riders on the roads, on the tracks and in other apps all see each other. The
island has bots on its roads, and its world holds many routes.

## Decision

- **Bots per route.** A route with `openbikenet` never gets bots, not even for
  events (`SimConfig::routes_without_bots`); the other routes of its world keep
  theirs. The tracks are not part of the road network, so no bot turns onto one.
- **The shared length is in the route file.** `openbikenet_length` (metres,
  required with `openbikenet`) is the track's length as OpenBikeNet publishes
  it. Positions are scaled between it and the local route's length and kept
  below it. The fixed 250 m is gone.
- **One connection for all shared routes.** Still one link per world (today one
  world has shared routes): it subscribes to every shared route and sends one
  `update` with the riders of all of them. A rider who moves to another shared
  route gets a `leave` first, then a `join` there, since rider keys are unique
  per connection.
- **Everybody in the world sees riders of other apps**, nearest first, after
  this server's own riders and within `max_visible_riders`, like riders of other
  routes. Each shared route hands out its own range of ids (`0x0100_0000` each
  from `0xF000_0000`), so the same remote rider id on two tracks is two riders.
  `route_riders.remote` still counts those on the viewer's own route.

Everything else in ADR 0020 stands: what is sent, the opt-in by picking a
shared route, no drafting or races with remote riders.

## Consequences

- Placing a shared track on any map is a matter of its route file: `map`,
  `openbikenet` and `openbikenet_length`.
- A route file with `openbikenet` but no `openbikenet_length` no longer loads.
- Riders on the roads near a track see the riders of other apps on it, so the
  state message carries remote riders for viewers on any route of the world.
