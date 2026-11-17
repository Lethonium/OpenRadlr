# Towns, cities and town light — implementation plan

Date: 2026-11-17 · Issue: #117 · Design:
`docs/superpowers/specs/2026-11-17-towns-and-lighting-design.md`

Work in small, test-first steps. Each step ends with `make check` green and a
screenshot in PR #119. The island stays deterministic and scenery off stays
exactly as it is.

## Step 0 — the map and the high country (done)

- [x] Draw a top-down land-use map from the seeded land (`client/worldMap.mjs`).
- [x] Show bare rock above the treeline and permanent snow above the snowline.
- [x] Fix the canopy's road distance: `distanceToRoad` only reaches ~170 m, so
      the 60–420 m canopy was a 60–170 m belt. `RoadIndex.distance` now searches
      far enough, and the canopy uses it.
- [x] Keep trees off the treeline and the rock faces; keep farms off the high
      country.
- [x] Add the annotated proposal map (`--proposal`).
- [ ] Update PR screenshots with the new land-use and proposal maps.

## Step 1 — settlement data and layout (pure, no meshes)

**Files:** `client/public/js/land/settlement.js` (new),
`client/public/js/land/settlementLayout.js` (new),
`client/test/settlementLayout.test.js` (new).

- [ ] Define `SETTLEMENT_KIND` (`city`, `town`, `village`, `harbour`,
      `hamlet`) and a `settlementAt(kind)` style table.
- [ ] `layoutSettlement({ kind, center, radius, seed, terrain, roads })`:
      - build the local frame from the first main road;
      - lay out streets (main, street, lane, alley, quay) with widths;
      - split blocks into plots with frontage rules;
      - reserve the square, church, guildhall, café and any existing café;
      - return streets, blocks, plots, square, props and lights as plain data.
- [ ] Determinism test: same seed → deep-equal layout.
- [ ] City test: ≥3 streets, ≥2 junctions, a square, a church, ≥40 plots.
- [ ] Village test: 1–2 streets, no grid, ≤25 plots.
- [ ] Overlap test: no plot overlaps another, a street, a river or the ridden
      road's clear width.
- [ ] Terrain test: no plot on a slope over 0.35 or a ground range over 2.5 m.
- [ ] Same layout in temperate and winter.

**Acceptance:** `node --test test/settlementLayout.test.js` green; no renderer
involved.

## Step 2 — street and block meshes

**Files:** `client/public/js/view3d/settlement.js` (new),
`client/public/js/view3d/world.js`, `client/test/settlementBuild.test.js`.

- [ ] `buildSettlement(layout, { terrain, structures, into, palette, biome })`.
- [ ] Street ribbon: sample the ground, crown 0.08 m, pavement 2.4 m, kerb.
- [ ] Junction pad: rounded polygon at each junction; pavements turn the
      corner.
- [ ] Square: paving grid, fountain, benches, stalls, lamps, trees.
- [ ] Buildings: use the kit's roles, fall back to procedural houses.
- [ ] Near/far: buildings and their twins into `chunks.village` /
      `chunks.villageFar`; small props near-only.
- [ ] Test: a street is above the ground, below the rider, and does not cross a
      building; a building sits on the lowest ground under it.
- [ ] Test: the city's near vertices stay under 250k.

**Acceptance:** a screenshot from the saddle at the city approach shows at
least two streets and a junction; the drone shows a grid.

## Step 3 — put the city on the map

**Files:** `routes/maps/valley.json`, `client/public/js/route/network.js`,
`client/public/js/view3d/world.js`, `client/test/settlementWorld.test.js`.

- [ ] Add `settlements` to `RoadNetwork` (`this.settlements`).
- [ ] Add the valley settlements:
      - `hilltop` city at `(2400, 950)` radius 420;
      - `southwest` village at `(-350, -2190)` radius 260;
      - `harbour` at `(4900, -4050)` radius 300 (map y is −world z).
- [ ] Build every settlement once, whichever route is ridden.
- [ ] Remove or shrink the overlapping village zones so the city does not get
      a second strip (`hill-road` 1919–2249, `orchard-lane` 90–420,
      `hill-north` 90–420).
- [ ] Keep the café on the square and its approach clear.
- [ ] Test: the city is in the same place on every route; scenery off has no
      settlement.

**Acceptance:** riding `rolling-hills` from the start passes through the city;
the drone at the café shows the grid and the square.

## Step 4 — the city's character

**Files:** `client/public/js/view3d/settlement.js`,
`client/public/js/view3d/scenery/village.js`, `client/test/settlementCity.test.js`.

- [ ] Market square: café, guildhall, church, market stalls, fountain, benches,
      trees, lamps.
- [ ] Shop frontages: awnings, signs, a few taller models.
- [ ] Workshops and yards on the lowest block.
- [ ] Gardens and orchards on the edge.
- [ ] Junction places: a lamp, a name board, a bench, a tree.
- [ ] City style table: taller models, denser plots, paving, plane trees.
- [ ] Test: the square has at least 6 props and 2 buildings; the city has at
      least 3 shop plots and 2 workshop plots.

**Acceptance:** the city reads as a town, not a village strip, from the saddle
and the drone.

## Step 5 — the southwest village and the harbour

**Files:** `routes/maps/valley.json`,
`client/public/js/view3d/settlement.js`, `client/test/settlementVillage.test.js`.

- [ ] Southwest village: green, church, farm lane, one cross lane, stone walls,
      orchard.
- [ ] Harbour: a new lane from the southeast road to the bay, quay, boats,
      fish market, net racks, dunes, reeds.
- [ ] Harbour lane is scenery, not a rideable road; it does not change the
      network's routes.
- [ ] Test: the harbour has a quay, ≥3 boats and a lane that reaches the water;
      the village has a green and a church.
- [ ] Test: neither settlement enters the river or the sea.

**Acceptance:** screenshots of the village and the harbour.

## Step 6 — town light

**Files:** `client/public/js/view3d/lighting.js` (new),
`client/public/js/view3d/renderer.js`, `client/public/js/view3d/view3d.js`,
`client/public/js/view3d/world.js`, `client/test/townLight.test.js`.

- [ ] Window quads: 2–4 per street-facing facade, seeded on/off, into `bright`.
- [ ] Lamp heads: keep in `bright`; raise dusk brightness to 1.0.
- [ ] Ground pools: additive radial quads into a new `chunks.glow`; radius
      6–9 m for lamps, 2–3 m for shop windows; dusk only.
- [ ] Point lights: up to 8 nearest, in the opaque shader; High quality only.
- [ ] Market lights: string bulbs across the square, lit stalls, one lit clock
      or sign.
- [ ] Day: pools empty, bright intensity low. Dusk: pools and lights on.
- [ ] Test: at dusk the light list is non-empty and the pools are in `glow`;
      at day the pools are empty.
- [ ] Test: the nearest 8 selection is stable and does not flicker.

**Acceptance:** a dusk screenshot from the saddle shows warm pools on the
street and lit windows; a day screenshot shows neither.

## Step 7 — variety pass, borrowing the Living distribution

**Files:** `client/public/js/land/groundGrid.js` (new),
`client/public/js/land/fields.js` (new, adapted from
`view3d/living/fields.js`), `client/public/js/land/settlement.js`,
`client/public/js/view3d/settlement.js`,
`client/public/js/view3d/biomes/temperate.js`,
`client/test/landFields.test.js`.

- [ ] Port `groundGrid` (height, slope, river, road distance on a coarse grid)
      and the road-distance field that saturates at 800 m.
- [ ] Port the parcel layout: blocks turned along the nearest road, one crop per
      parcel, block-level crop bias, hedges and tracks on the edges.
- [ ] Use the parcels for placement and ground colour, **not** a flat texture:
      crop colours, hedge lines, orchard rows and farm tracks.
- [ ] Height bands: farm (0–55 m), rough pasture (55–95 m), moor/heath
      (95–205 m), rock (205–330 m), snow (330 m+), coast/sand.
- [ ] Style tables for city, village, harbour, hamlet.
- [ ] Tree species and ground cover per region (plane trees, apples, pines,
      willows, reeds).
- [ ] West farm belt: cluster farms, hedgerows, orchard rows, tracks.
- [ ] South wetland: pond, reeds, willows, boardwalk.
- [ ] North high country: treeline, alpine meadow, snow.
- [ ] Test: two settlements of different kinds do not share the same building
      mix or tree mix.
- [ ] Test: the same parcel data gives the same ground colour and the same
      hedges in the world and on the map.

**Acceptance:** the proposal map's eight regions each read differently in the
drone.

## Step 8 — docs, screenshots, check

- [ ] Update `docs/protocol.md` only if a protocol field changes (it should
      not).
- [ ] Add an ADR for the settlement layer (data, determinism, lighting).
- [ ] Update `CHANGELOG`? No: Release Please writes it from the PR title.
- [ ] Add screenshots to PR #119:
      - land-use map with rock and snow;
      - annotated proposal map;
      - city from the saddle and the drone;
      - village and harbour;
      - dusk city with lights, day city without.
- [ ] `make check` green (lint, client tests, Rust tests, scenery check).
- [ ] Keep the PR draft until the user has seen the city.

## Risks

- **Performance:** a grid adds streets and buildings. Keep the city under the
  vertex budget and use near/far twins; measure with `sceneryBench.mjs`.
- **Terrain:** a hilltop grid needs terraces. Skip steep plots rather than
  flatten the island.
- **Determinism:** the layout must not depend on route order. Build it from the
  settlement seed, not from the world's build order.
- **Lighting:** point lights in the shader can cost; keep 8 and make them High
  quality only. Pools and emissive windows carry Low.
- **Existing zones:** the city must not get a second strip from the old
  village zones. Remove or shrink them in the same commit.

## Order of work

1. Layout data and tests (no visible change).
2. Street/block meshes behind a flag or a new settlement kind.
3. Put the city on the map and remove the old strips.
4. City character.
5. Village and harbour.
6. Lighting.
7. Variety.
8. Screenshots and PR.

Start with step 1 and 2; the city is the largest visible win.
