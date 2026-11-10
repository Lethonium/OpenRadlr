# Living island — design

Date: 2026-11-09 · Issue: #48 · Status: agreed in discussion, awaiting spec review

## Goal

From the drone the island looks empty and its ground is an obvious noise
pattern. A new world tier, **Living**, makes the island look inhabited, with
some movement and a few playful surprises. It does not have to be realistic.
The island's shape, hills and roads stay as they are.

Riders pick it beside 2D and 3D. Plain 3D stays exactly as it is today, so
weaker hardware simply uses 3D.

## Decisions

| Question | Decision |
| --- | --- |
| What "life" means | Lived-in land first, plus ambient movement and a few playful touches |
| Where the setting lives | A third view choice: `2D · 3D · Living`. The High/Low graphics toggle is unrelated and stays |
| Default | On for desktops and laptops; off for phones and devices reporting under 4 GB of memory. An explicit choice wins |
| Ground technique | One generated ground map per island, read by the terrain shader |
| Biomes | Temperate first. Winter renders like plain 3D until a follow-up |
| Sky fix from #47 | Applies in Living only |
| Relation to #47 | Living is a step on the ladder `2D → 3D → Living`; a later style can sit above it and build on it |

## Today, measured

The valley map (island about 13 km across, radius 6577 m) has 4.72M vertices in
chunks: scenery 1.81M, terrain 0.90M, detail 0.70M, structures 0.70M, road
0.61M. The renderer has no instancing.

| What you see | Cause |
| --- | --- |
| Camouflage blobs from the drone | `terrainColor` in `biomes/temperate.js`: one 85 m value noise cut into five bands, coloured per 16–48 m triangle |
| Only ground colour from the high orbit | Scenery stops at about 3 km from the camera (`SCENE.drawDistance` × lens reach) |
| Flat grey-green high ground | Blend to one colour between 85 and 140 m above sea level |
| Empty land at road level | `buildScenery` sprinkles single trees; no woods, hedges, fences, tracks or orchards |
| Black spikes beside the road | Grass tufts render almost black |

## The setting

- `viewControls` offers `2d`, `3d` and `living` as modes, in that order. The View popover and
  the menu's View page show them; the studio is unchanged.
- `app.viewMode` stays `"3d"` for both 3D and Living, so existing checks and
  saved `openride.view` values keep working. A separate `openride.living`
  (`"on"` / `"off"`) holds the choice. The popover's selected option is derived
  from both.
- The 2D/3D shortcut (`toggleView`) flips between 2D and whichever 3D look the
  rider last used.
- `livingDefault({ deviceMemory, coarsePointer })` is pure and is used only
  while the key is unset: off when `deviceMemory < 4` or on a phone-like device
  (coarse pointer, narrow screen); otherwise on. A browser that does not report
  memory counts as enough. A saved `openride.view` of `3d` is not a choice
  about Living.
- Labels live in `i18n/en.js` and `de.js`, with the button named "Living".

## Building

- `buildScene(routeFile, others, { network, biome, living })` passes the flag
  to the worker. `buildWorld` adds `scene.living`:
  `{ groundMap: { width, height, data, x0, z0, size }, movers }`, and a `life`
  group in `chunks`. All plain data with typed arrays, so `transferList` hands
  it over without copying.
- Changing the setting rebuilds the world like a season change:
  `buildRideWorld` also re-checks `app.living`, and `MenuStage`'s build key
  gains the flag. The old world keeps showing until the new one is ready.
- A biome opts in with a `biome.living` hook carrying crop colours, models and
  counts. Without one, `buildWorld` builds the plain world.

### New modules in `view3d/living/`

All pure, running in the worker and under `node --test`.

| Module | Does |
| --- | --- |
| `fields.js` | Parcel layout and crops, exported as data |
| `groundMap.js` | Paints the 2048² texture |
| `dressing.js` | Woods, hedges, walls, orchards, fences, props |
| `coast.js` | Beach and harbour objects |
| `movers.js` | Mover lists and `moverPose(mover, timeS)` |
| `whimsy.js` | Playful landmarks and roadside scenes |

### Where Living falls back to plain 3D

The scene has no `living` part and the view choice shows a short note
(`view.livingUnavailable`, like the existing "3D unavailable" one) when:

- the biome has no `biome.living` hook (Winter for now),
- the world has no road network map, or
- the island's box is longer than 16 km on a side (one 2048² map would be coarser than 8 m per pixel), such as the 180 km Lanzarote route.

## Fields and ground map

**Layout (`fields.js`).** A seeded pattern of straight-edged parcels covers the
land, each roughly 80 to 200 m across and turned to follow the nearest road.
Each parcel gets one crop from a per-parcel random draw with a gentle regional
bias. The layout is data: hedges sit exactly on the painted edges.

| Area | Look |
| --- | --- |
| Lowland farmland | Meadow, pasture, wheat, yellow rapeseed, ploughed earth, hay with mown stripes, a few lavender and sunflower fields |
| Beside rivers | Lusher, wetter meadow, no crop fields |
| Near villages | Small garden and allotment plots |
| Foothills | Fields thin out into rough pasture with irregular patches |
| High ground | Heather, moorland and scree bands; bare rock on steep slopes |
| Coast | Dry sand, darker wet sand at the waterline, dune grass behind the beach |
| Woods | A dark, mottled canopy painted in, so forests read from the high orbit |

**Painting (`groundMap.js`).** One RGBA8 2048² texture covers the island's box:
about 6.5 m per pixel and about 22 MB with mipmaps on the valley map. Crops get
row and furrow lines along the parcel; farm tracks are thin pale lines; the
giant bicycle (see Playful touches) is painted in. Heights and slopes come from
a coarse grid, not per-pixel terrain lookups. Alpha marks where the map
applies: zero underwater and outside the island, so the terrain keeps its
vertex colours there.

**Shader.** A terrain-only flag selects the lookup from `v_world.xz`. The map
replaces the terrain colour *before* lighting, so sun, shadows, fog and time of
day work as now and the facets stay visible. Within about 150 m of the camera a
cheap noise adds fine speckle, so the ground does not look like a blurry 6.5 m
pixel grid when riding. Texture sampling is off unless a ground map is bound.

Roads, heights and river courses do not change.

## Static dressing

Anything a rider passes close to gets real objects. Anything far away is
covered by the ground map.

| Item | Where | Vertex budget |
| --- | --- | --- |
| Woods | Dense clusters of cheap one-piece trees, detailed trees only at the edges | 400k |
| Hedges and stone walls | About a third of field edges within 450 m of a road: hedges in the lowlands, dry-stone walls on rough pasture, coarser pieces further out | 400k |
| Farm and village props | Hay bales in hay fields, scarecrows, beehives, gates, sheds, parked tractors, garden plots, benches, washing lines, market stalls, bunting across village streets | 200k |
| Orchards | Tidy rows of small fruit trees on some parcels near farms and villages | 80k |
| Fences | Around pastures and along farm tracks where they meet a road | 60k |
| Coast | Beach huts, parasols and towels, a wooden jetty near a village or café, moored boats, rocks at the waterline | 80k |
| Verges | Green grass and strips of wildflowers, using a Living version of the flora hooks | about net zero |

In Living, `buildScenery`'s `blocked` also rejects trees standing inside crop
parcels. Trees on hedge lines, in woods and in rough ground stay.

**Placement.** Everything uses today's clearance checks: off roads and verges,
out of rivers, away from buildings, cafés, gyms and statue rows, and off
junction sight lines. Bunting hangs well above rider height.

**Drawing.** The `life` group is drawn out to about 1.6 km, with shadows only
near the rider, as other small objects are. It also draws at Low quality and in
the menu.

## Movement

The worker produces a plain list of movers with path, speed and start phase.
The pure `moverPose(mover, timeS)` gives a position and rotation. Models are
shared and nothing rewrites buffers per frame. Movement is decorative and not
synced between riders.

| Mover | Behaviour | Count on the valley map |
| --- | --- | --- |
| Birds | Flocks circling over woods and fields, gulls near the coast, flapping by swapping two poses | 12 flocks |
| Sailing boats | Slow ovals offshore with a gentle bob | 10 |
| Tractors | Up and down a ploughed or hay parcel, turning at the ends | 8 |
| Villagers | Strolling the pavements, turning back at each end | 6–10 per village |
| Grazing animals | About a third of each herd wanders and pauses; the rest stay baked in | about 80 |
| Hot-air balloons | Slowly drifting high over the island | 3–5 |

**Limits.** At most 150 mover draw calls per frame, nearest first; balloons
always count. Riders with reduced motion get everything frozen. No mover enters
or crosses a road.

## Playful touches

Kept to a handful so they stay a surprise.

- A lighthouse on a headland with a turning beam that shows most at dusk.
- A giant bicycle mown into a large flat parcel beside a road, in the ground map, so it only reads from the drone.
- A sheep on top of a hay-bale tower, looking down at the riders.
- An escaped penguin waddling along a beach, reusing Winter's model.
- A scarecrow that waves as riders pass.
- About 8 small roadside scenes on the valley map, one every few kilometres: a circle of garden gnomes, a picnic with an oversized sandwich, a cow standing in a pond, and the like.

## Budgets

| Item | Limit on the valley map |
| --- | --- |
| Static dressing | about 1.2M vertices |
| Mover models and playful scenes | about 250k vertices |
| Reserve | about 200k vertices |
| Living in total | at most 1.65M added vertices (35% over today's 4.72M) |
| Extra world build time | target 3 s or less |
| Ground map | about 22 MB |
| Mover draw calls | at most 150 per frame |

## Testing

Plain `node --test`, no browser.

- With Living off, the built world is identical to today's.
- With Living on, heights, roads, zones, cafés, gyms and the overview match the plain world (the ADR 0018 invariants).
- The same seed gives the same fields, map and movers.
- Each parcel holds one crop; the map is empty under the sea.
- Nothing lands on a road or verge, in a river, or on a café, gym or statue row.
- Tractors stay in their parcel, villagers on pavements, boats at sea; reduced motion freezes movers.
- Living adds at most 1.65M vertices on the valley map; build time is recorded.
- `livingDefault`, a remembered choice, a saved `3d` not counting as a choice, and the Winter and huge-map fallbacks.

Visual checks: renders from fixed camera positions at day, golden hour and
dusk, against the before shots.

The development machine has no GPU, so vertex counts, draw calls and build time
are checked there, but real frame rates need a laptop and a phone. If Living is
too heavy, the per-item budgets are the levers.

## Docs

- ADR 0021: the generated ground texture and the Living tier.
- `CHANGELOG.md` under `[Unreleased]` with #48.
- English and German labels.

## Delivery

One PR from `feat/living-island`, as ordered commits that each pass `make check`:

1. Setting and plumbing, with no visible change
2. Fields, ground map, terrain shader and sky fix
3. Static dressing
4. Coast
5. Movers
6. Playful touches
7. Docs

Follow-ups, not part of this: a Winter version of Living, and further polish
listed in the PR.
