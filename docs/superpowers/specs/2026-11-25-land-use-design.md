# Land use: a believable island from the drone — Design

Part of the polished world (`docs/superpowers/specs/2026-11-23-three-js-world-design.md`), after step 4 part 3
(`docs/superpowers/specs/2026-11-24-move-features-design.md`). Same branch and PR (`feat/polished-world`).

## Intent

The owner looked at the start menu's drone view of the new world and found it strange:

- The old drone view had much more fog. The island felt larger and more real. Now the edges of the square ground
  tile show against the sea at the horizon.
- From above, crop fields only lie along the roads. That reads as fake from the menu, and likely from the ride's
  follow drone too. From a rider's eye it is less obvious.
- Fields are everywhere, the coast included. The land needs a believable distribution and enough variety of
  landscapes and themes.

The target look is **a mix of a real island aerial view and the old drone view** (owner, 2026-11-25): the old
view's
thick blue haze and fine, even patchwork of greens and tans; a real Mediterranean island's structure (small
irregular fields in the plains around villages and farms, terraces and orchards on the lower slopes, pine woods and
scrub higher up, scrub, pines and dunes along the coast, no ploughland on the shore). Old shot:
`~/.cache/openradlr/screenshots/baseline/menu-island.png` (pr-screenshots `polished-world/before/`).

Success: the menu drone, the ride's follow drone and the rider's view all show land use that is spread over the
whole island, varies by region, and does not follow the roads; the island fades into haze instead of ending in a
square; frame cost stays within budget.

## Goals

- One land-use plan covering the whole island, not only the road sides.
- Distribution by region kind, distance to the coast, slope, height and nearness to villages and farms.
- Variety: arable fields (seasonal crops as today), pasture, orchards (olive, almond, fruit by region), vineyards,
  scrub (garrigue), dunes and beach grass at the shore, fallow; parcel edges as dry-stone walls (Mediterranean
  regions) or hedgerows (green interior).
- Drawn cheaply far away (painted into the ground), planted near the camera (crops, tree rows, walls, bushes) with
  the reach set per quality level.
- More fog in the menu drone view, and no visible ground-tile edge from any camera.

## Non-goals

- No new region system: the regions of step 3 (#127: meadow, farmBelt, deepWood, wetland, highCountry, pineCoast,
  oliveTerraces, lavenderFields, almondValley) stay and drive the mix.
- No changes to roads, rivers, towns, landmarks or the farmsteads' own buildings; farms keep their place logic but
  now take their fields from the land-use plan.
- No new crop assets beyond what the planted kinds need (an orchard tree row, a vine row, a wall/hedge segment and a
  scrub bush may reuse or extend the nature assets).
- The spin studio and the adapter deletion stay in step 4 part 4.

## Anti-goals (a failure even if it works)

- Fields that still read as ribbons along the roads, from the menu or the follow drone.
- One uniform look everywhere (the same patchwork on the coast, in the mountains and in the plain).
- A ground edge or square silhouette visible at the horizon.
- Low or Medium draw calls more than 10 % above `move3/after.txt` (Low 451, Medium 811) on the ride; a menu that
  drops frames it did not drop before.
- Fog so thick that the island's shape is lost: the far coast stays readable as a silhouette (why `droneLens` thins
  the haze for big islands today).

## Constraints

- Layering per `client/layering.mjs`: the plan lives in `world/plan/` (pure, runs in the world worker, seeded,
  no Three.js); drawing in `view3d/assets/` and `view3d/scene/`.
- Deterministic by world seed; no `Math.random`.
- Quality levels Low/Medium/High/Ultra; devices below Low use 2D.
- The plan must stay fast enough for the worker on the big maps (`ground.huge`), and its data small enough to post
  to the page.

## Approaches

1. **Paint only.** A land-use map painted into the terrain colour; 3D fields near the roads taken from it. Cheapest;
   from the follow drone, land away from the road is flat colour.
2. **Parcels over the whole island, painted far and planted near (chosen by the owner).** Every parcel is plan data
   with its kind and edges; far away it is paint, within reach it gets its crops, tree rows, walls or bushes. Best
   from every camera; more work and more draw calls near the camera, bounded by quality reach.
3. **Tune what exists.** More fog, no coastal fields, more scattered field spots. Quick, but fields are still
   seeded from the roads, so the drone still shows the pattern.

Built in two steps: **A** the plan, the paint and the fog (fixes the menu view on its own), then **B** the planting
by distance, measured against the draw-call budget.

## Design

### A1. Land-use plan (`world/plan/landUse.js`)

- Parcels cover the land inside the island bounds: irregular, roughly rectangular shapes of real field sizes
  (about 40–200 m), from a seeded subdivision (e.g. jittered blocks split along a local grain that follows the
  terrain and nearby roads, so fields line up with tracks the way real ones do), clipped by the existing masks
  (road, river, built, verge) and the sea.
- Each parcel gets a kind from a weighted mix: region kind (its `fieldShare` and crop lists stay the base),
  distance to the shore (a coastal band of scrub, pine and dunes with no arable or orchard), slope and height
  (terraces and orchards on lower slopes, pasture, scrub and woods higher, no ploughing on steep ground), and
  distance to villages and farms (farmland clusters around them and thins out away from them; wild land between).
- Woods (`planWoods`) and the land use agree: a parcel planned as wood is the woods' business; woods do not stand on
  fields.
- `planFields` is replaced: today's `Field` list becomes the arable parcels near enough to be planted, so the crop
  layer, stalks, farms and fauna keep their inputs. Fields are no longer seeded from road samples.
- Output: parcel list (kind, crop for the season, corners or polygon, edge kind) plus what the paint needs.

### A2. Paint

- The ground colour comes from the land-use plan everywhere, with a fine mottling (the old view's even patchwork)
  inside each kind and a slight per-parcel tint so neighbours differ.
- The near ground grid is 16 m per vertex (144 m on huge maps), too coarse for parcel edges, so the paint is a
  land-use texture built in the worker (a few metres per texel, capped in size) and sampled by the terrain shader;
  the masks' earth painting goes into the same texture.

### A3. Fog and the edge

- The menu drone's haze gets thicker, tuned against the old baseline shot and a real aerial, while the far coast
  stays a readable silhouette.
- The ground never ends in a visible square: the far grid reaches the fog's end, or the land fades into the sea
  colour before its edge, whichever is cheaper; checked from the menu drone, the follow drone and the ride.

### B. Planting by distance

- Within a quality-set reach, parcels get their 3D content: arable as today's draped fields and stalks; orchards and
  vineyards as instanced rows; walls and hedges as instanced segments along parcel edges; scrub and dune grass as
  instanced bushes. Beyond reach: paint only.
- Draw calls stay bounded: field meshes merged per chunk (today each field is its own mesh), instanced rows and
  segments per kind and chunk, chunks built and dropped as the camera moves, as the plant chunks do today.
- New quality key (name the builder's call) with the planting reach per kind and level; Low plants the least.

## Verification

- Node tests for the plan: no arable or orchard parcel in the coastal band; parcels cover land away from roads (a
  share of arable parcels lies more than 300 m from any road); kinds follow region, slope and distance as specified;
  deterministic by seed; no parcel on roads, rivers, built ground or the sea.
- Shots (High, summer, day, then one autumn and one winter): the menu drone next to the old baseline, the ride's
  follow drone, a rider's view in farmland, on the coast and on a slope; workbench for any new asset.
- Draw calls on the ride per level against `move3/after.txt`; the menu's frame time before and after.

## Calls made for the builder (marked as the designer's, not the owner's)

- **Coverage and size:** the plan covers every land cell of the world's bounds (the valley map today; tracks and
  huge maps the same way). Two outputs: the land-use texture for the whole island (one per world, at most
  2048 × 2048 texels; on bigger islands a texel covers more ground) and the full parcel list as typed arrays (kind,
  crop, corners, edge kind), a few MB at most. No polygons beyond quads.
- **Who picks what is planted:** the plan holds every parcel; the planting layers pick by camera position and the
  quality's reach each time their chunks rebuild, so the follow drone and the menu drone get planted parcels away
  from roads too. Farms keep their logic but take arable parcels near a road (they need a drive); fauna takes the
  arable and pasture parcels as its fields and meadows.
- **Woods:** `planWoods` keeps its placement and runs after the parcels, as it runs after the fields today: it
  fills the land no parcel took ("wild" land), so woods and parcels never overlap. "Wood" is not a parcel kind.
- **Terrain material:** the terrain layer's near tiles and far mesh may change their material (both sample the
  land-use texture), including the night, weather and season paths.
- **Frame budget:** the menu's draw calls and triangles are measured before and after with the same headless probe
  (`?stats`) and may grow at most 10 % (software GL frame times are too noisy to budget). Ride draw calls: Low and Medium at most +10 %, High and Ultra at most +15 % over
  `move3/after.txt`.

## Left to the builder

- Season looks of the new kinds (vineyard, orchard, scrub, dunes) in all four seasons.

- The subdivision algorithm, parcel sizes, the exact weights per region kind, colours and texture resolution.
- Whether the edge fix is more far grid or a fade into the sea.
- Names of modules, data fields and the quality key.
