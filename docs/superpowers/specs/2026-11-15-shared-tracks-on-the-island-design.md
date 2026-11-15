# Shared tracks on the island — design

Date: 2026-11-15 · Issue: #107 · Status: implemented

## Goal

Both velodromes, the 250 m oval (`velodrome-250`) and Herne Hill (`herne-hill-450`, and
`herne-hill-450-clockwise` the other way round, OpenBikeNet/protocol#6), stand on the island, so
everybody sees each other: riders on the roads, riders on the tracks, and riders of other apps on
the tracks. Lanzarote stays a world of its own.

## Today

ADR 0020 shares exactly one route, the velodrome, a world of its own:

- `app.rs` gives a world with a shared route no bots at all (`sim_config_for`) and starts one
  OpenBikeNet link for the first shared route it finds.
- `GameCore` keeps one `Obn` (route, frames, remotes) and shows riders of other apps only to
  riders on that route (`with_remotes`).
- `obn::OBN_LENGTH_M = 250.0` scales distances both ways; `Outbox` and `Remotes` serve one route.

## Decisions

- **Bots per route, not per world.** A route with `openbikenet` gets no bots; the other routes of
  its world keep theirs. The tracks aren't part of the road network, so bots can't turn onto them.
  Other apps still never see our bots (they are never sent), and riders of other apps on a track
  aren't hidden in a crowd of bots.
- **The shared length comes from the route file.** `openbikenet` stays the route id; a new
  `openbikenet_length` (metres, required with `openbikenet`) replaces `OBN_LENGTH_M`. The local
  route is drawn to that length, but to within a few millimetres, so the protocol's own length is
  needed to keep `distance < length`.
- **One link per server, all shared routes.** The protocol allows several `subscribe`s on one
  connection, and one `update` carries riders on any routes (spec v0 §3.4, §6). `Outbox` keeps
  each joined rider's route: a rider who moves to another shared route gets `leave` and a new
  `join`, and leaves go out before joins in a frame, since rider keys are unique per connection.
  Today all shared routes are in one world; one link per world stays the rule.
- **Riders of other apps are seen by everyone in the world.** Each shared route keeps its own
  `Remotes` (ids in its own range, so two tracks never hand out the same id). Every viewer gets
  them added after the local riders, nearest first, within `max_visible_riders`, as riders of
  other routes are today. `route_riders.remote` counts those on the viewer's own route.
- **Herne Hill's two directions are two OpenRadlr routes** on the same oval, the points reversed.

## Place on the island

- **Off the road network for now, with room for a junction later.** The tracks are plain routes
  with `map` `valley`, not network edges, so bots and junction turns stay as they are. But each
  oval stands on flat ground with its home straight, the one with the start/finish line,
  facing a road 35–50 m away, at about the road's height. A short connector road from that
  straight to the road can later be added as an edge with a junction at both ends, without
  moving the track (the tracks would then become network edges too).
- **Both on the flat strip south of `valley-west`** (about 35 m above sea level, more than 250 m
  from the nearest café): Herne Hill's centre near (−480, −150), the 250 m oval's near
  (−210, −120), east of the river that crosses the strip, long axes east–west, the north
  straight facing the road.

## Client

- **Tracks drawn on the island.** With a road network, `buildWorld` draws the network's roads
  only. The map's routes that aren't walks over them (the tracks) are drawn and levelled with
  the roads, whichever route is ridden, so the world looks the same from all of them.
- **One Herne Hill card.** A route whose id is another's with `-clockwise` added is that track
  the other way round. The start menu shows one card with the riders of both, and under the
  picked track's name a choice of the way round, with the riders going each way.

## Testing

Unit tests in the sim (routes without bots), `route_file` (the new field), `obn::outbox` (several
routes, a rider changing route), `obn::remote` (id ranges), `game` (bots stay on the roads,
remote riders for viewers on other routes, frames per route), and the end-to-end
`tests/openbikenet.rs` (one connection subscribes to two routes). A sim test rides a track
without a walk on a map with a network. Client tests: the tracks are drawn and the ground is
level under them, the world looks the same from a track, and the start menu's card and choice
of the way round.
