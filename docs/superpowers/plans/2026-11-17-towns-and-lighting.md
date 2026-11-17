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
- [x] Update PR screenshots with the new land-use and proposal maps.

## Step 1 — settlement data and layout (pure, no meshes) — done

**Files:** `client/public/js/land/settlement.js` (new),
`client/test/settlementLayout.test.js` (new).

- [x] Define `SETTLEMENT_KIND` (`city`, `town`, `village`, `harbour`,
      `hamlet`) and a `SETTLEMENT_STYLE` table.
- [x] `layoutSettlement({ kind, center, radius, seed, terrain, roads })`:
      - build the local frame from the nearest main road;
      - lay out streets (main, street, lane, alley, quay) with widths;
      - split blocks into plots with frontage rules;
      - reserve the square, church and café;
      - return streets, blocks, plots, square, props and lights as plain data.
- [x] Determinism test: same seed → deep-equal layout.
- [x] City test: ≥8 streets, ≥12 junctions, a square, ≥40 plots.
- [x] Village test: fewer streets and plots, no grid.
- [x] Overlap test: no plot overlaps another, a street or the square.
- [x] Terrain test: no plot on a slope over 0.35 (the layout checks it).
- [x] Same layout in temperate and winter (the layout takes no biome).

**Acceptance:** `node --test test/settlementLayout.test.js` green; no renderer
involved.

## Step 2 — street and block meshes — done (first pass)

**Files:** `client/public/js/view3d/settlement.js` (new),
`client/public/js/view3d/world.js`, `client/test/settlementBuild.test.js`.

- [x] `buildSettlement(layout, { terrain, structures, into, palette, biome })`.
- [x] Street ribbon: sample the ground, pavement 2.4 m. The 0.08 m crown and
      kerb are still to add.
- [x] Junction pad: rounded polygon at each junction.
- [x] Square: paving grid, fountain, benches, stalls, church, windmill, lamps.
- [x] Buildings: use the kit's roles, fall back to procedural houses.
- [x] Near/far: buildings and their twins into `chunks.village` /
      `chunks.villageFar`; small props near-only.
- [ ] Test: a street is above the ground, below the rider, and does not cross a
      building; a building sits on the lowest ground under it.
- [ ] Test: the city's near vertices stay under 250k. Measured 1.0M near with
      188 detailed houses; the budget needs a decision.

**Acceptance:** a screenshot from the saddle at the city approach shows at
least two streets and a junction; the drone shows a grid.

## Step 3 — put the city on the map — done for the city

**Files:** `routes/maps/valley.json`, `client/public/js/route/network.js`,
`client/public/js/view3d/world.js`.

- [x] Add `settlements` to `RoadNetwork` (`this.settlements`).
- [x] Add the Hilltop city at `(2400, 950)` radius 420.
- [x] Add the southwest village at `(-350, -2190)` and the harbour at
      `(4450, -4125)` (map y is −world z). The harbour moved to the bay the
      terrain actually has.
- [x] Build every settlement once, whichever route is ridden.
- [x] Skip the overlapping village zones when scenery is on, so the city does
      not get a second strip (`hill-road` 1919–2249, `orchard-lane` 90–420,
      `hill-north` 90–420, `rolling-hills` 90–420).
- [x] Keep the café on the square and its approach clear (occupancy).
- [x] Test: the city is in the same place on every route; scenery off has no
      settlement (`test/settlementWorld.test.js`).

**Acceptance:** riding `rolling-hills` from the start passes through the city;
the drone at the café shows the grid and the square.

## Step 4 — the city's character — first pass

**Files:** `client/public/js/view3d/settlement.js`,
`client/public/js/view3d/scenery/village.js`, `client/test/settlementCity.test.js`.

- [x] Market square: café, church, market stalls, fountain, benches, lamps.
      A guildhall is still a large house, not its own role.
- [ ] Shop frontages: awnings, signs, a few taller models.
- [ ] Workshops and yards on the lowest block.
- [ ] Gardens and orchards on the edge (a few garden trees are in).
- [x] Junction places: a lamp at each junction.
- [x] City style table: denser plots, paving, taller kit models.
- [ ] Test: the square has at least 6 props and 2 buildings; the city has at
      least 3 shop plots and 2 workshop plots.

**Acceptance:** the city reads as a town, not a village strip, from the saddle
and the drone.

## Step 5 — the southwest village and the harbour

**Files:** `routes/maps/valley.json`,
`client/public/js/view3d/settlement.js`, `client/test/settlementVillage.test.js`.

- [x] Southwest village: a green with a fountain, a church, and a cross lane
      off the main road.
- [x] Harbour: a new lane from the southeast road to the bay, a quay, a jetty,
      four boats, and a fish-market square with stalls at the quay.
- [x] Harbour lane is scenery, not a rideable road; it does not change the
      network's routes.
- [x] Test: the harbour has a quay, ≥3 boats and a lane to the road; the
      village has a green and a church.
- [x] Test: neither settlement enters the river or the sea (on the real map).
- [ ] Still open, not in this pass: stone walls and an orchard in the village;
      net racks, dunes and reeds at the harbour.

**Acceptance:** screenshots of the village and the harbour. Done:
`client/sceneryShot.mjs` for the 3D shots, `client/settlementMap.mjs` for the
layout diagrams.

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
