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

---

## Status and handoff (2026-11-16, end of session)

Direction chosen by the user: **keep Kenney** (Nature Kit trees, no KayKit or
Quaternius), **build full villages** from Kenney's Fantasy Town Kit, and
**carry on with the woods/fields noise** (`land/land.js`). PR #119 stays a
draft.

### Done (committed on `feat/scenery-kit`)

- `14d7c82` importer keeps glTF node transforms and, with `origin: "keep"`,
  a modular part's place on its tile. This was why the first cottages came
  out as scattered walls.
- `d2c9ee5` `tools/scenery/assemble.mjs` builds the `fantasy-town` kit:
  8 cottages, church, windmill (each with a 14-face far twin) + fountain,
  stalls, bench, lantern, fence, hedge, cart. Rebuild with
  `node tools/scenery/assemble.mjs "<pack>/Models/GLB format" client/public/assets/scenery/fantasy-town`
  (pack zip: kenney.nl/assets/fantasy-town-kit; copy its License.txt in).
- `66e6679` the Models level loads `nature` + `fantasy-town`; kits merge by
  role with prefixed file names; far twins are downloaded.
- `3f12682` full villages (`view3d/scenery/village.js`, `furnishVillage` in
  `features.js`): street front with gardens and fences/hedges, back lane with
  garden trees, paved square (fountain, benches, stalls, lanterns, cart),
  church on the square, windmill outside. Buildings near/far split at 350 m
  (`view3d/lod.js`, groups `village`/`villageFar`). Scenery off is unchanged.
- `cbec402` `buildCanopy` in `world.js`: cheap crowns filling woods 60–420 m
  from roads. **Tested, not wired in yet.**

`make check` client side: 1,856 tests green, lint clean, scenery-check passes.

### Findings that drive the next steps

- Woods read as an orchard: ~2,400 trees spread over woods of km scale
  (`WOOD_SCALE` 720 m) is about one tree per 2,000 m². Modelled trees
  (~100 faces) cannot fill that; hence the canopy.
- The patchy quilt on the ground is the biome's own `terrainColor`
  (`valueNoise(x/85)` over `FIELDS`), not the land's woods/fields. The ground
  ignores where the woods are.
- Wall colours look grey-blue on the shaded side: scene ambient, not a bug
  (normals checked, file colours correct).
- The procedural (scenery off) village never builds its front row: lots at
  9.5 m are always within `avoid`'s road margin. Left as is for parity; the
  kit village has its own layout.

### Next

1. Wire `buildCanopy` into `buildWorld` when scenery is on (once over the
   island box, into its own chunk group or `scenery`), measure vertices, look.
2. Land-aware ground colour: pass `land` to `buildTerrain` → temperate
   `terrainColor` uses dark forest floor under woods, calm crop colours in
   fields, plain meadow elsewhere instead of the 85 m quilt. Keep the
   user's earlier rule: not patchy, farmland about a third, calm greens.
3. Possibly more modelled trees in the belt along the road inside woods.
4. Re-shoot screenshots (drone/street/square/forest), update PR #119 body
   (the Kenney-vs-better-packs question is answered: Kenney).
5. Real-hardware frame rate; triangle cost of a village (cottages are
   1–3k faces, mostly timber detail; church ~5k).

### How to look at it

- Worktree: `/root/.local/share/opencode/worktree/984c27/feat/scenery-kit`
  (opencode's). A server from it may still run on :8080; it serves
  `client/public` live, so client changes need only a reload.
- Village 2 of `rolling-hills` is at 7397–7727 m (square ~7562), the forest
  zone at 5946–6648. Shots: join with `?at=<m>`, scenery `models`, pause the
  ride right after joining (software GL needs ~45 s, the rider drifts
  ~500 m otherwise). Helper scripts used this session are in
  `/tmp/claude-ft/scripts/` (`shot.sh`, `shot.cjs`, `render.cjs`); they patch
  the drone camera via request interception to get aerial views. /tmp may
  not survive; recreate from this description if needed.
