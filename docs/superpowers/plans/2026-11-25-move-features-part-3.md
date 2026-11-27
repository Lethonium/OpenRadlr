# Move the features, part 3: crowd, arches, lemons, highlight, roadside, cafés and gyms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything around the road that the adapter still draws (golden lemons, the menu's route highlight, route arches and banners, guard rails, signs and the flamme rouge, the roadside crowd and its barriers, the bike cafés and the outdoor gyms) is drawn by the new world, and the old chunk meshes that carried them are gone.

**Architecture:** The worker's built world stops writing these items into the old `chunks` and returns plain placement data instead (`world.arches`, `world.furniture`, `world.crowd`, `world.cafeSites`, richer `world.gyms`). New assets in `view3d/assets/` draw them in the new materials; new scene layers read the static placements when the world scene is made and per-frame snapshots (`frame.lemons`, `frame.crowd`) that `View3D.render()` builds from what it computes today. Text on arches, banners and boards is painted into a `DataTexture` from our pixel font (no canvas in assets).

**Tech Stack:** plain ES modules, vendored Three.js (`client/public/js/three.js`), node test runner, Playwright (shots only).

**Spec:** `docs/superpowers/specs/2026-11-24-move-features-design.md` (part 3 of its Order, "Around the road" and "Menu", calls 2 and 7), under `docs/superpowers/specs/2026-11-23-three-js-world-design.md`. Parts 1–2 (`docs/superpowers/plans/2026-11-24-move-features-part-1.md`, `2026-11-25-move-features-part-2.md`) built the layers and rigs this one sits beside.

## Global Constraints

- Layering `world/` → `view3d/assets/` → `view3d/scene/` → `view3d/engine/`, enforced by `client/layering.mjs`: assets import only `world/`, assets and Three.js; scene may import `view3d/` root modules (`features.js`, `banners.js`, `crowd.js`, `highlight.js`) but not `engine/`. `view3d/world.js` runs in the world worker: it must not import Three.js or assets.
- No `document`/canvas, no `Math.random` in assets or layers (seeded randomness from placement data); every resource through `own` (`createOwner(track)`), freed by `dispose()`.
- Layer shape `{object, update(frame), setEnvironment(env), dispose()}`, registered as a maker in `scene/worldScene.js` and in its `setQuality` rebuild list (as `athletes`, `statues`).
- Kept pure logic and its tests: `crowd.js` (`CROWD`, `crowdShare`, `cheer`), `banners.js` (`ARCH_TEXT`, `BANNERS`, `bannerSpots`), `highlight.js` (`highlightColor`, `HIGHLIGHT`, `HIGHLIGHT_LIFT`), `ride/lemons.js`, `features.js` placement (`CAFE_DISTANCE`, `GYM_DISTANCE`, `gymClearing`, `studioSite`, `STUDIO_*`), `workout/gymSpots.js`. Data shapes `world.cafes` (positions), `world.gyms`, `world.studio` stay (spec call 7); fields may be added.
- Colours stay the biome's (`biome.arch`, `biome.people.shirts`, `biome.palette`, `biome.road.barrier`), converted to linear as the other layers do. Winter: the crowd stays penguins clapping.
- The spin studio and its riders stay on the adapter (part 4).
- Commits: Conventional Commits, imperative, user-facing, trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No model ids anywhere.
- Gate per task (repo root): `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && echo LINT OK && node --test 'test/**/*.test.js'"` — LINT OK printed, 0 failures. `npm run preload` (same container) when a module joins a page's import graph; commit the `*.html` change. No temp files left in `client/`.

## Review Focus

1. **Lemons I collected, or on another route** (`collected: true`, or my rider on a route other than the view's): never drawn, and a collected one vanishes the same frame. Test in Task 1.
2. **Flipping through routes in the menu** (highlight set 30 times, then cleared): one band set at a time, nothing leaks. Test in Task 2.
3. **Hilltop Café in the middle of town** (`hill-cafe` sits at the city centre): the café and its gym are built and no house plot overlaps either. Test in Task 6.
4. **Riding alone vs. with others** (`crowdShare` of 1 human vs. 10): fewer spectators alone, none drawn within `SCENE.nearCameraHide` of the camera, cheering ones hop. Test in Task 5.
5. **Changing quality mid-ride** (`setQuality` rebuilds layers): arches, furniture, cafés and gyms are back from the world's placement data, the crowd and lemons from the next frame. Test in Task 7.

---

### Task 1: Golden lemons

**Files:**
- Create: `client/public/js/view3d/assets/props/lemon.js`, `client/public/js/view3d/scene/lemonLayer.js`
- Modify: `client/public/js/view3d/assets/props/index.js` (workbench entry `lemon`), `client/public/js/view3d/scene/worldScene.js` (maker `lemons`), `client/public/js/view3d/view3d.js` (`frame.lemons`, drop `lemonMesh`, its draw and shadow cast)
- Delete: `client/public/js/view3d/lemonModel.js` (and its import/test, if any, once unused)
- Test: `client/test/lemonLayer.test.js`, `client/test/view3d.test.js`

**Interfaces:**
- Produces:
  - `lemon.js`: `LEMON_COLORS` (moved from `lemonModel.js`: peel `[1.0, 0.8, 0.08]`, nub `[0.92, 0.68, 0.06]`, leaf `[0.24, 0.62, 0.22]`), `lemonGeometry() -> THREE.BufferGeometry` (about 1 m long along x, centred on the origin, vertex colours: the ellipsoid 0.44 × 0.3 × 0.3, a nub at each end, a leaf), and workbench `meta`/`create` as the other props.
  - `createLemonLayer({settings, uniforms, track})`: one `InstancedMesh` (capacity 64, name `"lemons"`), vertex-coloured standard material with an emissive glow of 0.5 × the peel colour; casts shadows when `settings.shadows`. Reads `frame.lemons: {position: number[], yaw: number}[]` (position is the lemon's centre). `stats() -> {drawn}`.
  - View: `frame.lemons` from today's `#lemonModels` logic (same reach `SCENE.lemonReach`, same bob `sin(t·2.2 + distance)·0.1`, height 1.25, spin `t·1.6 + distance`); the layer applies today's nose-up tilt of 0.35 rad (Euler YXZ) at full size.
- [x] **Step 1: failing tests**
  - `lemonLayer.test.js` › `each lemon is an instance at its position and turn` — two entries → `count` 2, instance 1's matrix translation equals entry 1's position ± 1e-6 and its rotation about y equals the yaw.
  - › `more lemons than the capacity are cut, not thrown` — 70 entries → `count` 64.
  - › `dispose frees everything` — tracker live 0.
  - `view3d.test.js` › `lemons near my rider go to the frame, collected ones and other routes' never` — `setLemons([{distance: 50, lane: 0, collected: false}, {distance: 60, lane: 0, collected: true}])` with my rider at 0 on the view's route: `frame.lemons.length` 1; my rider on another route id: 0; after marking the first collected: 0 the next frame.
- [x] **Step 2:** Run the two files → FAIL.
- [x] **Step 3:** Implement; remove the adapter's lemon draw, shadow cast and `lemonMesh` upload/dispose.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `feat(client): Float the golden lemons in the new world`.

### Task 2: Route highlight in the menu

**Files:**
- Create: `client/public/js/view3d/scene/highlightLayer.js`
- Modify: `client/public/js/view3d/highlight.js` (`buildHighlight` returns plain band data, no `MeshBuilder`), `client/public/js/main.js:1017-1018` (bands), `client/public/js/view3d/view3d.js` (`setHighlights` → world scene), `client/public/js/view3d/scene/worldScene.js` (maker `highlight`, `setHighlights`)
- Test: `client/test/highlight.test.js` (adjust only the mesh-shape assertions), `client/test/highlightLayer.test.js`

**Interfaces:**
- Produces:
  - `buildHighlight(route, opts) -> {positions: Float32Array, colors: Float32Array, glow?: undefined}` — same options and geometry as today (band quads every `step` m, `lift`, beacon at the start), `positions` xyz per vertex (non-indexed triangles), `colors` linear-free rgb 0–1 per vertex as today's tints.
  - `scene.setHighlights(bands: {band: ReturnType<buildHighlight>, glow: number}[])`: replaces the shown bands (disposes the old geometries). `highlightLayer`: one `Mesh` per band, `MeshBasicMaterial({vertexColors: true, toneMapped: false, transparent: false})`, colour scaled by `glow` (1 picked, 0.35 others, as today), `renderOrder` above the road, `frustumCulled` true with a computed bounding sphere. Kept across `setQuality` rebuilds (the scene re-sends the last bands, as `setStatues` does).
  - `View3D.setHighlights(bands)` keeps its signature (`{mesh, glow}` from callers becomes `{band, glow}`; update `main.js` and `view/menuStage.js` doc).
- [x] **Step 1: failing tests** (`highlightLayer.test.js`)
  - `a band is drawn in its colours, scaled by its glow` — a 2-triangle band with colour (1, 0.5, 0), glow 0.35 → one mesh, its vertex colours times material colour equal (0.35, 0.175, 0) ± 1e-6.
  - `setting bands again replaces them and leaks nothing` — set 3 bands 30 times, then `[]`: tracker live equals the empty layer's baseline; `object.children.length` 0.
  - `bands survive a quality rebuild` — `scene.setHighlights([b])`, `scene.setQuality("low")`: the rebuilt layer shows 1 band.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement; remove the adapter's `#highlights` uploads and `drawBright` of bands.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `feat(client): Light the picked route in the new world's menu`.

### Task 3: Route arches and banners

**Files:**
- Move: `client/public/js/view3d/pixelFont.js` → `client/public/js/view3d/assets/pixelFont.js` (update importers)
- Create: `client/public/js/view3d/assets/textTexture.js`, `client/public/js/view3d/assets/props/routeArch.js`, `client/public/js/view3d/scene/archLayer.js`
- Modify: `client/public/js/view3d/banners.js` (placement only: add `archSpots`, `bannerPlacements`; drop `buildBanners`, `letterArch`, `letterBeam`), `client/public/js/view3d/world.js` (`world.arches`; drop `buildArches` and `meshes.arches`), `client/public/js/view3d/view3d.js` (drop `meshes.arches` draw and shadow cast), `scene/worldScene.js` (maker `arches`), `assets/props/index.js` (workbench `route-arch`)
- Test: `client/test/banners.test.js` (keep `bannerSpots` tests; replace mesh tests), `client/test/textTexture.test.js`, `client/test/archLayer.test.js`

**Interfaces:**
- Produces:
  - `textTexture(text: string, {background: number[], ink: number[], width: number, height: number}, own) -> THREE.DataTexture` (sRGB 0–1 colours; text centred, scaled to fit 90 % of the width; uppercase glyphs from `GLYPHS`, unknown characters as a space).
  - `archSpots(route) -> {kind: "start_finish"|"climb"|"sprint", text: string, distance: number}[]` (one per `route.markers` entry, `text` from `ARCH_TEXT`) and `bannerPlacements(route) -> {kind: "climb"|"halfway", text, distance}[]` (= `bannerSpots`).
  - `world.arches: {kind, text, position: number[], yaw: number, halfWidth: number, height: number, banner: boolean}[]` — position the road centre at the spot (ground height), yaw from the level road frame (`yawFor` of the frame's forward), `halfWidth = roadHalfWidth(lanes) + 0.6`, `height` 5.2 for arches, `BANNERS.bottom + BANNERS.height` for banners.
  - `routeArch.js`: `createRouteArch({kind, text, halfWidth, height, colors: {post, beam, ink}, banner, own, uniforms}) -> THREE.Group` — arch: two round posts and a beam (the reference's inflatable shape), text on both faces; banner: two thin posts and a cloth beam `BANNERS.height` tall with the text; the start/finish beam keeps a chequered strip. Colours: arch beam `biome.arch.start|climb|sprint`, posts `biome.arch.post`, banner cloth `biome.arch.climb` or `BANNERS.halfway`, ink white or dark as today.
  - `createArchLayer(world, {biome, settings, uniforms, track})`: one group per placement, all casting shadows; static.
- [x] **Step 1: failing tests**
  - `textTexture.test.js` › `the text is inked in the middle and the edges stay background` — "KOM" 128×32 dark on white: the centre row has ink pixels, column 0 and column 127 are all background.
  - › `unknown characters do not throw` — "Ü✓" paints without throwing.
  - `archLayer.test.js` › `an arch spans the road at its spot, facing along it` — a placement at (10, 2, −5), yaw 0.3, halfWidth 6: the group's bounding box spans ≥ 12 m across (rotated frame) and its lowest y is 2 ± 0.05.
  - › `every marker of a route gets its arch and text` — `archSpots(route)` of rolling-hills has one entry per marker, the start/finish text `ARCH_TEXT.start_finish`.
  - › `dispose frees everything`.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `feat(client): Raise the route arches and banners in the new world`.

### Task 4: Guard rails, road signs and the flamme rouge

**Files:**
- Create: `client/public/js/view3d/assets/props/roadSigns.js`, `client/public/js/view3d/scene/furnitureLayer.js`
- Modify: `client/public/js/view3d/features.js` (`buildRoadside` → `roadsideFurniture` returning data; `buildVillageSigns` → data), `client/public/js/view3d/world.js` (`world.furniture`; no `chunks` writes for these), `scene/worldScene.js` (maker `furniture`), `assets/props/index.js` (workbench `warning-sign`, `village-sign`)
- Test: `client/test/features.test.js` (placement), `client/test/furnitureLayer.test.js`

**Interfaces:**
- Produces:
  - `roadsideFurniture(route, terrain, {skip, markers, rails, twoWay, railGrade, railStep, cliffs, villages}) -> {rails: {a: number[], b: number[]}[], signs: {kind: "warning"|"village", position: number[], yaw: number}[], flammeRouge: {position: number[], yaw: number, halfWidth: number} | null}` — the same rules and spots as today's `buildRoadside` (rails at `half + 0.3` per side, `a`/`b` the segment's ends at ground height; signs at `half + 0.9`, village boards at `half + BOARD_SETBACK`; flamme rouge 1000 m before the finish on routes > 1500 m).
  - `world.furniture = {rails, signs, flammeRouge, barriers}` (rails and signs concatenated over the roads as today's calls; `barriers` from Task 5's `buildSpectators`, empty until then).
  - `roadSigns.js`: `warningSignParts()`, `villageSignParts()` (post + face, the face's colours from today's biome models), `flammeRougeParts(halfWidth)`; each returns `{geometry, glow?: geometry}` with vertex colours; faces slightly emissive at dusk/night like today's `bright` group.
  - `createFurnitureLayer(world, {settings, uniforms, track})`: rails as one `InstancedMesh` of a unit rail (post + beam, scaled along the segment) using `biome.palette.pole`/`metal`; signs as one `InstancedMesh` per kind; the flamme rouge as a mesh; `setEnvironment(env)` raises the faces' glow with `env.night`.
- [x] **Step 1: failing tests**
  - `features.test.js` › `rails follow steep descents on both sides of a two-way road` — a straight test route with a 6 % descent stretch: rails only inside the stretch, two per step.
  - › `the flamme rouge stands a kilometre before the finish` — route of 3000 m: `flammeRouge.position` equals `roadFrame(route, 2000).center` x/z ± 0.01; a 1200 m route: `null`.
  - › `climb warnings stand before and after each climb` — two signs per climb marker, at `distance − 120` and `top + 25`.
  - `furnitureLayer.test.js` › `each rail segment is one instance from a to b` — 3 segments → instance count 3; instance 0's matrix maps local (0,0,0) to the midpoint ± 1e-6 and local x ±0.5 to `a`/`b` ± 1e-3.
  - › `night lights the sign faces` — `setEnvironment({night: 1})` makes the face material's emissive intensity higher than at `night: 0`.
  - › `dispose frees everything`.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement; `world.js` no longer passes `structures`/`bright` to the roadside code.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `feat(client): Put guard rails and road signs in the new world`.

### Task 5: The roadside crowd and its barriers

**Files:**
- Create: `client/public/js/view3d/assets/people/spectator.js` (+ `assets/people/index.js` workbench entries), `client/public/js/view3d/scene/crowdLayer.js`
- Modify: `client/public/js/view3d/features.js` (`buildSpectators` returns `{people, barriers}`, no meshes), `client/public/js/view3d/world.js` (`world.crowd = {people, figure}`, `world.furniture.barriers`; drop `spectatorMeshes`), `client/public/js/view3d/view3d.js` (`frame.crowd`; drop spectator/flag meshes, draws, shadow casts), `scene/furnitureLayer.js` (barriers), `scene/worldScene.js` (maker `crowd`)
- Delete once unused: the old crowd models (`buildSpectator` in `biomes/temperate.js`'s import chain, `biomes/winter/people.js`), `buildFlag`.
- Test: `client/test/features.test.js` (spectators), `client/test/crowdLayer.test.js`, `client/test/view3d.test.js`

**Interfaces:**
- Produces:
  - `buildSpectators(route, terrain, {seed, perSide, biome, blocked}) -> {people: Person[], barriers: {a, b, color}[]}` — `Person` exactly as today's entries (`position, yaw, shirt, armsUp, motion, phase, scale, rank, flag`); the random streams unchanged so everyone stands where they stood.
  - `spectator.js`: `spectatorGeometry({figure: "person"|"penguin", pose: boolean}) -> {body: BufferGeometry, shirt: BufferGeometry}` — person after the reference villager (capsule torso, head, hair, legs; `pose` true = arms up), penguin after today's winter penguin (`pose` true/false = the clap's two flipper poses); `shirt` is the part tinted per person (white vertex colour). `flagGeometry() -> BufferGeometry` (pole and white cloth, origin at the hand).
  - `world.crowd.figure`: `"penguin"` when `biome.people.motion === "clap"`, else `"person"`.
  - `createCrowdLayer(world, {settings, uniforms, track})`: per pose two `InstancedMesh`es (body, shirt with `instanceColor`) plus one flag `InstancedMesh` (`instanceColor` = flag colour); capacity = `world.crowd.people.length`. Reads `frame.crowd: {index: number, yaw: number, lift: number, pose: boolean, flagSwing: number}[]` (index into `world.crowd.people`). `stats() -> {drawn}`.
  - View: `frame.crowd` from today's filter and `cheer(p, fans, timeS)` (same `crowdShare`, `SCENE.spectatorDistance`, `SCENE.nearCameraHide`), `flagSwing = sin(t·2.6 + phase)·0.5`; the flag's hand point from `biome.people.flagHand` moves into the asset (person `[0.36, 1.85, −0.05]`, penguin `[0.5, 0.8, −0.1]`).
- [x] **Step 1: failing tests**
  - `features.test.js` › `spectators stand where they always stood` — rolling-hills: the first 5 people's positions and shirts equal a snapshot taken before the change (record it in the test from the current code first).
  - › `barriers line both sides of each crowd spot` — 16 segments per side per spot.
  - `crowdLayer.test.js` › `a pose picks its mesh and the shirt keeps its colour` — 3 entries (2 arms up): arms-up body count 2, down count 1; shirt instance colour of entry 0 equals person 0's shirt (linear) ± 1e-6.
  - › `a hop lifts the spectator` — entry with `lift` 0.3: instance y = person y + 0.3.
  - › `only flag wavers carry a flag` — flag count equals entries whose person has `flag`.
  - › `winter crowds are penguins` — `figure: "penguin"` builds the penguin geometry (its bounding box height < 1.2 m).
  - `view3d.test.js` › `the crowd thins out when I ride alone and keeps clear of the camera` — 1 human vs 10: fewer `frame.crowd` entries alone; no entry within `SCENE.nearCameraHide` of the eye.
- [x] **Step 2:** Run → FAIL (record the snapshot first, then change the code).
- [x] **Step 3:** Implement.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `feat(client): Bring the roadside crowd into the new world`.

### Task 6: Bike cafés and outdoor gyms, clear of the towns

**Files:**
- Create: `client/public/js/view3d/assets/buildings/bikeCafe.js`, `client/public/js/view3d/assets/props/outdoorGym.js`, `client/public/js/view3d/scene/venueLayer.js`
- Modify: `client/public/js/view3d/features.js` (`buildBikeCafe`/`buildOutdoorGym` return data only; add `cafeClearing`), `client/public/js/view3d/world.js` (`world.cafeSites`, café clearings into `planWorld`, no chunk writes), `client/public/js/world/plan/settlements/*.js` (plots skip clearings), `scene/worldScene.js` (maker `venues`), `assets/buildings/index.js`, `assets/props/index.js` (workbench `bike-cafe` with a `style` option, `outdoor-gym`)
- Delete once unused: biome models `cafe`, `gym`, `gymSign` (`biomes/temperate.js`, `biomes/winter/buildings.js`) and their builders.
- Test: `client/test/features.test.js`, `client/test/world3.test.js`, `client/test/venueLayer.test.js`

**Interfaces:**
- Produces:
  - `cafeClearing(route) -> {x, z, radius: 14}` (centre = today's café position); `planWorld` gets café and gym clearings; `planSettlements` drops any plot whose footprint comes within a clearing's radius (streets and squares stay).
  - `buildBikeCafe(route, terrain, {occupancy, avoid}) -> {position, distance, yaw, forecourt: {inner: number[][], outer: number[][]}} | null` (same spot rules; `forecourt` the paved edge points every 2 m from `center − 11` to `center + 11`, inner at `half + 0.02`, outer at `half + 10`, y = road + 0.1).
  - `buildOutdoorGym(...)` as today plus `{position: number[] (pad origin), base: number, drop: number, signLift: number}`; `GYM_TOP` exported (the mat's top over `base`, today's `gym.top` value) so spots keep their height.
  - `world.cafeSites: {id: string|null, name: string, style: "valley"|"hut"|"hilltop"|"beach", position, yaw, forecourt}[]` — style by id: `valley-cafe` → valley, `forge-hut` → hut, `hill-cafe` → hilltop, `beach-cafe` → beach (the Cape Loop's start, next to the yoga gym), anything else → valley; name from the network node.
  - `bikeCafe.js`: `createBikeCafe({style, name, snow, own, uniforms}) -> THREE.Group` after the reference's `bike-cafe` (all four styles; front faces +z then turned by the layer so it faces the road), name board via `textTexture`, a bike rack with three parked bikes baked from `createBike` into one mesh.
  - `outdoorGym.js`: `createOutdoorGym({drop, signLift, own, uniforms}) -> THREE.Group` after the reference's `outdoor-gym` (pad with kerbs reaching `drop` down, mat with seams, pull-up rig, dip bars, sit-up bench, beam, sign "OUTDOOR GYM" via `textTexture`); mat top at `GYM_TOP`; no athletes (part 2 draws them).
  - `createVenueLayer(world, {season, settings, uniforms, track})`: cafés (snow in winter), forecourts as one mesh, gyms; static; casts and receives shadows.
- [x] **Step 1: failing tests**
  - `world3.test.js` › `no town plot overlaps a café or a gym` — the browser's world (`buildWorld(new RouteGeometry(rolling-hills), {network: roadNetworkOf(valley)})`): for every plot of every settlement, its centre is farther than `radius + max(width, depth)/2` from each clearing; and `world.cafeSites` has all four cafés of the valley map with their styles (`valley-cafe` valley, `forge-hut` hut, `hill-cafe` hilltop, `beach-cafe` beach), each with a gym in `world.gyms` (the beach gym keeps `cafeId` `beach-cafe`, so its yoga venue still finds it).
  - `features.test.js` › `the gym's spots sit on the mat` — every spot's y equals `base + GYM_TOP` ± 1e-6.
  - `venueLayer.test.js` › `a café faces the road` — for one café site, the group's +z (after the layer's turn) points towards the road (dot with `−right` > 0.9).
  - › `the gym's mat top meets the spots` — the mesh's highest point over the mat's centre region is within 0.02 of `base + GYM_TOP`.
  - › `each style builds` — the four styles create without throwing and differ in vertex count.
  - › `dispose frees everything`.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `feat(client): Build the bike cafés and outdoor gyms in the new world, clear of the towns`.

### Task 7: The old chunks go

**Files:**
- Modify: `client/public/js/view3d/world.js` (no `chunks`), `client/public/js/view3d/view3d.js` (no chunk uploads, draws, shadow casts or `chunkNear`/`chunkVisible`), `client/public/js/view3d/worldWorker.js` (transfer list), `client/public/js/view3d/threeRenderer.js` (only if a method lost its last user)
- Delete once unused: `client/public/js/view3d/chunks.js` and its test, old builders in `features.js`/`biomes/*` with no users left (`grep` each before deleting).
- Test: `client/test/view3d.test.js`, `client/test/worldScene.test.js`

**Interfaces:**
- Consumes: every layer of Tasks 1–6.
- [x] **Step 1: failing tests**
  - `worldScene.test.js` › `a quality change keeps the arches, furniture, cafés and gyms` — make the scene from a built world, `setQuality("low")` then `"high"`: the `arches`, `furniture` and `venues` layers have the same child/instance counts as before.
  - `view3d.test.js` › `the adapter draws no world chunks` — after a render the fake renderer saw no `draw` call with a chunk handle (the view has no `chunks` field).
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement and delete.
- [x] **Step 4:** Gate → PASS.
- [x] **Step 5:** Commit `refactor(client): Drop the old world chunks`.

### Task 8: Shots, draw calls, memory (main session)

- [x] **Step 1:** Restart the dev server fresh (40 bots), run `drawcalls.mjs` → `~/.cache/openradlr/screenshots/move3/after.txt`; compare with `move2/after.txt`; Low and Medium within +10 %.
- [x] **Step 2:** Workbench round: `lemon`, `route-arch` (start and climb), `warning-sign`, `village-sign`, `bike-cafe` (valley, hut, hilltop, beach), `outdoor-gym`, the spectator (person, penguin).
- [x] **Step 3:** One ride round (Simulator, High), aimed from the browser's world: start arch with the Valley Café, a climb top with the crowd and barriers, a descent with rails, Forge Hut, Hilltop Café in town, the Beach Café with its yoga gym (Cape Loop), a winter crowd, the menu highlight (menu shot), lemons if the day has them. A second round only for fixes.
- [x] **Step 4:** Contact sheet, upload to `pr-screenshots` `polished-world/move3/`, push the branch, update the `polished-world` memory.
