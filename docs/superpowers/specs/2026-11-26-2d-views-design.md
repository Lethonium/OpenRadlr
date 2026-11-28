# 2D views: the map and the side view, drawn from the 3D world

## Intent

Devices that cannot run the 3D world well ride in 2D. Today that is a plain top-down map with its own
symbols, which looks like a fallback, not like OpenRadlr. Both 2D views should feel like the game: the
same island, the same trees, houses, riders, seasons, time of day and weather as the 3D world, only drawn
flat.

Who it is for: devices that end up in 2D (`view3d/qualityPick.js`): almost all have WebGL2 but run under
~14 fps at Low (`UNUSABLE_MS = 70`); a few have no WebGL2 at all.

## Goals

- **Map** (top-down, heading up): the ground with its land use, hill shading, roads and rivers; real tree
  crowns and roofs from above with their shadows; riders, crowd and animals.
- **Side** (a layered side view, the owner's favourite): the road unrolled left to right by distance, up
  is height; the island beside the route in depth behind it; trees, houses, cafés, the crowd and the
  riders standing where they are along the road; a whole-route profile strip along the bottom.
- Both follow the season, time of day (with a real night) and weather settings like the 3D world.
- Every tree, building, animal, spectator and rider in 2D is a picture of the 3D asset, rendered on the
  device; no second set of 2D art.

## Non-goals

- The 2.5D isometric miniature view (parked; the sprite baker makes it cheap later: sprites taken at
  ~35°).
- Devices without WebGL2 get no sprites: they keep today's map (`view/rideMapView.js`).
- No new assets: what the 3D world lacks, 2D lacks.

## Anti-goals

- Rendering 3D every frame in 2D mode (that is what these devices cannot do).
- Drawn 2D symbols that drift from the 3D assets.
- Scenery that hides the riders.

## Constraints

- Plain ES modules, no build step; Canvas 2D for the views; Three.js only through `js/three.js` and only
  inside the sprite baker.
- Layering per `client/layering.mjs`; deterministic (no `Math.random`); UI text in `i18n/en.js` + `de.js`.
- Client tests stay plain node: pure planning code is tested directly, drawing against a fake 2D context.

## Approaches (decided with the owner)

1. **What the views draw from** — chosen: the 3D world's own plan and ground (the scene the world worker
   builds), so 2D always matches 3D. Rejected: keeping the 2D map's own light scenery (keeps drifting,
   every feature drawn twice).
2. **What the side view is** — chosen: a side view that follows the rider like a game, with depth.
   Rejected: a whole-route height chart as the view (reads like a chart; it survives as the bottom strip).
3. **How things look** — chosen: sprites rendered from the real 3D assets **on the device at load**
   (exact kits and seasons, no image files in the repo). Rejected: pre-rendered sprite sheets committed
   by a script (works without WebGL2, but several MB per season, regeneration on every asset change,
   riders only tinted).
4. **Camera height of the side view** — chosen: **low** (just above the road; hills rise behind). Mid and
   high were tried (more fields visible, flatter hills) and liked less.
5. **Houses on the near side of the street** — chosen: **left out**. Drawing them cut low in front (a
   stage set) was tried and read as roofless stumps.

A throwaway prototype of all of this is on the local branch `spike/2d-views` (`client/public/spike2d*.html`,
`js/spike2d/`); its numbers below are starting values, not tuned results. Shots:
`pr-screenshots/spike-2d/` (`s-sheet`, `s-sheet2`, `s-close`, `cam-sheet`, `tilt-sheet`, `stage-sheet`).

## Design

### The world data

The views take the same scene object the 3D view gets from `buildScene` (`view3d/worldScene.js`
`sceneOf`): `plan`, `ground` (`near` heights, normals and colours on a 16 m grid; `paint`, the land-use
paint on a 6 m grid), `roads`, `rivers`, `crowd`, `cafeSites`, `arches`, `furniture`, `studio`. It is
built in the world worker, so the ride does not stall. The side view needs the land's height beside the
route: it samples `ground.near.heights` (a function cannot cross the worker boundary). Measured: ~3 s on
the dev machine for the whole build including the ground grids; the grids are needed for the colours.

A pure index puts every placed thing in 48 m buckets by position (trees, rows, scrub, roadside props,
field edges, house plots with their facing, lamps, farms, landmarks, turbines, cafés, spectators, herd
animals). The side view also projects each thing near the route to `(distance along, lateral offset)`
once per map, with the road's direction there.

### The sprite baker

One module renders an asset once into a canvas and returns `{frames, ox, oy, ppm}` (`ox, oy`: the
asset's ground point in the image; `ppm`: pixels per metre).

- A hidden canvas and a `WebGLRenderer` with alpha; the scene and lights of `createWorldScene` (as the
  workbench uses them) with the sky, clouds and weather hidden; assets made through `WORKBENCH_ASSETS`
  with the season.
- Orthographic camera. **Side:** from the right of the road, pitch ≈ 0.16 rad, no ground shadow (it
  reads as a slab edge-on). **Top:** straight down, world x right and z down, with a shadow-catcher
  ground (`ShadowMaterial`) sized to the shadow box, so each sprite carries its real shadow and the map
  draws it unrotated (the sun stays put when the map turns).
- What is baked per season:
  - plants and props by plant id (trees, olive, almond, cypress, bush, lavender, rock, hay bale, bench,
    cart, …): side and top;
  - houses per style: side at 7 turns, top at 12 yaws; farmstead, bike café, street lamp, lighthouse,
    windmill, turbine, castle; spectator; cow, sheep, horse, pig;
  - riders: the real cyclist in each rider's look, side as 12 pedalling frames, top as one frame; baked
    when a rider first appears.
- Baked lit by day; time of day is a tint over the land (below). Buildings that light up get a second,
  night bake with their windows glowing, used at dusk and night.
- Budget: the prototype baked ~130 sprites in ~20 s in headless software GL. **First step of the build:
  a probe page that bakes the full set and reports the time and memory**; the owner runs it on a real slow
  device later, so the build goes on meanwhile with the mitigations below ready to switch on. Then, as needed: bake what is in view first and show the
  view as soon as that is done; lower resolution; keep the sprites for the session (a persistent cache is
  a follow-up). Cap the sprites' memory (starting value 40 MB).

### The side view

- **Camera:** low. The road sits at ~64 % of the height and is exaggerated 1.6× in height so grades read;
  ~55 m of road across the screen; my rider at 30 % from the left.
- **Depth:** a camera standing ~110 m to the right of the road; a thing at lateral offset `L` (negative
  behind the road) is scaled by `f = 110 / (110 − L)` toward a horizon at ~30 % of the height. Heights
  flatten with distance (from 1.6× at the road to ~0.3× far away) so near hills do not shoot off the
  screen.
- **Four bands**, back to front, each scrolling at its own speed:
  1. **Far** (1–5 km, sea): the island's silhouette in haze; cached as an image, redrawn only when it has
     scrolled a few pixels.
  2. **Middle** (40 m – 1 km): ~10 thin bands of real terrain coloured from the ground colours and
     land-use paint with hill shading, hazier with distance; sprites of trees and buildings at their real
     depth (out to 70 m in the prototype). Cached per chunk.
  3. **Road**: the road, its verge, riders, the crowd, cafés and the houses along the street.
  4. **Front** (the near verge, up to ~22 m): a few plants and props, larger, never buildings.
- **Buildings** stand only behind the road, at their real distance and never below the road; each picks
  the side sprite nearest to its real turn against the camera plus a fixed turn of −0.45 rad, so it shows
  a side wall and reads as a solid (straight-on fronts looked flat).
- **Riders:** the pedalling frame from the crank phase (cadence), tilted with the (exaggerated) grade;
  name labels as in the HUD; drawn larger than the scenery (riders ~1.1×, scenery ~0.8× of true scale,
  to tune).
- **Sky:** gradient from the time-of-day preset, sun glow, or at night the moon and stars; clouds by the
  weather.
- **Bottom strip:** the whole route's height profile with every rider on it and the visible stretch
  marked.

### The map

- Heading up, my rider just below the centre, ~95 m of height shown (today: 120 m).
- **Ground** in 64 m tiles, made once and kept: the ground colours with the land-use paint over them,
  sea by depth, hill shading from the normals, a little grain; then hedges and walls, vine rows and scrub
  as small dabs, rivers and roads (asphalt, edge, centre dashes), then the sprites (trees, roadside props,
  rows' trees, houses by yaw, farms, cafés, lamps, landmarks) sorted back to front.
- **Moving things** per frame: the crowd and animals (sprites), riders (top sprite, ~2.4× true size so
  they read), name labels upright.

### Time of day and weather (both views)

- Golden hour, dusk and night are a tint over the land (night a deep blue); the sky has its own colours.
- At dusk and night: glow of street lamps, windows (night sprites), cafés, and bike lights (a short beam
  ahead and a red tail).
- Rain and snow as falling streaks and flakes; overcast greys the sky and dims the light. Values come from
  the same `world/weather.js` and `world/daylight.js` as the 3D world.

### What else carries over (calls made while writing this up)

- The game's own things are sprites too: route arches and banners, golden lemons, the flamme rouge, the
  tandem and beer bike with their riders.
- The map keeps what today's map shows: the lemons still on the road, the draft gap ahead of me, my best
  lap's ghost.
- The side view shows the riders on my route (like the HUD's panels); the map shows every rider in view.
- Out of scope: the spin studio and workout screens (no 2D view today), the start menu's map preview, the
  cockpit and VR.

### Choosing the view

- The View popover's 3D/2D switch becomes **3D / Map / Side**, offered on every device (not only weak
  ones); the choice is remembered like today's view mode (per profile, as the other view settings).
- On WebGL2 devices the new Map replaces today's `rideMapView`.
- A device sent to 2D by the quality pick starts on **Map** (owner's choice).
- No WebGL2: Map is today's `rideMapView`; Side is not offered.

## Left to the builder

Bucket sizes, tile and chunk sizes, the exact number of terrain bands, cache sizes and eviction, the
sprites' resolutions, how a frame's draws are batched, and the tuned values above (all starting values
from the prototype).

## Risks

- **Bake time on weak devices** (measured first; see the sprite baker).
- **Sprite memory** on phones (cap and measure).
- **Frame time** of the side view's middle band on a weak device (cache, fewer bands).
