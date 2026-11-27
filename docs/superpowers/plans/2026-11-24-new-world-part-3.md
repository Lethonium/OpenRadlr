# New World Part 3: Villages, Farms and Landmarks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The new Three.js scene draws the island's towns, farms, wind turbines, landmarks, far islands and the
roadside props owed from part 2; the adapter's houses, pavements, barns, turbines and far islands are deleted.

**Architecture:** Placement stays pure in `world/plan/`: #127's settlement layout (split into small files), farms,
turbines, landmarks and far islands, each a seeded function returning plain data, run inside `planWorld` in a fixed
order that stamps a new `built` mask so woods, fields and verges keep off them. Town streets and pavements become
road strips (new `pavement` kind), drawn by the existing road layer. `view3d/assets/buildings/` and `props/` hold
the reference's buildings and our own props as part builders; three scene layers (`settlementLayer`,
`farmLayer`, `landmarkLayer`) merge them per town or farm with a near mesh and a cheap far twin.

**Tech Stack:** plain ES modules, vendored Three.js r170, node:test, Playwright for shots.

**Spec:** `docs/superpowers/specs/2026-11-24-new-world-design.md` (sections Architecture, Villages, farms and
landmarks, Quality levels, Workbench, Order of work item 3). Parts 1 and 2's plans
(`docs/superpowers/plans/2026-11-24-new-world-part-{1,2}.md`) hold the conventions this plan reuses.

**Sources:** #127 on local branch `pr127`: `client/public/js/land/settlement.js` (layout),
`client/public/js/view3d/landmarks.js` and `view3d/settlement.js` (models, cathedral, quay, boats), tests
`client/test/settlement{Layout,Roads,World,Build}.test.js` and `landmarks.test.js`
(read with `git show pr127:<path>`). Reference (git-ignored): `notes/polished-world/reference/assets/buildings/`
(house, farmstead, street-lamp, windmill, windpump, wind-turbine, lighthouse, castle) and `props/` (balloon, boat,
road-furniture), `js/world.js` lines 940-1030 (towns) and 1600-1700 (farms). Use only their scenic palettes, never
`comic`.

## Global Constraints

- Layer order `world/ → view3d/assets/ → view3d/scene/ → view3d/engine/ → View3D` (`client/layering.mjs`).
- No module-level mutable state; constants frozen; JSDoc with types on every export; files about 300 lines at most
  (#127's 704-line `settlement.js` is split, Task 2).
- Placement is a pure, seeded function of map, roads, seed and detail; same input → same output. Season changes
  models and colours, never positions.
- Nothing stands on a road, junction pad, river, bridge or in the sea; no tree, field or verge item inside a plot,
  street, square, farm yard or landmark apron.
- Whoever creates a geometry, material or texture disposes of it (`createOwner(track)`); no DOM canvas textures.
- Reference and #127 code is restyled, not pasted; each taken reference file gets a line in `view3d/NOTICE.md`.
- Route files without a network (no map settlements or landmarks) still get villages from their route zones,
  farms and turbines.
- UI text only through `js/i18n/en.js` and `de.js`; GLSL lines carry `// i18n-ok`.
- Commits: Conventional Commits, imperative; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Houses on the road or in the sea:** a house on a crossing road, a farm on a river, a boat on land →
   Task 2 and Task 4 tests sample every plot, yard and prop against road distance, river distance and sea level.
2. **A town grown over by trees or fields:** woods or crops inside a village → Task 3 asserts no tree, field or
   roadside item lies in a `built` cell or within a landmark apron.
3. **The city's weight:** #127 measured its city at 4.63M vertices → Task 8 pins per-level triangle budgets for
   near and far settlement meshes on the valley map, and Low below Medium.
4. **Season or quality switch:** rebuilding settlement, farm and landmark layers must not leak → Task 8 and Task 9
   disposal tests build, switch season, switch quality, dispose and count every resource.
5. **Landmarks out of sight:** a landmark nobody can see from a road is wasted → Task 3 ports #127's sight tests
   (lighthouse, castle, sea arch, windmills each seen from some road sample).

## Known, accepted for this part

- Bike café, outdoor gym, studio, spectators, arches, banners, km markers and warning signs stay adapter meshes
  (step 4). Village signs stay with `buildRoadside` and read the same zone villages.
- Window and lamp glow follow `env.night` as plain emissive meshes; lamp pools, point lights and the lighthouse
  beam's light on the ground come in part 4.
- Part 2 crop follow-ups (black bar at field edges, Low stalk rows, wind-animated Ultra fields) are not in this part.

## Commands

From the repo root: `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm run lint && node --test 'test/**/*.test.js'"`;
`npm run preload` in the same container after adding or removing modules reachable from `main.js`.
Baseline before Task 1: lint OK, 2249 pass, 0 fail.

---

### Task 1: Map data, neutral homes and the `built` mask

**Files:**
- Modify: `routes/maps/valley.json` (add `settlements` and `landmarks` exactly as in `pr127`'s file),
  `client/public/js/route/network.js`, `world/plan/masks.js`
- Move: `view3d/zones.js` → `world/zones.js` (importers: `view3d/world.js`, `view/rideMapDecor.js`);
  `view3d/assets/nature/geom.js` → `view3d/assets/geom.js` (all nature importers)
- Test: `client/test/network.test.js` (or the file testing `RoadNetwork`), `client/test/plan.test.js`

**Interfaces:**
- Produces: `network.settlements: {id, kind, center: [x, z], radius, seed}[]` and
  `network.landmarks: {id, kind, center: [x, z], yaw, apron, count}[]` (file `y` north → `z = -y`, like regions;
  missing lists → `[]`); `MASK.built = 5`; `stampBuilt(masks, {x, z, width, depth, yaw}) -> void` (rectangle,
  overwrites free, verge and field cells, never road or river); `stampDisc(masks, x, z, r, value) -> void`
  (the existing private `stamp`, exported).

- [ ] **Step 1: Write failing tests:** `"the valley lists three settlements and five landmarks"` (ids `hilltop`,
  `southwest`, `harbour`; `cape-light`, `sw-ruin`, `south-arch`, `farm-mills`, `valley-balloons`; `hilltop.center`
  equals `[2400, -950]`); `"a map without settlements has none"`; `"a built rectangle takes free and field cells but
  not road cells"`.
- [ ] **Step 2:** Run them, expect FAIL. **Step 3:** Implement and move the files (update every import; `git mv`).
- [ ] **Step 4:** Full suite + lint green. **Step 5:** Commit `feat(client): Put settlements and landmarks on the valley map`.

### Task 2: Settlement layout in `world/plan/settlements/`

**Files:**
- Create: `world/plan/settlements/styles.js` (`SETTLEMENT_KIND`, `SETTLEMENT_STYLE` from #127 verbatim),
  `streets.js` (main street, rows, cross streets, junctions, blocks, square, harbour lane and quay),
  `plots.js` (footprints, `placeAlong`, frontage slicing), `index.js` (`layoutSettlement`, lamps, props, boats),
  `world/plan/settlements/plan.js` (`planSettlements`)
- Modify: `world/regionKinds.js` (add `houses` to `RegionStyle`)
- Test: `client/test/settlementLayout.test.js` (port #127's `settlementLayout` and `settlementRoads` tests to the
  new paths and the `tinyWorld` / valley fixtures), `client/test/settlementPlan.test.js`

**Interfaces:**
- Consumes: `network.settlements`, `resolveZones(route).villages` (`world/zones.js`), `regionAt` / `regionMix`,
  `stampBuilt`, `RoadIndex`.
- Produces: `layoutSettlement({id, kind, center, radius, seed, terrain, roads}) -> Layout` with #127's fields
  (`streets[{id, points, width, existing, houses}]`, `junctions`, `blocks`, `plots[{x, z, yaw, width, depth,
  front, street, side}]`, `square`, `lamps[{x, z, yaw}]`, `props[{role, x, z, yaw, radius}]`, `quay`, `boats`);
  `planSettlements({settlements, routes, terrain, roads, regions, seed, masks, water}) -> Settlement[]` where
  `Settlement = Layout & {houses: string, ground: Float32Array}` (`ground`: per plot, the lowest ground under its
  footprint, so a house is founded, never floating).
- `REGION_STYLE[kind].houses`: meadow and farmBelt `"cottage"`, deepWood and wetland `"timber"`, highCountry and
  lavenderFields `"stone"`, pineCoast, oliveTerraces and almondValley `"whitewashed"`; outside regions `"cottage"`.
- A route zone village becomes `{id: "<routeId>:village:<n>", kind: "village", center: midpoint of its stretch,
  radius: half its length + 50}` unless its centre lies within a map settlement's radius.

- [ ] **Step 1: Port #127's layout tests** (8 + 2) and add `"every settlement's plots, streets and square are
  stamped built"`, `"no plot lies within a road's half width plus pavement, in a river, or below water + 2"`,
  `"a route-file village becomes a settlement on its stretch"`, `"a zone village inside a map town is dropped"`,
  `"a town takes its region's house style"` (a settlement centred in `olives` of `tinyWorld` → `"whitewashed"`).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Port and split the layout (keep #127's draw order of random
  numbers: streets, blocks, plots frontage by frontage); write `planSettlements`.
- [ ] **Step 4:** Green. **Step 5:** Commit `feat(client): Lay out towns and villages as pure data`.

### Task 3: Landmarks and the plan's order

**Files:**
- Create: `world/plan/landmarks.js`, `world/sight.js`
- Modify: `world/plan/index.js`, `world/plan/woods.js`, `fields.js`, `roadside.js` (skip `built` cells),
  `client/test/support/planFixture.js` (a `valleyWorld()` fixture, cached, built from `routes/maps/valley.json`)
- Test: `client/test/landmarks.test.js`, `client/test/plan.test.js`

**Interfaces:**
- Produces: `planLandmarks({landmarks, terrain, roads, seed, masks, water}) -> Landmark[]`,
  `Landmark = {id, kind, x, z, y, yaw, apron, members: {x, z, y, yaw}[]}` (`members`: windmills
  `MILL_SPACING = 75` apart in a row along `yaw`, balloons `{loop radius 600-1500, height 250-450, phase}` as
  #127; single landmarks one member; `y` the lowest ground under the footprint, sea arch at `water`). Unknown kinds
  are skipped. Each apron is stamped `built`.
- `seenFromRoad(point: [x, y, z], {roads, terrain, step = 40, eye = 1.6, reach = 2500}) -> boolean`: true when
  some road sample within `reach` has an unblocked line to `point` (terrain sampled every 10 m along the line).
- `planWorld` order: masks → settlements → landmarks → fields → farms and turbines (Task 4) → woods → roadside;
  `WorldPlan` gains `settlements`, `landmarks` (and Task 4's `farms`, `turbines`, `islands`).

- [ ] **Step 1: Failing tests:** port #127's placement and sight tests (`"the lighthouse stands near the sea, on dry
  ground"`, `"a stretch of cape-loop sees the lighthouse"`, `"the castle crowns the crag above the southwest
  village"`, `"the sea arch stands in deep water within sight of a road"`, `"the farm belt has a row of five
  windmills on dry ground clear of the roads"`, `"an unknown landmark kind is skipped"`); add
  `"no tree, field or roadside item lies in a built cell"` on `valleyWorld()` and `"the plan is deterministic"`
  extended to the new keys.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; order `planWorld` as above. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Place the island's landmarks where a road sees them`.

### Task 4: Farms, wind turbines and far islands

**Files:**
- Create: `world/plan/farms.js`, `world/plan/turbines.js`, `world/plan/islands.js`
- Modify: `world/plan/index.js`
- Test: `client/test/farmPlan.test.js`

**Interfaces:**
- Produces: `planFarms({fields, terrain, roads, regions, seed, masks, water, settlements}) -> Farm[]`,
  `Farm = {x, z, y, yaw, houses, silos: 1|2, paddock: {x, z, width, depth, yaw} | null, drive: Float32Array
  (x, z pairs, yard gate to road edge), pump: {x, z} | null}`; one farm per field cluster whose nearest road
  is 60-150 m from the yard (reference rule), yards 540 m apart, clear of settlements by `radius + 220`, yard
  ground range under 8 m; yard (radius 42) stamped `built`. Count per network road: `max(1, round(length/1000))`
  as today.
- `planTurbines({terrain, roads, seed, masks, water, bounds}) -> {x, z, y, yaw, phase, speed}[]`: the placement
  of today's `buildWindTurbines` (`view3d/features.js`) moved unchanged (count 6), stamped `built` (radius 8).
- `planFarIslands({terrain, seed}) -> {x, z, radius, height}[]`: today's `buildFarIslands` placement (count 11,
  distance 1300) as data.
- `FARM` and `TURBINE` tables frozen at the top of their files.

- [ ] **Step 1: Failing tests:** `"every farm's drive reaches a road"` (last drive point within
  `roadHalfWidth + VERGE + 1` of a road), `"a farm stands next to a field"` (some field centre within 260 m),
  `"no farm yard, paddock or turbine is on a road, a river or below water + 2"`, `"farms keep clear of towns"`,
  `"turbines are where today's are"` (same positions as `buildWindTurbines` on `tinyLoopFile`, captured before
  deleting it), `"far islands stand well off the coast"` (moved from `view3d.test.js`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Plan farms next to their fields, turbines and far islands`.

### Task 5: Town streets as road strips

**Files:**
- Create: `world/plan/streetStrips.js`
- Modify: `world/plan/roadStrips.js` (`ROAD_KIND.pavement = 6`), `view3d/assets/road.js` (`kindColors`:
  pavement colour per style), `view3d/roadStyle.js` (a `pavement` colour, warm grey `[0.62, 0.6, 0.56]`),
  `view3d/world.js` (merge street strips into `roads.strips`)
- Test: `client/test/roadLayer.test.js`

**Interfaces:**
- Produces: `streetStrips(settlements, terrain, {step = 2, lift = 0.06}) -> Strips` (same format as `roadStrips`):
  every non-`existing` street as asphalt of its width, pavements both sides (`pavement` kind, `style.pavement`
  wide) on every street, the main street included; the square as one paved quad grid; farm drives as 3.6 m
  gravel (`verge` kind). Heights: `terrain.height + lift`, sampled every `step` metres.

- [ ] **Step 1: Failing tests:** `"a town street sits on the ground, a few centimetres up"`,
  `"the main street gets pavements but no second asphalt"`, `"the pavement kind has its own colour"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Pave the towns' streets, squares and pavements`.

### Task 6: Building assets

**Files:**
- Create: `view3d/assets/buildings/house.js` (reference `house.js`; styles `cottage` ← spring, `whitewashed` ←
  summer, `timber` ← autumn, `stone` new: sandstone walls `#cdb48a`-ish, terracotta roofs), `farmstead.js`,
  `streetLamp.js`, `cathedral.js` (from #127's city cathedral), `index.js` (`BUILDINGS`)
- Modify: `view3d/NOTICE.md`
- Test: `client/test/buildingAssets.test.js`

**Interfaces:**
- Every building module: `meta {id, name, category: "Buildings", description, options}` and
  `parts({style, season, detail, seed, own}) -> {near: Part[], far: Part[], glows: BufferGeometry[], width, depth}`
  where `Part = {geometry, color?}` vertex-coloured, local space, ground at y = 0, front door facing +z;
  `create(opts) -> {object, dispose()}` for the workbench. Winter: snow caps on roofs. `detail: false` drops
  window frames, chimneys and sills.
- Budgets: house near ≤ 600 triangles (≤ 300 at `detail: false`), far ≤ 24; farmstead near ≤ 3000, far ≤ 80;
  street lamp ≤ 120; cathedral near ≤ 4000, far ≤ 120.

- [ ] **Step 1: Failing tests** per asset: `"<id> stands on the ground"` (min y within ±0.05 of 0, foundations
  may go to −0.6), `"<id> faces +z"` (door centroid z > 0), `"<id> stays within its triangle budget per detail"`,
  `"<id> disposes everything it made"` (tracker count), `"a winter house has snow on its roof"`.
- [ ] **Step 2:** FAIL. **Step 3:** Restyle the reference files onto `assets/geom.js`. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Add houses, farmsteads, lamps and the cathedral as assets`.

### Task 7: Landmark assets and props

**Files:**
- Create in `view3d/assets/buildings/`: `lighthouse.js`, `castle.js`, `seaArch.js` (#127's swept rock),
  `windmill.js` (#127's Mallorcan sandstone tower, reference sails), `windTurbine.js`, `windpump.js`;
  in `view3d/assets/props/`: `balloon.js`, `boat.js`, `picketFence.js`, `stoneWall.js`, `logPile.js`,
  `boardwalk.js`, `cairn.js`, `snowPole.js`, `cart.js`, `bench.js`, `mailbox.js`, `beehive.js`, `index.js` (`PROPS`)
- Modify: `view3d/scene/roadsideLayer.js` (assets `{...NATURE, ...PROPS}`, header comment), `view3d/NOTICE.md`
- Test: `client/test/buildingAssets.test.js`, `client/test/natureAssets.test.js` (props)

**Interfaces:**
- Landmarks follow Task 6's contract plus `movers`: `{sails | rotor | lamp | envelope: Object3D-independent
  pivot {x, y, z, axis}}` so the layer can turn them. Budgets: lighthouse near ≤ 2500, castle ≤ 5000, sea arch
  ≤ 4000, windmill ≤ 1200 (far ≤ 60, #127), turbine ≤ 900, balloon ≤ 200 (#127).
- Props follow the plant contract (`defineAsset`, `parts({season, detail, uniforms, own}) -> {near, far}`), so
  the roadside layer instances them like clumps; each ≤ 400 triangles, `far: []`.

- [ ] **Step 1: Failing tests:** the four contract tests of Task 6 for every new id; `"the roadside layer draws
  every prop id the region tables name"` (each id in `REGION_STYLE[*].props.kinds` is in `{...NATURE, ...PROPS}`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Add landmark buildings and the verge's props`.

### Task 8: Settlement and farm layers

**Files:**
- Create: `view3d/scene/settlementLayer.js`, `view3d/scene/farmLayer.js`, `view3d/scene/buildingMerge.js`
  (place parts by `{x, y, z, yaw}`, merge per group, near/far twin with distance switch)
- Modify: `view3d/quality.js` (`buildings: {near, far}` per level: low `{near: 250, far: 1500}`,
  medium `{400, 2500}`, high `{600, 4000}`, ultra `{900, 6000}`), `view3d/scene/worldScene.js` (makers
  `settlements`, `farms`; rebuilt on season and quality change)
- Test: `client/test/plantLayers.test.js` (or a new `buildingLayers.test.js`)

**Interfaces:**
- `createSettlementLayer(plan, {season, settings, uniforms, track}) -> Layer`: per settlement one near mesh
  (houses, lamps, cathedral for `city`, boats and quay for `harbour`) and one far mesh, shown by camera distance
  to the settlement centre (`near` within `settings.buildings.near`, far up to `.far`, nothing beyond); glows in
  one `MeshBasicMaterial` mesh whose colour is `env.night` × warm window colour (`setEnvironment`); shadows cast
  only by near meshes.
- `createFarmLayer(plan, {...}) -> Layer`: farmsteads, paddock fences (reference `fenceParts`, gate toward the
  yard), windpumps and turbines; turbine rotors turn by `frame.t × speed + phase` within `buildings.near`, stand
  still beyond.
- Layer shape as part 2: `{object, update(frame), setEnvironment(env), dispose()}`; materials shared through the
  layer's owner with `grain` and `heightFog` hooks like the plants.

- [ ] **Step 1: Failing tests:** `"a settlement shows its near mesh close and its far twin far away"`,
  `"far buildings stay within the level's budget on the valley"` (sum of far triangles: low ≤ 60k, ultra ≤ 200k;
  near triangles of the city: low ≤ 400k, and low < medium), `"windows glow only at night"`,
  `"turbine rotors stop beyond reach"`, `"settlement and farm layers dispose everything after a season and a
  quality switch"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit `feat(client): Draw towns and farms in the new scene`.

### Task 9: Landmark and far-island layers, old drawing deleted

**Files:**
- Create: `view3d/scene/landmarkLayer.js`, `view3d/scene/islandLayer.js`
- Modify: `view3d/scene/worldScene.js`, `view3d/world.js` (drop `buildVillage`, `buildFarms`,
  `buildWindTurbines`, `buildFarIslands`, `rotors`, `meshes.islands`), `view3d/view3d.js` (drop rotor and
  island drawing), `view3d/worldScene.js` (scene object keys), `view3d/features.js`, `view3d/structures.js`,
  `view3d/biomes/*` (delete what nothing imports any more), `workbench.js` / `workbenchState.js` (asset list
  `{...NATURE, ...BUILDINGS, ...PROPS}`), `~/.cache/openradlr/scripts/part3.json` (shot list, not in the repo)
- Test: `client/test/view3d.test.js`, `client/test/world3.test.js` (village/farm/turbine assertions move to the
  plan tests or go), `client/test/worldScene.test.js`

**Interfaces:**
- `createLandmarkLayer(plan, {...}) -> Layer`: one object per landmark (near/far by `settings.buildings`),
  windmill sails turning, balloons on their clock-driven loops (`frame.t`, #127's formula), the lighthouse lamp
  glowing by `env.night`.
- `createIslandLayer(plan, {...}) -> Layer`: far islands as low rock-and-green domes (`assets/nature/rock.js`
  geometry scaled), always drawn, fogged.

- [ ] **Step 1: Failing tests:** `"balloons move with the clock and repeat"`, `"the scene has towns, farms,
  landmarks and islands on the valley"`, `"the world no longer carries rotors or island meshes"`,
  `"landmark and island layers dispose everything"`; the layering test stays green.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; delete the old code function by function as nothing imports it;
  `npm run preload`. **Step 4:** Full suite + lint green.
- [ ] **Step 5:** Commit `feat(client): Raise the landmarks in the new scene and retire the old towns`.

### Task 10: Shots (main session)

- [ ] Shot list `part3.json`: ride shots through `southwest` (village + castle), `hilltop` (city), `harbour`,
  the farm belt with the windmills, a farm on `west-farms`, cape loop with the lighthouse; one night and one
  winter shot of the city; workbench shots of house (each style), farmstead, lighthouse, windmill. Compare with
  the reference's town and farm shots in summer. At most two fix rounds by subagents, then the owner reviews.
- [ ] Merge `origin/main`, full gate, push.
