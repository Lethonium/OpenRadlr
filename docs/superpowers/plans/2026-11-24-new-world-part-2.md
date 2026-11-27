# New World Part 2: Regions, Plants, Roads and Rivers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The island gets its regions, and the new Three.js scene draws its plants (grass rings, crop fields, woods,
roadside clumps), roads, rivers and bridges; the adapter keeps only buildings, landmarks, people and features.

**Architecture:** Pure placement in `world/` (regions, masks, plan modules, road and river strips) runs in the
worker and returns typed arrays. `view3d/assets/nature/` holds the reference's plant assets restyled to the house
rules; `view3d/scene/` gets one layer per kind (grass, crops, forest, roadside, roads, rivers), each with the
shape `{object, update(frame), setEnvironment(env), dispose()}`. A Three.js workbench replaces the 2D gallery.

**Tech Stack:** plain ES modules, vendored Three.js r170, node:test, Playwright for shots.

**Spec:** `docs/superpowers/specs/2026-11-24-new-world-design.md` (sections Architecture, Regions, Ground, Roads,
Plants, Quality levels, Workbench, Order of work item 2). Part 1's plan
(`docs/superpowers/plans/2026-11-24-new-world-part-1.md`) holds the commands and the conventions this plan reuses.

## Global Constraints

- Layer order `world/ → view3d/assets/ → view3d/scene/ → view3d/engine/ → View3D`, enforced by `client/layering.mjs`.
  `world/` imports nothing from `view3d/` (Task 1 removes the `noise.js` exception).
- No module-level mutable state; constants frozen; JSDoc with types on every export; files about 300 lines at most.
- Placement is a pure, seeded function of map, routes, seed, season and detail; same input → same output.
- Whoever creates a geometry, material or texture disposes of it; scene layers own theirs through the tracker
  (`scene/tracker.js`, `createOwner(track)`).
- Textures are built from pure data (`THREE.DataTexture` from typed arrays), never from a DOM canvas, so node tests
  can build every layer.
- Reference code is restyled, not pasted; each taken file gets a line in `view3d/NOTICE.md`.
- Nothing grows on a road, junction pad, river or bridge; the road keeps today's paths, widths and heights
  (`roadFrame`, `roadHalfWidth`, `ROAD_LIFT`).
- Route files without a road network (procedural `terrainModel`, e.g. `riverside-flats`) still get plants, road
  and rivers.
- UI text only through `js/i18n/en.js` and `de.js`; GLSL lines carry `// i18n-ok`.
- Commits: Conventional Commits, imperative; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Plants on the road:** a tree, crop or grass blade on asphalt, a pad or in a river is the most visible bug →
   Task 3's mask test samples every placed item against the road and river distance.
2. **Worker payload size:** planning trees for a 9 km island must not freeze loading → Task 3 pins per-level
   item budgets on the fixture and the long route; plans are typed arrays, transferred.
3. **Season switch without reload:** changing the season rebuilds crops, foliage and grass colour without leaks →
   Task 5's disposal test builds, switches season and disposes, counting every resource.
4. **Road seam with the terrain:** the new road must sit exactly where the old one sat (no floating, no z-fight)
   → Task 6 asserts the strip's centre heights equal `roadFrame` + `ROAD_LIFT`.
5. **Low quality weight:** Low must not get heavier than today → Task 4 pins per-level budgets (grass blades,
   tree instances, roadside items) and that Low has fewer of each than Medium.

## Known, accepted for this part

- Buildings, farms' barns, villages, landmarks, arches, far islands, spectators and features stay adapter meshes
  (part 3). Their dark shaded sides and pale islands stay until then.
- Animals, weather drawing, night lights stay as today (part 4).

## Commands

Same as part 1: from the repo root,
`docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && node --test 'test/**/*.test.js'"`;
`npm run preload` in the same container after adding or removing modules reachable from `main.js`.
Baseline before Task 1: lint OK, 2022 pass, 0 fail.

---

### Task 1: Pure road, river and terrain helpers move to `world/`

**Files:**
- Create: `client/public/js/world/noise.js` (moved from `view3d/noise.js`), `world/roads.js`, `world/rivers.js`
- Modify: `view3d/world.js`, `view3d/features.js`, every importer of the moved names, `client/layering.mjs`
- Test: move the existing tests of the moved functions into `client/test/roads.test.js` and `rivers.test.js`

**Interfaces:**
- Produces (`world/roads.js`): `LANE_WIDTH`, `SHOULDER`, `VERGE`, `ROAD_LIFT`, `roadHalfWidth(lanes)`,
  `roadFrame(route, d)`, `riderPosition(route, d, lane)`, `RoadIndex`, `mapSeed`, `mapBounds(routes)`,
  `terrainModel(routes, {seed})`, `networkTerrain(network, roads, {keepClear})`, `waterLevel(index)`,
  `junctionClearings(network)`, `junctionBankAt(points, x, z)` and the `JUNCTION_*` constants.
- Produces (`world/rivers.js`): `RIVER`, `BRIDGE_HALF_LENGTH`, `buildRiverPath(route, baseTerrain, at, seed, seaLevel)`,
  `withRivers(base, rivers, floor)`.
- `world/noise.js` exports what `view3d/noise.js` exported; `view3d/noise.js` is deleted.

- [ ] **Step 1:** In `layering.mjs` drop the `js/view3d/noise.js` exception for `world/`. Run the layering test:
  FAIL naming `groundGrid.js` (and `seasons`/others if they import it).
- [ ] **Step 2:** Move the code, algorithms unchanged; `view3d/world.js` and `features.js` import from `world/`
  (this also ends their circular import). Update all importers (`view3d.js`, `banners.js`, `menuCamera.js`,
  `highlight.js`, `chaseCamera.js`, `view/rideMapView.js`, `view/rideMapDecor.js`, tests) to import from `world/`
  directly; no re-export shims.
- [ ] **Step 3:** Full suite and lint: PASS, same count as baseline. `npm run preload`.
- [ ] **Step 4:** Commit `refactor(client): Move the pure road, river and noise helpers into world/`.

### Task 2: Regions

**Files:**
- Create: `client/public/js/world/regions.js`, `world/regionKinds.js`
- Modify: `client/public/js/route/network.js` (parse `regions`), `routes/maps/valley.json` (add the regions)
- Test: `client/test/regions.test.js`

**Interfaces:**
- Produces: `REGION_KINDS` (frozen array: `meadow`, `farmBelt`, `deepWood`, `wetland`, `highCountry`,
  `pineCoast`, `oliveTerraces`, `lavenderFields`, `almondValley`); `regionAt(x, z, regions, seed) →
  {kind, weight}[]` (strongest first, from #127, `git show pr127:client/public/js/land/regions.js`);
  `regionMix(x, z, regions, seed) → {kind, weight}[]` that always sums to 1, filling the rest with `meadow`.
- `REGION_STYLE[kind]` (frozen) in `regionKinds.js`:
  `{ground: {spring, summer, autumn, winter}: [r,g,b] linear tint, trees: {mix: {plantId: share}, density /ha},
  verge: {mix: {plantId: share}, perMetre}, props: {kinds, every}, fieldShare, crops: {spring, summer, autumn,
  winter}: cropId[]}`. Plant ids are asset ids of Task 4: `broadleaf`, `poplar`, `birch`, `cypress`, `pine`,
  `umbrellaPine`, `olive`, `almond`, `bush`, `lavender`, `rock`. Seed the values from #127's
  `view3d/regions/styles.js` (`git show pr127:…`); `blossomValley` becomes `almondValley`; `meadow` is the calm
  green interior default; `fieldShare` of `farmBelt` 0.55, `meadow` 0.3, Mediterranean kinds ≤ 0.15, so farmland
  stays about a third of the lowland.
- `network.regions`: `{id, kind, center: [x, -y], radius}[]` (empty array when the file has none).

- [ ] **Step 1: Failing tests** in `regions.test.js`:
  - `regionAt is empty without regions`; `regionMix fills with meadow` (sum of weights is 1 ± 1e-9 at 50 random
    points of a fixture with two regions).
  - `a region centre is that region` (weight 1 at the centre), `far outside a region is meadow`.
  - `edges blend`: on a line across an edge there is a point where two kinds both weigh > 0.2.
  - `every kind has a full style`: each `REGION_KINDS` entry has `ground` for all four `SEASONS`, tree shares that
    sum to 1, crops for all four seasons.
  - `the lowland is about a third farmland`: area-weighted `fieldShare` over the valley regions plus meadow on a
    100 m grid of the island's land below 120 m lies in [0.25, 0.42].
  - `the network reads regions` from a minimal map file; a file without `regions` gives `[]`.
- [ ] **Step 2:** Run: FAIL (modules missing). **Step 3:** Implement; add #127's eleven regions to
  `valley.json` (`blossomValley` → `almondValley`). **Step 4:** PASS, lint. **Step 5:** Commit
  `feat(client): Give the island regions with their own plants and colours`.

### Task 3: The plant plan in the worker

**Files:**
- Create: `client/public/js/world/plan/masks.js`, `plan/woods.js`, `plan/fields.js`, `plan/roadside.js`,
  `plan/index.js`
- Modify: `view3d/world.js` (`buildWorld` calls `planWorld`, returns `plan`), `view3d/worldScene.js`
  (`sceneOf`, `transferList` include the plan), `world/groundGrid.js` (field and region tint in the ground colour)
- Test: `client/test/plan.test.js` (+ fixture helper in `test/support/planFixture.js`)

**Interfaces:**
- `planWorld({terrain, roads, rivers, regions, seed, season, detail, bounds}) → WorldPlan`, where `roads` is the
  `RoadIndex` and `detail` is `"low" | "medium" | "high" | "ultra"`. `WorldPlan`:
  `{trees: {[plantId]: Float32Array /* x,y,z,yaw,scale per item */}, fields: Field[], roadside:
  {[plantId]: Float32Array}, masks: {cell, x0, z0, columns, rows, data: Uint8Array /* 0 free, 1 road, 2 river,
  3 field */}}`; `Field = {x, z, width, depth, yaw, crop, corners: Float32Array(12)}`.
- `masks.js`: `buildMasks({roads, rivers, bounds, cell = 4}) → masks`, `clearAt(masks, x, z) → boolean`.
- Budgets per detail level (frozen `PLAN_BUDGET` in `plan/index.js`): trees low 6000 / medium 14000 / high 26000 /
  ultra 40000; roadside items low 4000 / medium 9000 / high 16000 / ultra 24000; trees thin by distance from the
  route beyond 1500 m (half density) so the budget goes where riders look.

- [ ] **Step 1: Failing tests** in `plan.test.js` on the fixture (small network map with two regions, one river,
  one junction) and on the long route (`routes/` file used by `longRoute.test.js`):
  - `nothing grows on roads or rivers`: every tree and roadside item is ≥ `roadHalfWidth + VERGE + 1` from the
    nearest road centre line and ≥ `RIVER.halfWidth + 2` from a river; no field corner lies on a road.
  - `the plan is deterministic`: two calls with the same input give byte-equal arrays.
  - `region character`: in an `oliveTerraces` disc ≥ 60 % of trees are `olive`; in `deepWood` tree density is ≥ 3×
    that of `meadow`.
  - `roadside stays near the road`: every roadside item is within 25 m of a road.
  - `budgets per level`: counts ≤ `PLAN_BUDGET[level]`, and low < medium < high < ultra for trees and roadside.
  - `seasons change crops, not positions`: tree positions equal across seasons; field crops come from the region's
    season list.
  - `a route file without a network gets a plan` (procedural `terrainModel`).
  - `the plan transfers`: `transferList(sceneOf(world))` contains every plan buffer.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; seeded random from `world/noise.js`/`mapSeed`; trees by Poisson-ish
  jittered grid per region density; fields as rotated rectangles along roads in field-share areas, kept off masks.
  `groundGrid` tints by `regionMix` and paints field rectangles as earth under crops. **Step 4:** PASS, lint,
  preload. **Step 5:** Commit `feat(client): Plan the island's woods, fields and verges in the world worker`.

### Task 4: Plant assets and their materials

**Files:**
- Create: `client/public/js/view3d/assets/nature/foliage.js` (from REF `_foliage.js`, textures as DataTexture),
  `nature/broadleaf.js` (shapes round, poplar, birch, cypress), `nature/pine.js`, `nature/bush.js`, `nature/rock.js`,
  `nature/grass.js` (REF `grass-field.js`: `createField`, `RINGS` → quality), `nature/crops.js` (REF
  `crop-field.js` + pumpkin, hay bale), and new `nature/olive.js`, `nature/umbrellaPine.js`, `nature/lavender.js`,
  `nature/almond.js`; `assets/nature/index.js` (registry `NATURE` by plant id)
- Modify: `view3d/assets/materials.js` (add `windify(material, amplitude, uniforms)`, `translucent(material,
  amount, uniforms)` from REF `core/geo.js`), `view3d/quality.js`, `view3d/NOTICE.md`
- Test: `client/test/natureAssets.test.js`, `client/test/quality.test.js`

**Interfaces:**
- Every plant asset: `meta = {id, name, category: "nature", options}` and `parts({season, detail}) →
  {near: {geometry, material}[], far: {geometry, material}[]}` (leaf cards near, hulls far) plus
  `create(opts) → {object, update?(frame), dispose()}` for the workbench. Ground at y = 0, +Y up, metres.
  Season: `almond` blossoms in spring, broadleaves turn in autumn and are bare in winter, `olive`/`pine`/
  `umbrellaPine` stay green, snow tint in winter.
- Quality adds (frozen, per level): `grassRings` (REF `RINGS`: low 10/30/80/160, high 14/44/115/250, ultra
  18/56/145/330; medium between low and high), `treeLod: {cards, hulls}` (low 420/1400, medium 600/2000, high
  750/2600, ultra 1300/3600), `leafShadows` (false on low), `roadsideReach` (low 120, medium 200, high 300,
  ultra 400 m).

- [ ] **Step 1: Failing tests** in `natureAssets.test.js`, for each id in `NATURE` and each season:
  - `sits on the ground`: bounding box min y within [-0.05, 0.05].
  - `has near and far parts`; `far has fewer triangles than near`.
  - `triangle budget`: near ≤ 1200 triangles per tree, ≤ 400 per bush/lavender clump, far ≤ 120.
  - `winter broadleaves are bare` (no leaf-card part); `almond blossoms in spring` (card colour differs from
    summer).
  - `create and dispose`: through a counting tracker every geometry, material and texture created is disposed.
  - `quality tables`: rings strictly increasing per level; Low's outer ring < Medium's; `treeLod.cards < hulls`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement, restyling the reference (no `CFG` globals; per-module frozen tables).
  **Step 4:** PASS, lint. **Step 5:** Commit `feat(client): Add the island's plants as Three.js assets`.

### Task 5: Plant layers in the world scene

**Files:**
- Create: `client/public/js/view3d/scene/forestLayer.js` (chunked instancing by 300 m cells, cards near / hulls far
  by `treeLod`, visibility per frame from `frame.camera`), `scene/grassLayer.js` (camera-centred rings from
  `grassRings`, height/colour/mask DataTextures from the ground grid and `plan.masks`), `scene/cropLayer.js`,
  `scene/roadsideLayer.js`
- Modify: `scene/worldScene.js` (compose them; `setSeason` rebuild path), `view3d/view3d.js` (season change
  rebuilds the plant layers from the world's plan without a new worker run when only colours/crops change),
  `scene/terrainLayer.js` (REF `grassFloor`: terrain beyond the last grass ring shades like grass)
- Test: `client/test/plantLayers.test.js`, extend `worldScene.test.js`

**Interfaces:**
- `createForestLayer(plan, {assets, settings, uniforms, track})`, `createGrassLayer(ground, plan,
  {settings, uniforms, track})`, `createCropLayer(plan, {assets, settings, uniforms, track})`,
  `createRoadsideLayer(plan, {assets, settings, uniforms, track})`; each returns
  `{object, update(frame), setEnvironment(env), dispose()}`.
- `worldScene.setSeason(season, plan)`: rebuilds crop, forest and grass colour, disposes the old ones.

- [ ] **Step 1: Failing tests** in `plantLayers.test.js` (fixture plan from Task 3):
  - `one instanced mesh per plant, part and chunk`; instance count equals plan items in that chunk.
  - `cards near, hulls far`: with the camera at a chunk, that chunk's cards are visible and hulls hidden; at
    `treeLod.cards + 1` m the reverse; beyond `hulls` both hidden.
  - `grass follows the camera`: after `update` with the camera moved 500 m, ring centres moved with it (snapped).
  - `low has no leaf shadows`: `castShadow` false on card meshes at Low, true at High.
  - `season switch leaks nothing`: build at summer, `setSeason("winter", plan)`, dispose → tracker reports every
    created resource disposed.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, lint, preload. **Step 5:** Commit
  `feat(client): Draw grass, woods, fields and verges in the new scene`.

### Task 6: Roads, rivers and bridges in the new scene

**Files:**
- Create: `client/public/js/world/plan/roadStrips.js` (pure: cross-section strips with UVs for asphalt, verges and
  junction pads, from the same samples `buildRoad`/`buildJunctionPad` use today), `world/plan/riverStrips.js`
  (river ribbons and bridge decks/abutments from `buildRiverPath`/`buildBridge` logic),
  `view3d/assets/road.js` (asphalt and marking DataTextures: 12 m tile, edge lines, dashed centre, per season tint;
  reflector post and guard-rail parts from REF `road-furniture.js`), `view3d/scene/roadLayer.js`,
  `view3d/scene/riverLayer.js` (REF river shader: flow, banks, fog)
- Modify: `view3d/world.js` (`buildWorld` returns `roads`/`rivers` strips in the plan instead of the `road` chunk
  and `rivers` mesh), `view3d/view3d.js` (stops drawing `rivers` and the road chunk), `scene/worldScene.js`
- Test: `client/test/roadStrips.test.js`, `client/test/roadLayer.test.js`

**Interfaces:**
- `roadStrips(route, terrain, {lanes, lift = ROAD_LIFT, step, clear, bankAt}) → {positions: Float32Array,
  uvs: Float32Array, kinds: Uint8Array /* 0 asphalt, 1 verge, 2 marking */, indices: Uint32Array}`;
  `junctionPads(network, terrain, opts)` same shape.
- `riverStrips(rivers, terrain) → {positions, uvs, flow: Float32Array, indices}`; `bridges(route, terrain,
  rivers) → {decks: Float32Array, rails: Float32Array}`.
- `createRoadLayer(plan, {assets, settings, uniforms, track})`, `createRiverLayer(plan, {...})`.

- [ ] **Step 1: Failing tests** in `roadStrips.test.js`:
  - `the road sits where it sat`: for 200 samples along the fixture route, the strip's centre height equals
    `roadFrame(route, d).position[1] + ROAD_LIFT` within 0.02 m, and its half-width equals `roadHalfWidth(lanes)`.
  - `uv runs along the road`: u increases monotonically with distance, one 12 m tile per unit.
  - `pads cover junctions`: each junction node lies inside its pad polygon.
  - `rivers flow downhill`: `flow` heights never rise along a river by more than `RIVER.rise`.
  - `every road crossing of a river has a bridge` whose deck height ≥ the road height there.
  - In `roadLayer.test.js`: `textures are data textures` (no canvas), `dispose leaks nothing`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; delete `buildRoad`, `buildJunctionPad`, `buildRiverWater`,
  `buildBridge` and the road chunk once nothing imports them (grep first; `buildRoadside` markers/signs/cliffs that
  part 3 still needs stay). **Step 4:** PASS, lint, preload. **Step 5:** Commit
  `feat(client): Draw roads, rivers and bridges in the new scene`.

### Task 7: Old plants go; the workbench replaces the gallery

**Files:**
- Delete: `buildScenery`, `buildGroundDetail` (`view3d/world.js`), the `flora` of both biomes
  (`biomes/temperate.js`, `biomes/winter/flora.js`) and their tests; `client/public/gallery.html`, `gallery.css`,
  `js/gallery.js`
- Create: `client/public/workbench.html`, `client/public/workbench.css`, `client/public/js/workbench.js` (composition
  root: asset list from `NATURE`, turntable, day/night toggle via `environmentAt`, options panel from
  `meta.options`, triangle and draw-call stats; uses `engineFor(canvas)` and the same post chain)
- Modify: `client/worldShotList.mjs` and `worldShots.mjs` (`gallery` kind → `workbench`, `?asset=<id>&season=`),
  `client/worldShots.json`, `AGENTS.md` (composition roots), tests that referenced the removed code
- Test: `client/test/workbench.test.js` (pure parts: `workbenchState(search)` parses `?asset=&season=&time=`;
  unknown asset falls back to the first), `worldShotList.test.js`

- [ ] **Step 1:** Failing tests for `workbenchState` and the `workbench` shot kind. **Step 2:** FAIL.
- [ ] **Step 3:** Implement; expose `globalThis.Workbench = {select(id), setOption(key, value), setSeason(s),
  setTime(t)}` for headless shots (dev page only). Delete the old code; grep for importers first.
- [ ] **Step 4:** Full suite PASS, lint, preload. **Step 5:** Commit
  `feat(client)!: Replace the model gallery with a Three.js workbench`.

### Task 8 (main session): Shots, review, merge, push

- [ ] Shots into `~/.cache/openradlr/screenshots/part2/`: the step-1 list, the part-1 extras (night, seasons),
  plus workbench shots of each plant in summer and winter. Compare with `part1/` and the reference.
- [ ] Milestone review (layering, disposal, budgets, file sizes, removed code really gone); break one test on
  purpose.
- [ ] Merge `origin/main`, full check (client and Rust), push, show the owner.
