# Scenery from open models — implementation plan

> **For agentic workers:** work task by task; tests first, every commit passes
> CHECK. This is a spike (#117): the goal is a branch to look at, not a merge.

**Goal:** Draw the island with CC0 low-poly models instead of procedural
cones, so a fuller, less repetitive world can be judged by eye and by frame
rate.

**Architecture:** Models are imported offline into
`client/public/assets/scenery/` as flat-shaded vertex-coloured `.geo.json`
plus a manifest. `view3d/scenery/` turns those into `MeshBuilder`s and a
`flora` that `buildScenery` can draw from; placement, occupancy, determinism
and the chunk group stay exactly as they are.

**Spec:** `docs/superpowers/specs/2026-11-16-scenery-from-open-models-design.md`

**Commands** (no usable Node on the host; mount the whole repo — the tests
read `routes/` from the repo root):

```sh
# One test file
docker run --rm -v "$PWD":/w -w /w/client node:22-alpine node --test test/<file>.test.js
# CHECK: lint and every client test
docker run --rm -v "$PWD":/w -w /w/client node:22-alpine sh -c 'npm run lint && npm test'
```

## Global constraints

- CC0 only. Every kit manifest declares `licence: "CC0-1.0"` and provenance;
  `make scenery-check` fails otherwise.
- With scenery off, `buildWorld` output is unchanged and every test passes as
  today (1,605 client tests at the base commit `d4757e2`).
- Deterministic: kit choice, yaw and scale come from the seeded `random`
  `buildScenery` already passes; no `Math.random`, `Date` or I/O in
  `view3d/scenery/`.
- Placement rules are untouched: no scenery on roads, verges, rivers, in the
  sea or on the beach, and nothing inside the occupancy grid.
- UI text only through `i18n/en.js` and `de.js` (ADR 0017).
- `openradlr.scenery` is `"off" | "sparse" | "normal" | "dense"`, default
  `"off"`. `openradlr.showFps` is `"on" | "off"`, default `"off"`.
- Commits reference `#117`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `tools/scenery/import.mjs` | GLB/OBJ → `.geo.json` + manifest; strip UVs, bake face colours |
| `tools/scenery/check.mjs` | Licence gate over every committed manifest |
| `client/public/assets/scenery/<kit>/` | Committed CC0 output |
| `client/public/js/view3d/scenery/models.js` | Manifest → meshes, LOD pick |
| `client/public/js/view3d/scenery/kits.js` | Load and index manifests |
| `client/public/js/view3d/scenery/palette.js` | Role → biome colour (identity now) |
| `client/public/js/view3d/scenery/plan.js` | `floraFor(kit, random)` — a `buildScenery` flora |
| `client/public/js/view/fpsMeter.js` | Rolling mean and 1% low (pure) |
| `client/test/sceneryFixture.js` | Tiny kit for tests |
| `client/test/scenery*.test.js`, `client/test/fpsMeter.test.js` | Tests |

Modified: `view3d/world.js` (`buildScenery` `flora` option), `worldScene.js`,
`worldWorker.js`, `main.js`, `index.html`, `styles.css`, `i18n/en.js`,
`i18n/de.js`, `view/viewPopover.js`, `Makefile`, `ASSETS-LICENSE.md`.

---

### Task 1: Licence record and the gate

- [x] Spec and plan in `docs/superpowers/`.
- [ ] `ASSETS-LICENSE.md`: a "Scenery models" section — CC0 only, the kit
      table with pack URLs, and the rule that a pack showing QAL is skipped.
- [ ] `tools/scenery/check.mjs`: exits non-zero if a manifest under
      `client/public/assets/scenery/` is missing `licence: "CC0-1.0"` or a
      `provenance` block; exits zero on an empty directory (no kits yet).
- [ ] `make scenery-check`, wired into `make check`.

### Task 2: The importer

**Files:** `tools/scenery/import.mjs`, `tools/scenery/import.test.mjs`,
`tools/scenery/fixtures/` (a self-made two-triangle GLB and its colour map).

- [ ] **Failing test:** import the fixture. Expect 6 vertices, no
      `TEXCOORD_0`, per-face colours equal to the sampled texels, normals from
      winding, bounds from positions, origin moved to the base centre.
- [ ] **Failing test:** a manifest declaring a non-CC0 licence makes the gate
      exit non-zero; `CC0-1.0` with provenance passes.
- [ ] Implement GLB parse (JSON + BIN chunks), colour-at-centroid sampling,
      and the OBJ/MTL path for the untextured Quaternius packs.
- [ ] Quantise positions to 2 decimals; drop normals (recomputed on load from
      winding, as `MeshBuilder.triangle` already does).

### Task 3: Models and kits

**Files:** `view3d/scenery/{models,kits,palette,plan}.js`,
`client/test/sceneryFixture.js`, `sceneryModels.test.js`,
`sceneryPlan.test.js`.

- [ ] **Failing test (models):** a `.geo.json` becomes a `MeshBuilder` with
      one vertex per triangle corner; `pickLod(model, distance, nearRange)`
      returns the `far` variant beyond `nearRange`, `near` within it.
- [ ] **Failing test (kits):** a manifest indexes models by name and role; an
      unknown name throws with kit and model in the message; a manifest that
      is not CC0 throws.
- [ ] **Failing test (palette):** a known role takes the biome colour; an
      unknown role keeps the source colour.
- [ ] **Failing test (plan):** `floraFor(kit, random)` draws deterministically
      from the seeded random, sets instances at the given `x, y, z`, and never
      picks a model whose role the kit marks as water-only on land.
- [ ] Implement the four modules.

### Task 4: Into the scenery build

**Files:** `view3d/world.js`, `worldScene.js`, `worldWorker.js`;
`client/test/sceneryWorld.test.js`.

- [ ] **Failing test:** `buildScenery(route, terrain, bounds, { flora })`
      calls `flora.tree` instead of `biome.flora.tree` and leaves the placed
      positions identical for the same seed.
- [ ] **Failing test:** `buildWorld(route)` (no scenery) gives the same
      vertex counts per group as before; `buildWorld(route, { scenery, kits })`
      grows only the `scenery` group.
- [ ] **Failing test:** `buildSceneNow` carries the scenery option and its kit
      meshes through `sceneOf` and the transfer list.
- [ ] Wire `scenery` through the worker message beside `biome`.

### Task 5: The setting

**Files:** `main.js`, `index.html`, `view/viewPopover.js`, `i18n/en.js`,
`i18n/de.js`; `client/test/scenerySetting.test.js`.

- [ ] **Failing test:** saved value → resolved level; garbage or missing →
      `"off"`; `?scenery=` wins without saving.
- [ ] A "Scenery" row in the View popover (Off / Sparse / Normal / Dense),
      rebuilding the world on change the way a biome change already does.

### Task 6: FPS read-out

**Files:** `client/public/js/view/fpsMeter.js`, `client/test/fpsMeter.test.js`,
`main.js`, `index.html`, `styles.css`, settings drawer, `i18n/*`.

- [ ] **Failing test:** the meter reports the mean over its window; the 1%
      low is the mean of the slowest 1%; fewer than a window of frames reports
      nothing yet; one very long frame (tab restore) resets rather than skews.
- [ ] `#hud-fps` beside `.hud-status`, 3D view only, toggled in settings,
      written at 2 Hz.

### Task 7: See it

- [ ] Screenshots at the same camera, scenery off / sparse / dense, plus a
      drone shot.
- [ ] Frame timings from the read-out on real hardware; numbers go in the PR
      body.
- [ ] Draft PR referencing #117.

---

## Review focus

- A pack that is not CC0 never reaches the repo (Task 1).
- Scenery off changes nothing: same vertex counts, same world (Task 4).
- A season the palette does not know keeps the model's own colours (Task 3).
- Placement is identical to today's for the same seed when the same stands
  are picked, so a bug shows up as a moved tree, not a mystery (Task 4).
- The FPS read-out never writes to the DOM more than twice a second (Task 6).
