# 30. Island regions and landmarks as map data and style tables

Date: 2026-11-19 · Status: accepted

## Context

The valley island read as one place: woods, fields and villages in muted greens
under a grey haze. A ride through it had no memorable stretches. The owner
compared it with Cykelapp, whose coast, desert and blossom scenes read as
different places at a glance, and asked for a believable Mediterranean island
with a few playful landmarks, visuals first. What Cykelapp does well, taken as
technique only (no geometry): warm light and sunward haze, big masses of one
colour, one landmark visible from afar per area, roadside detail at the camera's
distance, and a style table per zone. See [#117].

Constraints stay as in [ADR 0028](0028-instance-repeated-scenery.md) and
[ADR 0029](0029-settlement-layer.md): the world is seeded and identical on
every route and client, scenery off must not change, and the dense wood is the
budget ceiling for a phone.

## Decision

- **Light first.** The presets are retuned warmer and every level gets it: three
  small terms in the opaque shader (sunward haze, saturation, a water glint) and
  a Mediterranean ground palette.
- **Regions are map data.** `routes/maps/valley.json` lists 11 hand-placed
  regions of 8 kinds (pine coast, olive terraces, blossom valley, lavender
  fields, farm belt, deep wood, wetland, high country). `RoadNetwork` exposes
  them and `regionAt(x, z)` (pure, in `land/regions.js`) answers which regions
  weigh on a spot. Edges blend over about 150 m and wander with 300 m noise, so
  no circle shows. The `land.js` answers (`forestAt`, `fieldAt`, `kindAt`,
  `treeFactor`) do not change; regions only recolour and refill what they find.
  Route files without a network get none.
- **Looks are style tables.** `view3d/regions/styles.js` holds one table per
  kind: ground colours, tree mix and density, canopy colour, a colour mass,
  near-only cover and roadside props. A biome overrides pieces of it (winter
  bares the almonds, takes the flowers out of every region's cover and snows the
  lavender); a kind it does not override keeps its temperate look.
- **Plants and props are drawn in code** (`plants.js`, `props.js`), in the
  existing low-poly style, in metres, with a far twin of at most 12 triangles.
  Cover (grass, shrubs, wheat, flowers, lavender) is a new near-only chunk
  group kept off the road's 3 m shoulder, settlements, landmark aprons and
  rivers, and low and prop-free within 18 m of the sea on that side.
- **Landmarks are map data too.** `landmarks.js` builds a lighthouse, a castle
  ruin, a sea arch, a row of windmills, a cathedral in the market city and four
  hot-air balloons from map entries, once, into `village`/`villageFar`, with an
  apron reserved in the `Occupancy`. Parts that move (sails, balloons) are
  per-frame `movers` driven by the clock, like turbine rotors and clouds; they
  are visual only and not seeded. The cathedral is drawn in `assemble.mjs`,
  because the Kenney pack could not be downloaded. A viaduct had no site (no
  road deck rises 12 m over the ground for 60 m) and was not built.
- **A land-use map** (`client/worldMap.mjs`) draws the regions' colour masses
  and the landmarks from the same data, for review.

## Consequences

- Budget, headless software WebGL, `sceneryBench.mjs --camera chase --scenery
  quaternius --frames 120`, opaque calls and visible vertices (Task 1 baseline,
  the dense wood before regions: 957 calls, 1,527,246 vertices):

  | View | Calls | Vertices |
  | --- | ---: | ---: |
  | Dense wood, rolling-hills 6490 | 894 | 1,329,213 |
  | City, rolling-hills 300 | 661 | 1,467,585 |
  | Coast, cape-loop 1000 | 766 | 1,645,200 |
  | Lavender, rolling-hills 4500 | 1,430 | 3,223,533 |
  | Olive terraces, balcony-road 4400 | 1,274 | 3,252,756 |
  | Almond valley, riverside-flats 8150 | 1,438 | 3,160,956 |

  The wood and the city are under the baseline. The coast is a little over it in
  vertices, and the lavender, olive and almond views are over it in both: they
  are open, built-up views (farmland, houses, cover along both verges) that were
  already heavier than the wood before regions. For lavender the same spot
  without regions was 1,682 calls and 4,829,664 vertices, so regions make it
  lighter; no without-regions figure was taken for the olive and almond views.
  The levers if a phone struggles are the cover densities, then the cover's
  near range.
- Scenery off is unchanged: no regions, landmarks, cover or movers, and its
  geometry is byte-identical. The light retune applies at every level.
- Roads, heights, routes, the protocol and the server are untouched; regions and
  landmarks are client map data.
- Adding a region is a map entry plus, for a new kind, a style table and its
  plants; adding a landmark is a map entry plus a builder. The map's placements
  are part of the review surface, like settlements.
- Winter falls back by merging: a kind with no override keeps its temperate
  style, and a biome with no flowers removes the flowering plants from every
  region's cover, so a new region cannot show blossom on snow.

[#117]: https://github.com/Lethonium/OpenRadlr/issues/117
