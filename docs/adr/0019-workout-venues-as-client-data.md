# 19. Workout venues as client data, statues as a main-thread layer

Date: 2026-11-06 · Status: accepted

## Context

ADR 15 put every workout at the start café's gym, and the workout menu was a
select box. Riders asked (#26) for each workout to happen at its own gym, and
for the menu to show what you will do: the figures should stand around the gym
as statues, and the workouts should be cards with a block strip. Each gym is
one scenery object in the world (ADR 10), so the same gym is seen by every
rider, and the menu shows the same world before a ride starts.

The first slice has six exercises and three presets. Yoga and more presets are
coming, so the venue table will grow, and a gym may later host one category
instead of one workout.

## Decision

- **A gym hosts a category, and a preset names its venue.** The venue table is
  pure client data in `client/public/js/workout/venues.js`: each café id maps
  to a category and a statue material. Each preset in `presets.js` carries a
  `venue`, and `figuresAt(venueId, presets)` derives a gym's statues from the
  presets it holds. An unknown venue fails the load, like an unknown exercise.
- **The route is chosen on the client.** `venueRoute(venueId, routes, cafes)`
  returns the first route in `/api/info` order whose start lies within 30 m of
  the venue's café, else the default route as before. The server and the wire
  are unchanged.
- **Statues are their own layer.** `view3d/statues.js` builds one row per gym
  from the rider's body parts, frozen at a defining moment of its clip
  (`STATUE_MOMENT`), on a plinth. The main thread owns the layer, placed with
  the gym's `statueRow` transform, and `View3D.setStatues`, `setStatueGlow` and
  `statueTargets` manage it. Rows are not baked into the worker's chunks.
- **The glow is local.** During a rest, `highlightedFigure` picks the next
  exercise's statue and the layer draws its glow ring. Nothing is sent over
  the wire, so the highlight belongs to the rider who sees it.
- **The fallback keeps the preview honest.** When a picked workout's venue has
  no route, the rider joins the default gym, and that gym's row shows the
  picked workout's figures in its venue's material until another card is picked.

## Alternatives

- **Venues on the server.** The server would send the table in `/api/info`,
  and the menu would show it the same way. Rejected for now: the table is
  presentation data that changes with the menu, and a server change would make
  every client depend on a new server release for a new gym. Server-side venues
  stay open for the day a server rule needs them (for example, to restrict a
  workout to a route).
- **Live posed riders for the statues.** Each statue would be a parked rider
  animated at its exercise. Rejected: that means one animated body per figure
  per gym in every client, and the statues do not move. A frozen pose is cheap
  and reads the same from the drone camera.
- **Baking the statues into the world chunks.** Simple to draw, but a row could
  not be rebuilt for the fallback or the highlight without rebuilding the chunk
  it lives in. Rejected in favour of a layer the main thread can rebuild.

## Consequences

- No protocol change, so the version stays 2 and the server is untouched.
  A workout still reaches the server as the same `workout` join and exercise
  messages as before.
- The venue table is duplicated nowhere: it lives in one client module, and
  `docs/workouts.md` is the readable copy. Changing a venue means changing that
  module and the doc together.
- Beach Café holds core for now. When yoga arrives, core moves to Forge Hut;
  the preset's `venue` and the table are the only places that change.
- The statue layer adds one row of meshes per gym to the main thread. The row
  is small (at most six figures), and it is built once per world.
- The highlight is local: two riders at the same gym may see different glows.
  That is accepted, since the glow is a hint for the rider doing the workout.
