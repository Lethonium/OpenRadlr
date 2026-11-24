# Step 4: Move the features into the new world — design

Step 4 of the Three.js world (umbrella spec `2026-11-23-three-js-world-design.md`). Steps 1–3 and the new world's
parts 1–4 (`2026-11-24-new-world-design.md`) are done on `feat/polished-world`. Step 5 (delete the old renderer,
after shots, the PR) follows.

## Intent

The world is now drawn by Three.js scene layers with the new materials, light, shadows, weather and night. Everything
the rider actually interacts with — their own rider, other riders, vehicles, the studio, gyms, statues, the crowd,
arches, lemons — is still drawn on top by the temporary adapter (`view3d/threeRenderer.js`) with the old shaders and
flat vertex colours, in an overlay pass. It looks pasted on: no new light, no real shadows, no weather or night look.

Step 4 moves all of it into the new scene, so the whole picture is one world. Logic modules stay pure and keep their
tests; only the drawing is redone. At the end the adapter has no users and is deleted.

## Owner decisions (2026-11-24)

- **Riders are the reference's rigged rider** (`notes/polished-world/reference/assets/creatures/rider.js`, 19 bones,
  skinned, height/weight proportions, painted kit, IK poses), on the reference's bikes (`props/bicycle.js`) and
  composed like `creatures/cyclist.js`, driven by our own state and posing. A simpler rider at Low and far away.
- **A rider's look comes from their id, as today**, now from many more combinations (height, weight, skin, hair,
  kit cut, pattern, colours, glasses, gloves). Bot teams keep their team kits. No protocol, profile or UI change.
  Riders that follow the profile (height, kit picker, sent to others) is a later feature of its own, after the PR.
- **Structure:** one scene layer per feature, fed a per-frame snapshot by the view, like parts 1–4. Not a mesh swap
  inside the adapter (riders would keep the old light), not one big commit (no per-feature shots and review).
- **Rider detail (proposed by me, accepted with the direction):** the nearest riders get the full rig posed every
  frame; further riders a cheap baked version in one batch; at Low everyone but my rider is cheap.

## Goals

1. Every item below is drawn by a scene layer in the new look, with the new materials, sun and lamp shadows,
   weather and night, at every quality level.
2. The adapter (`threeRenderer.js`), the overlay pass and the occlusion-query labels are gone at the end of step 4.
3. Every pure logic module listed under "Kept" still exists with its tests passing unchanged (or changed only where
   it returned old meshes).
4. Each feature lands as its own commit(s) and is checked in shots (at most about 2 shot rounds per part; software
   GL makes a ride shot cost 3–4 minutes).

## Non-goals

- No new features, no protocol change, no profile or settings UI change (apart from quality keys).
- Deleting the old renderer files (`renderer.js` remnants, `meshBuilder.js`, `shaders.js`, old builders, biomes, old
  world chunks in `worldWorker.js`) is step 5, except where step 4 already leaves them without users and their
  deletion is trivial. Then they go in step 4.
- No avatar customisation (see owner decisions).
- The 2D view and the cockpit (second screen) are untouched.

## Anti-goals

- Riders that look worse than today in any way the user notices: wrong jersey colour code (me / humans / bots and
  team kits / remote), feet off the pedals, riders floating or sinking, wrong lane, wrong facing.
- A frame rate drop at Low or Medium with a full road (40 bots) compared with today.
- Losing any of the 13 workout exercises or their statues, or any vehicle (bike, tandem, beer bike of every seat
  count the models have today).

## Scope: what moves

Riding:
- **My rider, other riders, bots, ghost lap**: rider + bike, pedalling at their cadence (my cadence for me, 85 when
  `power > 0` for others, as today), coasting at 0, standing on steep climbs (the reference's rule). Jersey primary
  colour carries today's colour code (`colors.me/human/bot/remote`, bot team kits from `view/botKits.js`); the
  pattern and other colours come from the id. The ghost stays see-through and pale (`SCENE.ghost`).
- **Vehicles**: tandem and beer bike (`vehicleLayout`, `vehicleScene.js` placement) with seated riders pedalling.
  Frames rebuilt in the new material style; seat, pedal and handle points come from `vehicleLayout`.
- **Name labels**: same DOM labels, same `LabelVisibility` and `labelLook`; hidden behind terrain and buildings
  without GPU occlusion queries (method left to the builder; must not stall the GPU).
- **Rider shadows**: real shadows from the sun (and the headlight at High+) replace the blob under the bike. A soft
  contact blob may stay where shadows are off (Low).
- **Bike lights at night**: every rider's bike shows a front and rear light at dusk and night (emissive, no light
  source except my headlight, which part 4 added).

Around the road:
- **Roadside crowd** (`crowd.js` cheer, share, ranks): people from the reference villager style, two poses plus the
  hop and the waving flag, instanced. Placement stays `buildSpectators`' spots (the spots, not its meshes).
- **Route arches and banners** (`banners.js` texts and spots): the reference's `route-arch`, with the start/finish,
  KOM and sprint texts.
- **Lemons** (`ride/lemons.js`): a new lemon asset, bobbing and spinning as today, glowing a little.
- **Roadside furniture still in the old chunks**: guard rails on steep descents and cliffs, village signs, warning
  signs, route markers (`features.buildRoadside`). Drawn as a roadside layer from the same placement rules.
- **Bike cafés and outdoor gyms** (`features.buildBikeCafe`, `buildOutdoorGym`): the reference's `bike-cafe` (its
  four styles mapped to our café ids/biome) and `outdoor-gym`. Their placement must not overlap town plots (part 3
  open item: `hill-cafe` sits at the city centre).
- **Statues** (`statues.js` slots, `STATUE_MOMENT`, materials, glow): the rig frozen at the clip's moment, in marble,
  bronze, sandstone or granite, on the plinth, with the glow for the picked one.
- **Workout riders at the gym** (`#workoutParts`, `clips.js`): the rig playing our 13 clips with the clip fade, and the
  side-view inset (`SIDE_CAMERA`, already rendered by the engine with a viewport).

Studio:
- **The spin studio building in the valley** (`studioLayer.js`: storeys by room count, open/closed glass) and **the
  studio class view** (`StudioView3D`: room, stage, seats, Coach Lemon, riders on smart trainers, seat/pov cameras):
  the reference's `spin-studio`, on our layout (`studioLayout.js`, `studioCamera.js`).
  `StudioView3D` gets the same engine as `View3D` (one WebGLRenderer per canvas) and its own small scene.

Menu:
- **Route highlight** (`highlight.js` colours, lift, beacon): a scene layer, glowing as today.
- Menu camera, drone lens, glide: already on the engine; only the highlight moves.

## Kept as pure logic (tests stay)

`chaseCamera.js`, `menuCamera.js`, `studioCamera.js`, `riderPose.js` (`poseAt`, `blend`, `JOINTS`, clip
validation), `clips.js` (`CLIPS`, `clipFor`, `settle`, `mirrorPose`, `STATUE_MOMENT`), `crowd.js`, `labels.js`,
`banners.js` (`ARCH_TEXT`, `BANNERS`, `bannerSpots`), `highlight.js` (`highlightColor`, `HIGHLIGHT*`),
`studioLayout.js`, `vehicleLayout`, `statueSlots`, `riderLook` (extended, see below), `ride/lemons.js`,
`workout/gymSpots.js`, `vehicleScene.js` placement, the view's pure helpers (`projectToScreen`, `visibleLabels`,
`gymCameraPose`, `sideCameraPose`, …).

`clips.js` today measures the lowest point of a pose from the old mesh corners (`SHAPES`). That needs a source that
is not an old mesh: the rig's bone/skin extents or a table of part sizes. Behaviour (feet on the ground, lying
riders clear of it) must stay as its tests pin it.

## How it is built

### Riders

- **Rig asset**: `view3d/assets/creatures/rider.js` (+ `bicycle.js` under `assets/props/`, a `cyclist.js`
  composer), ported from the reference file by file in our style (as parts 2–4 did), with workbench entries.
- **Look**: `riderLook(id)` grows into the full look (height 1.50–2.05, weight 45–120, skin, hair, kit, pattern,
  colours, glasses, gloves, bike type) from the id hash. Deterministic: same id, same look on every client. The
  jersey's primary colour is overridden by the colour code at draw time. Bike type is road for most riders; a few
  gravel/city; never TT for bots unless the builder sees a reason.
- **Riding pose**: the rig's own `poseRide(fit, {crank, grip, standing, coast, t})` on the bike's contact points.
  Crank angle comes from the view's existing per-rider pedal phase (`#pedal`), so cadence behaves as today.
- **Exercises**: a pure retarget from our joint angles (`riderPose` convention, documented in its header) to bone
  rotations of the rig. All 13 clips, idle and the statue moments go through it. Pinned by tests (e.g. a squat's
  knee bend shows as the shin bone's angle; a lying pose's lowest point is on the ground).
- **Levels of detail**: a new quality key `riders: { full, reach }` — `full` how many riders (nearest first, my rider
  always) get the full rig posed each frame, `reach` how far any rider is drawn (today 600 m). Proposed: Low
  `{full: 1, reach: 300}`, Medium `{full: 4, reach: 450}`, High `{full: 8, reach: 600}`, Ultra `{full: 16, reach:
  600}`. The rest are cheap riders: the rig baked at a few crank positions into plain meshes, instanced per bake,
  bikes via `instancedBikes`. The builder tunes the numbers after measuring.
- **Seated riders** (tandem, beer bike, studio): the rig on the vehicle's seat and pedal points, same posing.

### Layers

New scene layers under `view3d/scene/`, each `{object, update(frame), setEnvironment(env), dispose()}`, added to the
world scene's maker list so `setQuality` rebuilds them:

- `riderLayer` (riders, ghosts, vehicles, bike lights; owns the rigs and the cheap batches)
- `crowdLayer`, `archLayer`, `lemonLayer`, `highlightLayer`, `statueLayer` (statues and gym athletes),
  `studioBuildingLayer`, and roadside/café/gym additions to existing layers or a `roadsideFurnitureLayer`.

The frame grows a snapshot the view builds once per frame from what `render()` already computes: placed riders
(id, position, forward, cadence, tint, ghost, gym/clip state, vehicle), crowd entries, lemons, highlight bands,
statues, studio rooms. Layers do not reach into the view or the network state.

Data that today goes into the old `chunks` from `world.js` (cafés, gyms, roadside, spectators' stands, arches)
becomes placement data in the built world (plain, transferable from the worker, like the part 3 plan), and the old
chunk building is removed for those items.

### Studio view

`StudioView3D` uses `engineFor(canvas)` and a small scene: the studio room asset, the riders via the same
`riderLayer` code in a "studio" mode, Coach Lemon, studio lights. Seat and pov cameras unchanged; in pov my body is
hidden, the bike stays (as today).

## Order (each a part of the plan with its own shots)

1. Rider rig, bike, look, riding pose, LOD, colour code, ghost, labels without occlusion queries — the big one.
2. Vehicles and seated riders; exercises (retarget), gym athletes, statues.
3. Crowd, arches/banners, lemons, highlight, roadside furniture, cafés and gyms (with the town-plot fix).
4. Studio building and studio view; delete the adapter and the overlay pass.

## Constraints

- Layering: `world/` → `view3d/assets/` → `view3d/scene/` → `view3d/engine/`, enforced by `client/layering.mjs`.
- Three.js only through the vendored module; no new dependencies.
- Client tests in plain node (no browser); Three.js code is tested by asserting on scene graphs and pure helpers.
- UI text in `en.js` and `de.js` if any is added (none planned).
- Shots: ride shots on the Simulator (`#use-simulated`), High quality stored; aim from the browser's world.

## Left to the builder

- File layout inside `assets/` and `scene/`, the exact layer split for the small features.
- How labels test occlusion (terrain height along the line, a coarse building box test, a depth readback every few
  frames — anything that does not stall).
- The bake count and poses of cheap riders, the exact LOD numbers after measuring draw calls.
- Which café style goes with which café; how the town-plot overlap is avoided (move the café, or skip plots).
- Whether a contact blob stays at Low.
- How much of the reference's cyclist behaviour (glances, hip rock) is kept.

## Calls made after the builder check (mine; the owner may overrule)

1. **Cheap riders are for road riders only.** Statues never move: each is the rig posed once at its moment and
   baked into a plain mesh (no rig at draw time). Gym athletes (workout riders) use the full rig within the gym's
   reach and do not count against `riders.full`; beyond it they are not drawn (the gym is off the road).
2. **Lemons:** the reference has no lemon. The pickup lemon is redrawn by us after today's `lemonModel.js` (shape and
   colours), in the new materials with a slight glow. **Coach Lemon** is today a rider in the accent colour; he stays
   the rig in a lemon-yellow kit (accent colour), no separate character model.
3. **Tandem and beer bike** are built by us from the bicycle asset's parts (wheels, cranksets, tubes, saddles, bars)
   placed on `vehicleLayout`'s points, plus simple solid parts for the beer bike's platform, bar and roof. Not a
   from-scratch modelling job; one workbench entry each.
4. **Seated riders** use the same `poseRide` with per-seat contact points from `vehicleLayout` (saddle, pedal axle,
   grips or bar). Feet on the pedals and hands on the bars are required, as for solo riders (anti-goal).
5. **VR** is out of scope (the umbrella spec ignores #90).
6. **Performance measure:** draw calls and triangles (`renderer.info`) at each level on a full road (40 bots,
   `OPENRADLR_TARGET_RIDERS=40`), headless, before part 1 and after each part, compared with today. Frame time on
   software GL is not a measure. A real-device check on the owner's hardware happens before the PR.
7. **Cafés and gyms** keep their data shape (`cafes`, `gyms`, `studio` in the built world; the workout and menu code
   read those, and they stay). Only their drawing and old chunk meshes go. A café that would land on a town plot
   moves along its road to the nearest free spot; its route-relative position may change.
8. **Shots inside part 1:** a workbench round first (rider, bike, a few looks), then one ride round (riding, LOD,
   labels, night lights). Later parts: one round each, a second only for fixes.
