# Living island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third view choice, Living, that makes the island look inhabited, moving and a bit playful, while plain 3D stays exactly as it is.

**Architecture:** A `living` flag travels through the existing world build (worker, `buildWorld`, scene). When it applies, pure modules in `view3d/living/` lay out fields, paint one ground texture, and add a `life` chunk group plus a plain list of movers; the view draws these with the existing chunk and per-object paths. Everything is gated by the flag, so the plain world is untouched.

**Tech Stack:** Plain ES modules, WebGL2 through the project's own renderer, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-living-island-design.md`

**Commands** (Node is not on the host; the repo root must be mounted):

```sh
# One test file (run from anywhere)
docker run --rm -v /root/projects/Open-Ride:/w -w /w/client node:22-alpine node --test test/<file>.test.js
# Lint and every client test ("CHECK" below)
docker run --rm -v /root/projects/Open-Ride:/w -w /w/client node:22-alpine sh -c "npm run lint && npm test"
```

## Global Constraints

- Living adds at most 1,650,000 vertices on the valley map (4,722,774 today).
- Extra world build time: target 3 s or less on the valley map.
- Ground map: RGBA8, 2048×2048, about 22 MB with mipmaps.
- At most 150 mover draw calls per frame, nearest first; balloons always count.
- Living is cosmetic: terrain heights, roads, zones, cafés, gyms, statue rows and `overview` are identical with it on or off (ADR 0018).
- With Living off, `buildWorld` output is identical to today's.
- Deterministic from the map seed. No `Math.random`, `Date` or I/O in `view3d/living/`.
- Nothing placed or moving on roads, verges, rivers, cafés, gyms, statue rows or junction sight lines.
- Living falls back to plain 3D for a biome without `biome.living`, a world without a road network, or an island box longer than 16 km on a side.
- UI text only through `i18n/en.js` and `de.js` (ADR 0017), with the button named "Living".
- `openride.living` is `"on"` or `"off"`; `app.viewMode` stays `"3d"` for Living.
- Rider-facing order of the view choice: 2D, 3D, Living.
- Commits: imperative message, `Part of #48.`, the session's `Co-Authored-By` trailer, no model names. Every commit passes CHECK. Do not push or open a PR until asked.

## Review Focus

- Rider flips Living on and off quickly while a world builds: the last pick wins, and no stale world is swapped in (test in Task 1).
- A device whose WebGL `MAX_TEXTURE_SIZE` is under 2048: terrain keeps its vertex colours rather than failing (test in Task 2).
- Switching Living off, or leaving the ride: the 22 MB texture is freed, with no leak over repeated switches (test in Task 2).
- `openride.living` holds a garbage value, or storage is unavailable: treated as unset, no crash (test in Task 1).
- A ride lasting hours: movers stay continuous at the wrap of their path, with no jumps (test in Task 5).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `client/public/js/view3d/living/setting.js` | Pure setting logic: default, saved value, view choice |
| `client/public/js/view3d/living/index.js` | Eligibility; `planLiving` and `finishLiving`, called by `buildWorld` |
| `client/public/js/view3d/living/temperate.js` | Temperate's `living` hook: crop colours, budgets, flora |
| `client/public/js/view3d/living/fields.js` | Coarse ground grid, parcels, land classes, woods |
| `client/public/js/view3d/living/groundMap.js` | Paints the texture |
| `client/public/js/view3d/living/dressing.js` | Woods, hedges, walls, orchards, fences, props |
| `client/public/js/view3d/living/coast.js` | Beach and harbour objects |
| `client/public/js/view3d/living/movers.js` | Mover lists, `moverPose`, `selectMovers` |
| `client/public/js/view3d/living/whimsy.js` | Playful landmarks, roadside scenes, giant bicycle |
| `client/test/livingFixture.js` | Small fake island terrain for unit tests |
| `client/test/livingSetting.test.js`, `livingFields.test.js`, `livingGroundMap.test.js`, `livingDressing.test.js`, `livingMovers.test.js`, `livingWorld.test.js` | Tests; only `livingWorld` builds the full valley map |

Modified: `view3d/world.js`, `worldScene.js`, `worldWorker.js`, `renderer.js`, `view3d.js`, `features.js` (`buildFarms`), `biomes/temperate.js`, `view/menuStage.js`, `view/viewControls.js`, `view/viewPopover.js`, `main.js`, `index.html`, `i18n/en.js`, `i18n/de.js`.

---

### Task 1: Setting and plumbing, with no visible change

**Files:**
- Create: `client/public/js/view3d/living/setting.js`, `client/test/livingSetting.test.js`
- Modify: `view3d/world.js:957`, `worldScene.js:15,28,44`, `worldWorker.js:6`, `view/menuStage.js:28,41,104,249-289,451`, `main.js` (`buildRideWorld`, `setBiome` neighbour, menu `deps`, popover `onPick`, `toggleView`)
- Test: `client/test/startMenu.test.js` (or whichever file already fakes `MenuStage` deps)

**Interfaces:**
- Produces:
  - `LIVING_KEY = "openride.living"`
  - `livingDefault({ deviceMemory?: number, coarsePointer: boolean, narrow: boolean }) -> boolean`
  - `resolveLiving(saved: string|null|undefined, device) -> boolean`
  - `viewChoice(mode: "2d"|"3d", living: boolean) -> "2d"|"3d"|"living"`
  - `fromViewChoice(id: string) -> { mode: "2d"|"3d", living: boolean|null }` (`null`: leave Living as it is)
  - `buildScene(file, others, { network, biome, living })`, `buildSceneNow(file, others, network, biome, living = false)`, `buildWorld(route, { others, network, biome, living = false })`; `scene.living` is `null` for now
  - `MenuStage` dep `living: () => boolean` and method `livingChanged()`
  - `setLiving(on: boolean)` in `main.js`

- [ ] **Step 1: Write the failing tests** in `livingSetting.test.js`:

```js
test("off on low memory and on phones, otherwise on", () => {
  assert.equal(livingDefault({ deviceMemory: 2, coarsePointer: false, narrow: false }), false);
  assert.equal(livingDefault({ deviceMemory: 8, coarsePointer: true, narrow: true }), false);
  assert.equal(livingDefault({ deviceMemory: 8, coarsePointer: false, narrow: false }), true);
  assert.equal(livingDefault({ coarsePointer: false, narrow: false }), true, "no memory report counts as enough");
});
test("an explicit choice wins over the default", () => {
  const phone = { deviceMemory: 2, coarsePointer: true, narrow: true };
  assert.equal(resolveLiving("on", phone), true);
  assert.equal(resolveLiving("off", { deviceMemory: 16, coarsePointer: false, narrow: false }), false);
});
test("a garbage or missing value counts as unset", () => {
  const desktop = { deviceMemory: 16, coarsePointer: false, narrow: false };
  for (const saved of [null, undefined, "banana", ""]) assert.equal(resolveLiving(saved, desktop), true);
});
test("the view choice maps both ways and 2D leaves Living alone", () => {
  assert.equal(viewChoice("3d", true), "living");
  assert.equal(viewChoice("3d", false), "3d");
  assert.equal(viewChoice("2d", true), "2d");
  assert.deepEqual(fromViewChoice("living"), { mode: "3d", living: true });
  assert.deepEqual(fromViewChoice("3d"), { mode: "3d", living: false });
  assert.deepEqual(fromViewChoice("2d"), { mode: "2d", living: null });
});
```

In the `MenuStage` test file, add:

```js
test("the menu world is rebuilt when Living changes, and the last pick wins", async () => {
  // deps.living() returns a mutable value; deps.buildScene resolves on demand.
  // Flip true → false → true during the build, resolve every build.
  // assert: the view on screen was built with living === true, and no earlier scene replaced it.
});
```

- [ ] **Step 2: Run the tests; expect FAIL** (module not found).
- [ ] **Step 3: Implement `setting.js`.** Phone-like is `coarsePointer && narrow`.
- [ ] **Step 4: Thread the flag.** `buildSceneNow(..., living = false)` passes it to `buildWorld`; `sceneOf` also returns `living`; the worker reads `data.living`; `buildScene` posts it. `buildWorld` sets `world.living = null` for now.
- [ ] **Step 5: `MenuStage`.** `buildKey(routeId, biome, living)`, add `#viewLiving` and `#living()`, and include it everywhere `#viewBiome` / `#biome()` are compared (lines 249, 263, 273, 289, 451). `livingChanged()` mirrors `biomeChanged()`.
- [ ] **Step 6: `main.js`.** `app.living` from `resolveLiving(readSetting(LIVING_KEY), device)`, where `device` uses `navigator.deviceMemory`, `matchMedia("(pointer: coarse)")` and `MENU_NARROW_QUERY`. `setLiving(on)` writes the key, then calls `app.menu?.livingChanged()` or `buildRideWorld()` as `setBiome` does. `buildRideWorld` also captures `living` and rebuilds when `app.living !== living` after the build. Popover `onPick` for `"mode"` goes through `fromViewChoice`: call `setLiving` when `living !== null` and it differs, then `setViewMode(mode)`. `selected().mode` becomes `viewChoice(app.viewMode, app.living)`. `toggleView` is unchanged, since `app.living` persists.
- [ ] **Step 7: Run the tests; expect PASS.** Then run CHECK.
- [ ] **Step 8: Commit** `Carry a Living setting through the world build`

---

### Task 2: Fields, ground map, terrain shader, sky and the button

**Files:**
- Create: `view3d/living/index.js`, `temperate.js`, `fields.js`, `groundMap.js`, `client/test/livingFixture.js`, `livingFields.test.js`, `livingGroundMap.test.js`, `livingWorld.test.js`
- Modify: `view3d/world.js` (`buildWorld`), `biomes/temperate.js`, `renderer.js` (shader, `begin`, new methods), `view3d.js` (upload, terrain draw, dispose, `life` range), `view/viewControls.js`, `view/viewPopover.js:90`, `main.js`, `index.html:609-612`, `i18n/en.js`, `i18n/de.js`
- Test: `client/test/viewControls.test.js:11`, `viewPopover.test.js`, `view3d.test.js` (`StubRenderer`)

**Interfaces:**
- Consumes: `buildWorld`'s `living` flag from Task 1; `terrain` (`height`, `distanceToRoad`, `riverDistance`, `seaLevel`, `seed`, `index.nearest`, `island`).
- Produces:
  - `LIVING_MAX_BOX_M = 16000`; `livingEligible({ biome, network, box: { x0, z0, x1, z1 } }) -> boolean`
  - `groundGrid(terrain, box, cell = 32) -> { heightAt(x, z), steepAt(x, z), riverAt(x, z) }`
  - `buildFields(terrain, grid, { seed, sea, villages: (x, z) => boolean }) -> Fields`
  - `Fields.parcelAt(x, z) -> { id: number, crop: string, angle: number, u: number, v: number, width: number, depth: number, center: [x, z] } | null`
  - `Fields.landAt(x, z) -> "sea"|"sand"|"wetSand"|"dunes"|"river"|"village"|"farm"|"rough"|"moor"|"scree"|"rock"`
  - `Fields.woodAt(x, z) -> number` (0..1)
  - `Fields.edges() -> Iterable<{ a: [x, z], b: [x, z] }>` (straight runs on parcel boundaries)
  - `paintGroundMap({ fields, grid, box, overlays = [] }) -> { width: 2048, height: 2048, data: Uint8Array, x0, z0, size }`
  - Overlay: `{ x0, z0, x1, z1, paint(x, z) -> [r, g, b] | null }` (colours in 0..255)
  - `planLiving({ terrain, biome, zonesOf, ordered, water, seed }) -> plan | null`, `finishLiving(plan, { chunks, occupancy, ... }) -> { groundMap, movers, models }`
  - `scene.living = { groundMap, movers: [], models: {} } | null`; `chunks.life` exists only when Living applies
  - `Renderer.uploadGroundMap(map) -> handle | null`, `Renderer.disposeGroundMap(handle)`, `Renderer.useGroundMap(handle | null)`, `begin({ ..., sky: boolean })`
  - Exported `fitsGroundMap(maxTextureSize: number, width: number) -> boolean`

- [ ] **Step 1: Write the fixture and failing field tests.** `fakeIsland({ radius = 1500, seed = 7 })` returns a terrain with a gently sloped island, one straight road through the centre, a working `index.nearest`, `seaLevel: 0` and `riverDistance: () => Infinity`. In `livingFields.test.js`:

```js
test("every point of a parcel has that parcel's crop", ...);        // sample 2000 points; same id → same crop
test("parcels are 80 to 200 m across", ...);                         // assert width and depth within [80, 200] for every parcel
test("crops are varied and none dominates", ...);                    // ≥5 distinct crops among farm parcels; share of the most common ≤ 0.35
test("neighbouring parcels usually differ", ...);                    // walking across edges, ≥60 % change crop
test("parcel edges are straight", ...);                              // three collinear samples of an edge() share one line, within 0.01 m
test("land classes follow height and slope", ...);                   // sea below 0; sand at +1; moor at +120; rock on steep ground
test("the same seed gives the same fields", ...);                    // deepEqual over sampled parcelAt
test("eligible only with a hook, a network and a small enough box", ...);
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement `fields.js`.** Parcels are blocks of rows, so all edges are straight:

```text
Blocks: jittered-grid Voronoi, cell 650 m, Euclidean. A block's angle = road tangent nearest its seed point.
Inside a block, in its (u, v) frame: rows of constant depth (seeded 110–170 m);
each row splits along u into equal parcels (seeded length 80–200 m, row-dependent offset).
parcelAt: find block (3×3 search) → rotate → row = floor(v / depth), idx = floor((u + offset) / length).
```

Crops are drawn per parcel id from `meadow, pasture, wheat, rapeseed, ploughed, hay, lavender, sunflower`, with lavender and sunflower rare (3 % each). Land classes use, above sea: wet sand below 0.7 m, sand below 2.4 m, dunes below 5 m, farm below 55 m, rough to 95 m, moor to 150 m, scree above; rock where steep > 0.6. River land is within `RIVER.halfWidth + 9` m. Woods: `fbm(x/420, z/420, seed + 11)` above 0.58 on rough and moor land, plus 8 % of farm parcels as a whole.

- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Write failing map tests** in `livingGroundMap.test.js`:

```js
test("the map is 2048² RGBA", ...);                                  // data.length === 2048 * 2048 * 4
test("the map is empty under the sea", ...);                         // a sea pixel has alpha 0
test("land pixels are opaque", ...);                                 // a farm pixel has alpha 255
test("a wood reads darker than a meadow", ...);
test("an overlay paints inside its box only", ...);
test("the same seed paints the same map", ...);                      // byte equality
```

Paint at 512² in unit tests through a `size` option, defaulting to 2048.

- [ ] **Step 6: Implement `groundMap.js`, run; expect PASS.** Colours come from `biome.living.crops`. Furrows: a ±8 % stripe along the parcel's `v` with an 8 m period (hay: 16 m). Tracks: a pale 1-pixel line along a seeded subset of `edges()`. Height and slope come from `grid`, never `terrain.height`.
- [ ] **Step 7: Create `living/temperate.js`, add `living` to `biomes/temperate.js`, and wire `buildWorld`.** After `buildTerrain`, call `planLiving`; before return, call `finishLiving`. Add `chunks.life = new ChunkedMesh()` only when `plan` is non-null.
- [ ] **Step 8: Add failing invariants** in `livingWorld.test.js`, with `routes/maps/valley.json` and `rolling-hills.json`, built once at file scope with `living: true` and `false`:

```js
test("plain world is unaffected", ...);          // living:false has no chunks.life and scene.living === null
test("layout is the same with Living", ...);     // deepEqual: overview, gyms; chunks.road and terrain positions byte-equal
test("winter renders like plain 3D", ...);       // biome "winter", living:true → scene.living === null
test("a huge island falls back", ...);           // livingEligible with a 20 km box → false
test("the build stays within budget", ...);      // added vertices ≤ 1_650_000; log extra build ms
```

Run; fix until PASS.

- [ ] **Step 9: Renderer.** Add `uniform sampler2D u_groundMap; uniform vec4 u_groundBox; uniform float u_groundOn;` to `MESH_FRAGMENT`. Replace `v_color` in the two `lit` lines with an `albedo` that is `v_color` unless `u_groundOn > 0.5`:

```glsl
vec4 g = texture(u_groundMap, (v_world.xz - u_groundBox.xy) * u_groundBox.z);
albedo = mix(v_color, g.rgb, g.a);
// fine speckle, fading out by 150 m: ±6 % from a hash of floor(v_world.xz * 2.0)
```

In `begin`, always set `u_groundMap` to texture unit 1: a `sampler2D` and the `sampler2DShadow` on one unit is a GL error. Bind a 1×1 transparent texture to unit 1 when no map is in use. `begin({ sky = false })` draws the sky with `gl.depthFunc(gl.LEQUAL)` when true and restores `LESS` after. `uploadGroundMap` returns `null` when `!fitsGroundMap(gl.getParameter(gl.MAX_TEXTURE_SIZE), map.width)`; otherwise RGBA8 with `generateMipmap`, trilinear, and anisotropy 4 if `EXT_texture_filter_anisotropic` exists.

- [ ] **Step 10: View.** Add `life: 1600` to `SCENE.drawDistance`, and add `"life"` to the shadow groups only if `this.chunks.life` exists. Upload `world.living?.groundMap` in the constructor. In the render loop, `useGroundMap(handle)` around the `terrain` group only, then `useGroundMap(null)`. Pass `sky: Boolean(this.groundMap)` to `begin`. `dispose()` frees the map. Add `hasLiving` getter. Extend `StubRenderer` in `view3d.test.js` and test:

```js
test("the ground map is used for terrain only and freed on dispose", ...);
test("a device too small for the map keeps vertex colours", ...);    // stub uploadGroundMap → null: no useGroundMap(handle), no throw
test("fitsGroundMap needs at least the map's width", ...);           // fitsGroundMap(1024, 2048) false, (4096, 2048) true
```

- [ ] **Step 11: Show the button.** `viewControls` modes become `2d`, `3d`, `living` (label `t("view.living")`), and update `viewControls.test.js:11`. The popover disables `living` like `3d` when `has3d === false`. Add `#view-living` in `index.html` in the same order. `setViewMode` sets all three `aria-pressed` values from `viewChoice`. In `show3d`, when `app.living && !app.view3d.hasLiving`, set `#view-note` to `t("view.livingUnavailable")`. Add both keys to `en.js` and `de.js`.
- [ ] **Step 12: Render and look.** Run the probe with `living: true` (add the flag to `notes/living-island/probe.js`):

`docker run --rm -v /root/projects/Open-Ride:/app -w /app mcr.microsoft.com/playwright:v1.64.1-noble node notes/living-island/shots.cjs after-2`

Expected: `orbit` shows a field quilt with no blobs and no flat grey high ground.

- [ ] **Step 13: Run CHECK. Commit** `Paint Living's fields into a generated ground map`

---

### Task 3: Static dressing

**Files:**
- Create: `view3d/living/dressing.js`, `client/test/livingDressing.test.js`
- Modify: `view3d/living/index.js`, `living/temperate.js`, `view3d/world.js` (`buildWorld` scenery and detail calls)

**Interfaces:**
- Consumes: `Fields` from Task 2; `Occupancy`; `chunks.life`.
- Produces:
  - `buildWoods(ctx, limit)`, `buildHedges(ctx, limit)`, `buildOrchards(ctx, limit)`, `buildFences(ctx, limit)`, `buildProps(ctx, limit)`, each returning vertices added
  - `ctx = { mesh, fields, terrain, occupancy, keepClear(x, z, radius) -> boolean, random, biome, zonesOf, ordered, water }`
  - `plan.treeBlocked(x, z) -> boolean`
  - `biome.living.flora = { tuft, flower }`
  - `biome.living.budgets = { woods: 400_000, hedges: 400_000, props: 200_000, orchards: 80_000, fences: 60_000, coast: 80_000 }`

- [ ] **Step 1: Write failing tests**, using `fakeIsland`:

```js
test("hedges lie on parcel edges", ...);                    // each hedge box centre is within 1 m of a parcel boundary
test("hedges only within 450 m of a road", ...);
test("about a third of the near edges have a hedge", ...);  // between 0.25 and 0.42 of near edge length
test("stone walls on rough land, hedges in the lowlands", ...);
test("woods gather where woodAt says", ...);                // ≥90 % of wood trees have woodAt > 0
test("nothing lands on a road, verge or kept-clear spot", ...);  // keepClear stubbed true in a region: no vertex inside it
test("every builder stops at its limit", ...);              // limit 3000 → returned count ≤ 3000
test("lone trees in crop parcels are blocked, hedge lines and rough land are not", ...);
test("the living tuft faces up, so it isn't black", ...);   // all tuft normals are [0, 1, 0]
test("the same seed places the same things", ...);          // vertex data byte-equal
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement `dressing.js`.** Cheap wood tree: one cone or ellipsoid, 40 vertices or fewer; detailed trees (`biome.flora.tree`) only where `woodAt` falls off, at the edge. Hedges are `orientedBox` pieces, 8 m long within 150 m of a road and 20 m beyond. Orchards go on parcels within 300 m of a farm or village, in rows 7 m apart along the parcel's `u`. Props are built from `MeshBuilder` primitives and placed with `keepClear` and `occupancy.add`. Bunting uses a village's `zone` across the road at 6 m and goes into the mesh via `segment`; village props stay on `PAVEMENT` or beyond. `treeBlocked` is true on `ploughed`, `wheat`, `rapeseed`, `lavender`, `sunflower`, `hay` parcels when more than 6 m from an edge. The tuft uses `triangleFacing(..., color, [0, 1, 0])`.
- [ ] **Step 4: Wire `buildWorld`.** `blocked` adds `plan?.treeBlocked`. Scenery and ground detail receive `{ ...biome, flora: { ...biome.flora, ...biome.living.flora } }` only when `plan`. `finishLiving` runs the builders in budget order after buildings are placed.
- [ ] **Step 5: Run the tests; expect PASS.** Then run `livingWorld.test.js`; the budget test must stay green.
- [ ] **Step 6: Render `after-3` shots**, and check `low-drone`, `cam-drone` and `chase` for woods, hedges and green verges. Run CHECK.
- [ ] **Step 7: Commit** `Dress Living's land with woods, hedges and farm life`

---

### Task 4: Coast

**Files:**
- Create: `view3d/living/coast.js`
- Modify: `view3d/living/index.js`, `client/test/livingDressing.test.js`

**Interfaces:**
- Consumes: `ctx` from Task 3.
- Produces: `buildCoast(ctx, limit) -> number`; `coastSpots(fields, terrain, seed) -> [{ x, z, seaward: [dx, dz] }]`, also used by Tasks 5 and 6.

- [ ] **Step 1: Write failing tests:**

```js
test("beach huts and parasols stand on sand", ...);                 // landAt under each is sand or dunes
test("the jetty starts at the shore and reaches the water", ...);   // first height ≥ sea, last height < sea
test("moored boats float in shallow water", ...);                   // sea − 6 m < height < sea
test("the coast stops at its limit", ...);
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** `coastSpots` walks `island.radiusAt` at 2° steps and keeps points with a sand band. The jetty goes at the coast spot nearest a village or café.
- [ ] **Step 4: Run; expect PASS. Render, then run CHECK.**
- [ ] **Step 5: Commit** `Add beach huts, a jetty and moored boats to Living's coast`

---

### Task 5: Movers

**Files:**
- Create: `view3d/living/movers.js`, `client/test/livingMovers.test.js`
- Modify: `view3d/features.js` (`buildFarms`), `view3d/living/index.js`, `view3d/view3d.js`, `main.js` (reduced motion to the view)

**Interfaces:**
- Consumes: `Fields`, `coastSpots`, zones.
- Produces:
  - Mover: `{ kind: string, model: string, path: { type: "circle", center, radius, height } | { type: "ping", points: [x, y, z][] }, speed: number, phase: number, scale: number, tint: number[], bright?: boolean }`
  - `moverPose(mover, timeS) -> { position: [x, y, z], yaw: number, pose: 0|1 }`
  - `selectMovers(movers, eye, cap = 150) -> mover[]`
  - `buildMovers(ctx) -> { movers, models: { [model]: [mesh0, mesh1] } }`
  - `buildFarms(..., { movingAnimal?: ({ x, y, z, yaw, kind }) => void })`
  - `View3D.reducedMotion: boolean`

- [ ] **Step 1: Write failing tests:**

```js
test("a tractor never leaves its parcel", ...);                    // parcelAt(pose).id constant over 500 time samples
test("villagers stay on the pavement and never reach the road", ...);
test("boats stay at sea", ...);                                    // height < sea over a full lap
test("balloons stay well above the ground", ...);                  // y − height ≥ 150 m
test("no mover enters a road", ...);                               // distanceToRoad > half width + verge for ground movers
test("a pose is continuous across the path's wrap", ...);          // |pose(t − ε) − pose(t + ε)| small at each lap and at t = 86_400 s
test("selectMovers caps at 150, nearest first, balloons always", ...);
test("counts follow the design", ...);                             // 12 bird flocks, 10 boats, 8 tractors, 3–5 balloons on fakeIsland-scaled values
test("the same seed gives the same movers", ...);
```

In `view3d.test.js`:

```js
test("reduced motion freezes the movers", ...);   // two renders at different timeS draw movers with equal matrices
test("movers are drawn within the frame cap", ...);
```

In `livingWorld.test.js`:

```js
test("a plain world keeps every animal baked in", ...);   // no movingAnimal: structures byte-equal to today's
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement `movers.js`.** `ping` eases at both ends so a turn doesn't snap. Each bird of a flock is one mover with a shared centre and a phase offset. Grazing animals `ping` over a few metres with a long pause built into their easing. Pure function of `timeS`, so nothing accumulates.
- [ ] **Step 4: `buildFarms`.** With `movingAnimal`, every third animal goes to the callback instead of being appended. Consume the same `random()` draws either way, so the plain layout is unchanged.
- [ ] **Step 5: View.** After the rotors, `selectMovers(scene.living.movers, eye)`, then draw by `model` and `pose` with `moverPose(m, this.reducedMotion ? 0 : timeS)`. `bright` movers use `drawBright`. `dispose()` frees the model handles. `main.js` sets `view.reducedMotion` where it already reads the media query.
- [ ] **Step 6: Run the tests; expect PASS. Render, then run CHECK.**
- [ ] **Step 7: Commit** `Add birds, boats, tractors, walkers and balloons to Living`

---

### Task 6: Playful touches

**Files:**
- Create: `view3d/living/whimsy.js`
- Modify: `view3d/living/index.js`, `client/test/livingDressing.test.js`, `client/test/livingMovers.test.js`

**Interfaces:**
- Consumes: `ctx`, `coastSpots`, `Overlay`, the mover shape, `buildPenguin` from `biomes/winter/people.js`, `buildSheep` and `buildHayBale` from `structures.js`.
- Produces: `buildWhimsy(ctx, limit) -> { overlays, movers, models }`; `pickBicycleParcel(fields, terrain, seed) -> parcel | null`.

Note that the overlay feeds `paintGroundMap`, so `finishLiving` calls `buildWhimsy` before painting.

- [ ] **Step 1: Write failing tests:**

```js
test("the giant bicycle sits on a flat parcel beside a road", ...);   // 30–250 m from a road, height range ≤ 4 m
test("the bicycle paints only inside its parcel", ...);               // the overlay returns null outside the parcel
test("the lighthouse stands on a headland, its beam turns", ...);     // land near the sea; beam yaw changes over time
test("the penguin stays on the beach", ...);                          // landAt sand over a full lap
test("the sheep tower and every scene keep clear of the road", ...);
test("about one scene every few kilometres, eight on the valley", ...);  // placed count from road length, min 1, max 8
test("whimsy stops at its limit", ...);
test("the scarecrow waves", ...);                                     // pose changes between two times
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** Bicycle: two circles and a frame drawn in the parcel's `(u, v)` as a distance field. Roadside scenes are a seeded rotation through `gnomes`, `picnic`, `cowInPond`, each built from primitives; `cowInPond` needs a pond from `river.ponds` and is otherwise skipped. The scarecrow is a two-pose mover with zero speed.
- [ ] **Step 4: Run the tests and `livingWorld.test.js`; expect PASS.** Mover models and scenes together stay within 250,000 vertices.
- [ ] **Step 5: Render at day, golden and dusk, then run CHECK.**
- [ ] **Step 6: Commit** `Hide a few playful surprises around the island`

---

### Task 7: Docs

**Files:**
- Create: `docs/adr/0021-living-world-tier.md`
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added), `docs/adr/0018-biomes.md` (one line pointing at 0021 for the `living` hook)

- [ ] **Step 1: Write ADR 0021** (context, decision, consequences): the first generated texture in a renderer that was vertex-colour only (why a map rather than cutting terrain), Living as a view choice rather than a quality level, the separate key, the fallback list, and the budgets.
- [ ] **Step 2: Add the changelog entry** in user terms, ending with `(#48)`.
- [ ] **Step 3: Render the final before/after set** into `notes/living-island/shots/`, and note the final vertex count and extra build time for the PR text.
- [ ] **Step 4: Run CHECK.** Expected: lint clean and every test passing.
- [ ] **Step 5: Commit** `Record the Living tier in an ADR and the changelog`

Frame rates on real hardware stay open for the user to check on a laptop and a phone.
