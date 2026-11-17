# Farms and nature from Quaternius — implementation plan

> **For agentic workers:** work task by task; tests first; every commit passes
> CHECK. This continues the scenery spike (#117), PR #119.

**Spec:** `docs/superpowers/specs/2026-11-17-farms-and-nature-design.md`

**Worktree:** `/root/.local/share/opencode/worktree/984c27/feat/scenery-kit`
(branch `feat/scenery-kit`, PR #119, server on :8080 serves its `client/public`).

**Commands** (no usable Node on the host; mount the whole repo):

```sh
docker run --rm -v "$PWD":/w -w /w/client node:22-alpine node --test test/<file>.test.js
docker run --rm -v "$PWD":/w -w /w/client node:22-alpine sh -c 'npm run lint && npm test'
make scenery-check
```

## Global constraints

- CC0 only; `make scenery-check` must pass.
- Scenery off: `buildWorld` output unchanged.
- Deterministic: farm sites from the existing stream; model choices from a
  separate seeded stream, so the kit does not move the farms.
- Farm models are authored at real-world metres; `planFlora.model()` does not
  apply `height`, so the farm kit must not rely on it.
- UI text only through `i18n/en.js` and `de.js` (ADR 0017).

---

## Task 1: Kit builder and the two Quaternius kits

**Files:** `tools/scenery/assemble-quaternius.mjs`,
`client/test/sceneryQuaternius.test.js`,
`client/public/assets/scenery/quaternius-nature/`,
`client/public/assets/scenery/quaternius-farm/`,
`ASSETS-LICENSE.md`.

- [x] Failing test: the builder's nature selection has 17 models in `firs`,
      `leafy`, `bushes`, `rocks`, every file exists, and no role is over the
      tuft budget by accident.
- [x] Failing test: the farm selection has `farmBarns`, `farmSilos`,
      `farmWindmills`, `farmWells`, `farmFences`, `farmCoops`; a manifest
      declares `CC0-1.0` and provenance.
- [x] Implement the builder: selected models, `readObj`, decimate at
      `--far 0.20`, write `.geo.json` + `manifest.json`, copy the licence
      text.
- [x] Build both kits from the local pack folders and commit them.
- [x] `ASSETS-LICENSE.md`: the two packs, their pages, CC0 evidence and date.
- [x] `make scenery-check` green.

## Task 2: Detail density follows the kit

**Files:** `client/public/js/view3d/scenery/plan.js`,
`client/test/sceneryPlan.test.js`.

- [x] Failing test: a kit with `tufts` returns `detailDensity.tufts`, a kit
      without it returns no `tufts` entry, so the biome keeps its own density.
- [x] Implement: build `detailDensity` from the roles the kit actually holds.
- [x] Existing Kenney behaviour unchanged.

## Task 3: Farmstead placement from the kit

**Files:** `client/public/js/view3d/features.js`,
`client/public/js/view3d/world.js`,
`client/public/js/view3d/lod.js`,
`client/test/sceneryFarm.test.js`.

- [x] Failing test: `buildFarms` with a kit places a barn, house, silo and well
      into the near group and the same transforms into the far group; with no
      kit it places the procedural models exactly as before.
- [x] Failing test: the farm sites are the same with and without the kit for
      the same seed.
- [x] Add `farm`/`farmFar` chunk groups when the kit holds farm roles, add the
      pair to `LOD_PAIRS`, and include `farm` in the shadow pass.
- [x] Implement `buildFarms` kit path with a separate seeded stream, ground
      under each building, occupancy, and hay bales/animals unchanged.
- [x] `KITS_OF.quaternius = ["quaternius-nature", "fantasy-town", "quaternius-farm"]`
      and the `quaternius` scenery level + i18n.
- [x] Scenery off test: no `farm` group and the same structure counts.

## Task 4: Look, measure, screenshot

- [ ] `tools/scene-bench.mjs` / a visibility check for nature, nature+farm,
      Kenney: build time, upload MiB, visible vertices at 6490 m and 7562 m.
- [ ] Playwright `client/sceneryBench.mjs` at the forest, a farm and the
      village; chase and drone; off / Kenney / Quaternius.
- [ ] Screenshots into `~/.cache/openradlr/screenshots/`, then the
      `pr-screenshots` branch for the PR body.
- [ ] Update PR #119: why, what changed, cost table, comparison screenshots,
      and what is still open.

## Review focus

- The farm kit's roles never steal the village's `houses`, `windmills` or
  `fences`.
- A kit without tufts does not thin the biome's grass.
- Turning the kit on does not move the farms.
- The far farm group is cheap; the near farm group is only drawn near.
- Scenery off is byte-for-byte the world it was.
