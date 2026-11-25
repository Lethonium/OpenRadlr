# Move the features, part 2: vehicles, gym athletes, statues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workout riders at the outdoor gyms, the gyms' statues and the shared vehicles (tandem, beer bike) with their seated riders are drawn by the new world on the part 1 rig, and their old adapter paths are gone.

**Architecture:** A pure retarget in `view3d/assets/riders/` turns our clip poses (`riderPose.js` joint angles) into rig bone rotations and settles them on the ground from the rig itself. Three scene parts read per-frame snapshots that `View3D.render()` builds: an athlete layer (`frame.athletes`), a statue layer (rows set once, glow per frame) and vehicles inside the rider layer (`frame.vehicles`). The winter season keeps its penguins as an outfit on the same rig.

**Tech Stack:** plain ES modules, vendored Three.js (`client/public/js/three.js`), node test runner, Playwright (shots only).

**Spec:** `docs/superpowers/specs/2026-11-24-move-features-design.md` (part 2 of its Order, and its calls 1, 3, 4), under `docs/superpowers/specs/2026-11-23-three-js-world-design.md`. Part 1's plan, `docs/superpowers/plans/2026-11-24-move-features-part-1.md`, built what this one consumes.

## Global Constraints

- Layering `world/` → `view3d/assets/` → `view3d/scene/` → `view3d/engine/`, enforced by `client/layering.mjs`: assets import only `world/`, assets and Three.js; scene may import `view3d/` modules (e.g. `clips.js`, `statues.js`, `vehicleModel.js`) but not `engine/`.
- No `document`/canvas, no `Math.random` in assets or layers; every resource through `own` (`createOwner(track)`), freed by `dispose()`.
- Our pose convention (`riderPose.js` header) is the input: forward −Z, angles about the body's X axis, `…z` joints sideways; the rig faces **+x**, up +y, right +z (part 1). The retarget converts once; clips stay untouched.
- Look and colour as part 1: `lookOf(id)` from `assets/riders/look.js`, jersey primary = the colour code tint (linear 0–1), converted as the rider layer does.
- Kept pure logic and its tests: `clips.js` (`CLIPS`, `clipFor`, `mirrorPose`, `mirrorPlant`, `STATUE_MOMENT`), `riderPose.js` (`poseAt`, `blend`, `JOINTS`, `validClip`), `statues.js` (`statueSlots`, `STATUE_MATERIALS`, `PLINTHS`), `vehicleScene.js`, `vehicleLayout`, `workout/gymSpots.js`, `workout/venues.js`.
- Studio riders and Coach Lemon stay on the adapter (part 4).
- Commits: Conventional Commits, imperative, trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No model ids anywhere.
- Gate per task (repo root): `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && node --test 'test/**/*.test.js'"` — all pass, lint clean. `npm run preload` (same container) when a module joins a page's import graph; commit the `*.html` change.

## Review Focus

1. **A workout rider with no or an unknown exercise** (just arrived, old client): stands idle on the ground at the spot, not lying or floating. Test in Task 3.
2. **A beer bike with empty seats, and me aboard** (5, 7 or 9 seats, some `null`): empty saddles stay empty, every occupied seat has a rider with feet on the pedals, and my rider is drawn once, on the vehicle, not also on the road. Test in Task 5 (seats) and Task 6 (me once).
3. **Riding away from a gym and back** (athletes leave the reach and return): rigs are released and reused without leaking; nothing is drawn past the reach. Test in Task 3.
4. **Winter** (season Winter → penguins): penguin athletes and penguin statues still rest on the ground or plinth, in every clip. Test in Task 2 and Task 4.
5. **A lying statue longer than its plinth** (downward dog, low lunge on `PLINTHS.lying`): shrunk to fit the plinth, as today. Test in Task 4.

---

### Task 1: Retarget our clips onto the rig, settled from the rig

**Files:**
- Create: `client/public/js/view3d/assets/riders/retarget.js`
- Modify: `client/public/js/view3d/assets/riders/rider.js` (contact points, `poseJoints`)
- Test: `client/test/retarget.test.js`

**Interfaces:**
- Consumes: `createRider(look, {own, uniforms})` (part 1) and its bones `RIG_BONES`.
- Produces:
  - `RiderRig.poseJoints(pose: Pose)`: sets bone rotations from `Pose = {root: {y, z?, pitch}, joints: Record<string, number>}` (the `riderPose.js` shape, joint names as `JOINTS`); missing joints count as 0. `root.y` and `root.z` move the hips as `bodyTransforms` does (up, and back = rig −x); `root.pitch` turns the whole body about the rig's z axis with the same sense as `bodyTransforms` (π/2 lies on the back).
  - `RiderRig.contactPoints: {bone: string, local: THREE.Vector3}[]` (a few points per bone on the skin surface, taken once from the bind pose: for each bone the skinned vertices weighted ≥ 0.6 to it, their extremes along the bone's 3 axes) and `RiderRig.lowestPoint() -> number` (min y over the contact points in the rig object's frame).
  - `settleOnRig(rig: RiderRig, pose: Pose, plant?: {bone: string, x: number} | null) -> Pose` in `retarget.js`: the pose with `root.y` replaced so the rig's lowest point is `pose.root.y` above the ground, and with `plant` (bone origin) moved back along the rig's x to `plant.x`. `plantFor(rig, clip) -> {bone, x} | null`: a clip's `plant.mesh` (`footR` → `foot_R`, `footL` → `foot_L`, `shinR` → `shin_R`, …) measured at the clip's first key.
  - `JOINT_BONES` (the mapping, exported for the tests): spine → `spine` and `chest` (half each), neck → `neck`, shoulderX/z → `upperArm_X`, elbowX → `forearm_X`, hipX/z → `thigh_X`, kneeX → `shin_X`, ankleX/z → `foot_X`.

- [ ] **Step 1: failing tests** (`retarget.test.js`, each pose from `clips.js`/`riderPose.js`)
  - `the zero pose stands upright` — `poseJoints` of the zero pose then `settleOnRig`: lowest point 0 ± 0.01, `headPos` y within 4 % of `rig.height − 0.1`.
  - `a knee bend shows as the shin's angle to the thigh` — joints `{kneeR: −1.2}`: the angle between the `thigh_R` and `shin_R` bone directions (world) is 1.2 ± 0.02 rad, and the lower leg swings back: `foot_R` origin x < `shin_R` origin x − 0.2 (rig −x is back).
  - `a hip lift swings the thigh forward` — `{hipL: 1.0}`: the `shin_L` origin is ahead (rig +x) of the `thigh_L` origin by more than 0.25 m.
  - `sideways joints raise a limb away from the body` — `{shoulderRz: 1.2}`: `hand_R` z > `upperArm_R` z + 0.3; `{shoulderLz: 1.2}`: `hand_L` z < `upperArm_L` z − 0.3.
  - `every clip stays on the ground` — for each `CLIPS` entry and 12 times over its `loopS`: after `settleOnRig(rig, poseAt(clip, t), plantFor(rig, clip))`, `lowestPoint()` equals the clip pose's `root.y` (0 except jumps) ± 0.01.
  - `lying on the back keeps the body flat` — `situps` at t 0 and `plank` at t 0: `|head y − foot_R y| < 0.35`, lowest point 0 ± 0.01.
  - `a planted foot holds still` — `squats` over 12 times: the planted bone's world x varies by less than 0.03.
  - `a mirrored pose mirrors the body` — `mirrorPose(poseAt(CLIPS.low_lunge, 0))`: each `_L` bone's world z equals minus the `_R` bone's z of the unmirrored pose ± 0.01 (and x, y equal ± 0.01).
- [ ] **Step 2:** Run `node --test test/retarget.test.js` → FAIL.
- [ ] **Step 3:** Implement. Bones rotate in their own bind frames: express each joint as a rotation about the body's side axis (rig z) or forward axis (rig x, for `…z`) in the parent's frame, as `bodyTransforms` composes them (X rotation then Z). Riding poses (`poseRide`) must keep working: `poseJoints` resets the bones it drives first.
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Play our exercise clips on the rigged rider`.

### Task 2: Penguins on the same rig (winter)

**Files:**
- Create: `client/public/js/view3d/assets/riders/penguinOutfit.js`
- Modify: `client/public/js/view3d/assets/riders/rider.js` (workbench option `figure: rider | penguin`)
- Test: `client/test/penguinOutfit.test.js`

**Interfaces:**
- Consumes: `RiderRig`, `poseJoints`, `contactPoints`, `settleOnRig` (Task 1).
- Produces: `PENGUIN_SCALE = 0.78`; `dressAsPenguin(rig, {own, uniforms, scarf: string}) -> void` — hides `rig.mesh` (and helmet/glasses), parents penguin parts to bones (body on `hips`/`chest`, head on `head`, flippers on `upperArm_X`/`forearm_X`, feet on `foot_X`), scales the rig object by `PENGUIN_SCALE`, and replaces `rig.contactPoints` with points on the penguin parts. Shapes after today's `biomes/winter/people.js` `penguinWorkoutParts` (and the reference `notes/polished-world/reference/assets/creatures/penguin.js` for the look), black back, white front, orange beak and feet, the scarf in the tint.

- [ ] **Step 1: failing tests**
  - `a penguin hides the rider and rides the bones` — after `dressAsPenguin`: `rig.mesh.visible === false`; every penguin mesh's parent is a `THREE.Bone` of the rig.
  - `penguins stay on the ground in every clip` — as Task 1's "every clip stays on the ground", on a dressed rig.
  - `the scarf takes the tint` — `scarf: "#ff0000"`: some penguin material or vertex colour is (1, 0, 0) in sRGB.
  - `dispose frees the penguin` — tracker: all owned resources disposed after `disposeAll`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; materials with `cloudShadows`/`heightFog` hooks, `castShadow` on.
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Dress the rig as a penguin for winter workouts`.

### Task 3: Gym athletes layer

**Files:**
- Create: `client/public/js/view3d/scene/athleteLayer.js`
- Modify: `client/public/js/view3d/scene/worldScene.js` (maker `athletes`, `setQuality` rebuild list, Frame typedef)
- Test: `client/test/athleteLayer.test.js`

**Interfaces:**
- Consumes: `createRider`, `kitTexture`, `lookOf`, `createBike`, `bikeGeometry`, `poseJoints`, `settleOnRig`, `plantFor`, `dressAsPenguin`, `PENGUIN_SCALE`.
- Produces:
  - `frame.athletes: AthleteEntry[]`, `AthleteEntry = {id, position: number[3] (the spot on the mat), yaw (our `placement` yaw: 0 faces −Z), pose: Pose (already blended and mirrored by the view; NOT settled), plantMesh: string | null (the clip's `plant.mesh` after mirroring), tint: number[3], figure: "rider" | "penguin", bike: {position: number[3], yaw} | null}`; missing means none.
  - `ATHLETE_REACH = 200` (m from `frame.camera`); `createAthleteLayer({settings, uniforms, track})` (`object.name = "athletes"`), `stats() -> {drawn}`, `rigOf(id)` for tests. Athletes do not count against `riders.full`.

- [ ] **Step 1: failing tests**
  - `an athlete stands on its spot, facing its yaw` — entry at (5, 2, −3), yaw π/2, zero pose: the rig's lowest world point y = 2 ± 0.01; its `hips` world x,z within 0.15 of (5, −3); the rig's forward (rig +x in world) equals our yaw's forward (`[−sin yaw, 0, −cos yaw]`) ± 0.01.
  - `an athlete with no exercise stands idle` — `pose` = `poseAt(clipFor(null), 0)`: head y − spot y > 1.4.
  - `a squat keeps its feet planted` — `squats` sampled over 1 loop with `plantMesh "footR"`: `foot_R` world x,z vary < 0.03.
  - `the parked bike stands at the rack` — `bike` at (8, 2, −3), yaw 0: a bike object's both wheel bottoms are at y 2 ± 0.02 and it faces −Z.
  - `athletes past the reach are not drawn and leave no leak` — one at 150 m (drawn), one at 250 m (not); then id 7 in/out ×10: live owned resources equal those after the first update.
  - `a penguin athlete` — `figure: "penguin"`: the rig is dressed (`rig.mesh.visible === false`), lowest point on the spot.
  - `a changed tint repaints the kit` — as part 1's rider layer test.
  - `dispose frees everything`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: pool rigs by id (and figure); place the rig object at `position` with the yaw converted as the rider layer does (+x → our forward); `settleOnRig` each frame with the plant measured once per clip change (`plantFor` needs the clip's first key: the view passes `plantMesh`; take `x` from the pose at the frame the plant first appears for that id and hold it until `plantMesh` changes). Bikes from `createBike` (look's bike type and colours), standing still.
- [ ] **Step 4:** Gate → PASS; `npm run preload` if needed.
- [ ] **Step 5:** Commit `feat(client): Draw gym athletes on the rigged rider`.

### Task 4: Statue layer

**Files:**
- Create: `client/public/js/view3d/assets/riders/statue.js`, `client/public/js/view3d/scene/statueLayer.js`
- Modify: `client/public/js/view3d/scene/worldScene.js` (maker `statues`; the layer keeps its rows across `setQuality` rebuilds: the scene re-sends the last rows), `client/public/js/view3d/assets/riders/index.js` (workbench `statue`)
- Test: `client/test/statueLayer.test.js`

**Interfaces:**
- Consumes: `createRider`, `poseJoints`, `settleOnRig`, `dressAsPenguin`; `STATUE_MATERIALS`, `PLINTHS`, `statueSlots`, `STATUE_MOMENT`, `CLIPS`, `poseAt` (scene side).
- Produces:
  - `bakeStatue({pose: Pose, material: {figure: number[3], accent?: number[3]}, figure: "rider" | "penguin", own, uniforms}) -> {geometry: THREE.BufferGeometry, box: THREE.Box3}` (rig posed and settled, skinned vertices baked as part 1's cheap riders do, one colour, no rig at draw time; bronze patina from `accent` on the lower 15 % of the figure).
  - `createStatueLayer({uniforms, track})` (`object.name = "statues"`): `setRows(rows: {gym: object, figures: string[], material: string, figure: "rider" | "penguin"}[])` (each row placed at `gym.statueRow.position`/`.yaw`, plinths from `PLINTHS`, figures at `statueSlots` x, scale 1.15 (× `PENGUIN_SCALE` for penguins), a lying figure longer than its plinth shrunk to fit, centred over the plinth), `setGlow(gym | null, index | null)` (an emissive ring around that plinth's top, visible only for it), `update(frame)`, `dispose()`. Figures and plinths of a row merge into one mesh per material.

- [ ] **Step 1: failing tests**
  - `each figure rests on its plinth` — a row `squats, pushups, situps` in marble: each figure's box bottom = its plinth top ± 0.01 (upright 1.0, lying 0.6) in the row frame.
  - `a lying figure fits its plinth` — `downward_dog`, `low_lunge`: figure box x-length ≤ `PLINTHS.lying[0]` + 0.001.
  - `the glow lights one plinth` — `setGlow(gym, 1)`: exactly one ring visible, centred at slot 1's x; `setGlow(null, null)`: none.
  - `materials colour the figures` — bronze: the figure's colour is `STATUE_MATERIALS.bronze.figure` and the patina `accent` appears.
  - `penguin statues stand on their plinths` — `figure: "penguin"`, `squats, plank`: as the first test.
  - `rows replace rows without leaking` — `setRows` 5 times: live owned resources equal those after the first.
  - `a row of one sits in the middle` — one figure at x 0.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. The view's `statueTargets(gym)` keeps working from the pure `statueSlots` and `PLINTHS` (unchanged).
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Carve the gym statues from the rigged rider`.

### Task 5: Tandem and beer bike with seated riders

**Files:**
- Modify: `client/public/js/view3d/vehicleModel.js` (`vehicleLayout` seats gain `grips: number[3][]`, two points where the hands rest: tandem captain the bar ends, stoker the captain's seat-post bar, beer bike the counter edge in front of the seat; pure, in its frame)
- Create: `client/public/js/view3d/assets/riders/vehicles.js`
- Modify: `client/public/js/view3d/scene/riderLayer.js` (`frame.vehicles`), `client/public/js/view3d/assets/riders/index.js` (workbench `tandem`, `beer-bike`)
- Test: `client/test/vehicleModel.test.js` (grips), `client/test/vehicles.test.js`, `client/test/riderLayer.test.js`

**Interfaces:**
- Consumes: `bikeGeometry`, `createBike` parts (wheel, crankset, saddle, bar builders — export the needed builders from `bicycle.js`), `createRider`, `poseRide`, `lookOf`, `kitTexture`.
- Produces:
  - `seatFit(seat: {hip, bottomBracket, yaw, grips}, look) -> BikeFit` in `vehicles.js`: a `bikeGeometry("city")` fit with `bb`, `saddle`, `grips` replaced by the seat's points converted to the rig frame (our −Z forward → +x).
  - `createVehicle({kind: "tandem" | "beer_bike", layout, own, uniforms}) -> {object, setWheels(distanceM), setCranks(angles: number[]), seatFrame(index) -> THREE.Object3D}`; tandem from two crank sets, two saddles, one long frame in tubes, two wheels; beer bike: platform, counter (bar), roof on posts, four wheels, one crankset and saddle per seat — simple boxes and the bike's parts, new materials, `castShadow`.
  - `frame.vehicles: VehicleEntry[]`, `VehicleEntry = {id, kind, layout (from `layoutOf`), position, forward, speed, seats: ({id, me, cadence, tint} | null)[]}` read by the rider layer; vehicles are drawn up to `riders.reach`; seated riders are full rigs and do not count against `riders.full`.
  - `riderLayer.seatHeads() -> Map<riderId, number[3]>`: world points 0.25 m above each seated rider's head after the last `update`, for the view's labels.

- [ ] **Step 1: failing tests**
  - vehicleModel: `every seat has two grips in reach` — for tandem 2 and beer bike 5, 7, 9: each seat's grips are 0.45–0.75 m from its hip and in front of it (along its yaw).
  - vehicles: `wheels touch the ground` — both kinds: every wheel's lowest point y 0 ± 0.01.
  - vehicles: `seated riders reach pedals and grips` — each seat of tandem and beer bike 7: after `poseRide(seatFit(...), {crank: 0.6})` on a rig in `seatFrame(i)`, foot ball within 0.04 m of its pedal, palm within 0.06 m of a grip (as part 1 measures).
  - riderLayer: `a vehicle carries its riders` — a beer bike 7 with seats `[a, null, b, null, null, c, null]`: 3 rigs drawn on it, none at the empty seats; the vehicle faces `forward`.
  - riderLayer: `vehicle wheels turn with speed` — speed 5, dt 1: the wheel turned by 5 / wheelRadius ± 1e-6.
  - riderLayer: `vehicles leave and return without leaking` — as part 1's leak test.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Crank angle per seat from each seat's cadence (part 1's `ride` rule; 0 holds the pedals level).
- [ ] **Step 4:** Gate → PASS.
- [ ] **Step 5:** Commit `feat(client): Ride the tandem and the beer bike in the new world`.

### Task 6: View wiring; old paths out

**Files:**
- Modify: `client/public/js/view3d/view3d.js` (build `frame.athletes`, `frame.vehicles`; `setStatues`/`setStatueGlow` go to the statue layer; remove the adapter drawing of workout riders, their bikes, statues, vehicles, seated bodies and their shadow casters and blobs; vehicle riders' label heads from the layer's seat positions), `client/public/js/view3d/clips.js` (drop `settle`, `SHAPES`, `RIG_SHAPES`, `measure` once unused — keep `planted` working: it now stores `{mesh}` only, and `CLIPS[*].plant.mesh` stays), `client/public/js/view3d/statues.js` (drop `buildStatues` and the part builders once unused), `client/public/js/view3d/vehicleModel.js` (drop `buildTandemFrame`, `buildBeerBike`, `buildSeatedBody` once unused), `client/public/js/view3d/biomes/winter/*` (drop `penguinWorkoutParts` once unused; the crowd's penguins stay for part 3)
- Test: `client/test/view3d.test.js`, and the tests of the dropped functions (moved to Tasks 1–4's tests, which pin the same behaviour)

**Interfaces:**
- Consumes: `frame.athletes` (Task 3), statue layer (Task 4), `frame.vehicles` (Task 5).
- Produces: `View3D` as today to its callers (`setStatues`, `setStatueGlow`, `statueTargets`, side-view inset).

- [ ] **Step 1: failing tests** (view3d, fake renderer as the existing tests)
  - `a workout rider reaches the athlete layer` — a workout rider at a gym: the world scene's last frame has one `athletes` entry with the clip's pose, `plantMesh` and the right tint; the adapter got no draw of a body or bike.
  - `a winter gym's athletes are penguins` — winter biome: the entry's `figure === "penguin"`.
  - `statue rows go to the statue layer` — `setStatues(rows)`: the layer's rows equal them (figure from the biome); `setStatueGlow(gym, 2)` reaches `setGlow`.
  - `a vehicle reaches the rider layer, with me on it once` — me on a beer bike: `frame.vehicles` has it with me in my seat; `frame.riders` does not contain me.
  - `seated riders' labels sit above their heads` — a tandem's two labels are placed from the rider layer's `seatHeads()` (not the old `[0, 0.62·scale + 0.55, 0]` offset).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; the clip fade (`#clips`, `CLIP_FADE_S`, mirror, side change) stays in `View3D` and produces the entry's `pose`.
- [ ] **Step 4:** Gate → PASS; `grep -rn "settle\|buildStatues\|buildBeerBike\|buildTandemFrame\|buildSeatedBody\|penguinWorkoutParts" client/public/js` finds only what still runs (studio uses none of them; check).
- [ ] **Step 5:** Commit `feat(client): Move gym athletes, statues and vehicles to the new world`.

### Task 7: Shots, draw calls, memory (main session)

- [ ] **Step 1:** Re-run `drawcalls.mjs` → `~/.cache/openradlr/screenshots/move2/after.txt`; compare with part 1's `move1/after.txt`; Low and Medium within +10 %.
- [ ] **Step 2:** Workbench round: `wb-tandem`, `wb-beer-bike`, `wb-statue` (marble squat), `wb-rider` posed `squats` and `penguin`.
- [ ] **Step 3:** One ride round (Simulator, High), aimed from the browser's world: `gym-athletes` (a workout ride at a gym, side-view inset visible), `statues` (a gym's row, one glowing), `statues-winter` (season winter, penguins), `tandem` and `beer-bike` (a vehicle ride, chase cam). A second round only for fixes.
- [ ] **Step 4:** Contact sheet, upload to `pr-screenshots` `polished-world/move2/`, push the branch, update the `polished-world` memory.
