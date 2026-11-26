# Move features, part 4: the studio, then delete the adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The spin studio (the building in the valley and the room-only class view) is drawn by the Three.js scene, and the temporary adapter (`view3d/threeRenderer.js`), its shaders, the overlay pass and the old rider meshes are deleted.

**Architecture:** A studio asset ported from the reference's `spin-studio` (`view3d/assets/buildings/spinStudio.js`) gives the shell and one storey's room. A scene layer (`studioBuildingLayer`) stacks it at the valley site; studio riders and the coach are ordinary `frame.riders` entries of `riderLayer`, placed by the pure studio placement that stays in `studioLayer.js`. `StudioView3D` gets `engineFor(canvas)` and a small scene of its own (room, riderLayer, lights). Then nothing calls the adapter and it goes, together with every module only it kept alive.

**Tech Stack:** plain ES modules, vendored Three.js (`client/public/js/three.js`), node:test.

**Spec:** `docs/superpowers/specs/2026-11-24-move-features-design.md` (part 4 of "Order"; sections "Studio", "Studio view", "Layers").

## Global Constraints

- Layering: `world/` → `view3d/assets/` → `view3d/scene/` → `view3d/engine/`, enforced by `client/layering.mjs` (assets may not import from `view3d/` outside `assets/`; put shared constants in `view3d/studioLayout.js`, which is pure and imports nothing from view3d).
- Three.js only through `client/public/js/three.js`; no new dependencies; deterministic (no `Math.random`, use `seededRandom` from `world/noise.js`).
- Client tests in plain node (no browser); Three.js code is tested by asserting on scene graphs and pure helpers.
- No UI text added (none planned); `i18n-ok` comments stay where they are.
- Gate (from the repo root): `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && echo LINT OK && node --test 'test/**/*.test.js'"` → `LINT OK`, `fail 0`.
- Commits: Conventional Commits, imperative; end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never change git config.

## Review Focus

1. **More floors than rooms:** a rider sits in room 2 while the studio says 1 room → the building grows to 3 floors and floor 2 is lit (today's `StudioLayer.riders` opens it). Test in Task 2.
2. **My own point of view in the studio:** camera mode `pov` → my body is hidden, my bike stays (spec). With the rig, hide via the rider's material/visibility of its meshes, not the SkinnedMesh's parent (part 2 trap: bones live under it). Test in Task 2.
3. **The coach on several floors:** each open floor has a coach; they must not share one pooled cyclist (riderLayer pools by id). Test in Task 2.
4. **Riders right in front of the studio camera:** riders closer than 1.2 m (horizontally) to the camera are not drawn, except mine and the coach (today's `STUDIO_NEAR_HIDE` / `shownInRoom`). Test in Task 3 and Task 4.
5. **A view disposed and made again on the same canvas** (leaving the studio for the road and back): the engine is shared and survives; the studio view's scene is disposed (tracker count back to 0). Test in Task 4.

---

### Task 1: Spin studio asset

**Files:**
- Create: `client/public/js/view3d/assets/buildings/spinStudio.js`
- Modify: `client/public/js/view3d/studioLayout.js` (add `FLOOR_HEIGHT = 4.9`, `SLAB = 0.3`, `FOOTPRINT = {halfWidth: 8.5, front: -10, back: 8}`), `client/public/js/view3d/assets/props/index.js` (workbench entry, as `bikeCafe`)
- Modify: importers of `FLOOR_HEIGHT`/`SLAB` from `studioBuilding.js` (`menuCamera.js`, `studioCamera.js`, `studioLayer.js`) → import from `studioLayout.js`
- Test: `client/test/spinStudio.test.js`

**Interfaces:**
- Consumes: `ROOM, STAGE, RISER, ROW_GAP, SEAT_GAP, INSTRUCTOR, seatPosition` (studioLayout.js); `geom.js` (`box`, `cylinder`, `merge`, `colour`, …), `materials.js`, `owner.js`, `textTexture.js` (sign), `createBike` not needed (trainers only).
- Produces:
  - `createStudioRoom({own, uniforms, ceiling = true}) -> {object: THREE.Group, setOpen(open: boolean)}` — one storey's interior in floor-local space (floor top at y = 0, riders face −z): oak floor, stage, back-row riser, speakers, wall props, ceiling with light panels (omitted when `ceiling` is false), 16 smart trainers under the seats' rear axles, the lit accent strips (emissive lemon/orange) and the wall screen. `setOpen(false)` darkens it (accents and panels off, room colour × 0.35) as today's `CLOSED_TINT`.
  - `createStudioShell({floors, own, uniforms}) -> {object: THREE.Group, glass: THREE.Mesh[]}` — base/plinth, a slab per floor at `floor * FLOOR_HEIGHT`, roof at `floors * FLOOR_HEIGHT` with the "SPIN STUDIO" sign (textTexture, lemon on dark board, as the reference), side/back walls, one glass front pane per floor (transparent, `depthWrite: false`), in site-local space (origin on the ground at the footprint's middle).
  - `meta` + `create(options)` for the workbench: id `spin-studio`, options `storeys` (1–3), `open` (bool), `cutaway` (bool, no ceiling).

- [ ] **Step 1: Write the failing tests** in `client/test/spinStudio.test.js`:
  - `room has a trainer under every seat`: count meshes/instances named `trainer` (an InstancedMesh of 16 or 16 meshes) and assert each instance's x/z is within 0.3 m of `seatPosition(i)` shifted to the rear axle (behind the seat in +z).
  - `room stays inside ROOM`: bounding box of `object` within `ROOM.halfWidth`, `ROOM.front`, `ROOM.back` (+0.05) and `y ≤ ROOM.height + 0.1`.
  - `room without ceiling has no panel above 4 m`: `createStudioRoom({ceiling: false})` bounding box max y < `ROOM.height - 0.2`.
  - `closed room darkens`: after `setOpen(false)` every emissive material's `emissiveIntensity` is 0.
  - `shell stacks floors`: `createStudioShell({floors: 3})` has 3 glass panes; bbox max y ≥ `3 * FLOOR_HEIGHT`; footprint within `FOOTPRINT`.
  - `deterministic`: two `createStudioRoom` calls give identical position arrays on the merged floor geometry.
  - `disposes`: with `own` from `createOwner(track)`, `disposeAll()` leaves the tracker at 0 (pattern: any existing asset test, e.g. `test/bikeCafe.test.js` or similar).
- [ ] **Step 2:** Run `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/spinStudio.test.js` → fails (module missing).
- [ ] **Step 3:** Port `notes/polished-world/reference/assets/buildings/spin-studio.js` in our style (merged vertex-coloured geometry, shared materials from `materials.js` with the scene's hooks as `bikeCafe.js` does). Replace its `Math.random` oak texture by a seeded canvas-free version (vertex-coloured planks are fine; no `document`), its sign by `textTexture`, its screen by a flat emissive panel. No riders, no bikes in the asset (riders come from riderLayer).
- [ ] **Step 4:** Move `FLOOR_HEIGHT`, `SLAB`, `FOOTPRINT` into `studioLayout.js`; `features.js` `STUDIO_FOOTPRINT` re-exports `FOOTPRINT`; update the importers. Add the workbench entry.
- [ ] **Step 5:** Gate → `LINT OK`, `fail 0`.
- [ ] **Step 6:** Commit `feat(client): Port the spin studio as a Three.js asset`.

### Task 2: Studio building layer; studio riders on riderLayer

**Files:**
- Create: `client/public/js/view3d/scene/studioBuildingLayer.js`
- Modify: `client/public/js/view3d/studioLayer.js` → pure placement only: keep `floorCount`, `floorTransform`, `seatWorld`, add `coachWorld` export; replace class `StudioLayer(renderer, site)` by `StudioFloors(site)` with the same `floors`, `setRooms`, `setOpen`, `riders(list)`, `coaches()` and a new `open` getter, no renderer, no `draw`. Coach entries get `id: coachId(floor)`.
- Modify: `client/public/js/view3d/studioLayout.js` (add `coachId(floor) = -1 - floor`, `isCoach(id)`).
- Modify: `client/public/js/view3d/scene/riderLayer.js` (RiderEntry: optional `lookId` (look, kit and seed; default `id`) and `hideBody` (rider hidden, bike shown)).
- Modify: `client/public/js/view3d/scene/worldScene.js` (maker `studio` when `world.studio`; `update` passes `frame.studio`).
- Test: `client/test/view3d/studioLayer.test.js` (rewrite for `StudioFloors`), `client/test/studioBuildingLayer.test.js`, `client/test/riderLayer.test.js` (add).

**Interfaces:**
- Consumes: Task 1's `createStudioShell`, `createStudioRoom`, `FLOOR_HEIGHT`, `SLAB`.
- Produces:
  - `createStudioBuildingLayer(site, {settings, uniforms, track}) -> {object, update(frame), setEnvironment(env), dispose()}`; `frame.studio = {floors: number, open: number}`; rebuilds the shell when `floors` changes; one room per floor at `floorTransform(site, floor)` + `SLAB`, open below `open`, closed above; glass panes per floor. Object name `studio`.
  - `StudioFloors` as above; `coaches()` returns `{rider: {id: coachId(floor), lookId: INSTRUCTOR.id, coach: true, …}, position, forward, yaw}`.
  - RiderEntry `{…, lookId?: number, hideBody?: boolean}`.
- [ ] **Step 1: Failing tests:**
  - studioLayer: `rider in room 2 opens three floors` (setRooms(1), riders([{studio:{room:2,seat:0}}]) → floors 3, open 3); `coaches have one id per floor` (open 2 → ids `[-1, -2]`, both `lookId: INSTRUCTOR.id`); the existing `seatWorld`/`floorTransform` tests stay.
  - studioBuildingLayer: `grows by floors` (update with floors 1 then 3 → 3 glass panes, roof y ≈ 3·FLOOR_HEIGHT + site y); `closed floors are dark` (floors 2, open 1 → room 1's emissive intensity 0, room 0's > 0); `disposes` (tracker 0).
  - riderLayer: `hideBody keeps the bike` (entry with `hideBody: true` → the cyclist's bike meshes visible, every rider mesh/material hidden); `two coaches are two cyclists` (ids −1, −2 with the same `lookId` → 2 full cyclists drawn); `lookId picks the look` (kit key / look of an entry with `lookId: 0` equals that of id 0).
- [ ] **Step 2:** Run the three test files → fail.
- [ ] **Step 3:** Implement. Hide the body by setting `visible` on the rider's skinned mesh(es) themselves (not a parent of the bones) or its material's `visible`; restore when `hideBody` goes false.
- [ ] **Step 4:** Gate → `LINT OK`, `fail 0`.
- [ ] **Step 5:** Commit `feat(client): Draw the valley's spin studio in the Three.js scene`.

### Task 3: View3D without the adapter

**Files:**
- Modify: `client/public/js/view3d/view3d.js`, `client/public/js/view3d/engine/engine.js` and `engine/post.js` (comments only: no adapter/overlay), `client/test/view3d.test.js` and any test passing `{renderer}` to `View3D`.

**Interfaces:**
- Consumes: Task 2's `StudioFloors`, `frame.studio`, RiderEntry `lookId`/`hideBody`.
- Produces: `new View3D(canvas, labelLayer, route, world, {engine, weather})` (the `renderer` option is gone); `setStudioRooms(rooms)` and `studioSite` unchanged.

- [ ] **Step 1: Failing tests** in `client/test/view3d.test.js`:
  - `studio riders ride the rider layer`: a world with `studio` site, riders `[{id: 5, studio: {room: 0, seat: 3}, cadence: 80}]` → the frame passed to `worldScene.update` (spy, or the rider layer's drawn count) contains an entry id 5 at `seatWorld(site, 0, 3).position` and a coach entry id −1.
  - `my body is hidden in my own view`: camera mode `pov` in the studio → my entry has `hideBody: true`.
  - `riders next to the studio camera are left out`: another rider whose seat is < 1.2 m from the eye is not in `frame.riders`; the coach is.
  - `no adapter`: constructing a View3D with only `{engine}` (fake engine as the tests already have) renders a frame without touching a `renderer` (no `renderer` property needed).
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** In `view3d.js`: delete `ThreeRenderer`, `this.renderer`, the old rider meshes (`bodies`, `bodyParts`, `thighs`, `shins`, `foot`, `shoe`, `crankset`, `wheel`, `riderShadow`), `#riderParts`, `#drawWorld`, the shadow pass 0 (`sunShadowMatrix`), the contact-shadow pass (riderLayer's blobs cover it), the `renderer.viewport`/`renderer.end` calls (the side view keeps `engine.renderScene(..., rect)` only), `#pedalPhase`/`#wheelPhase` if nothing else reads them, and `resize` through the engine (`engine.resize(width, height, ratio)`). Studio riders and coaches go into `roadRiders` with `tint` (coach: accent), `speed: rider.speed ?? 0`, `grade: 0`, `hideBody` for me in pov, the near-camera rule; `frame.studio = {floors, open}` from `StudioFloors`.
- [ ] **Step 4:** Gate → `LINT OK`, `fail 0`.
- [ ] **Step 5:** Commit `refactor(client): Draw the road view without the old renderer adapter`.

### Task 4: StudioView3D on the engine

**Files:**
- Modify: `client/public/js/view3d/studioScene.js`, `client/test/studio3d.test.js`, `client/test/workoutStudioView.test.js` if it constructs the view.

**Interfaces:**
- Consumes: `engineFor`, `createRiderLayer`, `createStudioRoom`, `createTracker`, `cameraFromMatrices` (or a plain `lookAt` on a `PerspectiveCamera`), `qualitySettings`.
- Produces: `new StudioView3D(canvas, labelLayer, {engine, reducedMotion})`; `render(frame)`, `setQuality`, `cameraMode`, `cameraPose`, `dispose()` unchanged in shape; `shownInRoom`, `STUDIO_CAMERA_LABELS` and re-exports unchanged.

- [ ] **Step 1: Failing tests** in `client/test/studio3d.test.js` (fake engine as in `view3d.test.js`):
  - `draws the room and the riders`: render with 3 riders → the scene passed to `engine.renderScene` contains an object named `studio-room` and the rider layer reports 4 full cyclists (3 + coach).
  - `pov hides my body`: `cameraMode = "pov"` → my entry `hideBody: true` (spy on the rider layer's update or read its counts).
  - `dispose frees the scene but not the engine`: after `dispose()` the tracker is at 0 and `engine.dispose` was not called.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement: one `THREE.Scene` with `createStudioRoom({ceiling: true})` (named `studio-room`), a `createRiderLayer` built with `{...qualitySettings(quality), riders: {full: 17, reach: 60}}`, a hemisphere light and a key light from `STUDIO_LIGHT.sun` (casting shadows when the quality has them), background `STUDIO_LIGHT.horizon`. Each frame: entries for seated riders + coach (`seatPosition`, `INSTRUCTOR.position`, forward from yaw), `engine.resize`, `engine.beginFrame`, `engine.renderScene(scene, camera)`, `engine.present(camera, STUDIO_ENV)` where `STUDIO_ENV` carries the fields `engine/post.js` reads (`exposure`, `sun`, `sunColor`, `night: 0`, …: read post.js). Labels as today.
- [ ] **Step 4:** Gate → `LINT OK`, `fail 0`.
- [ ] **Step 5:** Commit `refactor(client): Draw the studio class view with the Three.js engine`.

### Task 5: Delete the adapter and what only it kept alive

**Files:**
- Delete: `view3d/threeRenderer.js`, `view3d/shaders.js`, `view3d/studioRoom.js`, `view3d/studioBuilding.js`, and their tests (`test/threeRenderer.test.js`, `test/view3d/studioRoom.test.js`, `test/view3d/studioBuilding.test.js`).
- Shrink: `view3d/riderModel.js` → rename to `view3d/riderGeometry.js` holding only what live code imports (`RIDER_GEOMETRY`, `WHEEL_HUBS`, `BODY_JOINTS`, `BODY_PARENTS`, `BODY_ATTITUDE`, `RIDING_LEAN`, `RIDING_POSE`, `legPose`, … check with grep); update importers; trim `test/riderModel.test.js` to those (rename to `riderGeometry.test.js`).
- Delete any further module under `client/public/js/` not reachable from the entry points, with its tests. Entry points: every `<script type="module">` in `client/public/*.html` and `client/public/**/*.html`, `view3d/worldWorker.js`, and workers created with `new Worker(new URL(...))`. Find them with a throwaway node script (not committed) that follows static `import`/`export … from` and dynamic `import("...")` specifiers.
- Modify: `view3d/NOTICE.md` (the studio is now ported from the reference's `spin-studio`), `client/layering.mjs` if it names a deleted file.

- [ ] **Step 1:** Run the reachability script; list unreachable modules in the report. Keep a module if a test-only or tool entry (e.g. `client/*.mjs`) imports it on purpose.
- [ ] **Step 2:** Delete them and their tests; `grep -rn "threeRenderer\|ThreeRenderer\|shaders.js\|overlay: true" client/public client/test` → nothing.
- [ ] **Step 3:** Gate → `LINT OK`, `fail 0` (the pass count drops by the deleted tests only).
- [ ] **Step 4:** Commit `refactor(client): Delete the old renderer adapter and the modules only it used`.

### Task 6: Shots and draw calls (orchestrator)

- [ ] Draw calls at each level on the ride (`drawcalls.mjs`, 40 bots) and the menu, compared with `landuse-b/after.txt`; save `~/.cache/openradlr/screenshots/move4/after.txt`.
- [ ] Shots: the valley studio from the road and the menu (1 and 3 floors, open and closed), a studio class in the valley (seat, pov, wide, coach), the room-only fallback view, workbench `spin-studio`. Upload to pr-screenshots `polished-world/move4/`.
- [ ] Tick this plan, update memory.
