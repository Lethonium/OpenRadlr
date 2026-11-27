# Three.js world, steps 1 and 2: baseline shots and foundation, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the old 3D world from fixed cameras, then make the whole app draw through a vendored Three.js,
with quality levels defined in one place and the own WebGL renderer deleted.

**Architecture:** Step 1 adds a join point (`?at=<metres>`) and a reproducible shot script driven by a JSON shot
list. Step 2 vendors Three.js r170 as plain files under `client/public/vendor/three/`, imported through one
re-export module by relative path, so there is no import map, no CSP change and node resolves it too. A
`ThreeRenderer` implements the **same interface as today's `Renderer`** (`upload`, `begin`, `draw`, …) on a
Three.js `WebGLRenderer` with `RawShaderMaterial`s built from today's GLSL. `View3D` and `StudioView3D` switch
to it unchanged apart from two new frame fields (`view`, `projection`) and a closing `end()`. The look stays the
same as the baseline; steps 3 and 4 replace the adapter calls with a real scene graph, feature by feature.

**Tech Stack:** plain ES modules, Three.js 0.170.0 (MIT), node:test, Playwright (screenshots only), ESLint.

**Spec:** `docs/superpowers/specs/2026-11-23-three-js-world-design.md`

## Global Constraints

- No build step: the client is plain ES modules served from `client/public`.
- CSP stays `script-src 'self'`; no CDN or other external request at runtime; works offline (LAN server,
  Android app bundling `www`).
- Tests run in plain node, no browser. New behaviour starts with a failing test; one reason to fail per test; no
  sleeps; time/RNG/I/O injected (CONTRIBUTING.md).
- Three.js is vendored and pinned: `three@0.170.0`, with its MIT licence file next to it.
- Screenshots at 1× (deviceScaleFactor 1), saved under `~/.cache/openradlr/screenshots/`, never in the repo.
- PR images go to the orphan `pr-screenshots` branch, folder `polished-world/before/`, uploaded one file at a
  time with `gh api -X PUT repos/Lethonium/OpenRadlr/contents/<path>` (a `git push` of that branch is blocked
  by the local pre-push hook).
- UI text lives in `client/public/js/i18n/en.js` and `de.js` (ADR 0017); both get every new key.
- Conventional Commit messages, imperative. One branch, `feat/polished-world`, ordered commits, each green
  under `make check`.
- Client tests and lint run in Docker with the repo root mounted (tests read `../routes`):
  `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm ci && npm test && npx eslint ."`

## Review Focus

1. **A stored quality of `"low"` or `"high"` from before this branch.** Riders keep exactly the level they had;
   an unknown or missing value reads as `"high"`. Test in Task 9.
2. **`?at=` with garbage, a negative number, or on a studio route.** It's ignored and the normal join happens
   (studio routes never take a resume point). Test in Task 1.
3. **Inset side view (`viewport(rect)`) during a workout.** It must clear and draw only inside its rectangle
   and not wipe the main view. Test in Task 6.
4. **Several passes in one frame (shadows, main view, inset).** Each pass is rendered exactly once, in call
   order, before the next one starts. Test in Task 6.
5. **The vendored Three.js and `package.json` drift apart** (Dependabot bumps `three`). The suite fails until
   `npm run vendor` is re-run. Test in Task 4.

Known, accepted gap: riders' name labels lose occlusion (hidden behind hills) in step 2, because the adapter
has no occlusion queries. `View3D` already treats a missing `queryOcclusion` as "in sight". Step 4 restores it on
the scene graph.

---

## Step 1: Baseline screenshots of the old world

### Task 1: Join part-way along the route with `?at=<metres>`

Port of commit `5ccca57` on `origin/feat/island-regions` (the `?at=` part only).

**Files:**
- Create: `client/public/js/ride/joinAt.js`
- Modify: `client/public/js/main.js` (the join's `resume:` field, near line 2000)
- Test: `client/test/joinAt.test.js`

**Interfaces:**
- Produces: `joinAtMetres(search: string) -> number | null`: the `at` query parameter as a finite number ≥ 0,
  else `null`.

- [ ] **Step 1: Write the failing tests**

```js
test("reads the join point in metres", () => assert.equal(joinAtMetres("?at=6490"), 6490));
test("no at parameter joins at the start as usual", () => assert.equal(joinAtMetres(""), null));
test("a negative join point is ignored", () => assert.equal(joinAtMetres("?at=-5"), null));
test("a join point that is not a number is ignored", () => assert.equal(joinAtMetres("?at=abc"), null));
```

- [ ] **Step 2: Run them and see them fail** (module not found)

Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/joinAt.test.js`

- [ ] **Step 3: Implement `joinAtMetres`, and use it in `main.js`.** When it returns a number and the route is
  not `kind === "studio"`, the join's `resume` becomes `{ routeId: app.route.id, distanceM }` instead of the
  restored snapshot's resume point. Otherwise the code path stays as it is today.

- [ ] **Step 4: Run the tests, see them pass, then run the whole client suite.**

- [ ] **Step 5: Commit** `feat(client): Join a ride part-way along the route with ?at=`

### Task 2: World shot script with a shot list

Based on `client/sceneryShot.mjs` on `origin/feat/island-regions` (settings before load, join, pause, wait for
the built world, camera pinning by patching `ChaseCamera.prototype.update`). The difference: it takes a whole
shot list, so step 5 can re-run it unchanged.

**Files:**
- Create: `client/worldShotList.mjs` (pure: parsing and settings), `client/worldShots.mjs` (Playwright runner),
  `client/worldShots.json` (the list; filled in Task 3)
- Modify: `client/eslint.config.js` (add both `.mjs` files to the node files list), `Makefile` (target
  `world-shots`, passing `ARGS` like `screenshot`)
- Test: `client/test/worldShotList.test.js`

**Interfaces:**
- Produces:
  - `parseShotList(json: string) -> Shot[]`
  - `Shot = { name: string, kind: "menu" | "ride" | "gallery", route?: string, at?: number, camera?: string,
    time?: "auto"|"day"|"golden"|"dusk", biome?: string, eye?: [x,y,z], target?: [x,y,z], wait?: number }`
  - `settingsFor(shot) -> Record<string,string>`: localStorage entries `openride.view = "3d"`, plus
    `openride.route`, `openride.camera`, `openride.time` and `openride.biome` when the shot has them. Never
    `openride.quality` (`low` turns the 3D menu off).
  - `pinCamera(source: string, eye, target) -> string`
  - CLI: `node worldShots.mjs --list worldShots.json --out <dir> [--only name,name] [--url http://localhost:8080]`.
    Writes `<dir>/<name>.png` at 1600×900, deviceScaleFactor 1, and prints each path.

- [ ] **Step 1: Write failing tests:**
  - `parseShotList` rejects a duplicate name, an unknown `kind`, an `eye` without a `target`, and a negative
    `at`, each with an error naming the shot.
  - `settingsFor` returns exactly the keys above, with no `openride.quality`.
  - `pinCamera`'s output still contains the original source, and ends with a `ChaseCamera.prototype.update`
    override that sets `this.eye`/`this.target` to the given arrays.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `worldShotList.mjs`, then `worldShots.mjs`.** The runner handles each `kind`:
  - **menu:** load `/`, wait until `#setup` no longer has the class `world-building`, then wait `wait` ms.
  - **ride:** `/?at=<at>`, join as "World Check", pause and wait for the world, as `sceneryShot.mjs` does.
  - **gallery:** `/gallery.html?biome=<biome>`.
  Block service workers when `eye` is set. Default timeout 600 s (software GL renders about 1 fps).
- [ ] **Step 4: Run the tests and see them pass; run lint.**
- [ ] **Step 5: Commit** `test(client): Add a world shot script that replays a list of cameras`

### Task 3: Shoot the baseline and upload it

No product code. This task decides the coordinates in `worldShots.json`.

- [ ] **Step 1: Start the server** in the background with a long timeout, with all routes as in `.env.dev`
  (see the memory note on the screenshot recipe: `cargo run` with `OPENRADLR_ROUTES_DIR=../routes`).
- [ ] **Step 2: Fill `client/worldShots.json`** with these shots (names fixed, values chosen by looking):
  - `menu-island` (drone over the whole island) and `menu-route` (a route picked)
  - `ride-village`, `ride-forest`, `ride-climb-banners`, `ride-coast`, `ride-farm`
  - `ride-riders-labels`, `ride-crowd-summit`
  - `studio-outside`, `statue`, `gym`: `ride` shots with `eye`/`target` pinned on them
  - `ride-dusk` (`time: "dusk"`), `ride-winter-snow` (`biome: "winter"`)
  - `gallery-temperate`, `gallery-winter`

  The old world has no rain; winter snowfall stands in for weather. The studio interior, beer bike and tandem
  need the UI (pick the studio, create a vehicle). Shoot each by hand only if it takes under 15 minutes;
  otherwise list it as not shot in the PR description.
- [ ] **Step 3: Run** the shots in the Playwright image on the host network (version from `client/package.json`,
  tag `v<version>-noble`), output to `~/.cache/openradlr/screenshots/baseline/`. Look at every image: each must
  show the finished world, not the loading note or the 2D map.
- [ ] **Step 4: Upload** each PNG to `pr-screenshots` under `polished-world/before/<name>.png` via `gh api`.
- [ ] **Step 5: Commit** `test(client): Record the baseline camera list for the world shots` (only
  `worldShots.json`).

---

## Step 2: Foundation

### Task 4: Vendor Three.js and decide it in an ADR

**Files:**
- Modify: `client/package.json`: `"dependencies": { "three": "0.170.0" }` (exact pin), script
  `"vendor": "node vendor.mjs"`
- Create:
  - `client/vendor.mjs`: copies `node_modules/three/build/three.module.min.js` and `LICENSE` into
    `client/public/vendor/three/`. It also takes a list of addon paths (empty for now) and rewrites their
    `from 'three'` to a relative path to `three.module.min.js`.
  - `client/public/vendor/three/{three.module.min.js,LICENSE}` (generated, committed)
  - `client/public/js/three.js`: `export * from "../vendor/three/three.module.min.js";`, the only import path for
    app code
  - `docs/adr/0030-three-js-renderer.md`
- Modify: `client/eslint.config.js` (ignore `public/vendor/**`), `docs/adr/0005-own-webgl-renderer.md`
  (Status: superseded by 0030), `client/public/index.html` (re-run `npm run preload`)
- Test: `client/test/vendorThree.test.js`

**Interfaces:**
- Produces: `client/public/js/three.js`, Three.js's full module namespace (`WebGLRenderer`, `BufferGeometry`,
  `RawShaderMaterial`, `REVISION`, …).

- [ ] **Step 1: Write failing tests:**
  - `REVISION` imported from `../public/js/three.js` equals `"170"`, and `package.json`'s `dependencies.three`
    equals `"0.170.0"` (this catches drift after a Dependabot bump).
  - `new BufferGeometry()` from `three.js` works in node without a DOM.
  - `public/vendor/three/LICENSE` exists and mentions "MIT".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3:** Run `npm install` and `npm run vendor` (in Docker) and add the re-export module.
- [ ] **Step 4:** Write ADR 0030 (context, decision, consequences):
  - Three.js replaces the own renderer, vendored and pinned, imported by relative path through `js/three.js`;
    no import map, so the CSP stays.
  - Updates: Dependabot bumps `package.json`, `npm run vendor` refreshes the copy, and the test enforces it.
  - Geometry, cameras and posing stay pure and node-tested.
  - Payload: about 170 KB gzipped.

  Mark ADR 0005 superseded.
- [ ] **Step 5:** Run the tests and see them pass, then run `npm run preload` and the full client suite
  (`modulePreload.test.js` must pass) and lint.
- [ ] **Step 6: Commit** `build(client): Vendor Three.js 0.170.0 and record the switch in ADR 0030`

### Task 5: Move the shaders out of `renderer.js` (refactor)

**Files:**
- Create: `client/public/js/view3d/shaders.js` with `MESH_VERTEX`, `MESH_FRAGMENT`, `SKY_VERTEX`,
  `SKY_FRAGMENT`, `DEPTH_VERTEX`, `DEPTH_FRAGMENT`, `WEATHER_VERTEX`, `WEATHER_FRAGMENT` (moved verbatim from
  `renderer.js`; all exported)
- Modify: `client/public/js/view3d/renderer.js` (import them), `client/test/view3d.test.js` (`WEATHER_VERTEX`
  from `shaders.js`)

- [ ] **Step 1:** Move them, and run the client suite and lint: all green, behaviour unchanged.
- [ ] **Step 2: Commit** `refactor(client): Keep the 3D shaders in their own module`

### Task 6: `ThreeRenderer`: passes, meshes and the sky

**Files:**
- Create: `client/public/js/view3d/threeRenderer.js`
- Test: `client/test/threeRenderer.test.js` (with a fake `WebGLRenderer`)

**Interfaces:**
- Consumes: `three.js` (Task 4), `shaders.js` (Task 5).
- Produces: `class ThreeRenderer` with the same methods and arguments as `Renderer` in `renderer.js`:
  - `constructor(canvas, { createRenderer = (canvas) => new WebGLRenderer({ canvas, antialias: true,
    powerPreference: "high-performance" }) } = {})`: sets `autoClear = false` and pixel ratio 1 (callers pass
    device pixels).
  - `upload(mesh) -> { geometry: BufferGeometry, count }` (attributes `a_position` 3, `a_normal` 3, `a_color` 4)
  - `dispose(handle)`
  - `resize(width, height)`: calls `setSize(width, height, false)`
  - `viewport(rect | null)`: device pixels from the bottom left; scissor on with a rect, off without
  - `begin(frame)`: `frame` is today's fields **plus** `view: Float32Array` and `projection: Float32Array`
    (column-major, from `math.js`). It sets an internal camera with `matrixAutoUpdate = false`: world-inverse =
    `view`, projection = `projection`, plus both inverses.
  - `draw(handle, model, tint = [1,1,1])`, `drawBright(handle, model, unlit = 0.45)`,
    `drawCloudLayer(handle, model, tint)`, `drawTransparent(handle, model, { alpha, unlit = 0, tint })`
  - `end()`: renders whatever pass is pending
- **Pass rule:** draws are queued into the current pass. A pass is rendered when the next pass starts
  (`begin`, `beginShadows`, `viewport`) or on `end()`.
- **Inside a pass:**
  - The pass clears colour (to `horizon`) and depth within the current viewport/scissor.
  - The sky draws first: a full-screen triangle with `SKY_*`, `renderOrder` −1, no depth write.
  - Then the opaque draws in call order, then the transparent draws in call order (no depth write, polygon
    offset −1/−2, blending as `renderer.js`).
- **Per-draw uniforms** (`u_model`, `u_tint`, `u_unlit`, `u_alpha`, `u_fogScale`) are set in the mesh's
  `onBeforeRender` on a `RawShaderMaterial` shared per kind. Frame uniforms are the same names `renderer.js`
  sets in `begin`. Mesh objects are pooled between frames, and every mesh has `frustumCulled = false` (the old
  renderer drew without culling).
- **Not implemented:** `queryOcclusion`, `occlusion`, `keepOcclusion` (`View3D` checks for them).

- [ ] **Step 1: Write failing tests**, each against a fake renderer that records `clear`, `setViewport`,
  `setScissor`, `setScissorTest` and `render(scene, camera)` calls, and the names of the meshes in each
  rendered scene:
  - `"one pass renders once, on end"`: begin, two draws, end gives exactly one `render`, with sky, then
    mesh 1, then mesh 2.
  - `"transparent draws render after opaque ones"`: draw A, drawTransparent B, draw C gives sky, A, C, B.
  - `"starting a new pass renders the pending one first"`: begin, draw, viewport(rect), begin, draw, end gives
    two `render`s in that order.
  - `"an inset clears only inside its rectangle"`: with `viewport({x:10,y:20,width:300,height:200})`, the
    clear happens with the scissor test on and scissor (10, 20, 300, 200).
  - `"draws are not kept for the next frame"`: two frames with one draw each give one mesh per render.
  - `"the camera uses the frame's view and projection"`: after `begin`, the camera's
    `matrixWorldInverse.elements` equal `view`, and its `projectionMatrix.elements` equal `projection`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests and see them pass; run lint.**
- [ ] **Step 5: Commit** `feat(client): Draw the 3D view's meshes through Three.js`

### Task 7: `ThreeRenderer`: shadows and weather

**Files:**
- Modify: `client/public/js/view3d/threeRenderer.js`
- Test: `client/test/threeRenderer.test.js`

**Interfaces:**
- Produces:
  - `createShadowMap(size = 2048)`
  - `beginShadows(lightViewProjection)`, `drawShadowCaster(handle, model)`, `endShadows()`
  - `uploadWeather(data) -> { geometry, count }` (interleaved, 6 floats per vertex: `a_corner` 2, `a_seed` 4)
  - `drawWeather(handle, { viewProjection, camera, right, up, timeS, style })`
  All take the same arguments and give the same results as in `renderer.js`.
  - **Shadows:** a `WebGLRenderTarget` with a `DepthTexture`, drawn with `DEPTH_*` and polygon offset as in
    `renderer.js`. `begin` binds it as `u_shadowMap` with `u_lightViewProjection`, `u_shadowTexel` and
    `u_shadowStrength`, exactly as `renderer.js` does.
  - **Weather:** queued into the current pass after the transparent draws (blended, no depth write).

- [ ] **Step 1: Write failing tests:**
  - `"shadow casters render into the shadow target before the main pass"`: `setRenderTarget(target)`, render,
    `setRenderTarget(null)`, then the main render.
  - `"without a shadow pass the strength is zero"`: the frame uniform `u_shadowStrength` is 0 when
    `beginShadows` wasn't called this frame.
  - `"weather draws after transparent meshes"`.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(client): Give the Three.js renderer shadows and weather`

### Task 8: Switch the app to `ThreeRenderer` and delete the own renderer

**Files:**
- Modify:
  - `client/public/js/view3d/view3d.js`: the constructor builds `new ThreeRenderer(canvas)` when none is
    injected; `begin` gets `view` and `projection`, for the main view (line ~907, `projection` already exists,
    `view = lookAt(eye, target)`) and for the inset (line ~884); `this.renderer.end()` closes the frame
  - `client/public/js/view3d/studioScene.js`: the same (line ~108 for the renderer, ~172 for the frame)
- Delete: `client/public/js/view3d/renderer.js` (`createContext` goes with it)
- Modify: `client/public/index.html` (`npm run preload`), and any test faking the renderer, which gains a
  no-op `end`
- Test: `client/test/view3d.test.js`, `client/test/studioWorld.test.js`

- [ ] **Step 1: Write failing tests** with the existing fake renderer in these suites:
  - `"a rendered frame ends with end()"`: `View3D.render` calls `end` once, after the last draw.
  - `"the frame carries view and projection"`: `begin` receives `view` equal to `lookAt(camera.eye,
    camera.target)`.
  - The same two for `StudioView3D`.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement it and delete `renderer.js`. Step 4: Run the full
  client suite and lint, and see them pass.**
- [ ] **Step 5: Check the real app:** `make dev`, then run the Task 2 shot list into
  `~/.cache/openradlr/screenshots/step2/`. Compare each image with its baseline. The look must match apart
  from anti-aliasing and label occlusion. A difference in colour, fog, sky or shadows is a bug in Tasks 6–7:
  fix it before committing.
- [ ] **Step 6: Commit** `feat(client)!: Render the 3D world with Three.js instead of the own WebGL renderer`

### Task 9: Quality levels in one place

**Files:**
- Create: `client/public/js/view3d/quality.js`
- Modify:
  - `client/public/js/view3d/view3d.js` and `studioScene.js`: `setQuality` takes any level; every
    `this.quality === "high"` becomes the level's settings
  - `client/public/js/main.js`: `setQuality`, the `quality-mode` button cycles through the levels, the stored
    value is read through `qualityLevel`. The 3D start-menu check (`readSetting(QUALITY_KEY) !== "low"`, line
    ~903) stays as it is.
  - `client/public/js/i18n/en.js` and `de.js`: `graphics.medium` ("Medium" / "Mittel"), `graphics.ultra`
    ("Ultra" / "Ultra")
- Test: `client/test/quality.test.js`

**Interfaces:**
- Produces:
  - `QUALITY_LEVELS = Object.freeze(["low", "medium", "high", "ultra"])`
  - `qualityLevel(stored: string | null) -> level`: a known level as is; anything else is `"high"`
  - `nextQuality(level) -> level`: the next level in the list, wrapping from ultra to low
  - `qualitySettings(level) -> { pixelRatioMax: number, shadows: boolean, detail: boolean }`:
    - low: `{1, false, false}`
    - medium: `{1.5, true, true}`
    - high: `{2, true, true}`
    - ultra: `{2, true, true}` (step 3 widens the gap)
  - `detail` replaces `scene.high` in `view3d.js` (grass and fine detail); `shadows` replaces the `high` in
    the shadow check; `pixelRatioMax` replaces `high ? 2 : 1`.

- [ ] **Step 1: Write failing tests:**
  - `qualityLevel("low")` is `"low"`; `qualityLevel("high")` is `"high"`; `qualityLevel(null)` and
    `qualityLevel("potato")` are `"high"`.
  - `nextQuality("ultra")` is `"low"`.
  - The settings for each level match the table above.
  - The button's label for each level comes from `graphics.<level>` (i18n parity tests cover `de.js`).
- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: Run the full client suite and lint.**
- [ ] **Step 5: Commit** `feat(client): Offer four graphics levels, Low to Ultra`

### Task 10: Close step 2

- [ ] **Step 1:** `git fetch origin main && git merge origin/main`. Resolve conflicts, carrying any change to the
  old 3D code over into the new code (spec: "Main keeps moving").
- [ ] **Step 2:** `make check` (Rust and client, as CI does; client in Docker as above), and it passes.
- [ ] **Step 3:** Push `feat/polished-world` (`git push -u origin feat/polished-world`). No PR yet: the PR is
  opened in step 5 of the spec.
