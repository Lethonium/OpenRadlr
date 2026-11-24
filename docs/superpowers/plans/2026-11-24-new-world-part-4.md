# New World Part 4: Animals, Weather, Night and the Automatic Quality Pick — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The island gets weather that follows the season and the day, night lights that keep the road readable,
animals in pastures, woods, sky and sea, and a first-run quality pick per device that can choose 2D.

**Architecture:** Weather is a pure rule in `world/weather.js` (season odds, map seed, UTC day → kind; UTC time →
showers), folded into `environmentAt` so every layer gets it through `setEnvironment`. Animals are planned in
`world/plan/fauna.js`, built from `view3d/assets/creatures/` part builders and drawn by one instanced
`faunaLayer` that animates only near the camera. Night lights are one `nightLights` layer (lamp pools, nearest
point lights, rider headlight) plus the lighthouse beam in the landmark layer. The quality pick is pure
(`view3d/qualityPick.js`) and wired once in `main.js`. The adapter's weather drawing is deleted.

**Tech Stack:** plain ES modules, vendored Three.js r170, node:test, Playwright for shots.

**Spec:** `docs/superpowers/specs/2026-11-24-new-world-design.md` (sections Animals; Seasons, weather and night;
Quality levels and the automatic pick; Settings; Order of work item 4). Parts 1–3's plans hold the conventions.

**Sources:** reference `notes/polished-world/reference/js/world.js` lines 1037-1140 (herds, birds, dolphins,
butterflies), 1180-1300 (GPU-fall rain and snow, `weatherIntensities`, overcast), 1149 (head light), 582-630
(lamp pools); `assets/creatures/*.js` and `_walk.js`. Scenic palettes only.

## Global Constraints

- Layer order `world/ → view3d/assets/ → view3d/scene/ → view3d/engine/ → View3D` (`client/layering.mjs`).
- No module-level mutable state; constants frozen; JSDoc with types on every export; files about 300 lines at most.
- No layer reads a clock: time arrives as `frame.t` (scene clock) or as a `Date` / UTC seconds argument given by
  the caller. Weather is the same for every rider on the same map and UTC day.
- Night must never make the road unreadable: the rider's headlight lights the road ahead at every quality level.
- Low stays the lightest level: fewer animals, particles and lights than Medium; pinned by tests.
- Whoever creates a geometry, material or texture disposes of it (`createOwner(track)`).
- Bike head- and taillights on riders come with the riders in step 4 (riders are still adapter meshes).
- UI text only through `js/i18n/en.js` and `de.js`; GLSL lines carry `// i18n-ok`.
- Commits: Conventional Commits, imperative; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Weather differs between riders:** two clients on the same map and UTC day must get the same weather →
   Task 1 tests `weatherFor` across time zones (same UTC day, different local dates) and determinism.
2. **A dark road at night:** → Task 3 asserts the headlight is on at night at every level and points along the
   heading; shots in Task 8 check readability.
3. **Animals on the road or in the sea:** → Task 5 samples every planned animal against road, river and water.
4. **Per-frame cost of animals:** → Task 6 asserts only animals within `animals.animateReach` get new matrices.
5. **A wrong first pick strands a device:** a weak device picked as High, or a capable one sent to 2D → Task 7
   pins the thresholds and that a stored choice is never overwritten.

---

### Task 1: Weather rules and the environment

**Files:**
- Create: `client/public/js/world/weather.js`
- Modify: `world/daylight.js` (`environmentAt(preset, season, {haze, weather})`), `world/seasons.js` (odds per
  season in `SEASON_LOOK` or a sibling table)
- Test: `client/test/weather.test.js`, `client/test/daylight.test.js`

**Interfaces:**
- `WEATHER_KINDS = ["clear", "showers", "rain", "storm", "snow"]`; `WEATHER_ODDS` per season (spring
  `{clear: .45, showers: .3, rain: .17, storm: .08}`, summer `{clear: .75, showers: .2, storm: .05}`, autumn
  `{clear: .35, showers: .3, rain: .25, storm: .1}`, winter `{clear: .4, snow: .45, showers: .15}`).
- `weatherFor({season, seed, date}) -> {kind, strength}`: kind drawn from the odds by a hash of `seed` and the UTC
  day (`date.getUTCFullYear/Month/Date`), strength 0.5-1 from the same hash.
- `precipitationAt(weather, utcSeconds) -> number` 0..1: `rain`/`snow`/`storm` = strength; `showers` come and go
  (on about a third of the time, smooth ramps over ~2 min, period ~20 min, phase from the hash); `clear` 0.
- `weatherFromLocation(search, fallback) -> weather` (`?weather=clear|showers|rain|storm|snow`, strength 1) for
  previews and shots, like `?season=`.
- `Environment` gains `overcast` (0..1), `precipitation` (0..1), `wetness` (0..1), `snowing` (bool),
  `storm` (bool): overcast dims `sunIntensity` (×(1 − 0.75·overcast)), mixes sky and fog colours toward grey
  `[0.5, 0.54, 0.6]` (×0.6 at most), multiplies `fogDensity` by `1 + overcast`. No weather → today's values.

- [ ] **Step 1: Failing tests:** `"the same map and UTC day give the same weather"`, `"local dates either side of
  midnight on one UTC day agree"`, `"winter never rains, summer never snows"`, `"over 1000 days each season's
  kinds match its odds within 5 points"`, `"showers are dry about two thirds of the time"`, `"?weather=storm
  previews a storm"`, `"an overcast environment has a weaker sun and greyer sky"`, `"without weather the
  environment is unchanged"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Give each day weather from its season`.

### Task 2: Weather layer, wet roads, the adapter's weather removed

**Files:**
- Create: `view3d/scene/weatherLayer.js`, `view3d/scene/fallShader.js` (the reference's `GPU_FALL` hook)
- Modify: `view3d/quality.js` (`weather: {rain, snow}` drops: low `{1500, 1500}`, medium `{4000, 3500}`, high
  `{7000, 6000}`, ultra `{12000, 10000}`), `scene/worldScene.js` (layer; lightning flash adds to the hemisphere
  for 0.15 s), `scene/roadLayer.js` (`setEnvironment`: darker, glossier asphalt by `wetness`), `scene/sky.js`
  (`uCloudy` from `overcast`), `view3d/view3d.js` (weather from `weatherFor` / `?weather=` passed to
  `environmentAt`; `utcSeconds` into the frame), `main.js` (the view gets the map seed and today's date)
- Delete: `view3d/weather.js`, `biome.weather` entries, `threeRenderer.uploadWeather/drawWeather` and their shader
- Test: `client/test/weatherLayer.test.js`

**Interfaces:**
- `createWeatherLayer({settings, uniforms, track}) -> Layer`: rain as line streaks, snow as soft points in a
  140 m box wrapped round the camera on the GPU; `setEnvironment(env)` sets the draw range to
  `count × env.precipitation` for the active kind (rain for showers/rain/storm, snow for snow); storm: a
  lightning flash every 6-14 s (seeded, from `frame.t`), exposed as `flash` 0..1.
- Frame gains `utcSeconds` (wall-clock seconds the view passes in; the layer never reads the clock).

- [ ] **Step 1: Failing tests:** `"no drops are drawn in clear weather"`, `"rain draws its share of the level's
  drops"`, `"snow falls only when it snows"`, `"low draws fewer drops than medium"`, `"a storm flashes and
  fades"`, `"the weather layer disposes everything"`, `"wet roads are darker"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; delete the old weather path. **Step 4:** Green, `npm run preload`.
- [ ] **Step 5:** Commit `feat(client): Let it rain, storm and snow on the new scene`.

### Task 3: Night lights

**Files:**
- Create: `view3d/scene/nightLights.js`
- Modify: `view3d/quality.js` (`lampLights`: low 0, medium 4, high 8, ultra 12; `headlightShadows`: high and
  ultra), `scene/worldScene.js`, `scene/landmarkLayer.js` (lighthouse beam: two additive cones turning once per
  10 s, night only), `scene/buildingMerge.js` / `settlementLayer.js` (far twins carry window glow too, so far
  towns are lit at night), `view3d/view3d.js` (frame `heading`: the rider's unit forward on the ground)
- Test: `client/test/nightLights.test.js`

**Interfaces:**
- `createNightLights(plan, {settings, uniforms, track}) -> Layer`: lamp pools (one merged additive decal mesh of
  11 m quads under every planned street lamp, opacity 0.6 × `env.night`), the `settings.lampLights` nearest
  lamps as `PointLight`s (warm `[1, 0.78, 0.45]`, distance 22), and the headlight: a `SpotLight` 1.1 m above
  `frame.focus` aiming 25 m ahead along `frame.heading`, angle 0.5, penumbra 0.6, intensity by `env.night`
  (off by day), on at every level.

- [ ] **Step 1: Failing tests:** `"lamp pools sit under the planned lamps"`, `"the headlight is on at night at
  every level and off by day"`, `"the headlight points along the heading"`, `"only the nearest lamps get lights"`,
  `"low has no lamp lights"`, `"far towns glow at night"`, `"the lighthouse beam turns and shows only at night"`,
  `"night lights dispose everything"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Light the night with lamps, the lighthouse and a headlight`.

### Task 4: Creature assets

**Files:**
- Create: `view3d/assets/creatures/` — `creature.js` (contract), `cow.js`, `sheep.js`, `horse.js`, `pig.js`,
  `chicken.js`, `deer.js`, `rabbit.js`, `fox.js`, `bird.js`, `butterfly.js`, `dolphin.js`, `index.js`
  (`CREATURES`); `view3d/NOTICE.md`; workbench list gains `CREATURES` (`workbenchState.js`)
- Test: `client/test/creatureAssets.test.js`

**Interfaces:**
- `parts({seed, season, detail, own}) -> {body: BufferGeometry, limbs: [{geometry, pivot: [x, y, z], swing:
  "leg"|"wing"|"head"|"tail"}], speed, size}`: vertex-coloured, local space, feet at y = 0 (bird, butterfly,
  dolphin: centred), facing +z; legs swing about x at their hip pivot. `create(opts) -> {object, update(dt, t),
  dispose()}` walks in place for the workbench.
- Budgets (body + limbs): cow, horse ≤ 500; sheep, pig, deer ≤ 400; chicken, rabbit, fox ≤ 250; bird, butterfly
  ≤ 60; dolphin ≤ 300. `detail: false` ≤ half.

- [ ] **Step 1: Failing tests** per id: stands on the ground (or centred), faces +z, budget per detail,
  disposes everything, same seed same geometry; `"every creature is on the workbench"`.
- [ ] **Step 2:** FAIL. **Step 3:** Restyle the reference creatures (no `Math.random`, seeded). **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Add the island's animals as assets`.

### Task 5: Fauna plan

**Files:**
- Create: `world/plan/fauna.js`
- Modify: `world/plan/index.js` (after woods; `WorldPlan.fauna`), `view3d/worldScene.js` transfer list if typed
- Test: `client/test/faunaPlan.test.js`

**Interfaces:**
- `FAUNA_BUDGET` per detail: low `{herds: 8, wild: 20, flocks: 3, butterflies: 0, dolphins: 2}`, medium
  `{16, 50, 6, 40, 4}`, high `{30, 90, 10, 80, 6}`, ultra `{45, 140, 14, 140, 8}`.
- `planFauna({farms, fields, trees, terrain, roads, regions, seed, season, masks, water, detail}) -> Fauna`,
  `Fauna = {herds: [{kind, x, z, radius, count, seed}], wild: [{kind, x, z, yaw, seed}], flocks: [{x, z,
  altitude, radius, count, seed}], butterflies: [{x, z, seed}], dolphins: [{x, z, seed}]}`:
  herds — a farm's paddock gets cows, sheep or horses (6/9/4); open meadow and farmBelt land 30-150 m from a road
  gets sheep herds; every farm yard gets chickens (6-9) and, except in winter, pigs (3-4); wild — deer, rabbits
  and foxes on free cells within 20 m of a wood edge, deer and foxes only 40+ m from a road; flocks over land;
  butterflies on verge cells in spring and summer only; dolphins in water 80-400 m off a coast that a road
  passes within 600 m.

- [ ] **Step 1: Failing tests:** `"no animal stands on a road, in a river or in the sea"` (dolphins in the sea),
  `"butterflies stay home in winter"`, `"every paddock has a herd"`, `"each level stays in its budget and low
  plans fewer than medium"`, `"the fauna plan is deterministic"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Plan herds, wild animals, birds and dolphins`.

### Task 6: Fauna layer

**Files:**
- Create: `view3d/scene/faunaLayer.js`, `view3d/scene/faunaMotion.js` (pure poses: `grazePose(animal, t)`,
  `flockPose`, `dolphinPose`, `butterflyPose`, all functions of the plan entry and `t`)
- Modify: `view3d/quality.js` (`animals: {animateReach}`: low 60, medium 120, high 200, ultra 300),
  `scene/worldScene.js` (maker `fauna`, rebuilt on season and quality switches)
- Test: `client/test/faunaLayer.test.js`

**Interfaces:**
- `createFaunaLayer(plan, {season, settings, uniforms, track}) -> Layer`: one `InstancedMesh` per kind for the
  body and one per limb kind; herd animals wander and graze inside their herd radius, wild animals graze and
  flee 30 m from the camera, birds circle, dolphins surface and jump, butterflies flutter near their spot.
  Matrices are updated only for animals within `settings.animals.animateReach` of the camera; the rest keep
  their last pose. Animals are hidden at night except dolphins, birds hidden in rain and storm (`setEnvironment`).

- [ ] **Step 1: Failing tests:** `"a grazing cow stays inside its herd radius"`, `"poses are pure functions of
  time"`, `"only nearby animals are re-posed"` (count of matrix writes), `"butterflies and birds rest at night"`,
  `"the fauna layer disposes everything after a season and quality switch"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Bring the animals to life near the camera`.

### Task 7: Automatic quality pick

**Files:**
- Create: `view3d/qualityPick.js`
- Modify: `main.js` (first run only), `js/i18n/en.js`, `de.js` (a one-line notice when 2D was picked:
  en "Your device works best with the 2D view. You can switch to 3D in the menu.")
- Test: `client/test/qualityPick.test.js`

**Interfaces:**
- `chooseQuality({webgl2, deviceMemory, saveData, coarsePointer}) -> "2d"|"low"|"medium"|"high"`: no WebGL 2 →
  `"2d"`; `saveData` or `deviceMemory ≤ 2` → `"low"`; `coarsePointer` or `deviceMemory ≤ 4` → `"medium"`; else
  `"high"`. Ultra is never picked automatically. Missing `deviceMemory` counts as 8.
- `adjustQuality(level, frameMs: number[]) -> level|"2d"`: median of the samples; above 40 ms one level down; at
  `"low"` and above 70 ms → `"2d"`; otherwise unchanged. Called once with 90 frames after the first 3D ride's
  world is shown, only when the level was picked automatically (`openride.qualityAuto = "1"`, cleared after).
- `main.js`: with no stored `openride.quality`, store the pick (and `openride.view = "2d"` plus the notice for
  `"2d"`); a stored level or view is never overwritten, and a manual change clears `openride.qualityAuto`.

- [ ] **Step 1: Failing tests:** one per threshold above, `"ultra is never picked"`, `"a slow first ride steps
  down one level"`, `"a fast ride keeps the level"`, `"a stored choice is never overwritten"` (the `main.js`
  decision as a pure `firstRunQuality(stored, signals)` in `qualityPick.js`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green, `npm run preload`.
- [ ] **Step 5:** Commit `feat(client): Pick a graphics level for each device on first run`.

### Task 8: Shots (main session)

- [ ] Shot list `~/.cache/openradlr/scripts/part4.json` with `?weather=`: city at night (lamps, headlight on the
  road), cape loop at night (beam), farm by day (herds, chickens), wood edge (deer), coast (dolphins), rain and
  storm in autumn, snow in winter; workbench shots of cow, sheep, horse, dolphin. At most two fix rounds by
  subagents, then the owner reviews.
- [ ] Merge `origin/main`, full gate (client and Rust), push, publish shots to `polished-world/part4/`.
