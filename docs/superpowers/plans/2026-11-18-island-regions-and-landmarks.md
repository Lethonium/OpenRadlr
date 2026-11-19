# Island regions and landmarks — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warmer light everywhere, then eight Mediterranean regions with their own colours, plants and roadside, and up to seven landmarks, on the valley island.

**Architecture:** Light is a retune of `lighting.js` presets plus three small terms in the opaque shader. Regions and landmarks are hand-placed data in `routes/maps/valley.json`, parsed by `RoadNetwork`; a pure client module answers `regionAt(x, z)`; region *kinds* are style tables in the biome. World building reads them for ground colour, tree mix, canopy colour, a new near-only `cover` group and roadside props. Landmarks are built once into `village`/`villageFar` with an apron reserved in the `Occupancy`; moving parts (sails, balloons) are per-frame data like the turbine `rotors`.

**Tech Stack:** plain ES modules, WebGL2, `node --test`; Node runs in Docker (`node:22-alpine`), Rust in `rust:1`.

**Spec:** `docs/superpowers/specs/2026-11-18-island-regions-and-landmarks-design.md`

## Global Constraints

- Work in the worktree `/root/.local/share/opencode/worktree/984c27/feat/scenery-kit`, on a new branch `feat/island-regions` from `feat/scenery-kit`; one draft PR based on `feat/scenery-kit`, assign RalfLeonFasler, never merge.
- CC0 assets only; `make scenery-check` must pass. Cykelapp is a technique reference only, no geometry.
- Scenery **off**: no regions, landmarks, cover or movers; its geometry is byte-identical to today. The light retune applies to every level.
- `land.js` answers (`forestAt`, `fieldAt`, `kindAt`, `treeFactor`) do not change.
- Roads, heights, routes and the server simulation do not change.
- Regions only exist on a network map (`valley.json`); route files without a network get none.
- Budget: no region scene above the dense-wood baseline (Task 1) in visible vertices or draw calls at the same camera.
- Region edges blend over ~150 m and wander with ~300 m noise; no visible circles.
- Moving landmark parts are visual only (clock-driven, not seeded).
- Tests: plain node, one reason to fail, no sleeps; RNG from the seed. Commits: Conventional, imperative, `(#117)`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never set a git email.

Commands (from the worktree root):

```sh
T() { docker run --rm -v "$PWD":/w -w /w/client node:22-alpine node --test "$@"; }   # T test/x.test.js
docker run --rm -v "$PWD":/w -w /w/client node:22-alpine sh -c "npm run lint"
docker run --rm -v "$PWD":/w -w /w node:22-alpine node tools/scenery/check.mjs
```

Screenshots (server from `make dev` on 127.0.0.1:8080; output stays in `~/.cache/openradlr/screenshots/regions/`):

```sh
docker run --rm --network host -v $PWD/client:/app -v $HOME/.cache/openradlr:/root/.cache/openradlr -w /app \
  mcr.microsoft.com/playwright:v1.65.0-noble node sceneryShot.mjs --out /root/.cache/openradlr/screenshots/regions --at <m> --camera <chase|drone> --scenery quaternius
```

## Review Focus

1. Scenery off after every task: the world's chunks are identical to `feat/scenery-kit`'s (pinned in Task 4, re-run each task).
2. Routes off the network (velodrome, herne-hill, lanzarote-lava-180) build with no regions and no errors (pinned in Task 3).
3. Winter: blossom bare, lavender under snow, other regions fall back without throwing (pinned in Task 5).
4. Region plants, cover and props stay out of settlements, landmark aprons, rivers and the road's 3 m shoulder (pinned in Tasks 7–9).
5. Sea-side verge: within 18 m of water on that side only low cover, no props (pinned in Task 9).

---

### Task 1: Baseline and warmer light

**Files:**
- Modify: `client/public/js/view3d/lighting.js` (presets), `client/public/js/view3d/renderer.js` (opaque + sky shaders, `begin`), `client/public/js/view3d/view3d.js` (water draw passes specular)
- Test: `client/test/lighting.test.js` (create if missing), `client/test/renderer.test.js`

**Interfaces:**
- Produces: preset field `sunScatter: number` (0–1, how much the fog leans to the sun colour toward the sun), `saturation: number`; `Renderer.drawTransparent(handle, model, { alpha, specular = 0 })`.

- [ ] **Step 1: Record the baseline.** Run `client/sceneryBench.mjs --at 6490 --camera chase --scenery quaternius --frames 300` (Playwright image as above, `node sceneryBench.mjs …`) on `feat/scenery-kit`. Write visible vertices and draw calls into the plan under Task 18 as "Baseline". Take before-screenshots at golden and day: rolling-hills 6490 chase, rolling-hills 300 chase (city), cape-loop 4300 drone (coast), the pass on island-tour (pick the highest point) drone.
- [ ] **Step 2: Failing tests.**
  - `lighting.test.js`: `every preset has sunScatter in (0, 1] and saturation in [1, 1.25]`; `golden's sun is lower than day's` (`golden.sun[1] < day.sun[1]`); `golden's horizon is warmer than its zenith` (`horizon[0] - horizon[2] > zenith[0] - zenith[2]`).
  - `renderer.test.js`: after `begin({... sunScatter: 0.4, saturation: 1.1 })` the fake gl recorded `uniform1f` for `u_sunScatter` = 0.4 and `u_saturation` = 1.1; `drawTransparent(h, m, { alpha: 0.8, specular: 0.6 })` sets `u_specular` 0.6 and resets it to 0 after.
- [ ] **Step 3: Run, expect FAIL** (`T test/lighting.test.js test/renderer.test.js`).
- [ ] **Step 4: Implement.**
  - Presets (start values, tune by eye): day `zenith [0.28,0.48,0.86]`, `horizon [0.86,0.84,0.82]`, `sunColor [1,0.92,0.78]`, `sunScatter 0.25`, `saturation 1.1`; golden `sun normalize([0.8,0.13,0.3])`, `sunColor [1,0.66,0.38]`, `zenith [0.38,0.42,0.7]` (lavender), `horizon [1,0.74,0.52]`, `sunScatter 0.55`, `saturation 1.15`; dusk `sunScatter 0.45`, `saturation 1.1`. Biome `light` overrides keep working through `resolvedLight`.
  - Opaque shader: `fogTint = mix(u_fogColor, u_sunColor, u_sunScatter * pow(max(dot(normalize(v_world - u_cameraPosition), u_sunDirection), 0.0), 6.0))`; fog mixes to `fogTint`. After `toneMap`, `c = mix(vec3(dot(c, vec3(0.299,0.587,0.114))), c, u_saturation)`. Specular: `lit += u_sunColor * u_specular * pow(max(dot(reflect(-toCamera, n), u_sunDirection), 0.0), 60.0) * sunVisibility()`.
  - Sky shader: sun disk `pow(sunAmount, 600.0) * 1.6` and glow `pow(sunAmount, 8.0) * (0.12 + 0.25 * u_sunScatter)`.
  - Defaults when a caller omits them: `sunScatter 0`, `saturation 1`, so old callers render as before.
- [ ] **Step 5: Run, expect PASS**, plus `T test/view3d.test.js test/world3.test.js`.
- [ ] **Step 6: After-screenshots** of the four views; put before/after pairs in `~/.cache/openradlr/screenshots/regions/light/`.
- [ ] **Step 7: Commit** `feat: Warm the light with sunward haze, saturation and a water glint (#117)`.

### Task 2: Mediterranean ground palette — then STOP for the owner

**Files:**
- Modify: `client/public/js/view3d/biomes/temperate.js` (`COLORS`, `FIELDS`, `HIGH`, `terrainColor` meadow base, wood floor, crops)
- Test: `client/test/biomes.test.js` (or the existing temperate test file; grep `terrainColor`)

**Interfaces:** unchanged signatures.

- [ ] **Step 1: Failing test** `meadow is warmer than before`: `terrainColor({x:0,z:0,height:30,steep:0,seed:1,water:0,forest:0,field:0})` has `r/g > 0.75` (today 0.36/0.54 ≈ 0.67); `crops read gold`: with `field: 1`, `r > g * 0.85`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** meadow `[0.46,0.55,0.27]`, crops a dry gold `[0.66,0.6,0.32]`, wood floor `[0.2,0.26,0.13]`, `HIGH [0.56,0.54,0.42]`, leaves slightly olive. The scenery-off branch (`FIELDS`) gets the same warmer shift (light and palette apply to every level; geometry does not change).
- [ ] **Step 4: Run, expect PASS**; the full client suite (`T "test/**/*.test.js"`), lint.
- [ ] **Step 5: Commit** `feat: Warm the island's ground towards the Mediterranean (#117)`.
- [ ] **Step 6: Checkpoint.** Re-shoot the four views, send the before/after pairs to the owner, and wait for their go before Task 3.

### Task 3: Regions and landmarks in the map

**Files:**
- Modify: `routes/maps/valley.json` (add `regions`, `landmarks`), `client/public/js/route/network.js:74-84`
- Create: `client/public/js/land/regions.js`
- Test: `client/test/regions.test.js`, `client/test/network.test.js`

**Interfaces:**
- Produces: `network.regions: {id, kind, center:[x,z], radius}[]`, `network.landmarks: {id, kind, center:[x,z], yaw, apron, ...extra}[]` (both `[]` when absent; world z = −y like settlements).
- Produces: `regionAt(x, z, regions, seed) -> {kind: string, weight: number}[]` — every region with weight > 0, strongest first; weight 1 inside `radius − 75 + wobble`, 0 beyond `radius + 75 + wobble`, smoothstep between; `wobble = (fbm(x/300, z/300, seed + 0x5e9) − 0.5) * 0.35 * radius`.
- Produces: `REGION_KIND = {pineCoast, oliveTerraces, blossomValley, lavenderFields, farmBelt, deepWood, wetland, highCountry}`.

- [ ] **Step 1: Failing tests** (`regions.test.js`): weight 1 at a region's centre; `[]` 3 radii away; weight strictly between 0 and 1 somewhere on the radius; two points on the same radius at different angles get different weights (edge wanders); same inputs → same output; overlapping regions both returned, strongest first.
  `network.test.js`: a file with `regions`/`landmarks` maps `y` to `−z`; a file without them gives `[]`; `roadNetworkOf` for `velodrome.json` (no map) builds a world with `network === null` (Review Focus 2).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `regions.js` and the parsing. Map data (start values from the composition map; tune so each region covers what its name says):

  ```json
  "regions": [
    {"id":"south-coast-west","kind":"pineCoast","x":-1500,"y":-3300,"radius":1300},
    {"id":"south-coast-east","kind":"pineCoast","x":2600,"y":-3600,"radius":1300},
    {"id":"east-coast","kind":"pineCoast","x":4300,"y":-1500,"radius":1000},
    {"id":"north-terraces","kind":"oliveTerraces","x":-1300,"y":1300,"radius":900},
    {"id":"east-terraces","kind":"oliveTerraces","x":1900,"y":1800,"radius":800},
    {"id":"almond-valley","kind":"blossomValley","x":-200,"y":-800,"radius":850},
    {"id":"lavender-meadow","kind":"lavenderFields","x":1450,"y":-340,"radius":650},
    {"id":"west-farms","kind":"farmBelt","x":-1130,"y":-1540,"radius":700},
    {"id":"north-wood","kind":"deepWood","x":710,"y":1420,"radius":650},
    {"id":"wetland","kind":"wetland","x":990,"y":-2850,"radius":420},
    {"id":"high-country","kind":"highCountry","x":390,"y":2380,"radius":1100}
  ],
  "landmarks": []
  ```
  Landmarks are added by their own tasks.
- [ ] **Step 4: Run, expect PASS**; server: `docker run --rm -v "$PWD":/w -w /w/server rust:1 cargo test -p server` (the server loads `valley.json` in `route_file.rs` tests; it must ignore the new keys).
- [ ] **Step 5: Commit** `feat: Place the island's regions in the map (#117)`.

### Task 4: Regions reach the world; scenery off pinned

**Files:**
- Modify: `client/public/js/view3d/world.js` (`buildWorld`: `const regions = scenery && network ? network.regions : []`; a `regionsAt = (x, z) => regionAt(x, z, regions, seed)` closure passed down in later tasks)
- Test: `client/test/regionsWorld.test.js`

**Interfaces:**
- Produces: in `buildWorld`, `regionsAt(x, z) -> {kind, weight}[]` (always `[]` with scenery off); world result gains `regions: network.regions` only when scenery is on (for the 2D map later; nothing reads it yet).

- [ ] **Step 1: Failing test** `scenery off is unchanged`: build `rolling-hills` on the valley network with `scenery: null`, hash every chunk's position and colour arrays (sha1 over the typed arrays); compare to a hash recorded from `feat/scenery-kit` *after Task 2* (record it in the test file as a constant with a comment saying how to regenerate it). Second test: with a fake kit (as in `settlementWorld.test.js`), `buildWorld` returns `regions.length === 11`.
- [ ] **Step 2–4:** run (FAIL on the second), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: Hand the map's regions to the world builder (#117)`.

### Task 5: Region styles per biome

**Files:**
- Create: `client/public/js/view3d/regions/styles.js`
- Modify: `client/public/js/view3d/biomes/winter/index.js` (add `regions` overrides)
- Test: `client/test/regionStyles.test.js`

**Interfaces:**
- Produces: `regionStyle(kind, biome) -> { ground: {open?, field?, forest?: rgb}, trees: {plants: string[], density: number, canopy?: rgb}, mass: {kind: "stripes"|"patches"|null, colour: rgb, cover: number, scale: number, angle?: number}, cover: {plants: string[], perMetre: number}, props: {kinds: string[], every: number} }` — temperate defaults from `REGION_STYLES[kind]`, deep-merged with `biome.regions?.[kind]`; unknown kind → `null`.
- Plant and prop names used here are the ids Tasks 6 and 9 define: plants `umbrellaPine, olive, almond, lavender, reeds, willow, wildflower, alpineFlower, broom`; props `stoneWall, picketFence, mailbox, beehive, cart, bench, logPile, cairn, snowPole, boardwalk, hayBale`.

- [ ] **Step 1: Failing tests:** every `REGION_KIND` has a temperate style with `trees.density > 0` except `highCountry` and `lavenderFields` (open land) — density ≤ 0.2; `lavenderFields.mass.kind === "stripes"`; `blossomValley.trees.canopy` is pink (`r > g + 0.15`); winter: `blossomValley.trees.canopy` is not pink (`r − g < 0.05`), `lavenderFields.mass.colour` is near snow (all channels > 0.8), `regionStyle("pineCoast", winter)` returns the temperate trees (fallback); `regionStyle("nope", temperate) === null`.
- [ ] **Step 2–4:** FAIL, implement (values per the spec's region table; colour masses: lavender `[0.55,0.42,0.75]` stripes 9 m apart along `angle` per region; blossom `[0.96,0.78,0.84]` patches; farm belt wheat `[0.86,0.72,0.34]` stripes; wetland reed gold `[0.72,0.64,0.38]` patches; alpine flowers `[0.9,0.85,0.5]` patches sparse), PASS.
- [ ] **Step 5: Commit** `feat: Give each region kind its own look, with winter overrides (#117)`.

### Task 6: Region plants

**Files:**
- Create: `client/public/js/view3d/regions/plants.js`
- Test: `client/test/regionPlants.test.js`

**Interfaces:**
- Produces: `PLANTS: Record<name, ({mesh, x, y, z, random, colours, far = false}) => void>` for the names in Task 5. Each draws with `MeshBuilder` primitives (`box`, `cone`, `ellipsoid`, `triangle`) in the low-poly style of `temperate.plantTree`; `far: true` draws a ≤ 12-triangle silhouette at the same size. `colours` comes from the style (canopy override) or the biome's.
- Consumes: Task 5's names.

- [ ] **Step 1: Failing tests:** every plant draws > 0 triangles; near ≤ 400 triangles for trees, ≤ 60 for cover (`lavender`, `wildflower`, `alpineFlower`, `reeds`, `broom`); `far` ≤ 12; same seed → identical vertices; `umbrellaPine` is wider than tall in its crown (bounds of foliage-coloured vertices: width > 1.5 × crown height); `almond` uses the passed canopy colour.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat: Draw umbrella pines, olives, almonds, lavender and reeds (#117)`.

### Task 7: Region ground colour, tree mix and canopy

**Files:**
- Modify: `client/public/js/view3d/biomes/temperate.js` (`terrainColor` takes `region = null`: `{style, weight}` of the strongest region), `client/public/js/view3d/world.js` (`buildTerrain`, `buildScenery`, `buildCanopy` take `regionsAt = null`)
- Test: `client/test/regionsWorld.test.js`

**Interfaces:**
- Consumes: `regionsAt` (Task 4), `regionStyle` (Task 5), `PLANTS` (Task 6).
- Behaviour: ground = land colour blended toward `style.ground[landKind]` by weight, then the colour mass painted on top (`stripes`: `0.5 + 0.5 sin(2π (x cos a + z sin a) / scale)` thresholded at `1 − cover`; `patches`: `valueNoise(x/scale, z/scale)` > `1 − cover`) — only on open/field land, never on wood floor, river, beach or snow. Scenery: where a region's weight beats a uniform draw, the tree count multiplies by `trees.density` and the plant is `PLANTS[pick]` (near pass) / `PLANTS[pick]({far:true})` (far pass, same random draws so both passes agree). Canopy uses `trees.canopy` when set.

- [ ] **Step 1: Failing tests:** `terrainColor` with `region: null` equals Task 2's output exactly; inside the lavender region on open land, some cells along a line across the stripes are lavender-coloured and some are not; blossom region canopy crowns carry the pink; a tree point in `lavenderFields` is ≤ 0.2 × as likely as outside (count trees in a 200 m box at the centre vs a meadow box); no region plant within `half + 3` m of a road or inside a settlement's `0.65 × radius` (Review Focus 4).
- [ ] **Step 2–4:** FAIL, implement, PASS; Task 4's scenery-off hash still passes.
- [ ] **Step 5: Screenshots** at a point in each of: lavender meadow, almond valley, olive terraces, south coast (find route distances with `client/worldMap.mjs` or by sampling `route.positionAt`). Note the distances in the plan.
  - Shot at (route, metres; day, quaternius, chase + drone; `~/.cache/openradlr/screenshots/regions/task7/f3-*` and `f4-*`): lavender meadow `rolling-hills` 4500; almond valley `riverside-flats` 8150; olive terraces `balcony-road` 4400; south coast `cape-loop` 1000. Other runs inside regions: lavender `riverside-flats` 1200–2100, olive `island-tour` 21000–22650, coast `island-tour` 8100–10900.
  - A server started before `valley.json` gained `regions` serves the old map (no regions, no error): restart it after changing the map.
  - Tuned: colour-mass stripes were 9–22 m apart, finer than the 16 m ground grid (aliased into facets), now 40–48 m; lavender colour less blue.
- [ ] **Step 6: Commit** `feat: Colour, plant and fill the canopy by region (#117)`.

### Task 8: Near-only cover in verge bands

**Files:**
- Modify: `client/public/js/view3d/world.js` (new `buildCover(route, terrain, { regionsAt, into, water, blocked, seed })`; chunk group `cover: instancedChunk(64)` only with scenery), `client/public/js/view3d/view3d.js:72` (`drawDistance.cover = 150`; `cover` excluded from the shadow pass)
- Test: `client/test/regionsWorld.test.js`, `client/test/view3d.test.js`

**Interfaces:**
- Produces: `buildCover(...) -> { count }`. Bands (perpendicular distance from the road edge `half`): 0–3 m nothing; 3–7 m two items per 2 m of road per side from `style.cover.plants` × `perMetre`; 7–16 m one item at 60 %. Outside regions: the biome's tufts (today's `buildGroundDetail` stays as is for no-region stretches).
- Sea-side rule: if `terrain.height` 18 m out on that side is below `water + 0.5`, only `lavender`/`wildflower`/`reeds`-sized cover, never props (Task 9 reads the same helper `seaSide(route, d, side)`).

- [ ] **Step 1: Failing tests:** nothing within `half + 3` m; in the lavender region the 3–7 m band holds ≥ 0.8 items per metre per side; `cover` is not in the shadow groups and has `drawDistance` 150; scenery off has no `cover` chunk.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Bench** at the lavender meadow and the dense wood; both ≤ the Task 1 baseline. If over, lower `perMetre` before going on.
- [ ] **Step 6: Commit** `feat: Fill the verges with each region's cover, near only (#117)`.

### Task 9: Roadside props per region

**Files:**
- Create: `client/public/js/view3d/regions/props.js`
- Modify: `client/public/js/view3d/world.js` (`buildRegionProps(route, terrain, { regionsAt, into: chunks.structures, occupancy, water, blocked, seed })`)
- Test: `client/test/regionProps.test.js`

**Interfaces:**
- Produces: `PROPS: Record<name, ({mesh, x, y, z, yaw, random}) => {radius}>` for the Task 5 prop names; `stoneWall`/`picketFence` draw one 6 m panel along the road; `boardwalk` only where the road is within 12 m of water.
- Placement: every `props.every` metres along the road per side, at 7–12 m, yaw parallel to the road; added to `occupancy`.

- [ ] **Step 1: Failing tests:** each prop draws > 0 triangles and ≤ 300; in the olive terraces a 500 m stretch gets ≥ 5 `stoneWall` panels; no prop on the sea side where water is within 18 m (Review Focus 5); no prop inside a landmark apron or settlement (Review Focus 4).
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat: Line each region's roads with its own walls, fences and props (#117)`.

### Task 10: Landmark layer and the lighthouse

**Files:**
- Create: `client/public/js/view3d/landmarks.js`
- Modify: `client/public/js/view3d/world.js` (after settlements, before scenery: `buildLandmarks(network.landmarks, { terrain, near: chunks.village, far: chunks.villageFar, bright: chunks.bright, occupancy, water: ground.water })`; scenery off skips it), `routes/maps/valley.json`
- Test: `client/test/landmarks.test.js`

**Interfaces:**
- Produces: `LANDMARKS: Record<kind, { build({terrain, center, yaw, water, random}) -> {near: Mesh, far: Mesh, bright?: Mesh, at: [x,y,z], movers?: Mover[]} }>`; `buildLandmarks(list, opts) -> { movers: Mover[] }`; each landmark `occupancy.add(x, z, apron)` before any scatter.
- `Mover = { kind: "sails"|"balloon", at: [x,y,z], yaw, phase, speed, ...kindData }` — returned by `buildWorld` as `movers` (next to `rotors`).

- [x] **Step 1: Failing tests:** a lighthouse builds near and far meshes, far ≤ 60 triangles, white and red bands present; its lamp is in `bright`; no tree/cover/prop within its apron after `buildWorld`; every landmark in `valley.json` except `seaArch` stands above `water + 2` and ≥ apron from every road centre line (data test over the real map).
- [x] **Step 2–4:** FAIL, implement, PASS. Map entry: `{"id":"cape-light","kind":"lighthouse","x":4850,"y":-3900,"yaw":0,"apron":25}` — move it to the nearest high, dry point on the cape if the data test fails.
- [x] **Step 5: Commit** `feat: Build landmarks from the map, starting with the cape lighthouse (#117)`.

> Done: lighthouse moved to map `x 4500, y -2960` (world z +2960; plateau edge, apron 60, seen from cape-loop at 5080-5660 m).

### Task 11: Castle ruin on the crag

**Files:** Modify `client/public/js/view3d/landmarks.js`, `routes/maps/valley.json`; Test `client/test/landmarks.test.js`

- [x] **Step 1: Failing tests:** `castle` builds a curtain wall with ≥ 2 gaps and one tower taller than the walls; its base follows the ground (lowest wall bottom ≤ `terrain.height` at every corner); it stands on the highest ground within 600 m of the SW village (a helper `highestNear(terrain, center, 600)` picks the map coordinates; the test asserts the map entry is within 30 m of it).
- [x] **Step 2–4:** FAIL, implement procedurally in the town kit's stone colours (Kenney Castle Kit only if its own `License.txt` says CC0 and it passes `scenery-check`; procedural is the default), PASS.
- [x] **Step 5: Commit** `feat: Raise a castle ruin on the crag above the southwest village (#117)`.

> Done: castle at map `x -225, y -1935` (apron 70, ~290 m from the village, 23 m ground; the highest knoll, 27 m at -920,2020, is deep in the wood and no road sees it, so the test asks for ground within 6 m of the highest and a road sightline: cape-loop and riverside-flats see it from ~330-540 m). Procedural, stone colours only.

### Task 12: Sea arch

**Files:** Modify `client/public/js/view3d/landmarks.js`, `routes/maps/valley.json`; Test `client/test/landmarks.test.js`

- [x] **Step 1: Failing tests:** `seaArch` stands where the sea is ≥ 3 m deep; both feet reach below `water − 2`; the opening is open (no triangle crosses the middle 30 % of the span below `water + 8`); it is visible from the coast road (the nearest road sample is within 1,200 m).
- [x] **Step 2–4:** FAIL, implement (limestone colour, 5–8 rock segments along a half-ellipse, ~35 m high, ~50 m span); start at `x 1550, y −4200`; PASS.
- [x] **Step 5: Commit** `feat: Set a sea arch in the south bay (#117)`.

> Done: sea arch kept at map `x 1550, y -4200` (38 m deep; cape-loop and island-tour see it along ~580 m at ~1 km, the forest rule only counts woods on land).

### Task 13: Viaduct, where a road crosses high

**Files:** Modify `client/public/js/view3d/landmarks.js`, `client/public/js/view3d/world.js`; Test `client/test/landmarks.test.js`

**Interfaces:** `findViaductSite(roads, terrain, rivers, { minDeck = 12 }) -> {road, from, to, deck} | null` — a stretch over a river or valley where the road is ≥ `minDeck` m above the ground for ≥ 60 m. Not a map entry: found from the data. Road heights never change.

- [x] **Step 1: Failing tests:** on a synthetic road over a dip 20 m deep it returns that stretch; on flat ground it returns null; the arches' tops sit ≤ 0.4 m under the road surface and the piers reach the ground.
- [x] **Step 2–4:** FAIL, implement, PASS. On the real map: if null, log it in the plan and skip — do not move the road.
- [x] **Step 5: Commit** `feat: Carry a high road crossing on stone arches (#117)` (or record "no site" in the plan with no commit).

> Done: **no site**, no commit and no finder. Every route of the valley, probed at 10 m with the ground read 16 and 24 m to each side of the road (the higher side counts, so a road on a hillside does not pass as a crossing), has a deck at most 11 m above it, and only along ~20 m at the river bridges (cape-loop 10040, riverside-flats 4250, island-tour 12120, col-de-la-forge 12540); the hillside roads (forge-circuit 600-880 m, col-de-la-forge 5700-6000 m) are 13-17 m over the low side but cut into the slope. Nothing reaches `minDeck` 12 m for 60 m, and road heights do not move. A finder with no site on the map would be dead code, so none was committed.

### Task 14: Windmill row with turning sails

**Files:** Modify `client/public/js/view3d/landmarks.js`, `client/public/js/view3d/view3d.js` (draw `movers` of kind `sails` like `rotors`, within `SCENE.rotorDistance`), `routes/maps/valley.json`; Test `client/test/landmarks.test.js`, `client/test/view3d.test.js`

- [x] **Step 1: Failing tests:** `windmills` with `count: 5` builds 5 stone towers on a line 60–90 m apart, each with a `sails` mover at the cap; the view turns a mover's sails by `speed × t + phase` (fake clock, two frames, different matrices); movers beyond `rotorDistance` are not drawn.
- [x] **Step 2–4:** FAIL, implement; map entry in the west farm belt (`x −1130, y −1540`, `count 5`), PASS.
- [x] **Step 5: Commit** `feat: Line the farm belt with Mallorcan windmills (#117)`.

> Done: windmills moved from map `x -1130, y -1540` (in a wood, no road sees it) to `x -1170, y -2000` (open farmland; row along world x from -1320 to -1020, z +2000; riverside-flats at 5560 m and cape-loop at 11360 m pass ~100 m away, ~220 m of road sees the row over the trees). Apron 16 per mill (the landmark reserves one patch per tower, not the row's centre); `windmills` takes `count` from the map (far twin covers at most 5 mills, 55 triangles). Sails are `buildSails` in `structures.js`, drawn by `view3d.js` within `SCENE.rotorDistance`; `sceneOf` carries `movers`.

### Task 15: Cathedral in the market city

**Files:** Modify `tools/scenery/assemble.mjs` (a `cathedral` model with role `cathedral`, ~2× the church, nave + two towers, with a `-far` twin), `client/public/assets/scenery/fantasy-town/*` (regenerated), `client/public/js/view3d/settlement.js:272-280` (kind `city` prefers role `cathedral` for the church slot); Test `client/test/sceneryAssemble.test.js`, `client/test/settlementBuild.test.js`

- [x] **Step 1: Failing tests:** the assembled cathedral is ≥ 1.8× the church's height and has a far twin; in a city with a kit holding `cathedral`, the church slot uses it; `layoutSettlement` output for the city is deep-equal to before (layout untouched).
- [x] **Step 2–4:** FAIL, implement, regenerate the kit (`node tools/scenery/assemble.mjs "<pack>/Models/GLB format" client/public/assets/scenery/fantasy-town`; the pack is under `/tmp/opencode/packs` or re-download Kenney Fantasy Town Kit), `make scenery-check`, PASS.
- [x] **Step 5: Commit** `feat: Crown the market city with a cathedral (#117)`.

> Done: the Kenney pack could not be downloaded (kenney.nl answers 403), so the cathedral is drawn in `assemble.mjs` (`cathedral()`, 263 triangles, far twin 52) in the kit's stone and slate rather than from its tiles: nave, transept with a crossing spire, eight-sided apse, two west towers with spires, portal and rose window, 34 m against the church's 15 m. Add it to a kit with `node tools/scenery/assemble.mjs --cathedral-only <kit dir>` (no pack needed); no other model's file changed. The city's church slot takes it in `settlement.js`, stood back from the square by half its extra length; the layout is untouched.

### Task 16: Hot-air balloons

**Files:** Modify `client/public/js/view3d/landmarks.js`, `client/public/js/view3d/view3d.js`, `routes/maps/valley.json`; Test `client/test/landmarks.test.js`, `client/test/view3d.test.js`

- [ ] **Step 1: Failing tests:** `balloons` with `count: 4` yields 4 `balloon` movers on loops of 600–1,500 m radius at 250–450 m altitude around the entry's centre; the view moves each along its loop with the clock and draws it with fog scale 0.35 (like clouds) so it reads from far; drawn up to `light.fog[1]`.
- [ ] **Step 2–4:** FAIL, implement (envelope as a 10-segment ellipsoid in two bright colour bands, basket box, ≤ 200 triangles); map entry at the valley centre (`x 600, y −300`), PASS.
- [ ] **Step 5: Commit** `feat: Float hot-air balloons over the valley (#117)`.

### Task 17: Winter pass and the 2D map

**Files:** Modify `client/worldMap.mjs` (draw regions' colour masses and landmark symbols), `client/public/js/view3d/biomes/winter/index.js` if Task 5's overrides need visual tuning; Test `client/test/regionStyles.test.js`

- [ ] **Step 1:** Screenshots of the almond valley and lavender meadow in winter; fix anything that reads wrong (Review Focus 3) with a test first.
- [ ] **Step 2:** Regenerate the land-use map with regions and landmarks for the PR.
- [ ] **Step 3: Commit** `fix: Bare the blossom and snow the lavender in winter (#117)` / `chore: Draw regions and landmarks on the land-use map (#117)`.

### Task 18: Budget, ADR, PR

**Files:** Create `docs/adr/0030-island-regions-and-landmarks.md`; Modify `docs/architecture.md` (regions and landmarks beside the settlement layer), this plan (Baseline and results)

- [ ] **Step 1: Bench** each region view and the dense wood against the baseline; record a table here. Over budget → lower densities first, then shorten `cover` range, before anything else.
  - Baseline (Task 1): `sceneryBench.mjs --at 6490 --camera chase --scenery quaternius --frames 300` on rolling-hills (software WebGL): opaque 957 draw calls and 1,527,246 visible vertices (shadow 6 calls, 44,100 vertices); 1.88 fps (low 1.57), mean render CPU 3.1 ms; scene build 11.2 s.
  - Task 8 (cover): dense wood 6490: opaque 866 calls, 1,235,895 vertices (under baseline). Lavender meadow 4500: opaque 1,404 calls, 2,760,705 vertices; the same spot with cover disabled is 1,399 calls and 2,727,858 vertices, so the cover costs 5 calls and 33k vertices and the overage is the existing scene there — without regions the same spot is 1,682 calls and 4,829,664 vertices, so the regions make it lighter; the budget is met spot for spot.
  - Roadside tuning (after Task 9, owner's go): grass, shrub and wheat cover, a grass-and-flower strip 3 m beyond the shoulder, clumps of one to three plants, denser bands; stockier umbrella pines with a lobed crown; light dry-stone walls that follow the ground; greener pine coast; softer lavender stripes; a purple flower dome on each lavender, scattered (the owner turned down rows along the road as too straight). Dense wood 6490: 885 calls, 1,324,779 vertices (under baseline). Lavender meadow 4500: 1,421 calls, 3,219,099 vertices (Task 8 was 2,760,705; still far under the 4,829,664 without regions).
- [ ] **Step 2: ADR 0030** — context (variety, Cykelapp lessons), decision (map regions + style tables + landmarks + movers), consequences (budget numbers, scenery off unchanged, winter overrides).
- [ ] **Step 3:** `make check` equivalent: lint, full client tests, `cargo test`, scenery-check — all green.
- [ ] **Step 4:** Push `feat/island-regions`, open a **draft** PR against `feat/scenery-kit` titled `feat(client): Give the island regions, landmarks and warmer light`, screenshots via the `pr-screenshots` branch (gh contents API, 1× scale), assign RalfLeonFasler.
- [ ] **Step 5: Commit** `docs: Record the region layer and its costs (#117)`.
