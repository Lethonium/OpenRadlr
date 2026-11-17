# Towns, cities and town light — design

Date: 2026-11-17 · Issue: #117 · Status: design for discussion

## Goal

The island's settlements are still rows of houses along the rideable road. A
rider passes a street front and a lane behind it, but there is no junction, no
second street, no square that belongs to the town rather than to the road. The
east cluster around the Hilltop Café should become **one larger market city**;
the southwest cluster a **real village**; the southeast bay a **harbour
village**. At dusk the lanterns should actually light the street, and windows
should glow, so a town reads as inhabited from the saddle and the drone.

The reference for the *feeling* is The Crew Motorfest: warm, saturated, high
contrast, a few hero streets with strong light rather than an even wash. We
cannot match its density or its post-processing budget. We can match the
composition: a dark, cool evening, warm pools on the street, lit windows,
market lights, and a clear silhouette of roofs and church towers.

## What is there now

- `buildVillage` draws pavements along the ridden road, a church, lamps and a
  name board. With a town kit, `layVillage` adds a street front, one back lane
  and a square.
- Village zones come from route files (`lower-valley`, `hill-road`,
  `orchard-lane`, `hill-north`). Each is a 300–550 m stretch of **one road**.
- The east cluster is three zones around the Hilltop Café (`hill-road`
  1919–2249, `orchard-lane` 90–420, `hill-north` 90–420). They are separate
  strips, not one town.
- There is no cross street, no junction, no block, no second frontage.
- Lamps write their heads into the `bright` mesh, which the renderer draws
  unlit (brighter at dusk). Nothing else happens: no pool on the ground, no
  light on the road, no window glow.

## Settlement hierarchy

| Kind | Count | Where | Size | Character |
| --- | --- | --- | --- | --- |
| City | 1 | Hilltop Café, east | ~700 × 500 m | market square, guildhall, church, four streets, two junctions, workshops, gardens |
| Town | 0–1 | Southwest cluster | ~350 × 250 m | green, church, farm lane, cross street, smithy, inn |
| Village | 2–3 | existing zones | 250–400 m | one main street, one cross lane, a green or a church |
| Harbour | 1 | southeast bay | ~300 × 220 m | quay, boats, fish market, net racks, a lane to the water |
| Hamlet | 2–4 | farm belt | 80–150 m | three or four farms round a lane, no church |

The city is the only place with a **grid**. Villages get a main street and one
or two cross lanes; a hamlet is a farm cluster. That difference is what makes
the city read as a city.

## Where the city goes

The Hilltop Café is the natural centre: it is already a café node at 152 m,
with three roads leaving it (`hill-road`, `orchard-lane`, `hill-north`) and the
`rolling-hills` route starting there. The city grows **around the café**, not
along one route:

- the café stays on the market square;
- the three existing roads become three of its streets;
- two new streets close the blocks between them;
- the ground falls away to the south and east, so the city is terraced: the
  square is the flat top, the streets step down, and the lowest block is
  workshops and gardens.

The city is a **settlement**, not a route zone: it spans more than one road and
must look the same whichever route is ridden. A `settlements` array in the map
file carries its centre, kind, radius and seed. The world builds every
settlement once, like it builds every road once.

## Layout

All layout is in a **local frame** at the settlement centre: `u` east, `v`
north, `y` up. The frame is rotated to the first main street so the grid does
not fight the terrain. A settlement is a pure function of its seed and the
terrain.

### 1. Streets

A street is a polyline of stations, each `{u, v, width, kind}`. The builder
turns it into a ribbon that follows the ground, with a crown of 0.08 m, a
2.4 m pavement on each side and a kerb.

| Kind | Width | Use |
| --- | --- | --- |
| main | 8 m | the existing road through the settlement; already drawn |
| street | 7 m | a new street with two frontages |
| lane | 4.5 m | a back lane or a farm lane, one frontage |
| alley | 2.5 m | a pedestrian cut between two blocks |
| quay | 6 m | the harbour front, with bollards and a crane |

The city gets:

- the three existing roads as **main streets**;
- two **new streets** parallel to the longest existing road, one each side,
  at 70–90 m;
- three **cross streets** joining them, at 90–130 m spacing;
- **lanes** through the middle of the larger blocks;
- a **market square** at the café, about 55 × 45 m, paved, with the café, the
  guildhall, the church, stalls, a fountain, benches, trees and lamps.

Every junction gets a paved pad, a dropped kerb and a lamp. A junction is a
place, not two ribbons crossing: the pad is a rounded polygon and the
pavements turn the corner.

### 2. Blocks and plots

A block is the land between four streets. It is split into plots along its
frontages:

- plot width 7–14 m (city), 9–18 m (village), 14–24 m (hamlet);
- plot depth 14–22 m, with a front garden 2–4 m and a back garden 6–10 m;
- a corner plot faces the busier street and may be a shop or an inn;
- 10–20 % of plots are gardens, yards or workshops, not houses;
- the middle of a large block is a back garden, an orchard, a yard or a small
  green, reached by an alley.

Building height comes from the kit's model, not from a number: a city picks
the taller models when it has them, a village the smaller ones. A model whose
footprint does not fit is skipped; the plot becomes a garden. That is how a
real street has gaps.

### 3. Frontage rules

- A house's front faces the street; its door is on the street side.
- A shop has an awning or a sign over the pavement; a workshop has a yard.
- A church faces the square or the main street, with its tower visible from
  the approach.
- A guildhall or town hall faces the square, wider and taller than the houses.
- A farm has a barn, a yard, a silo and a track to the lane; no front garden.
- Fences and hedges run along the pavement with a gap for each door.
- Lamps stand at junctions, on the square and every 24–30 m along a street.

### 4. Terrain

- A street may climb; its ribbon follows the ground and its buildings sit on
  level pads. A pad is the lowest ground under the footprint, so nothing
  floats.
- A plot whose ground varies by more than 2.5 m becomes a terrace, a garden or
  a retaining wall, not a house.
- A street that would cross a river, another road, a building or a slope over
  0.35 is cut short at the obstruction; the block closes with a garden.
- The city keeps the café's sightline and the route's approach clear: no
  building within 10 m of the ridden road's edge, no street across the start
  arch.
- Trees are kept out of streets and squares, and planted in gardens, on the
  square and along the approach.

### 5. Determinism

- Seed: `hashSeed(settlement.id, map.seed)`.
- Every random draw happens in a fixed order: streets, then blocks, then plots
  frontage by frontage. The order never depends on the route ridden or on the
  order chunks are built.
- The same settlement is identical in every biome; only the models and colours
  change.
- A settlement is data first (`layoutSettlement` returns streets, blocks,
  plots and props) and meshes second (`buildSettlement` places it). The layout
  can be tested without a renderer.

## Lighting

### What the eye should read

At dusk, from the saddle:

- the sky and the distance are cool blue;
- the street is dark, with **warm pools** under the lamps;
- windows are **small warm rectangles**, not a uniform glow;
- the market square has a few brighter lights: stalls, string lights, the café;
- a church tower or a guildhall is a silhouette against the sky, with one lit
  clock or window.

At day, none of this is on. At golden hour, a warm hint, no pools.

### Layers

1. **Emissive heads and windows** (always on, cheap).
   - Lamp heads and lit windows go into the `bright` group, which is drawn
     unlit. At dusk the brightness is 1.0; at golden 0.55; at day 0.25.
   - Window quads are added to the street-facing facades: 2–4 per house,
     seeded on/off (about 65 % lit at dusk), warm `[1.0, 0.72, 0.38]`.
   - The town kit's own window faces are used where the kit has a `windows`
     role; otherwise the quads are placed from the footprint.
2. **Ground pools** (cheap, near-only).
   - An additive, radial-gradient quad on the pavement/road under each lamp,
     radius 6–9 m, alpha 0.22 at dusk, 0 at day.
   - A smaller pool under a lit shop window, radius 2–3 m, alpha 0.12.
   - Pools follow the ground and are drawn after the road, before the rider.
3. **Point lights** (High quality only, nearest 8).
   - A uniform array of up to 8 point lights: position, colour, radius.
   - The opaque shader adds `colour * intensity * max(0, 1 - d / radius)^2`
     to the lit colour. The nearest lamps and the market lights are selected
     each frame.
   - This is what actually lights the asphalt and the house walls; the pools
     make the same light visible on Low.
4. **Market lights** (hero props).
   - A string of small warm bulbs across the square, on a catenary.
   - Two or three lit stalls with a hanging lamp.
   - A lit clock or a sign on the guildhall.
   - These are the "few hero lights" that carry the Motorfest feeling; the rest
     of the town stays dark.

No bloom pass. Additive quads and a warm point light give the glow at a
fraction of the cost; a real bloom can come later if the look needs it.

### Performance

- Pools: 2 triangles each, near-only (1200 m), no shadows.
- Window quads: 2 triangles each, instanced with the building's near model;
  the far twin has none.
- Point lights: 8 in the shader, selected per frame; no per-light draw call.
- The town adds at most ~250k near vertices and ~80k far vertices; the city's
  street ribbons and pavements stay under ~120k.
- Low quality keeps the emissive heads and windows, drops the point lights and
  the pools.

## Variety across the island

The city is one character, not the whole island. Each settlement and region
gets a small style table:

| Region | Streets | Buildings | Trees | Ground |
| --- | --- | --- | --- | --- |
| East city | grid, wide, paved | tall, shops, guildhall, church | plane trees on the square, orchards outside | paving, gardens, arable |
| Southwest village | one main street, one cross lane | low, stone, church, smithy | apple trees, hedges | pasture, stone walls |
| Southeast harbour | quay, one lane | boathouses, fish market, net racks | wind-shaped pines, reeds | sand, dunes, wet meadow |
| North high country | pass road only | none | conifer treeline | rock, alpine meadow, snow |
| West farm belt | farm lanes | barns, silos, windmill | hedgerows, orchard rows | arable parcels |
| South wetland | boardwalk, one lane | none | willows, reeds | pond, marsh, meadow |

The style table chooses models, colours and props; it does not change where a
settlement is. The same city is in the same place in every biome and on every
client.

## Data model

```js
// layoutSettlement({ id, kind, center: [x, z], radius, seed, terrain, roads })
{
  kind: "city",
  center: [2400, -950],
  streets: [{ id, kind: "street", points: [[x, z], ...], width: 7 }],
  blocks: [{ id, streets: [...], plots: [...] }],
  plots: [{ x, z, yaw, width, depth, use: "house" | "shop" | "garden" | "church" | "guildhall" | "workshop" }],
  square: { x, z, width, depth, yaw },
  props: [{ role, x, z, yaw }],
  lights: [{ x, y, z, colour, radius, intensity }],
}
```

`buildSettlement` turns that into meshes and instance batches. It reuses the
existing `chunks.village`/`villageFar` groups, plus a new `chunks.glow` for
pools and string lights and a `scene.lights` list for the renderer.

## Testing

- `layoutSettlement` is pure: same seed → same streets, blocks, plots, props.
- A city has at least 3 streets, 2 junctions, a square, a church and 40 plots.
- A village has 1–2 streets and no grid.
- No plot overlaps another, a street, the river or the ridden road's clear
  width.
- A street never runs through a building; a building never stands in a street.
- The city's square is reachable from at least two streets.
- A settlement is the same in temperate and winter.
- Lighting: at dusk the lamp and window colours are in `bright`, the pools are
  in `glow`, and the light list is non-empty; at day the pools are empty and
  the bright intensity is low.
- Performance budget: the city's near vertices stay under the budget in a
  headless build.

## Open questions

1. Do we add a real **night** time of day (darker than dusk), or is dusk
   enough? Dusk is the current darkest and is the best fit for warm lights.
2. Should the city have a **wall or gate**, or stay open? An open market town
   fits the island better; a gate is a strong landmark but a lot of geometry.
3. Do we add **moving people** in the city now, or keep this PR static and let
   the Living tier add movement later?
4. How much of the city should be visible from the `rolling-hills` route? The
   route starts at the café; the city should read from the first 500 m, but the
   rest can be seen from the drone.

## Non-goals

- No new art assets beyond the existing CC0 kits.
- No change to the road network's rideable geometry; new streets are scenery.
- No change to physics, bots or route timing.
- No post-processing bloom in this pass.
