# Polish after part 4, and the classic rider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the studio's small issues, move the last old mesh code (road posts, bridges) onto Three.js assets and delete `meshBuilder.js`, and add the classic rider: an achievement for riders from before the new world that unlocks the old rider and bike as an own-screen style.

**Architecture:** Fixes stay in the existing studio asset/views. Road posts and bridges become placement data from the world worker plus Three.js assets drawn by `roadLayer`/`riverLayer`. The classic rider is a cyclist asset with `createCyclist`'s interface, chosen per rider entry in `riderLayer` by a `classic` flag the views set for my rider when the setting is on.

**Tech Stack:** plain ES modules, vendored Three.js, node:test.

**Spec:** `docs/superpowers/specs/2026-11-26-classic-rider-design.md` (classic rider); the studio issues are listed in PR #144 "Still open".

## Global Constraints

- Layering per `client/layering.mjs`; Three.js only through `client/public/js/three.js`; deterministic (no `Math.random`).
- UI text in `js/i18n/en.js` and `de.js` (ADR 0017); no duplicate CSS rules in `styles.css`.
- Gate (repo root): `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && echo LINT OK && node --test 'test/**/*.test.js'"` → `LINT OK`, `fail 0`. New modules: `npm run preload` (index.html preload list, checked by lint).
- Commits: Conventional Commits, imperative, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never change git config.

## Review Focus

1. **Imported rides** (backup import, Strava, older export files): must not stamp themselves as new or old wrongly; an imported pre-world record still earns the achievement, a record made now never does.
2. **The setting without the achievement** (a stale `openride.classicRider = true` in storage, e.g. a deleted profile): the classic look is only drawn when the achievement is earned.
3. **Classic rider in my own point of view** (studio pov): `hideBody` hides the classic body too, the bike stays.
4. **Switching the setting mid-ride:** my rider swaps style on the next frame, without leaking the old cyclist (pool keyed by id and style).
5. **Rider profiles** (several per device): achievements and the setting are per profile, like the other per-profile settings.

---

### Task 1: Studio polish

**Files:** `client/public/js/view3d/assets/buildings/spinStudio.js`, `client/public/js/view3d/studioScene.js`, `client/public/js/view3d/view3d.js`, tests `client/test/spinStudio.test.js`, `client/test/studio3d.test.js`, `client/test/view3d.test.js`.

- [x] **Sign:** the workbench's roof sign is a blank black board (the valley shows the text). Find why (text faces −z/back, or the workbench lacks what the scene gives) and fix it so "SPIN STUDIO" reads from the front in both. Test: the sign mesh's text texture is set and its front normal points to the glass front (−z local).
- [x] **Cutaway:** workbench `cutaway: true` with 3 storeys shows no inside. Cutaway removes the roof and ceiling and the glass front of every storey (and the top slab), so the rooms show from above/front. Test: with `cutaway` no glass pane and no ceiling mesh.
- [x] **Glass:** reads dark and murky from outside by day. Lighter, more transparent glass with a faint sky tint (open: opacity ≈ 0.12–0.18, lighter colour; closed floors stay darker). Test: open-floor glass opacity ≤ 0.2 and colour lightness ≥ 0.6.
- [x] **Coach kit:** the coach must wear lemon yellow in both views (`COACH_KIT = "#f5d000"` in `world/studioLayout.js`), not the theme accent (orange). Test in both view tests: the coach entry's tint is the linear of `#f5d000`.
- [x] Gate; commit `fix(client): Polish the spin studio's sign, cutaway, glass and coach kit`.

### Task 2: Road posts and bridges on Three.js assets; delete meshBuilder.js

**Files:** `client/public/js/view3d/world.js`, `roadPosts.js`, `bridges.js`, `structures.js`, `biomes/` (winter buildings' `post`), `scene/roadLayer.js`, `scene/riverLayer.js`, new assets under `view3d/assets/props/` (e.g. `roadPost.js`, `bridge.js`), `view3d/worldScene.js` `sceneOf` if fields change; delete `view3d/meshBuilder.js` and tests of deleted code.

- [x] Read how `world.js` builds `roads.posts` and `rivers.bridges` today and how the layers draw them; list the shapes (post kinds per biome, bridge deck/rails/piers).
- [x] Tests first: the world gives placement data (`{position, yaw, kind}` for posts; `{position, yaw, length, width, kind}` for bridges) instead of mesh data, at the same places as today (compare counts and positions with the old output for the valley fixture, then pin them); the layers draw them as instanced/merged meshes (draw calls: posts ≤ 1 per kind per road cell, bridges ≤ 2 each).
- [x] Implement the assets in our style (vertex colours, shared materials, workbench entries `road-post`, `bridge`), move the placement into `world.js` (pure), delete `meshBuilder.js` and every leftover builder; `grep -rn "MeshBuilder\|meshBuilder" client/public client/test` → nothing.
- [x] Gate; commit `refactor(client): Draw road posts and bridges as Three.js assets and drop the old mesh builder`.

### Task 3: The "Old School" achievement and the world stamp

**Files:** `client/public/js/ride/rideHistory.js`, `client/public/js/main.js` (~4221, the other record builder), `client/public/js/workout/workoutSession.js`, any import path that creates records (grep `startedAt:` and the import modules), `client/public/js/profile/achievements.js`, `client/public/js/view/badges.js`, `client/public/js/i18n/en.js`, `de.js`; tests next to the existing ones (`client/test/achievements.test.js`, `rideHistory.test.js`, …).

**Produces:** `WORLD_STAMP = 2` (exported from `profile/achievements.js` or a small `profile/worldStamp.js`); records carry `world: 2`; achievement id `classicRider`; `hasClassicRider(achievementState) -> boolean` helper where the settings code can use it.

- [x] Tests: a new ride record and a new workout record carry `world: 2`; `classicRider` is earned by a ride record without `world` and not by one with it; an imported record keeps the `world` value it had (absent stays absent).
- [x] Implement; i18n "Old School" / "Alte Schule", hint "Ride before the new world arrived." / "Fahre vor der neuen Welt."; a badge drawing (a simple low-poly bike) and its shape entry in `badges.js`, like `firstRide`.
- [x] Gate; commit `feat(client): Award Old School to riders from before the new world`.

### Task 4: The classic cyclist asset

**Files:** create `client/public/js/view3d/assets/riders/classicCyclist.js`; register in `assets/riders/index.js` (workbench); test `client/test/classicCyclist.test.js`.

**Produces:** `createClassicCyclist(look, {own, uniforms, seed, texture?}) -> Cyclist` with the same members as `createCyclist` (`object`, `rider: {object}`, `bike`, `crank`, `standing`, `ride(dt, {cadence, speed, grade, t, near, standing})`, `lights`, `setLights(level)`, `setKit(texture)` — the classic kit is vertex-coloured, so `setKit` is a no-op and the jersey takes `look.primary` instead, with a `setPrimary(hex)` the layer calls).

- [x] Tests: interface members present; `ride` with cadence 90 over 0.5 s changes the crank and the legs' rotations; `rider.object` holds only body meshes (hiding it leaves the bike); ground contact (lowest wheel point at y ≈ 0); disposal leaves the tracker at 0; deterministic.
- [x] Implement from the old shapes: `git show bca0f2e~1:client/public/js/view3d/riderModel.js` (bike, wheels, crankset, thigh/shin/foot with `legPose`, body parts, helmet; `test/support/riderMeshes.js` has the body parts) as Three.js geometry in the new materials (lit, shadows, fog hooks), the old proportions and flat low-poly look kept.
- [x] Gate; commit `feat(client): Rebuild the classic rider and bike as a Three.js asset`.

### Task 5: The Classic rider switch

**Files:** `client/public/index.html` (Settings checkbox, hidden until earned), `client/public/js/main.js` (setting `openride.classicRider` per profile, shown when `classicRider` is earned), `client/public/js/view3d/view3d.js`, `view3d/studioScene.js`, `view3d/scene/riderLayer.js`, i18n; tests in `view3d.test.js`, `riderLayer.test.js`, `studio3d.test.js` and the settings tests.

- [x] Tests: riderLayer draws `createClassicCyclist` for an entry with `classic: true` and swaps when the flag flips (old one released, no leak); the views set `classic: true` only on my entry and only when `setClassicRider(true)` was called; main shows the checkbox only when earned and ignores a stored `true` without the achievement; `hideBody` hides the classic body.
- [x] Implement: `View3D.setClassicRider(on)` and `StudioView3D.setClassicRider(on)`; my entry gets `classic`; vehicles' seats and gym athletes keep the rig. i18n "Classic rider" / "Klassischer Fahrer", hint "The old rider and bike, on your screen" / "Der alte Fahrer mit Rad, auf deinem Bildschirm".
- [x] Gate; commit `feat(client): Let Old School riders ride the classic rider and bike`.

### Task 6: Shots and the PR (orchestrator)

- [x] Season comparison sheets (old vs spring/summer/autumn/winter per camera) uploaded to `polished-world/after/`; workbench shots of the studio fixes, the road post and bridge, the classic cyclist; a ride shot with the classic rider.
- [x] Update PR #144's description (seasons section, classic rider, fixed items); tick this plan; memory.
