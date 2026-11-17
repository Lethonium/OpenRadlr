# Farms and nature from Quaternius — design

**Issue:** #117 (scenery spike, PR #119)
**Date:** 2026-11-17

## Goal

Make the island fuller with better trees and working farms, using CC0
Quaternius packs, without changing the world when scenery is off. This is the
first density step: farms and buildings count as density, not decoration.

## What ships in this round

- A `quaternius-nature` kit: 17 Ultimate Nature models (pines, common and
  birch trees, willows, bushes, rocks), near models plus decimated far twins.
- A `quaternius-farm` kit: 13 LowPoly Farm Buildings (barns, silos, windmill,
  water tower, well, fences, chicken coop), near models plus far twins.
- Farmsteads built from those models where the procedural world already puts
  farms: a barn, a farmhouse, a silo, a well, fences and a windmill on some
  farms. The procedural hay bales and grazing animals stay.
- A `quaternius` scenery level (nature + Kenney village + farm kit) beside the
  existing Kenney `models` level, so the two can be compared. It is a test
  level for this round, not a promise to replace Kenney.
- A fixed `detailDensity`: a kit that holds no tufts or flowers must not thin
  the biome's own ground detail.
- Screenshots and cost numbers in PR #119.

## What does not ship in this round

- The life layer (people, animals at cafés, boats, walkers).
- A city or larger town; the pipeline supports another building kit, but the
  style decision comes after this round.
- Wind sway, land-aware ground colour, and a per-instance visibility range.

## Kit pipeline

`tools/scenery/assemble-quaternius.mjs` builds a kit from a pack's OBJ folder:
it imports the selected models, decimates a far twin per model, writes
`<name>.geo.json`, and writes `manifest.json` with roles, target heights,
provenance and licence. It is data-driven, so the farm pack and a later
medieval/city pack use the same path.

Roles that a village already uses (`houses`, `windmills`, `fences`) are not
reused for farms. The farm kit names its own roles (`farmBarns`, `farmSilos`,
`farmWindmills`, `farmWells`, `farmFences`, `farmCoops`) so the Kenney village
keeps its own models and the farm can use Quaternius ones.

## Farmstead layout

At each procedural farm site, keep the existing orientation and footprint:

- barn (role `farmBarns`) at the centre,
- farmhouse (Kenney `houses`) beside it,
- silo (`farmSilos`) at the yard edge,
- well (`farmWells`) near the house,
- a few fence panels (`farmFences`) along the yard,
- a chicken coop (`farmCoops`) on some farms,
- a windmill (`farmWindmills`) on one farm in three,
- hay bales and animals as they are today.

Every building is placed into `farm`/`farmFar` chunk groups, drawn near and
far at the same transform. The farm group splits at the same distance as the
village (350 m). Scenery off keeps the procedural farm untouched.

## Determinism and cost

Farm sites come from the existing seeded stream. Model choices use a separate
seeded stream, so turning the kit on does not move the farms. The kit's far
twins are decimated at a more aggressive cell than the current 0.08 (start at
0.18–0.20), because the far wood is what made the first Quaternius test cost
3.4× Kenney at the forest.

Acceptance: build/upload in the same order as Kenney, visible vertices at the
forest below ~1.5M, and no farm model over ~1.5k triangles in the far group.

## Licence

Both packs are CC0. The nature pack's own `License.txt` is copied beside the
kit; the farm pack's page states CC0 and the kit records that provenance.
`make scenery-check` must pass.

## Reference

`docs/superpowers/specs/2026-11-17-cykelapp-feel-reference.md` records what
makes Cykelapp feel fuller: scatter density, many prop kinds, per-kind
visibility ranges, far silhouettes, and a life layer. This round takes the
first two: more kinds of things (farms, buildings) and better trees. The life
layer is the next round.
