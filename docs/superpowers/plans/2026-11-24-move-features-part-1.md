# Move the features, part 1: riders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Road riders (me, others, bots, ghost) are drawn by a new rider layer in the Three.js world — the reference's rigged rider on its bikes, looks from the id, colour code kept, nearest riders full and the rest cheap — and their labels hide without GPU occlusion queries.

**Architecture:** Pure look and kit-painting modules feed rig, bike and cyclist assets under `view3d/assets/riders/`; `view3d/scene/riderLayer.js` owns the full cyclists and the cheap instanced batches and reads a per-frame `frame.riders` snapshot that `View3D.render()` builds. Gym, vehicle and studio riders stay on the adapter until parts 2 and 4.

**Tech Stack:** plain ES modules, vendored Three.js (`client/public/js/three.js`), node test runner, Playwright (shots only).

**Spec:** `docs/superpowers/specs/2026-11-24-move-features-design.md` (part 1 of its Order), under the umbrella `docs/superpowers/specs/2026-11-23-three-js-world-design.md`.

## Global Constraints

- Layering `world/` → `view3d/assets/` → `view3d/scene/` → `view3d/engine/`, enforced by `client/layering.mjs`; pure look logic must not import Three.js.
- No `document`/canvas in assets: textures are `THREE.DataTexture` from typed arrays (as `assets/road.js`, `materials.js`).
- No `Math.random` in assets or layers: randomness from `seededRandom` (`world/noise.js`) seeded by the rider id.
- Every resource made by a layer or asset goes through `own` (`createOwner(track)`); `dispose()` frees all of it.
- Port the reference (`notes/polished-world/reference/assets/creatures/rider.js`, `cyclist.js`, `props/bicycle.js`) file by file into our style: JSDoc, named constants, no one-letter globals, line length as the repo's prettier.
- Reference frame: riders and bikes face **+x**; our road frame faces **−Z** (`yawFor(forward)`). The layer converts once (a −π/2 yaw on the cyclist root); assets keep the reference frame.
- Look comes from the id only; no protocol, profile or UI change. Jersey primary = colour code (`colors.me/human/bot/remote`, bot team kits via `TEAM_KITS`), ghost = `SCENE.ghost` (alpha 0.38, tint [0.75, 0.9, 1]).
- Commit messages: Conventional Commits, imperative, trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No model ids anywhere.
- Gate per task (from repo root): `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && node --test 'test/**/*.test.js'"` — all pass, lint clean. Run `npm run preload` (same container) when a module is added to the page's import graph and commit the `index.html` change.

## Review Focus

1. **A rider id of 0, negative or very large** (bots, remote riders, ghost ids): `lookOf` must give a valid look for any integer. Test in Task 2.
2. **The colour settings change mid-ride** (theme switch changes `colors.me`): the jersey must repaint, not keep the old colour; the kit cache keys on the colour. Test in Task 6.
3. **A rider vanishes and comes back** (left the 600 m reach, rejoined): pooled cyclists are released and reused without leaking geometries or textures. Test in Task 6.
4. **Cadence 0 / power 0** (stopped rider, waiting at the start): cranks stop with the pedals level, feet still on them, not spinning. Test in Task 4.
5. **Steep descent and steep climb** (grade −12 % and +12 %): bike pitched with the road, wheels on the road surface, rider not sunk into the frame. Test in Task 4.

---

### Task 1: Draw-call readout and the baseline

**Files:**
- Modify: `client/public/js/main.js` (where `app.view3d` is created)
- Create: `~/.cache/openradlr/scripts/drawcalls.mjs` (outside the repo)

- [ ] **Step 1:** In `main.js`, when the page URL has `stats` in its query, once a second write `app.view3d.engine.renderer.info.render.calls` and `.triangles` into `document.body.dataset.drawCalls` / `dataset.triangles`. No UI, no i18n. No test (dev-only readout); lint must pass.
- [ ] **Step 2:** Write `drawcalls.mjs` (Playwright, same launch as `client/worldShots.mjs`: Simulator via `#use-simulated`, `openride.quality` stored per level) that joins `/?at=1200&stats`, waits 20 s, and prints `level calls triangles` for low, medium, high, ultra.
- [ ] **Step 3:** Run it against the dev server started with `OPENRADLR_TARGET_RIDERS=40` (see AGENTS.md / memory for the full env), save the output as `~/.cache/openradlr/screenshots/move1/baseline.txt`.
- [ ] **Step 4:** Commit `main.js`: `chore(client): Read draw calls and triangles into the page with ?stats`.

### Task 2: Rider look from the id

**Files:**
- Create: `client/public/js/view3d/riderLook.js` (pure, no Three.js)
- Test: `client/test/riderLook.test.js`

**Interfaces:**
- Produces: `RIDER_SKINS` (ids `light, fair, tan, olive, brown, dark` → sRGB hex as the reference's `SKIN`), `RIDER_PATTERNS` (`solid, hoops, band, sash, panels, chevron, dots, fade`), `RIDER_KITS` (`road, long, skinsuit, casual`), `BIKE_TYPES_FOR_LOOKS` (`road, gravel, city`), and `lookOf(id: number) -> RiderLook`, where `RiderLook = {height, weight, skin, hair, kit, pattern, primary, secondary, accent, shorts, socks, shoes, helmet, glasses, gloves, gloveColor, bike, frame, frameAccent}` (colours `#rrggbb`, height m, weight kg).

- [ ] **Step 1: failing tests**
  - `lookOf is the same for the same id` — `deepEqual(lookOf(42), lookOf(42))`.
  - `lookOf gives a valid look for any integer id` — for ids `[0, -1, 1, 2**31 - 1, -(2**31), 123456789]`: height in [1.5, 2.05], weight in [45, 120], skin in `RIDER_SKINS`, pattern in `RIDER_PATTERNS`, kit in `RIDER_KITS`, bike in `BIKE_TYPES_FOR_LOOKS`, every colour matches `/^#[0-9a-f]{6}$/`.
  - `looks vary across riders` — over ids 1..200: at least 5 skins, 6 patterns, 3 kits, 3 bikes, and heights spanning more than 0.3 m.
  - `weight follows height plausibly` — over ids 1..200, every BMI (`weight / height²`) is in [18, 33].
  - `most riders ride road bikes` — over ids 1..200, `road` count > 60 %.
  - `casual kits are rare` — over ids 1..200, `casual` count < 15 %.
- [ ] **Step 2:** Run `node --test test/riderLook.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement with `seededRandom(id * 2654435761 >>> 0)` from `world/noise.js`. Height ~ normal around 1.76 (clamped), weight from a BMI in [19, 30]. Colours from fixed palettes (jersey pairs that read well, dark shorts mostly, white or dark helmets). `primary` is a default only: the layer overrides it with the colour code.
- [ ] **Step 4:** Run the gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Give every rider a full look from their id`.

### Task 3: Kit painter and the rigged rider asset

**Files:**
- Create: `client/public/js/view3d/assets/riders/kitPainter.js`, `client/public/js/view3d/assets/riders/rider.js`
- Test: `client/test/riderRig.test.js`

**Interfaces:**
- Consumes: `RiderLook` (Task 2).
- Produces:
  - `KIT_ATLAS` (the reference's `REG` regions: torso, arm, leg, head, hand, foot as `[u0, u1, v0, v1]`).
  - `paintKit(look: RiderLook, size = 256) -> Uint8Array` (RGBA, row 0 = v 1 as the reference's canvas); `kitTexture(look, own) -> THREE.DataTexture` (sRGB colour space).
  - `RIG_BONES` (the 19 names, reference order); `createRider(look: RiderLook, {own, uniforms, texture?}) -> RiderRig` with `RiderRig = {object: THREE.Group, mesh: THREE.SkinnedMesh, height, eyeHeight, poseRide(fit, {crank, grip?, standing?, coast?, lookYaw?, t?}) -> {pitchL, pitchR}, poseStand(t, {wave?}), saddleFor(fit) -> number, headPos(out: THREE.Vector3) -> THREE.Vector3, boneWorld(name, out) -> THREE.Vector3, setTexture(texture)}`.
  - `meta`/`create(options)` workbench pair for `rider` (options: height, weight, kit, pattern, skin, primary; poses `ride`, `stand`, `wave`).

- [ ] **Step 1: failing tests**
  - `paintKit fills the jersey with the primary colour` — look with `pattern: "solid"`, `primary: "#ff0000"`: the pixel at the torso region's centre (u 0.5, v 0.7 of `KIT_ATLAS.torso`) is `[255, 0, 0, 255]`.
  - `a skinsuit paints the shorts area with the primary` — `kit: "skinsuit"`: the torso pixel at v 0.03 equals the primary.
  - `patterns change the jersey` — `hoops` and `solid` arrays differ; `paintKit` of the same look twice is equal.
  - `the rig has the 19 bones of the reference` — `createRider(lookOf(1), …).mesh.skeleton.bones.map((b) => b.name)` deep-equals `RIG_BONES`.
  - `a standing rider stands on the ground at full height` — after `poseStand(0)`: the lowest skinned vertex y in [−0.02, 0.03]; the highest within 3 % of `look.height` (use `mesh.getVertexPosition` + `applyMatrix4(matrixWorld)` over every 7th vertex).
  - `a heavier rider is wider at the waist` — same height, weight 60 vs 110: the hips-ring width (max |z| of vertices near hip height ± 0.05) grows by more than 15 %.
  - `riding puts the feet on the pedals and the hands on the grips` — with `fit = bikeGeometry("road", {scale: 1, saddleHeight})` from Task 4 *stubbed here by a literal fit object* (copy the reference `geometryFor("road")` output for scale 1 into the test as data): after `poseRide(fit, {crank: 0.6})`, `boneWorld("foot_R")` lies within 0.04 m of the right pedal point (`bb + crankLen·(cos, sin)` as the reference) and `boneWorld("hand_R")` within 0.05 m of `fit.grips`.
  - `dispose frees what the rider made` — a tracker counting `own` calls; after the owner's `disposeAll`, every owned geometry/material/texture had `dispose` called.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port `kitTexture` as `paintKit` with a small rectangle/line rasteriser on the `Uint8Array` (no canvas); port `rider.js` (bones, `bindJoints`, loft, `poseRide`, `poseStand`, `ik2`, `saddleFor`, helmet and glasses on the head bone). Drop `poseExercise` (part 2 retargets our own clips). Material: `MeshStandardMaterial` with the kit map, roughness 0.62, `cloudShadows(uniforms)` and `heightFog(uniforms)` hooks like the creatures. `castShadow = true`.
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Add the rigged rider with a painted kit`.

### Task 4: Bicycle and cyclist

**Files:**
- Create: `client/public/js/view3d/assets/riders/bicycle.js`, `client/public/js/view3d/assets/riders/cyclist.js`, `client/public/js/view3d/assets/riders/index.js`
- Modify: `client/public/js/workbenchState.js` (add `...RIDERS` to `WORKBENCH_ASSETS`)
- Test: `client/test/cyclist.test.js`

**Interfaces:**
- Consumes: `createRider`, `kitTexture` (Task 3), `RiderLook` (Task 2).
- Produces:
  - `BIKE_TYPES` (`road, gravel, city, mtb, tt`, the reference's table); `bikeGeometry(type, {scale = 1, saddleHeight}) -> BikeFit` (`{bb, saddle, sd, grips, crankLen, rear, front, wheelRadius}` as `THREE.Vector3`/numbers); `createBike({type, frame, accent, scale, saddleHeight, own, uniforms}) -> {object, fit, setWheels(distanceM), setCrank(angle, pitchL?, pitchR?), setSteer(angle)}`.
  - `createCyclist(look: RiderLook, {own, uniforms, seed}) -> Cyclist`, `Cyclist = {object, rider: RiderRig, bike, crank, ride(dt, {cadence, speed, grade, t, near}), setKit(texture)}` — `cadence` rpm drives the crank (not the reference's speed formula); `speed` m/s spins the wheels; `grade` in percent: standing chance above 6 % (seeded), coasting when `cadence < 1`; `near: false` animates only wheels and cranks.
  - `RIDERS = {rider, cyclist}` workbench assets (`meta` + `create(options)` returning `{object, update(dt, t)}`), cyclist options: type, height, weight, kit, pattern, primary, speed, standing.

- [ ] **Step 1: failing tests**
  - `both wheels touch the ground` — for every `BIKE_TYPES` key at scale 1: `fit.rear.y` and `fit.front.y` equal `fit.wheelRadius` ± 0.005.
  - `cadence turns the cranks` — `createCyclist(lookOf(3))`, `ride(0.5, {cadence: 90, speed: 8, grade: 0, t: 0, near: true})`: `crank` changed by `90/60·2π·0.5` ± 1e-6 (mod 2π).
  - `a stopped rider holds the pedals level with the feet on them` — `ride(0.1, {cadence: 0, speed: 0, …})` 60 times: `Math.abs(Math.sin(crank)) < 0.05`; right foot bone within 0.04 m of the right pedal.
  - `on a steep climb or descent the wheels stay on the slope` — the cyclist object posed for grades +12 and −12 by the caller's pitch (`object.rotation.z = atan(grade/100)` in the reference frame): world y of both wheel bottoms equals the slope line through the bottom bracket's projection ± 0.02; the saddle bone (`hips`) is above the saddle point (not sunk).
  - `standing is the same for the same seed` — two cyclists with seed 7 ridden 20 s at grade 9, cadence 70: same `standing` trace.
  - `far riders skip the body` — `near: false`: rider bone matrices unchanged between two calls; crank changed.
  - `the workbench lists the rider and the cyclist` — `WORKBENCH_ASSETS.rider` and `.cyclist` exist with `meta.id`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port `bicycle.js` and `cyclist.js`; replace `Math.random` with `seededRandom(seed)`; drop the reference's `instancedBikes` (Task 5 bakes bikes instead).
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Add bicycles and the cyclist, pedalling at the rider's cadence`.

**Checkpoint (main session): workbench shot round** — `wb-rider`, `wb-cyclist` (two looks, road and city bike), `wb-cyclist-climb` (standing). Fix what the shots show before Task 5.

### Task 5: Cheap riders

**Files:**
- Create: `client/public/js/view3d/assets/riders/cheapRider.js`
- Test: `client/test/cheapRider.test.js`

**Interfaces:**
- Consumes: `createCyclist`, `lookOf`.
- Produces: `CHEAP_BAKES = 4` (crank angles `k·π/2`); `bakeCheapRiders({own, uniforms}) -> CheapRiders`, `CheapRiders = {object: THREE.Group, set(entries: {matrix: THREE.Matrix4, crank: number, tint: number[], alpha?: number}[]), count: number}` — one bake per crank from a neutral look (`lookOf(1)` with fixed skin `tan`), each bake split into a **jersey** geometry (instance colour = tint) and a **rest** geometry (vertex colours sampled from the neutral kit), bike merged into rest, all `InstancedMesh` with `castShadow` true; an entry goes to the bake nearest its crank.

- [ ] **Step 1: failing tests**
  - `every entry is drawn once` — `set` with 7 entries of mixed cranks: the sum of `count` over the jersey meshes is 7, and over the rest meshes is 7.
  - `the jersey carries the tint` — one entry tint `[1, 0, 0]`: its jersey instance colour is (1, 0, 0).
  - `a baked rider stands where its matrix puts it` — entry at `(10, 2, −5)` identity rotation: the rest mesh's instance bounding box (geometry box × instance matrix) contains `(10, 2 + 0.5, −5)` and its bottom is within 0.03 of y 2.
  - `draws stay few` — `object` has at most `CHEAP_BAKES · 2` meshes.
  - `set([]) hides the batch` — all counts 0.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Bake with `SkinnedMesh.getVertexPosition` per vertex into a plain geometry; a vertex is jersey when its sampled kit colour equals the neutral look's primary (paint the neutral look with primary `#ff00ff` to tell).
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Bake cheap far riders into a few instanced meshes`.

### Task 6: Rider layer and the `riders` quality key

**Files:**
- Create: `client/public/js/view3d/scene/riderLayer.js`
- Modify: `client/public/js/view3d/quality.js` (key + typedef), `client/public/js/view3d/scene/worldScene.js` (maker `riders`, in the `setQuality` rebuild list)
- Test: `client/test/riderLayer.test.js`, `client/test/quality.test.js`

**Interfaces:**
- Consumes: `createCyclist`, `kitTexture`, `bakeCheapRiders`, `lookOf`.
- Produces:
  - Quality key `riders: {full, reach}`: low `{full: 1, reach: 300}`, medium `{full: 4, reach: 450}`, high `{full: 8, reach: 600}`, ultra `{full: 16, reach: 600}`.
  - `frame.riders: RiderEntry[]`, `RiderEntry = {id, me: boolean, position: number[3], forward: number[3], cadence, speed, grade, tint: number[3] (linear 0–1), ghost: boolean}`; a missing `frame.riders` means none.
  - `createRiderLayer({settings, uniforms, track}) -> layer` (`object.name = "riders"`), plus `layer.stats() -> {full: number, cheap: number}` for tests.

- [ ] **Step 1: failing tests**
  - quality: `every level has riders full and reach` — values exactly as above; ultra.full ≥ high.full ≥ medium.full ≥ low.full ≥ 1.
  - `the nearest riders are full, the rest cheap` — high settings, 20 entries at distances 10..200 m from `frame.camera`, `me` at 150 m: `stats().full === 8` and includes `me`; `stats().cheap === 12`.
  - `riders past the reach are not drawn` — low settings, entries at 200 and 400 m: drawn = 1.
  - `my rider is full even at Low` — low settings, me + 3 nearer riders: full = 1 and it is `me`.
  - `the jersey follows the tint and repaints when it changes` — one entry tint `[1, 0, 0]`, update; then `[0, 0, 1]`, update: the cyclist's kit texture data at the torso centre is red, then blue.
  - `a rider faces along its forward` — entry with `forward` `[0, 0, -1]` and another `[1, 0, 0]`: the world position of the front wheel hub minus the rear hub, normalised, equals `forward` ± 0.01.
  - `a ghost is see-through` — entry `ghost: true`: every material of its cyclist is `transparent` with opacity 0.38 and does not cast shadows.
  - `a rider that leaves and returns does not leak` — tracker counts: rider 5 in, out for one update, in again 10 times: live owned resources after equal those after the first update (± the kit cache's one entry).
  - `bike lights glow at night only` — `setEnvironment({...env, night: 1})`: front and rear light meshes of a full rider are visible with emissive intensity > 0; `night: 0`: intensity 0.
  - `without shadows a contact blob sits under each rider` — low settings (`shadows: false`): one blob instance per drawn rider; high: none.
  - `dispose frees everything` — after `dispose()`, every owned resource disposed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Pool full cyclists by rider id (release to a free list keyed by look when unused for 2 s); kit textures cached by `${id}|${tint}` and released with the cyclist. Place: root at `position`, yaw from `forward` (reference +x → road −Z: yaw from `forward` so the front wheel leads, pinned by "a rider faces along its forward"), pitch from `forward[1]`. Feed `ride(dt, {cadence, speed, grade, t: frame.t, near: true})`. Bike lights: two small emissive meshes on each full cyclist (front white, rear red), intensity `env.night`; cheap riders get none. Blob: an instanced dark disc (alpha 0.22) when `settings.shadows` is false.
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Draw road riders in the new world: full near, cheap far`.

### Task 7: View wiring and labels without occlusion queries

**Files:**
- Create: `client/public/js/view3d/labelSight.js`
- Modify: `client/public/js/view3d/view3d.js` (build `frame.riders`; stop drawing road riders, their shadow casters, their blobs and ghosts through the adapter; labels), `client/public/js/view3d/threeRenderer.js` (remove `queryOcclusion`, `occlusion`, `keepOcclusion` and the label probe once unused), `client/public/js/view3d/riderModel.js` (drop `buildLabelProbe` if unused)
- Test: `client/test/labelSight.test.js`, `client/test/view3d.test.js`, `client/test/threeRenderer.test.js`

**Interfaces:**
- Consumes: `frame.riders` (Task 6), `lineOfSight` (`world/sight.js`).
- Produces: `labelInSight(eye: number[3], head: number[3], {height: (x, z) => number, boxes: {x, z, halfX, halfZ, yaw, top}[]}) -> boolean`; `plotBoxes(plan) -> box[]` (every settlement and farm building plot: centre, half extents from width/depth, yaw from facing, `top` = ground + 8 m); `groundHeight(ground) -> (x, z) => number` (bilinear over `ground.near`, then `ground.far`).

- [ ] **Step 1: failing tests**
  - `a rider on an open road is in sight` — flat height 0, no boxes, eye (0, 2, 0), head (0, 1.8, −60): true.
  - `a hill between hides the label` — height bump of 6 m at z −30: false.
  - `a house between hides the label` — box at (0, −30), half 4×4, top 8: false; the same box at x 20: true.
  - `groundHeight reads the grid` — a 3×3 near grid of heights 0..8: the value at a cell centre equals the bilinear mix.
  - view3d (fake renderer, as the existing tests): `road riders reach the world scene, not the adapter` — after `render` with 3 riders: the fake world scene's last frame has `riders.length === 3` with the right `me` and tints; the fake adapter received no `draw` call with a body mesh.
  - view3d: `a label behind a house is hidden` — world with one plot box between camera and rider: the rider's label element is `hidden` after `LabelVisibility`'s settle time.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `render()`, build `frame.riders` from `visible` entries that have no `gym` and are not studio seats (those stay on the adapter until parts 2 and 4): `{id, me, position, forward, cadence, speed: rider.speed ?? 0, grade: route.gradeAt(distance) (0 off-route), tint, ghost}`; pass it in the `worldScene.update` frame. Labels use `labelInSight` (head as today) instead of `renderer.occlusion`; boxes built once per world.
- [ ] **Step 4:** Gate → PASS; also `node layering.mjs` passes (part of lint).
- [ ] **Step 5:** Commit `feat(client): Ride the new riders in the world and hide labels by sight lines`.

### Task 8: Shots, draw calls, memory (main session)

- [ ] **Step 1:** Re-run `drawcalls.mjs` (Task 1) → `~/.cache/openradlr/screenshots/move1/after.txt`. Calls at Low and Medium must not exceed the baseline by more than 10 %; if they do, lower `riders.full`/`reach` or merge the cheap bakes further, then re-measure.
- [ ] **Step 2:** Ride shot round (Simulator, High, aimed from the browser's world): `pack-day` (chase cam into a group of bots), `pack-climb` (a steep stretch), `rider-close` (pinned camera 3 m beside my rider), `pack-night` (time night, bike lights), `pack-rain` (weather rain), `ghost` (if a ghost is available; else skip and say so), `labels-town` (riders in a village, labels behind houses hidden). At most two rounds.
- [ ] **Step 3:** Contact sheet, upload to `pr-screenshots` `polished-world/move1/`, push the branch, update the `polished-world` memory with status and lessons.
