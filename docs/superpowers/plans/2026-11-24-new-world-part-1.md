# New world, part 1: ground, sea, sky, light and settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D views draw a real Three.js world scene (terrain tiles, sea, sky with sun, moon and stars) through one
engine per canvas with the reference's post chain, in four seasons and five time modes including Night, while
riders, scenery and every feature keep drawing through the step-2 adapter on top.

**Architecture:** Layers `world/` (pure) → `view3d/assets/` → `view3d/scene/` → `view3d/engine/` → `View3D`, guarded
by an import test. The worker computes a ground grid (heights, normals, colours) as typed arrays; the main thread
turns it into terrain tiles. One `Engine` per canvas renders the world scene into an off-screen target, the
adapter draws its passes into the same target without clearing, and the post chain presents it.

**Tech Stack:** Three.js 0.170.0 (vendored, `client/public/js/three.js`), plain ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-new-world-design.md` (umbrella:
`docs/superpowers/specs/2026-11-23-three-js-world-design.md`).

## Global Constraints

- No build step; CSP `script-src 'self'`; no runtime requests outside the app. Addons are vendored by
  `client/vendor.mjs` (`ADDONS` list) with their `three` import rewritten.
- Import Three only from `client/public/js/three.js` (core) or `client/public/vendor/three/addons/…` (addons).
- New behaviour starts with a failing node test. No sleeps, time/RNG/I/O injected.
- No module-level mutable state in new code; constants `Object.freeze`d; JSDoc with types on every export; files
  about 300 lines at most.
- UI text only through `js/i18n/en.js` and `de.js`; new keys in both.
- After adding or removing imports reachable from `main.js`, run `npm run preload` (else `modulePreload.test.js`
  fails).
- Node and Rust run in Docker (see AGENTS.md and the commands below). Never set a git email.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Colour spaces.** The adapter's shaders output display (sRGB) colours, the world scene outputs linear HDR and
   the post chain tone-maps and encodes everything. Adapter output must be linearised in overlay mode, or riders
   and scenery look washed out (Task 5 test).
2. **Render target handoff.** The adapter's shadow pass and `flush` set render targets; they must restore the
   engine's target, not `null`, or features draw straight to the screen and skip post (Task 5 test).
3. **Several View3Ds on one canvas** (menu, ride, studio): one engine per canvas, never disposed by a view
   (Task 5 test).
4. **Saved settings from before:** `openride.biome = "winter"` must open in Winter; unknown time modes read
   as `day` (Task 3 tests).
5. **Route files without a network** (velodrome, Herne Hill): the ground grid must cover their procedural
   terrain as it covers `valley.json` (Task 4 test with a route-file fixture).

## Known, accepted for this part

- Scenery (trees, houses) still draws through the adapter and casts no shadow on the new terrain; the road does
  still receive the adapter's shadows. Parts 2 and 3 replace that scenery.
- Night has no lit windows, lamps or headlight yet (part 4); it is dark blue moonlight with stars.
- Rivers, roads, far islands and arches stay adapter meshes until part 2.

## Commands

```sh
# client lint + tests (from repo root)
docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && node --test 'test/**/*.test.js'"
# a single test file
docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/<name>.test.js
# preload list
docker run --rm -v "$PWD":/w -w /w/client node:22 npm run preload
```

Passing looks like `# fail 0` and a clean lint. A failure is a regression: fix it, don't call it flaky.

---

### Task 1: Layering guard and vendored addons

**Files:**
- Create: `client/test/layering.test.js`
- Modify: `client/vendor.mjs` (`ADDONS`), `client/test/vendorThree.test.js`
- Create (generated): `client/public/vendor/three/addons/**`

**Interfaces:**
- Produces: the folders `client/public/js/world/`, `view3d/assets/`, `view3d/scene/`, `view3d/engine/` and the
  rule below; vendored addons at `public/vendor/three/addons/<path>`.

- [ ] **Step 1: Write the failing layering test.** It walks `public/js/world/`, `view3d/assets/`,
  `view3d/scene/`, `view3d/engine/` (missing folders count as empty), reads static import specifiers with the
  same regex as `client/preload.mjs` (`IMPORT`), resolves them, and asserts:
  - `layering: world imports nothing from view3d, view, the DOM layer or three` — a `world/` file may import only
    other `world/` files and `view3d/noise.js` (pure, seeded).
  - `layering: assets import only world, three and other assets`
  - `layering: scene imports no engine`
  - `layering: an import against the arrows is reported with both file names` — run the checker on an in-memory
    pair (`world/a.js` importing `../view3d/scene/b.js`) through an injected `read`, expect one violation naming
    both.
  Export the checker as `layerViolations(files, read)` from `client/layering.mjs` (dev script, beside
  `preload.mjs`).
- [ ] **Step 2:** Run it; the in-memory test fails (no module).
- [ ] **Step 3:** Implement `client/layering.mjs`. The folders appear when their first module lands; the test
  treats missing folders as empty.
- [ ] **Step 4:** Set `ADDONS` in `vendor.mjs` to exactly:
  `postprocessing/EffectComposer.js`, `postprocessing/RenderPass.js`, `postprocessing/ShaderPass.js`,
  `postprocessing/MaskPass.js`, `postprocessing/Pass.js`, `postprocessing/UnrealBloomPass.js`,
  `postprocessing/OutputPass.js`, `shaders/CopyShader.js`, `shaders/LuminosityHighPassShader.js`,
  `shaders/OutputShader.js`, `utils/BufferGeometryUtils.js`. Add any further relative import these files pull in
  (the vendor test below finds them). Run `npm run vendor`.
- [ ] **Step 5:** Extend `vendorThree.test.js`: `every vendored addon resolves its relative imports to vendored
  files` and `no vendored addon imports the bare 'three' specifier`. Also add a node smoke test
  `the post-processing addons load in node` (dynamic `import()` of EffectComposer.js and UnrealBloomPass.js).
- [ ] **Step 6:** Run all client tests and lint. Commit `build(client): Vendor the Three.js post-processing addons and guard the world layers`.

### Task 2: Seasons and daylight in `world/`

**Files:**
- Create: `client/public/js/world/seasons.js`, `client/public/js/world/daylight.js`
- Modify: `client/public/js/view3d/lighting.js` (keeps only `sunShadowMatrix`), every importer of
  `TIME_PRESETS`, `TIME_MODES`, `presetForHour`, `resolvePreset`, `resolvedLight` (view3d.js,
  view/rideMapTheme.js, view/viewControls.js, main.js, tests)
- Test: `client/test/seasons.test.js`, `client/test/daylight.test.js`; the preset tests in `view3d.test.js`
  and `biomes.test.js` keep passing with imports from `world/daylight.js`

**Interfaces:**
- Produces (`world/seasons.js`):
  - `SEASONS = ["spring","summer","autumn","winter"]`, `SEASON_MODES = ["auto", ...SEASONS]`
  - `resolveSeason(mode: string, date: Date) -> season` — `auto` by month (Mar–May spring, Jun–Aug summer,
    Sep–Nov autumn, Dec–Feb winter); unknown mode → `auto`.
  - `seasonSetting({ season?: string|null, biome?: string|null }) -> mode` — a valid stored season mode wins;
    else stored biome `"winter"` → `"winter"`; else `"auto"`.
  - `biomeForSeason(season) -> "winter" | "temperate"` (old scenery and the 2D map until they are replaced).
  - `SEASON_LOOK[season]`, frozen: `{ grass: [r,g,b], grassDry: [r,g,b], soil, rock, sand, snowCover: 0..1,
    snowLine: metres }`, colours sRGB 0–1. Summer greens calm (no saturated yellow-green); winter `snowCover`
    1 and `snowLine` 0; others `snowCover` 0 and `snowLine` above the island's highest point.
- Produces (`world/daylight.js`):
  - Moved unchanged: `TIME_PRESETS`, `presetForHour`, `resolvePreset`, `resolvedLight` (a local `normalize`
    replaces the import from `view3d/math.js`, which `world/` may not import).
  - `TIME_MODES = ["auto","day","golden","dusk","night"]`; `TIME_PRESETS.night` (moonlit: sun below the
    horizon, a dim blue key light from the moon for the adapter, dark blue zenith and horizon, fog `[120, 2400]`,
    shadowStrength 0.3).
  - `presetForHour`: night from 21:00 to 05:30, dusk 19:30–21:00, the rest as today.
  - `environmentAt(preset, season, { haze = 1 } = {}) -> Environment`, pure, frozen result:
    `{ key, sun: [x,y,z] (unit, towards the sun, y up), moon: [x,y,z], night: 0..1, sunColor, skyTop,
    skyHorizon, skyBottom, hemiSky, hemiGround, fogColor (all linear RGB), sunIntensity, hemiIntensity,
    fogDensity, exposure, stars: 0..1, snow: 0..1 }`. Linear = sRGB→linear of the preset colours.

- [ ] **Step 1: Failing tests** in `seasons.test.js`: `auto follows the month` (Jan 15 → winter, Apr 1 → spring,
  Jul 1 → summer, Oct 31 → autumn, Dec 1 → winter); `an unknown mode reads as auto`; `a saved winter biome opens
  in winter` (`seasonSetting({ biome: "winter" }) === "winter"`); `a saved season beats a saved biome`
  (`{ season: "spring", biome: "winter" }` → `"spring"`); `anything else is auto`; `only winter draws the winter
  biome`; `every season has a complete look` (all keys present, colours in 0–1); `only winter has snow`.
- [ ] **Step 2: Failing tests** in `daylight.test.js`: `night is a time mode`;
  `the clock reaches night` (`presetForHour(23).key` and `(3)` → `"night"`, `(20)` → `"dusk"`, `(12)` → `"day"`);
  `at night the sun is below the horizon and the moon above` (`sun[1] < 0`, `moon[1] > 0`, `night === 1`);
  `by day there are no stars` (`stars === 0`, `night === 0`); `night is exposed brighter than day` (1.5 vs 1.05,
  the reference's values); `haze thins the fog` (`fogDensity` with haze 2 < with haze 1); `winter brings snow`
  (`snow === 1` in winter, 0 in summer); `colours are linear` (`skyTop` of day equals sRGB→linear of the day
  preset's `zenith`).
- [ ] **Step 3:** Run; they fail.
- [ ] **Step 4:** Implement both modules; move the presets out of `lighting.js` and update importers.
  `viewControls.js` gets `night: "drawer.timeNight"` in `TIME_KEYS`; add `drawer.timeNight` ("Night" /
  "Nacht") to both i18n files and a `<option value="night" data-i18n="drawer.timeNight">Night</option>` to
  `#time-mode` in `index.html`. `rideMapTheme.js` treats `night` as `dusk` (2D look unchanged): test
  `the 2D map draws night as dusk` in the existing rideMapTheme test file.
- [ ] **Step 5:** Run all client tests and lint; `npm run preload`. Commit
  `feat(client): Add four seasons and a Night time of day to the world's light`.

### Task 3: Season setting replaces the biome setting

**Files:**
- Modify: `client/public/js/main.js` (`BIOME_KEY`, `biomeSetting`, the three pickers `biome-mode`,
  `start-biome`, `menu-biome`, `buildRideWorld`, `studioWorld` and map calls), `client/public/index.html`
  (picker hints), i18n `en.js`/`de.js`
- Create: `client/public/js/view/seasonPicker.js` if the picker logic needs a testable home
- Test: `client/test/seasonSetting.test.js`

**Interfaces:**
- Consumes: Task 2's `SEASON_MODES`, `resolveSeason`, `seasonSetting`, `biomeForSeason`.
- Produces: `app.seasonMode` (stored as `openride.season`), `app.season` (resolved), `app.biome` derived as
  `biomeForSeason(app.season)` and passed everywhere a biome is passed today. `buildScene(…, { season })` gets
  the season alongside the biome (Task 4 reads it).

- [ ] **Step 1: Failing tests** for a pure `seasonFromLocation(search: string, stored: {season, biome}, date) ->
  { mode, season, preview: boolean }` in `world/seasons.js` (pure, so it lives there): `?season=autumn` previews
  autumn without saving (`preview: true`); `?biome=winter` previews winter (alias); stored values otherwise;
  `auto` resolves by the date. And `the season picker lists auto and the four seasons in order` for the picker's
  choices function (`seasonChoices()` → ids `auto, spring, summer, autumn, winter` with i18n keys
  `season.auto` … `season.winter`).
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. The three pickers list `seasonChoices()`; choosing writes `openride.season` and
  rebuilds the world as a biome change does today. Keep the biome preview swatch only if it still has a source
  (the biome registry's `preview` for `biomeForSeason`); otherwise drop it. i18n keys `season.auto` ("Season:
  auto" / "Jahreszeit: auto"), `season.spring` ("Spring"/"Frühling"), `season.summer` ("Summer"/"Sommer"),
  `season.autumn` ("Autumn"/"Herbst"), `season.winter` ("Winter"/"Winter"); remove `biome.temperate` and
  `biome.winter` only if nothing uses them (the i18n unused-key test tells).
- [ ] **Step 4:** Run all client tests and lint; `npm run preload`. Commit
  `feat(client)!: Pick one of four seasons instead of a biome`.
  (Breaking marker: the stored setting key changes; old values migrate.)

### Task 4: Ground grid in the worker

**Files:**
- Create: `client/public/js/world/groundGrid.js`
- Modify: `client/public/js/view3d/world.js` (`buildWorld` adds `ground` to its result),
  `client/public/js/view3d/worldScene.js` (`sceneOf`, `transferList`, `buildScene`/`buildSceneNow` pass `season`),
  `client/public/js/view3d/worldWorker.js`
- Test: `client/test/groundGrid.test.js`

**Interfaces:**
- Consumes: the terrain object `buildWorld` already has (`terrain.height(x,z)`, `terrain.distanceToRoad(x,z)`,
  `terrain.riverDistance(x,z)`), `ground.water` (sea level), `ground.bounds`; `SEASON_LOOK`.
- Produces: `groundGrid(terrain, { bounds, cell, water, season, seed }) -> GroundGrid`:
  `{ x0, z0, cell, columns, rows, heights: Float32Array, normals: Float32Array (3 per vertex),
  colors: Float32Array (3 per vertex, linear RGB), water }`. Same extent as today's `buildTerrain` fine grid
  (route bounds plus its margin, `cell` 16 m) plus a coarse outer grid to the horizon as a second `GroundGrid`
  (`cell` 140 m, as `buildTerrain`'s `outerCell`): `buildWorld` returns `ground: { near, far }`.
  `groundColor({ height, slope, roadDistance, riverDistance, noise }, look, water) -> [r,g,b]` (linear), exported
  for tests: grass by default with dry patches by noise, soil on road verges (within 11 m), rock on steep slopes
  (slope > 0.6), sand near the sea (height < water + 3), river bed near rivers, snow over everything not steep in
  winter.

- [ ] **Step 1: Failing tests**: `the grid samples the terrain's heights` (a terrain stub `height = (x,z) => x*0.1`
  → `heights[k]` matches at three cells); `normals point up on flat ground` (`[0,1,0]`); `steep ground is rock`;
  `a road verge is soil`; `the beach is sand`; `winter covers flat ground in snow`; `summer grass is calmer than
  saturated` (green channel minus red under 0.25 in sRGB terms); `colours are deterministic for a seed`;
  `a route file without a network gets a ground grid` (build a scene with `buildSceneNow` from an existing
  route-file fixture used by `world3.test.js`, assert `ground.near.heights.length === columns*rows`);
  `the ground grid is transferred, not copied` (`transferList(scene)` contains its buffers).
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. The old `buildTerrain` keeps running (the adapter still draws its mesh until Task 6
  stops drawing it; deleting it is Task 6's job).
- [ ] **Step 4:** Run all client tests and lint. Commit `feat(client): Compute the ground's grid and colours in the world worker`.

### Task 5: Engine per canvas, post chain and adapter overlay

**Files:**
- Create: `client/public/js/view3d/engine/engine.js`, `engine/camera.js`, `engine/postPlan.js`,
  `engine/post.js`, `engine/materials.js`, `engine/shaderChunks.js`
- Modify: `client/public/js/view3d/threeRenderer.js`, `client/public/js/view3d/shaders.js` (linear output
  switch), `client/public/js/view3d/quality.js`
- Test: `client/test/engine.test.js`, `client/test/postPlan.test.js`, `client/test/quality.test.js`,
  `client/test/threeRenderer.test.js`

**Interfaces:**
- Consumes: Task 2's `Environment`.
- Produces:
  - `qualitySettings(level)` grows, frozen per level, keeping `pixelRatioMax`, `shadows`, `detail`:
    `shadowMapSize` (low 0, medium 2048, high 4096, ultra 4096), `msaa` (0, 2, 4, 8), `ssao` (null,
    `{samples:10, full:false}`, `{samples:12, full:false}`, `{samples:16, full:true}`), `sunRays` (0, 0, 24, 40
    samples), `bloom` (false, true, true, true), `depthOfField` (false, false, true, true), `resolutionFloor`
    (0.6, 0.7, 0.75, 0.85).
  - `postPlan(settings, { ride: boolean }) -> string[]` pass names in order, from
    `["render", "atmos", "bloom", "output"]`; `atmos` only when `ssao` or `sunRays`; depth of field is part of
    `atmos` and only on in ride views.
  - `engineFor(canvas, { createRenderer }?) -> Engine` — one per canvas (WeakMap), created on first use.
    `Engine`: `resize(width, height, pixelRatio)`, `setQuality(settings)`, `beginFrame()` (binds the scene
    target, clears), `renderScene(scene, camera, rect?)`, `target` (the bound target, for the adapter),
    `present(camera, env)` (runs the post chain to the screen, or does nothing extra without post),
    `renderer` (the shared `WebGLRenderer`), `dispose()`.
  - `cameraFromMatrices(camera, view, projection)` in `engine/camera.js` (moved from `ThreeRenderer#setCamera`).
  - `materials.js`: `addHook(material, hook)` stacking `onBeforeCompile`s, and hooks `grain(opts)`,
    `cloudShadows(uniforms)`, `heightFog(uniforms)` ported from the reference's `core/geo.js` and
    `core/shared.js`; `shaderChunks.js` holds their GLSL strings. No module-level mutable uniforms: shared
    uniforms are created by `createSharedUniforms()` and owned by the scene (Task 6).
  - `ThreeRenderer` constructor option `renderer` (a shared `WebGLRenderer`; when given, `dispose` does not
    dispose it), `begin(frame)` with `frame.overlay === true`: no clear, no sky, output linearised
    (`u_linearOut = 1`), and every `setRenderTarget(null)` inside the adapter becomes
    `setRenderTarget(restoreTarget)` where `restoreTarget` is the target bound when the pass started.
- [ ] **Step 1: Failing tests**: quality — `each level has every switch`, `levels never get lighter going up`
  (shadowMapSize, msaa, ssao samples, sunRays non-decreasing). postPlan — `low has no atmosphere pass`,
  `ultra has every pass`, `depth of field only while riding`. engine (fake renderer from
  `threeRenderer.test.js`, moved to `client/test/support/fakeRenderer.js` and extended with
  `getRenderTarget`, `render` recording `(scene, camera, target)`): `one engine per canvas`
  (`engineFor(c) === engineFor(c)`, a second canvas gets another), `a frame renders the scene into the scene
  target`, `present draws to the screen last`, `resize keeps the target in device pixels`. ThreeRenderer —
  `an overlay pass neither clears nor draws the sky`, `an overlay pass draws into the engine's target`,
  `the shadow pass hands the target back` (bind target T, run a shadow pass, assert the last
  `setRenderTarget` is T), `overlay output is linear` (`u_linearOut` is 1 in overlay, 0 otherwise), `a shared
  renderer outlives the adapter`.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. `post.js` ports the reference's `core/post.js` without `InkPass` and the comic style:
  MSAA scene target with a depth texture, `RenderPass` replaced by the engine's own scene target (the passes
  read it), `AtmosPass` (SSAO, sun rays, far depth of field), `UnrealBloomPass`, `OutputPass` with the colour
  grade (ACES filmic, exposure from `env.exposure`). Built only in the browser path; node tests cover
  `postPlan` and the engine's call order with post disabled. In `shaders.js` the mesh fragment shaders end with
  `if (u_linearOut > 0.5) color.rgb = pow(color.rgb, vec3(2.2));`.
- [ ] **Step 4:** Run all client tests and lint; `npm run preload`. Commit
  `feat(client): Render through one engine per canvas with a post-processing chain`.

### Task 6: World scene: terrain, sea and sky, wired into View3D

**Files:**
- Create: `client/public/js/view3d/scene/terrainLayer.js`, `scene/sea.js`, `scene/sky.js`,
  `scene/worldScene.js`, `scene/tracker.js`
- Modify: `client/public/js/view3d/view3d.js`, `client/public/js/view3d/world.js` (drop the old terrain chunk,
  horizon mesh, water and cloud meshes from `buildWorld`; delete `buildTerrain`, `buildWater`, `buildClouds`
  and their tests once nothing imports them)
- Test: `client/test/worldScene.test.js`, `client/test/terrainLayer.test.js`, `client/test/view3d.test.js`

**Interfaces:**
- Consumes: Task 4's `ground: { near, far }`, Task 2's `environmentAt`, Task 5's engine, materials, quality.
- Produces:
  - Every layer: `createXLayer(input, { uniforms, settings, track }) -> { object: THREE.Object3D,
    update(frame), setEnvironment(env), dispose() }`; `frame = { dt, t, camera, focus }`.
  - `createTerrainLayer(ground, …)`: tiles of 64×64 cells from `ground.near` (and one mesh for `ground.far`
    with a hole under the near grid), `MeshStandardMaterial` with vertex colours, `grain` and `cloudShadows`
    hooks, receives shadows; tiles entirely below `ground.water - 3` are skipped.
  - `createSea(ground, …)`: the reference's ocean (`buildOcean` in `js/world.js`), at `ground.near.water`.
  - `createSky(…)`: the reference's sky dome (`buildSky`, `SU` uniforms) with sun, moon, stars by `env.stars`
    and its cloud layer by `env` (no aurora, rainbow or floating islands).
  - `createWorldScene(world, { settings, track }) -> { scene: THREE.Scene, sun: DirectionalLight, update(frame),
    setEnvironment(env), dispose() }` — composes the layers, a hemisphere light and the sun (shadow box follows
    `frame.focus`; size from `settings.shadowMapSize`, off at 0), and `scene.fog` with the height-fog hook.
  - `createTracker() -> { track(resource) -> resource, live() -> number, disposeAll() }` for tests and for the
    scene's own bookkeeping.
  - `View3D`: builds the world scene from the world's `ground`; per frame: `engine.beginFrame()`,
    `worldScene.update(frame)`, `engine.renderScene(worldScene.scene, camera)`, adapter passes with
    `overlay: true`, side view through `renderScene(…, rect)` plus the adapter, then `engine.present(camera,
    env)`. `setTimeMode` and a new `setSeason(season)` recompute `env` and call `setEnvironment`.
    `dispose()` disposes the world scene, never the engine.
- [ ] **Step 1: Failing tests**: `a world scene holds terrain, sea, sky and the sun` (names on the objects);
  `tiles under the sea are skipped`; `the far ground leaves a hole under the near grid` (no far triangle centre
  inside the near grid's bounds); `the sun's shadow map follows the quality` (0 → `castShadow` off);
  `setEnvironment moves the sun` (sun light position direction equals `env.sun`); `disposing the world scene
  disposes everything it created` (tracker `live() === 0` after `dispose()`); `a new season rebuilds
  without leaks` (build, dispose, build: live count equals one build's); View3D with a fake engine:
  `a frame draws the world before the riders and presents last`; `night darkens the frame` (`present` gets
  `env.night === 1` after `setTimeMode("night")`); `view3d no longer draws the old terrain, sea or clouds`.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement; port the reference's GLSL into `shaderChunks.js` or the layer files as exported
  strings, restyled to the project's lint and naming (no single-letter globals, no `CFG`/`HY` globals). Add an
  attribution line to `client/public/js/view3d/NOTICE.md` naming the reference ("Isle of Seasons" handover,
  original procedural code, taken under the project licence).
- [ ] **Step 4:** Run all client tests and lint; `npm run preload`. Commit
  `feat(client): Draw the ground, sea and sky as a Three.js scene`.

### Task 7 (main session): Shots, merge, check, push

- [ ] Shoot the step-1 camera list (`make world-shots`, Playwright image `v1.65.1-noble`, 1×) into
  `~/.cache/openradlr/screenshots/part1/`, plus the ride-coast and drone-island cameras at Night and in each
  season (`?season=`, time picker). Compare with `baseline/`.
- [ ] Milestone review of the part's diff (layering, colour spaces, disposal, file sizes).
- [ ] Merge `origin/main`, run the full check (client and Rust), push `feat/polished-world`.
- [ ] Show the owner the shots; part 2 starts after their review.
