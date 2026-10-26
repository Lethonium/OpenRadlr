# 10. One connected world

Date: 2026-10-14 · Status: stages 1–3 accepted and implemented (2026-10-15; road network #26, one world #14, turning #15), superseding [7](0007-one-world-per-route.md)

## Context

Today every route is its own world ([ADR 7](0007-one-world-per-route.md)):
its own coordinates, terrain seed and game loop. Riders on *Rolling Hills*
never see riders on *Col de la Forge*, and the three routes overlap in the same
coordinates without knowing about each other. Riders expect the routes of one
server to feel like one place: roads that cross or share a stretch, the same
landscape, and later the choice to turn onto another route at a junction.

## Proposal

One map per server, built from a **road network**: road segments joined at
junctions. A route is a loop through that network (a list of segment ids)
instead of its own list of points.

Stages, each usable on its own:

1. **One map, still separate worlds.** Route files move into one coordinate
   space around a shared hub (the bike café as start/finish for every route).
   Shared stretches use identical points; crossings get a bridge or a junction.
   The client draws every road and one terrain from a single map seed, so you
   see the other roads. Server: unchanged.
2. **One world on the server.** A rider's position becomes `(segment, offset,
   lane)`; one game loop simulates everyone. Riders on a shared segment see and
   draft each other; the state message carries riders within view distance.
   Races stay per route. Protocol version 2.
3. **Turning at junctions.** Before a junction the HUD shows the options
   (← / → like a lane change, default: stay on your route). Taking another road
   switches the rider's route; the recorder keeps one continuous ride.

## Things to solve first

- **Elevation must agree where roads meet.** *Riverside Flats* lies at 35–45 m,
  *Col de la Forge* at 300–450 m: they need a valley-to-pass layout (the col
  starts where the flats end) rather than the current overlapping loops.
- Terrain, villages, forests and the river must respect every road, not one.
- Route length, markers (sprints, climbs) and lap counting are per route, so a
  shared segment can be a sprint on one route and plain road on another.
- Bots need a route each and should not all pile onto shared stretches.

## Stage 1 as built

- Route files carry an optional `"map": { "id", "seed" }`; the server passes it
  through. Clients fetch the other listed routes and draw those on the same
  map. Files without `map` stay worlds of their own.
- The bundled routes come from one road network (`tools/valley-map.mjs`): a
  main road through the café with the start line, junctions where the loops
  leave and rejoin it, valley at 40 m, col at about 200 m (the col keeps its
  2.5 km climb at 6 % rather than climbing to the old 450 m).
- One terrain for all roads: an inverse-distance blend of every road's height
  on a coarse grid, so roads at different heights get slopes, not steps.
- Shared things (terrain, rivers, villages, farms, trees) are built for all
  routes in a fixed order, so the world is the same whichever route you ride.
- The bigger world takes a few seconds to build, so it is built in a module
  worker.
- The map is an island (#20): the coast runs a seeded margin (about 400–900 m)
  beyond the farthest road in every direction, with beaches, some cliffs and
  the sea at 0 m (route elevations are metres above sea level). It is derived
  from the roads and the map seed, so adding a route to the map grows the
  island where needed. Rivers that reach the coast flow into the sea; far-off
  islands replace the old mountain ring.

## Road network (decided 2026-10-15, #26)

Stage 1 shares a map but still hand-lays a main road with three loops. Before
stages 2 and 3 the map becomes a real network, decided as follows:

- **Format.** One network file per map: nodes (`café`, `junction`, `end`,
  with position and elevation) and edges (`from`, `to`, centre line ending
  exactly on both nodes, a reserved `type` for road variety #27, zones and
  markers). A route is a walk over the network: a start café and a list of
  `[edge, direction]`. Length, profile and points are derived, not stored.
  Route ids stay, so menus, settings and ride history keep working.
- **Terrain first.** The generator builds the landscape from the map seed
  (island outline, river valley, hills, a pass), puts the cafés on sensible
  spots, then lays each road along the cheapest path for grade and
  curvature. Road elevations come from the land, smoothed; the land is then
  flattened under the road bed as before. The landscape is part of the
  network file, so every client draws the same island, and the coast no
  longer has to be a margin around the roads (needed for coastal roads, #28).
- **Two-way roads, lanes per direction.** Each direction of an edge is its
  own carriageway: drafting and races only with riders going the same way,
  oncoming riders on the other side. Today's four lanes become two plus two
  on main roads (#27 refines this per edge). This allows out-and-back routes
  and free turning at junctions.
- **Markers belong to an edge in one direction.** A climb or sprint is the
  same on every route that rides it that way (and could get its own
  leaderboard later); a route picks up the markers of the edges it rides in
  the matching direction.
- **Places.** At least three cafés (the valley hub near the origin, a mountain
  hut on the col, a village café in the hills; a harbour café on the coast
  with #28) and about six to eight junctions on an island of roughly
  10 × 8 km, well inside the area the fixed GPS origin allows. The menu
  starts a rider at the café where their route starts.
- **Position (stage 2).** A rider is at `(edge, direction, offset, lane)` and
  follows a planned walk; "distance on my route" is derived from the walk, so
  races, laps, the HUD and the recorder keep their logic. Turning at a
  junction (stage 3) replaces the rest of the walk; leaving your route makes
  it a free ride, and race entrants can't turn off.
- **Order.** #26 adds the format, the generator and client drawing, and still
  writes one route file per route, so the game server and protocol stay
  unchanged until stage 2 (#14); the server only serves the network file.
  Existing rides shift once, as with stage 1.

### Road network as built (#26)

- `routes/maps/valley.json` holds the network: the landscape (a 40 m height
  grid and the coast), 9 places (3 cafés, 6 junctions), 11 two-way roads and
  the routes as walks. The server loads `maps/` next to the route files and
  serves each file unchanged at `/api/map?id=…`.
- `tools/valley-map.mjs` builds it terrain first: island, ridge with a col,
  river valley, hills; then the places; then each road as the cheapest path
  on a 20 m grid where grade, turning, the shore and other roads cost extra,
  smoothed into bends (hairpins on the col no tighter than about 12 m).
  Through places (`through`) have their main way in a straight line, so every
  route rides straight over its start line.
- The classic route files are derived from the walks; where a route turns
  from one road onto another it takes a short arc (up to 15 m radius) instead
  of the corner where the roads meet. Clients draw the ridden route on top,
  the other roads below it, and an asphalt pad under each junction.
- Clients fetch the network for a route's map and build the world from it:
  terrain from the grid, every road once, a café at every café, scenery per
  road (farms by length, ground detail thinner off the ridden route, terrain
  in 48 m pieces far from roads). Without a network file they fall back to
  the stage 1 drawing. The bigger map builds in about 10 % more time than
  stage 1's.
- The bundled routes changed once: *Riverside Flats* 8.6 km (was 6.8),
  *Rolling Hills* 7.8 km from the Hilltop Café (was 4.8 from the valley),
  *Col de la Forge* 12.9 km (was 8.6) with its 2.5 km at about 6 % to the col.

## Consequences

- Stage 1 is content and client work only and keeps the protocol; it is the
  natural first step.
- Stages 2–3 change the server core (`sim` crate) and the protocol, and
  replace ADR 7.
- CPU: one loop instead of one per route, but more riders per broadcast;
  state messages need view-distance culling.

## Stage 2 as built (#14)

- **One world per map.** The server groups route files by `map.id`; each
  group is one `World` with one game loop (routes without a map stay worlds
  of their own). A join names the route; the rider rides it in the map's world.
- **Position.** Route files carry their walk in route distance
  (`walk: [{edge, dir, from, to, length}]`, written by the generator), so the
  server keeps a rider's route distance as before and derives the road under
  them: step, direction and offset along the road, scaled to the road's own
  length (routes round their corners, so a route's stretch is a few metres
  shorter). Stage 3 will swap the rest of the walk at a junction.
- **Drafting.** Riders of one route draft along the route as before; riders of
  different routes draft where they ride the same road in the same direction,
  also across the end of the road onto the road the follower turns onto next.
  Oncoming riders never draft. Lanes are still four per direction (two plus
  two comes with #27).
- **Races, markers, laps** are per route: each route has its own race,
  entrants and results; `start_race` starts one on the starter's route.
- **Bots** keep `OPENRADLR_TARGET_RIDERS` on every route. A new bot starts at
  the spot of its route furthest from everybody (best of a few seeded
  tries), so bots don't pile up on shared roads; surplus bots leave only when
  no human anywhere on the map is near them.
- **State culling.** Each client gets the riders within 800 m of them in a
  straight line (beyond the 3D view's 600 m rider range), plus everyone in
  their route's race, and the counts of their route. Events go to the route's
  riders, chat to the whole map.
- **Protocol version 2** (see [protocol](../protocol.md)): riders carry
  `route` and `road`. The client draws riders of other routes in 3D on their
  own route's geometry (it loads the map's route files anyway); panels, the
  minimap, the profile and the 2D view show the riders of your route.

## Stage 3 as built (#15)

- **Choosing.** 250 m before a junction with more than one way on, the HUD
  lists the roads from left to right (arrow, the route it continues or *Off
  route*, where it leads). ← / → (the lane keys and controller buttons)
  step through them instead of changing lanes; a click or tap picks one too.
  The default is lit: your route's road, straight on off every route. The
  client sends `turn {edge}`; the server checks the road leaves the junction
  ahead and isn't back the way you came.
- **Where a turn leads.** Onto a road that a route rides that way (your own
  first), you ride that route from there: its markers, laps and riders.
  Onto any other road you ride off-route, road by road; the server keeps
  your road and offset, the client builds the road before, the current one
  and the next as one open geometry for the camera, HUD and recording.
  Turning back onto a route's road rejoins it.
- **Races.** Entrants can't turn (the HUD shows no options, the server
  refuses); riders off every route can't start or join a race.
- **One ride.** The recording, its name, files and Strava activity stay the
  route you joined; distance and the GPS track follow the roads ridden.
- **Not yet.** The 3D world keeps the arches and banners of the route it was
  built for; bots don't turn.
