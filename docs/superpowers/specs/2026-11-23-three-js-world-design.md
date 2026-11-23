# A new 3D world on Three.js

The umbrella design for replacing OpenRadlr's own WebGL renderer with Three.js and building a new, polished
3D world on it. It sets the structure and order of the work. The two big middle steps (the new world, moving
the features) each get their own design and plan when we reach them.

## Intent

This is the third attempt at a world that looks good up close. Living island (#48, draft PR #49) was good
from the drone but empty and flat next to the road. The scenery kit (#117, draft PRs #119 and #127) made the
world fuller, but the look still did not land. Both stayed inside our own renderer (ADR 0005), which has no
shadows, textures or post effects.

An independent agent prepared a reference: a Three.js (r170) renderer and about 60 procedural assets
(trees, grass, crops, farms, houses, cafés, a lighthouse, animals, a rigged rider, five bike types, the spin
studio, outdoor gym and statues), plus an asset previewer. It is kept outside the repo, in
`notes/polished-world/reference/` (git-ignored; the unpacked zip) (read `HANDOVER.md` there first). It is **inspiration, assets and
renderer**, not a layout: where things go on our island is our decision.

ADR 0005 already foresaw this: "If the scene grows beyond that, switching to Three.js ... only replaces
`renderer.js` and `view3d.js`; the geometry builders stay."

## Decisions made with the owner (2026-11-23)

- **Replace, not add.** Three.js becomes the only 3D renderer. There is no separate "Living" tier beside
  plain 3D.
- **One sweep.** One long branch (`feat/polished-world`) and one PR, built as ordered commits. No period
  with two renderers side by side and no developer switch; the old renderer is deleted on this branch.
  We keep nothing we don't need.
- **Quality levels carry slow hardware.** The same world runs on every device; levels turn effects, grass,
  draw distance and asset detail up or down.
- **Baseline screenshots first.** The first step records the old world from fixed cameras, for the PR
  description and to compare the new look against later.
- **Everything you see while riding survives** (see Scope). World dressing (village, farm and forest
  placement, biomes) is redesigned rather than ported.
- Draft PRs #49 and #127 (and #119 under it) are closed when this lands.

## Goals

- A 3D world that looks rich and polished up close and from the drone: soft shadows, ambient occlusion,
  bloom, colour grading, height fog, dense grass, crop fields, detailed trees and buildings, animals.
- Every 3D feature of today, rebuilt in the new look (list under Scope).
- Runs on weak hardware through quality levels, without a second renderer.
- An asset workbench: each asset can be developed and reviewed on its own, in day and night light.
- `make check` stays green, and the rule from CONTRIBUTING.md holds: new behaviour starts with a failing node
  test (no browser).

## Non-goals

- Pre-rendered route video for the weakest devices. Possible later (routes are fixed paths), filed as a
  separate idea, not part of this work.
- Changes to the 2D view (`client/public/js/view/`). It stays as it is, including as the fallback without
  WebGL 2.
- Native engine clients.
- VR (#86). Draft PR #90 was an experiment and is ignored here; it targets code this branch deletes.
- Real-GPU performance tuning beyond sane defaults: this machine has no GPU; the owner measures on their
  laptop and phone.

## Anti-goals

- A world that looks like a tech demo but is empty or repetitive next to the road. The close-up view while
  riding is what matters most (lesson of #49).
- Patchy, quilt-like farmland (owner feedback on #49): calm greens, farmland about a third of the lowland,
  organic woods.
- Losing a feature riders use today (studio, statues, gyms, crowd, labels, beer bike, ...).
- A level so heavy that a phone or an old laptop can't ride.
- A CDN or any other external request at runtime.

## Constraints

- **No build step.** The client is plain ES modules served from `client/public`.
- **CSP `script-src 'self'`** (`server/crates/server/src/headers.rs`) and **offline use** (LAN server,
  Android app bundling `www`). Three.js and the addons we use are vendored into the repo (e.g.
  `client/public/vendor/three/`), pinned, with their MIT licence. The reference's jsDelivr import map can't
  be used as is. Three's addons import the bare specifier `three`, so the browser needs an import map
  (inline: needs a CSP hash or nonce from the server) or the vendored addons get their import rewritten.
  The node tests must resolve the same specifier. Builder's call, recorded in the ADR.
- **Tests run in plain node.** Three.js core (geometry, maths, scene graph) loads in node without a DOM, so
  asset builders, placement and cameras stay testable there. Only the `WebGLRenderer` and post chain need a
  browser.
- **Everything is placed on the GPS-anchored world** (origin 39.0N 2.6E, never moved) and the existing map
  and route data (`routes/`, `valley.json`). Server and protocol are untouched.
- **Licence:** the reference code is original and procedural; we take it under the project licence (AGPL-3.0)
  with its own notice where the handover asks for one. Three.js is MIT.
- **Composition roots stay** (`main.js`, `gallery.js`, `cockpit/main.js`); dependencies are injected as
  today.

## Approaches considered

1. **Adopt Three.js, replace in one sweep (chosen).** The reference assets work as they are, we gain
   shadows, post effects and instancing for free, and nothing of the old renderer lingers. Cost: one long
   branch and a big PR, and no release of the new world until it is complete.
2. **Adopt Three.js, both renderers side by side behind a developer switch until parity.** `main` stays
   shippable throughout. Rejected by the owner: it keeps the old code alive and pulls the work toward
   copying today's look before building the new one.
3. **Keep our own renderer and rewrite the assets for it.** Every one of the 60 assets imports Three.js, and
   shadows, post effects and skinning would have to be written from scratch. Rejected: the most work for the
   least gain.

## Structure: the steps on the branch

Each step ends green (`make check`) and is committed in order.

### Step 1: Baseline screenshots of the old world

Before any code changes, record today's world with a reproducible shot script, so the same cameras can be
shot again on the new world. Shots at 1× (software GL; see the screenshot notes in AGENTS.md), saved under
`~/.cache/openradlr/screenshots/baseline/` and uploaded to the `pr-screenshots` branch in a
`polished-world/before/` folder for the PR description. The shot list (fixed seeds, fixed time of day):

- start menu: drone over the whole island; drone over one picked route
- riding, chase camera: a village, a forest road, a climb with banners, the coast, a farm with animals
- other riders on the road with name labels; the crowd at a sprint or summit
- the spin studio (outside and inside), a statue, an outdoor gym with the workout rider
- beer bike and tandem
- winter biome with snowfall, the dusk preset (the old world has no rain)

The script lives with the other shot helpers (`client/screenshot.mjs` style), takes a camera list, and is
reused unchanged for the after shots in step 5.

### Step 2: Foundation

- Vendor Three.js and the needed addons; solve the `three` specifier for browser and node (see
  Constraints).
- New ADR (0030) superseding ADR 0005: Three.js as the renderer, vendored, and what stays pure and tested.
- A `ThreeRenderer` with the same interface as today's `Renderer`, on Three.js with today's shaders, so the
  whole app (menu, ride, studio) runs on Three.js from here on with the same look, and `renderer.js` is
  deleted. Steps 3 and 4 replace these calls with a real scene graph. Riders' labels lose occlusion until
  step 4.
- Quality levels defined in one place (see Quality levels).

### Step 3: The new world (own design and plan)

Terrain, sea, sky, lighting, shadows, post chain, grass, crops, trees, villages, farms, landmarks, animals,
seasons, with our own placement rules over the real map and routes. The reference's world is a starting
point for techniques, not its layout. The asset previewer replaces the model gallery (`gallery.html`) as the
asset workbench. World generation runs off the main thread (as `worldWorker.js` does today). The winter biome
becomes the island's winter season.

### Step 4: Move the features (own design and plan)

Everything under Scope, onto the new world. Logic modules stay and keep their tests; only their drawing is
redone.

### Step 5: Delete the old renderer, after shots, PR

Remove the own-WebGL code (`renderer.js`, `meshBuilder.js`, the shaders, old geometry builders and their
tests, old world drawing in `worldWorker.js`), shoot the step-1 camera list again, and open the PR with
before/after pairs. Close #49, #119 and #127.

## Scope: what survives

Rebuilt in the new look:

- your rider, other riders, bots and team kits, name labels (`labels.js`)
- vehicles: bikes, beer bike, tandem (`vehicleScene.js`, `vehicleModel.js`)
- the spin studio and its room, stage, seats and Coach Lemon (`studio*.js`, `lemonModel.js`)
- statues, outdoor gyms and the workout rider's exercises (`statues.js`, `clips.js`, `workout/gymSpots.js`)
- the roadside crowd and its cheering (`crowd.js`), route arches and banners (`banners.js`)
- the start menu: drone camera, glide to a route, route highlight (`menuCamera.js`, `highlight.js`)
- weather and time of day (`weather.js`, `lighting.js`)
- the chase camera modes (`chaseCamera.js`)
- lemons and anything else drawn in the 3D view from outside `view3d/` (`ride/lemons.js`, `view/menuStage.js`
  and friends)

Kept as pure logic (with their tests): cameras, rider posing (`riderPose.js`, `clips.js`), crowd behaviour,
label visibility, banner texts, route zones, studio and vehicle layouts, lighting presets. Our own maths
helpers (`math.js`) are kept only where Three.js doesn't cover them.

Redesigned instead of ported: world dressing and placement (`features.js`, `zones.js` where it places
scenery, `island.js`, `biomes/`, `structures.js`).

## Quality levels

Today there are two: `high` and `low` (`openride.quality`); `low` also starts the app in 2D. The new world
gets several levels (proposal: Low, Medium, High, Ultra), each a set of switches:

- shadows (off or map size), SSAO, bloom, depth of field, sun rays, MSAA
- grass rings (radius, density), draw distance, tree LOD distances, far impostors
- asset detail (segments, leaf cards vs. simple hulls, animated parts), crowd and animal counts
- pixel ratio and dynamic resolution floor

Assets are procedural, so lower detail is a build option of each asset, not a second set of models. Far
trees and buildings can become camera-facing cut-outs (impostors). An automatic default picks a level per
device; the rider can change it in settings.

**Hardware floor (owner, 2026-11-23):** there is no fixed weakest device to support. The weakest device at
hand, an old Android tablet with about 3 GB of RAM, is not the baseline. A device that can't run Low
smoothly uses the 2D view instead, as devices without WebGL 2 do today. So Low is a light 3D world, not a
bare one, and the automatic default must be able to choose 2D (signals such as WebGL 2 support,
`navigator.deviceMemory`, the `saveData` hint already in `main.js`, or a short frame-time probe; decided in
step 3's design).

## Calls made while writing (the owner may override)

- **Main keeps moving.** Main is merged into the branch at the end of each step. Fixes to the old 3D code on
  main during the sweep are carried over by hand into the new code. New 3D features wait for step 4 or
  land on the branch.
- **No hard size budget.** Three.js core minified (about 700 KB, about 170 KB gzipped) plus only the addons
  we import are vendored, not the whole addon tree.

## Left to the builder

- The vendoring layout, the `three` specifier solution and how Three.js versions are updated (Dependabot or a
  script).
- File layout of the new `view3d/` (e.g. `assets/` folder as in the reference, or by feature).
- Which reference assets are taken, adapted or dropped; what of the reference's post chain is worth its cost.
- The exact shot script and camera coordinates for step 1, within the shot list above.
- Test strategy details for Three.js code in node (what is asserted about scene graphs).
