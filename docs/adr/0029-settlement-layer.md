# 29. Settlements as seeded layout data, built once

Date: 2026-11-17 · Status: accepted

## Context

The island's towns were procedural strips attached to route zones: a cluster of
houses either side of a road, rebuilt from whatever the ride happened to load.
That made the east cluster a long strip at the Hilltop Café, gave the same
place a different look from different approaches, and left no place for a
square, a street grid or town light. A city needs a layout that is stable
before any route is ridden, and it must stay cheap enough for a phone.

The existing world already has deterministic scenery placement, near/far
chunk twins and a scenery-off path that must not change. See [#117].

## Decision

Make a settlement map data and a pure layout:

- `routes/maps/valley.json` lists settlements by `id`, `kind`, `center` and
  `radius`. `RoadNetwork` exposes them; every settlement is built once when the
  world is built, whichever route is ridden.
- `layoutSettlement` is a pure function of the settlement and the map seed. It
  returns streets, junctions, blocks, plots, a square, lamps and props as plain
  data, and draws every random number in a fixed order (streets, blocks, plots
  frontage by frontage), so the result does not depend on route order or chunk
  order. The layout is the same in every biome; only models and colours change.
- `buildSettlement` turns that data into meshes. Buildings and their far twins
  reuse `chunks.village`/`chunks.villageFar`; small props stay near-only.
  Scenery off keeps the old procedural villages exactly as before.
- Town light is part of the same layer: emissive window panes placed in the
  model's real openings and lamp-head quads in the existing `bright` group,
  additive ground pools in a new `glow` group, and at most eight nearest lights
  in the opaque shader on High quality. There is no bloom pass. Pools ride the
  road surface rather than `terrain.height`, because the ground near a road is
  levelled about 0.35 m below the asphalt, and their dusk alpha is baked into
  the vertex colour because additive blending ignores destination alpha.
- The harbour lane is scenery, not a rideable road, so the network's routes do
  not change.

## Consequences

- The same town looks the same from every approach and in every biome, and its
  layout can be tested without a renderer. The layout diagram
  (`client/settlementMap.mjs`) is drawn from the same data as the 3D.
- The city is the new worst case: 8 streets, 15 junctions and 326 plots are
  4.63M visible vertices and 1358 draw calls in the headless build, more than
  the dense wood. The near/far twins, near-only pools and the High-only point
  lights are the levers; the plot count and the 350 m village near range are
  the first things to tune on real hardware.
- A settlement is built once, not per route, so the world build pays for every
  town even when the ride never reaches it. The settlements are small next to
  the terrain and the woods; the city's houses dominate.
- Scenery off is a separate path and is unchanged. The server protocol is
  unaffected; settlements are client map data.
- Adding a settlement is a map edit plus its kind's style, not a new route
  zone. Changing the layout seed changes the town, so the seed is part of the
  map's review surface.

[#117]: https://github.com/Lethonium/OpenRadlr/issues/117
