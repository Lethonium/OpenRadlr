# Step 3: The new world

The design for step 3 of [A new 3D world on Three.js](2026-11-23-three-js-world-design.md): the island itself
(ground, sea, sky, light, plants, villages, farms, landmarks, animals, seasons, weather and night) on a real
Three.js scene. Features (riders, studio, statues, gyms, crowd, banners) move in step 4; until then they keep
drawing through the step-2 adapter.

## Intent

The rework is only worth it if the new world looks great up close **and** leaves a codebase that is a pleasure
to extend. The owner's words: "make sure that this rework is worth it and we end up with a great codebase".
So this design cares as much about structure as about the look. The reference (`notes/polished-world/reference/`)
is taken in for its assets, shaders and rendering techniques, but its `world.js` (one 1,850-line file of module
globals) is not: its structure is rebuilt as small, tested modules.

## Decisions made with the owner (2026-11-24)

- **Character: mixed by region.** A calm green interior (farmland, mixed woods, high country) from the
  reference's assets; a Mediterranean coast and south-facing slopes (olive terraces, umbrella pines, lavender).
  PR #127's hand-placed regions in `valley.json` are the starting map.
- **Four seasons**, plus **Auto** (the default, following the calendar). The rider picks one in settings, as the
  biome today. Winter is today's winter biome, rebuilt as the island's winter.
- **Full day cycle with night.** Time modes Day, Golden hour, Dusk and Night, plus Auto (local clock, which now
  reaches night). Night brings window and street-lamp glow, the lighthouse beam, bike head- and taillights and
  a headlight on the rider. **Weather follows the season**: rain or storm showers in spring and autumn, snow in
  winter, clear summers with the odd shower.
- **Approach 2:** our own world modules (pure placement, tested in node, run in the worker) with the reference's
  drawing parts taken in file by file.
- **Quality bar:** great architecture, structure and code quality are a goal of this step, not a by-product.

## Goals

- The polished look of the umbrella spec's goals, on our island and our roads, in all four seasons, day and night.
- Every stretch of road has its own character (region), and the close-up view while riding is full and varied.
- A codebase with a clear layering (below), small files with one job each, no module-level mutable state,
  everything disposable, and node tests for every rule about what goes where.
- The asset workbench replaces `gallery.html`.
- An automatic quality pick per device, which can choose 2D.

## Non-goals

- Moving riders, vehicles, studio, statues, gyms, crowd, banners, labels or the menu cameras onto the new scene
  (step 4). They keep drawing through the adapter, with their old shading, until then.
- The reference's comic/ink style and its `seasons` demo map (builder's call: a second look to maintain that
  nobody asked for).
- Changing the 2D view's look. It keeps working with the new settings (see Constraints).
- Server or protocol changes.

## Anti-goals

- A port of the reference's `world.js` with its structure: module globals, hidden coupling through shared
  mutable objects, untested placement.
- Patchy, quilt-like farmland; repetitive or empty roadsides; a region map whose circles show.
- Night that is unreadable on the road: the rider must always see the road ahead.
- A Low level that a mid-range phone cannot ride smoothly.
- Abstractions with one user. Layers and interfaces exist because several modules share them.

## Constraints

From the umbrella spec (no build step, CSP `script-src 'self'`, offline, vendored Three.js, plain node tests,
GPS origin fixed, composition roots inject dependencies), plus:

- **The 2D view depends on `view3d/`**: `rideMapTheme.js` reads biome colours (`biomes/index.js`) and time
  presets (`lighting.js`), `rideMapDecor.js` reads `zones.js` and `world.js` constants, `mapPreview.js` reads
  `island.js`. Pure data these share moves to a neutral home (`world/`, below) and the 2D view imports it from
  there. The 2D map shows Winter in its winter colours and the other seasons in today's temperate colours;
  Night reads as Dusk (builder's call: the 2D look stays as it is).
- **Map data:** regions, landmarks and settlements are hand-placed in `routes/maps/valley.json`, as in #127. The
  server's map reader ignores unknown fields (no `deny_unknown_fields` in `map_file.rs`), so the server is
  untouched. Nothing on the server or in the protocol depends on scenery placement, so placement need not stay
  compatible with today's; the map `seed` stays the world's seed.
- **#127 is not merged** (a draft on `feat/scenery-kit`, built for the old renderer). We don't merge or rebase
  onto it: its region data, region and landmark modules and their tests are taken over by hand from
  `origin/feat/island-regions` into `world/` (builder's call), and the regions, landmarks and settlements keys
  are added to this branch's `valley.json`.
- **Where riders are is fixed.** `roadFrame`, `riderPosition`, the road-carved terrain (`networkTerrain`) and
  river paths decide where riders, the crowd and the camera are. Their algorithms and tests move to `world/`
  unchanged; only their drawing is redone.
- **Saved settings carry over:** `openride.biome = "winter"` becomes season Winter, any other biome becomes
  Auto; `?biome=winter` keeps working as a preview alias of `?season=winter`.

## Approaches considered

1. **Adapt the reference's world in one piece.** Fastest first picture; leaves an untested 1,850-line file of
   globals at the heart of the world. Rejected: against the quality bar and the test rule.
2. **Own world modules, reference parts taken in file by file (chosen).** Placement is pure and tested; drawing
   reuses the reference's assets and shaders nearly as written. More steps, each ending tested with shots.
3. **Extend the step-2 adapter on the old shaders.** Gains nothing from the reference. Rejected.

## Architecture

### Layers

Each layer may import only from the layers above it. A node test (`test/layering.test.js`) reads the import
lines of every module and fails on an import against the arrow.

```
world/      pure data and rules: no Three.js, no DOM, no time, no randomness except seeded
  ↓
assets/     Three.js object builders: geometry and materials, no scene, no renderer, no DOM
  ↓
scene/      assembles a world plan and assets into Three.js layers, updates them per frame
  ↓
engine/     the WebGLRenderer, post chain, frame loop, resize, dynamic resolution (browser only)
  ↓
View3D      the facade main.js talks to (today's public interface, kept)
```

- **`client/public/js/world/`** (pure, runs in the worker and in node):
  - `terrain.js`: height, slope and normal sampling over `valley.json` (one implementation, shared with 2D).
  - `roads.js`: road frames and rider positions, the network terrain carved around roads and junctions, river
    paths and bridges (moved from `view3d/world.js` and `features.js` with their tests, algorithms unchanged).
  - `regions.js`: from #127 (blended, wandering edges), with the region kinds of this design.
  - `seasons.js`: season ids, `resolveSeason(mode, date)`, the per-season tables (ground tints, crop stage,
    foliage, snow cover, weather odds).
  - `daylight.js`: time modes, `resolveTime(mode, date)`, and `environmentAt(time, season, weather)`: sun and
    moon direction, sky, light and fog colours, exposure, wetness, snow cover. Replaces `lighting.js`; pure, so
    the look of every time and season is pinned by tests.
  - `plan/`: the placement rules, one file each: `masks.js` (road and river masks, clearances), `fields.js`,
    `woods.js` (tree scatter per region), `roadside.js` (near-road clumps and props), `settlements.js`,
    `farms.js`, `landmarks.js`, `fauna.js`. Each is a pure function of map, routes, seed, season and a detail
    level, returning plain data (positions, rotations, kinds, typed arrays).
  - `plan/index.js`: `planWorld({ map, routes, seed, season, detail }) -> WorldPlan`. Deterministic and
    transferable; this is what `worldWorker.js` computes.
- **`client/public/js/view3d/assets/`**: the reference's asset files, adapted to the house style, grouped as in
  the reference (`nature/`, `buildings/`, `props/`, `creatures/`). The contract stays:
  `meta` plus `create(opts) -> { object, update?(frame), dispose() }` and part builders for merging and
  instancing. `opts.detail` (from the quality level) picks segments, leaf cards or hulls, and animated parts.
  New: olive, umbrella pine, lavender (and whatever #127's landmarks need that the reference lacks: windmill
  row, sea arch, cathedral are adapted or built).
- **`client/public/js/view3d/scene/`**: one module per layer of the world: `terrainLayer.js` (tiles), `sea.js`,
  `sky.js`, `grassLayer.js`, `cropLayer.js`, `forestLayer.js` (chunked instancing, LOD), `settlementLayer.js`
  (merged per village or farm), `landmarkLayer.js`, `faunaLayer.js`, `weatherLayer.js`, `nightLights.js`.
  Every layer has the same shape:
  `createXLayer(plan, assets, settings) -> { object, update(frame), setEnvironment(env), dispose() }`.
  `scene/worldScene.js` composes the layers and owns no logic of its own.
- **`client/public/js/view3d/engine/`**: `engine.js` (one `WebGLRenderer` per canvas, shared by every view on
  that canvas: menu, ride, studio, gym; fixing the step-2 note), `post.js` (the reference's chain, with each pass switchable by
  quality), `materials.js` (the reference's `onBeforeCompile` hook stack: grain, wind, translucency, cloud
  shadows, height fog), `shaderChunks/` (GLSL as exported strings), `dynamicResolution.js`.

### Frame and settings objects

- One frame object per frame, passed to every `update`: `{ dt, t, camera, env, focus }`. No layer reads a clock,
  `performance.now()` or a global.
- Environment changes (time, season, weather) flow through `setEnvironment(env)`, computed once by
  `environmentAt` and pushed down; no layer computes its own sun.
- Quality settings come from `quality.js` as one frozen object per level, extended with the switches of the
  umbrella spec (shadow map size, SSAO, bloom, DoF, sun rays, MSAA, grass radius and density, tree LOD
  distances, draw distance, animal and lamp counts, pixel ratio floor). Layers read only their own keys.

### Resource ownership

Whoever creates a geometry, material or texture disposes of it. Shared materials and geometries live in a small
cache owned by the scene and are disposed with it. A node test builds a world scene from a small fixture map,
disposes it and asserts every created geometry, material and texture was disposed (counted through an injected
tracker). Switching route, season or quality rebuilds without a page reload and without leaks.

### Worker

`worldWorker.js` runs `planWorld` and returns the plan (typed arrays transferred). Asset building and scene
assembly happen on the main thread (Three objects can't cross the worker boundary), sliced over frames behind the
loading screen, and shaders are compiled with `renderer.compileAsync()` before the first frame.

### Step-3/4 boundary

The engine renders the new world scene, then the adapter's passes (riders, studio, statues, ...) into the same
frame before the post chain, so they get the same tone mapping and bloom but keep their old lighting. Shadows on
features and label occlusion return in step 4. Old world code is deleted function by function in the part that
replaces it, as soon as nothing imports it (builder's call; the umbrella spec left it all for step 5, which then
only sweeps what remains). Feature placement that step 4 still needs stays where it is until then: spectators,
outdoor gym, bike café and studio sites in `features.js`, arches and banners. Those features sample terrain
height from `world/terrain.js` from part 1 on, so they stand on the new ground.

### Code quality rules for this step

On top of CONTRIBUTING.md:

- No module-level mutable state. Constants are frozen; everything else lives in instances or function scope.
- Files stay small and single-purpose (a soft limit of about 300 lines; a longer file needs a reason).
- Every exported function and class has a JSDoc comment with its types.
- Magic numbers live in named, frozen tables next to the rule that uses them (as `CFG` did in the reference, but
  per module).
- Reference code is restyled to the project's lint and naming, not pasted as is; its licence note travels with
  it (an attribution `NOTICE` in `assets/`, as the umbrella spec asks; the code comes under the project licence).
- Tests assert behaviour, not structure: placement rules (nothing on the road, farmland share, region
  character, landmark visible from a road), asset contracts (ground at y = 0, facing, triangle budget per
  detail level, `dispose`), environment tables, quality tables, layering and disposal. Pixels are checked by
  screenshots, not tests.

## The world

### Regions

#127's eleven regions are reviewed and mapped to the mixed character: interior kinds `farmBelt`, `deepWood`,
`wetland`, `highCountry`, `meadow`; Mediterranean kinds `pineCoast`, `oliveTerraces`, `lavenderFields`,
`almondValley`. Each region kind is one frozen entry: ground tint per season, tree mix, verge plants, roadside
props, field share, house style. Farmland stays about a third of the lowland, in calm greens, with organic wood
edges (anti-goals of the umbrella spec).

### Ground, sea and sky

Terrain from `valley.json` (carved around roads as today) in frustum-culled tiles with the reference's terrain shading (grass floor beyond the
grass rings, dry patches, wind waves); roads and rivers stamped into the masks so nothing grows on them. Sea
with the reference's ocean shader, sky dome with sun, moon, stars and clouds, and drifting cloud shadows. The sky
gradient now shows (the adapter hid it; noted in step 2).

### Roads, rivers and bridges

Drawn new on the same paths as today: textured asphalt with markings and earth-coloured edges, junction pads,
rivers with the reference's river shader, bridges where a road crosses a river, reflector posts and rails from
the reference's road furniture. Wet roads in rain, snowy verges in winter, lamp pools at night.

### Plants

Grass in camera-centred LOD rings, crop fields with seasonal stages (rapeseed in spring, wheat and sunflowers
in summer, stubble and pumpkins in autumn, ploughed or snow-covered in winter), trees with leaf cards near and
hulls far, per region. Roadside clumps and props near the road only, so the close-up view is full without
paying for it everywhere.

### Villages, farms and landmarks

Villages at #127's settlement spots and along the road network, in the region's house style, merged per
village; farms placed on farmland next to roads; landmarks hand-placed in `valley.json` with #127's rule that
each is visible from a road (lighthouse, castle ruin, sea arch, windmill row, cathedral, balloons).

### Animals

Herds in pastures near the road (cows, sheep, horses), chickens and pigs at farms, deer, rabbits and foxes at
wood edges, birds, butterflies in spring and summer, dolphins off the coast. Counts per quality level; animals
far from the camera stop animating.

### Seasons, weather and night

Seasons change ground tints, foliage (bare almonds and broadleaves in winter), crop stage, snow cover and the
animal mix (no butterflies in winter). Weather comes from the season's odds and the route seed, so riders on the
same route on the same day see the same weather (the day is the UTC date, so it is the same for everyone). Night lights windows, street lamps along village roads, the
lighthouse beam and the rider's headlight; exposure keeps the road readable.

## Quality levels and the automatic pick

`quality.js` grows the full table per level. `chooseQuality(signals) -> "2d" | level` is pure: WebGL 2
availability, `navigator.deviceMemory`, the `saveData` hint, coarse pointer and a short frame-time probe
rendered during loading. The pick is made once and saved; the rider can change it in settings. Thresholds start
from the reference's (`low` on coarse-pointer devices) and are tuned by the owner on their laptop and phone.

A node test checks a per-level budget of the planned world on the fixture map (tree, grass blade, animal and
lamp counts, triangle totals of the built assets), so a change that makes Low heavier fails a test, not a phone.

## Settings

The settings panel's biome choice becomes a season choice (Auto, Spring, Summer, Autumn, Winter; stored as
`openride.season`), and the time choice gains Night (stored where the time mode is stored today). `?season=`
previews a season and `?time=` a time mode without saving. Labels in `en.js` and `de.js`, as all UI text.

## Workbench

`workbench.html` with its own composition root (`workbench.js`) replaces `gallery.html` and `gallery.js`: the
reference's previewer (asset list, turntable, day and night, options from `meta.options`, stats), on the same
engine, materials and post chain as the world. It keeps the reference's scripting API for headless shots.

## Order of work (parts of this step)

Each part ends with `make check` green, screenshots from the world-shot script (plus night and each season where
the part touches them) and main merged in.

1. **Foundation of the new scene:** layering and test, `world/terrain.js`, `daylight.js`, `seasons.js`, quality
   table, engine (one renderer per canvas), post chain, materials, terrain tiles, sea, sky, time and season
   settings in the UI, the step-3/4 boundary in place. The adapter's world drawing goes; its feature drawing
   stays.
2. **Plants and regions:** regions, grass, crops, woods, roadside, the three new Mediterranean assets,
   workbench.
3. **Villages, farms and landmarks.**
4. **Animals, weather and night:** fauna, rain, storm and snow, night lights and exposure, the automatic quality
   pick.

Screenshots are taken with the Playwright image recipe at 1×. The owner reviews each part's shots before the next
part starts; that review, not a test, is the gate for the look. The node test rule still holds for every rule
about placement, tables and contracts.

## Left to the builder

- The exact region list after reviewing #127's eleven, and their tables.
- Which reference assets are taken, adapted or dropped, and the detail levels of each.
- What of the post chain each quality level turns on, and the dynamic-resolution floor.
- File names within the layout above.
- How scene assembly is sliced over frames during loading.
- Thresholds of the automatic quality pick, until the owner tunes them.
