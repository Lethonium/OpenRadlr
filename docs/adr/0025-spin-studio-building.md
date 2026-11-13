# 25. Spin studio as a building in the valley

Date: 2026-11-12 · Status: accepted

## Context

The spin studio ([ADR 11](0011-spin-studio.md)) was a dark room on its own
canvas, outside the world. The start menu had nowhere to fly to for it, so
picking the Studio card fell back to the island orbit, and riders on the road
never saw anyone in the studio.

On maps with a `valley-cafe` node the studio can sit in the world instead: a
glass building across the road from the Valley Café. Its riders can look out at
the real valley and the live road, and road riders can see the studio's riders
pedalling inside.

## Decision

- **Floors are rooms.** Floor *n* is studio room *n*. The building has at least
  two floors, and a new room adds one on top. Its height grows with the
  classes, so nobody changes floor while they ride.
- **Rooms close from the top only.** An empty extra room closes only when it is
  the last one. An empty room in the middle keeps its bots until the rooms above
  it have emptied too, so room indices stay stable for every seated rider.
- **A two-way mirror between the two cores.** The studio core publishes its
  seats to a shared `StudioMirror` registry on each broadcast, tagged with a
  generation counter. The valley game core shows them to road clients as
  `riders[]` entries with `studio: { room, seat }`. In the other direction, the
  valley core publishes the riders near the café node, and the studio adds them,
  plus the other rooms' seats, to `studio_state.road_riders`. Seats the studio
  stops publishing (closed or restarted) vanish from the road after one second
  on the reader's own clock, since the two cores' clocks are not comparable.
- **A feature flag for road clients.** Studio riders are sent only to clients
  that announce `"studio_riders"` in `join.features`. An older client would draw
  them at route position 0, so it sees the road as before.
- **Studio rider ids start at `0xE000_0000`**, below the OpenBikeNet range at
  `0xF000_0000`. Each core counts ids from 1, so the ranges keep them apart.
- **The building is drawn in the valley world.** The client builds the valley
  world in `View3D` and draws the building as a main-thread layer, so the floor
  count can change without remeshing the terrain. Without a valley map the room
  is drawn alone, and the menu keeps its island orbit.

## Consequences

- The protocol change is additive within version 2: `join.features`,
  `riders[].studio`, `studio_state.road_riders` and `studio.rooms` are optional,
  and an older client ignores them. See [the protocol](../protocol.md).
- The studio and the valley world now depend on each other at runtime. Without
  a valley map there is no mirror and the studio runs alone, as before.
- The mirror is a small shared registry with a lock, read once per broadcast.
  It holds no game state, so the two game loops stay independent.
- A stale-seat timeout of one second means a studio restart shows up on the road
  within about a second, and the valley's riders reach the studio at its own
  broadcast rate.
- Studio riders on the road have no physics, drafting or events. They are not
  counted in the valley's players, and the studio counts them.
