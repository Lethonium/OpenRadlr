# IRONMAN Lanzarote Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ~180 km IRONMAN Lanzarote bike course as a rideable route, built by a reusable GPX → route converter, placed at its own GPS offset, with a client that builds a world this long in reasonable time.

**Architecture:** A pure, browser-safe converter module (`client/public/js/route/gpxImport.js`) turns GPX text into a route file; a CLI wraps it now and a future upload (#16 steps 2–3) can reuse it in the browser. A one-off tool routes hand-picked waypoints over OpenStreetMap (OSRM) and samples Copernicus GLO-30 elevation into a committed GPX. Routes get an optional `geo` origin for exports. The 3D build is measured with a bench script and then made to scale.

**Tech Stack:** Node 22 ES modules (no new dependencies; `node:zlib` for DEM tiles), `node --test`, ESLint 9, Rust (serde) server, Docker for all tooling.

**Spec:** `docs/superpowers/specs/2026-10-18-ironman-lanzarote-design.md`

## Global Constraints

- No new npm or cargo dependencies; tools use Node built-ins only (like `tools/valley-map.mjs`).
- Never change `WORLD_ORIGIN` (39.0° N, 2.6° E); routes without `geo` export exactly as before.
- Lanzarote `geo`: `{ "lat": 38.0, "lon": 2.6 }`.
- Targets: length 180 km ± 1 % (178.2–181.8 km); climbing 2,375–2,625 m (2,500 m ± 5 %). Hit them by smoothing and waypoints only, never by scaling the profile.
- Grades ≤ 12 % over 50 m windows (`GRADE_WINDOW_M`).
- Scene build for Lanzarote: < 10 s and < 500 MB; valley routes unchanged.
- Attribution strings, verbatim: "Road geometry © OpenStreetMap contributors, ODbL" and "Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA".
- Run Node via Docker from the repo root: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'npm ci >/dev/null && node --test "test/**/*.test.js" && npx eslint .'`. Rust via `rust:1` with the repo at `/w`, work in `/w/server` (`cargo test`, `cargo fmt --check`, `cargo clippy -- -D warnings`).
- Commit messages: `Area: what (#42)`, ending with the `Co-Authored-By` line. One PR, commits in task order.

## Review Focus

1. GPX from other apps: `<trkpt>` with attributes in either order, namespaces (`gpx:trkpt`), several `<trkseg>`, missing `<ele>` → parse all segments in order; points without `<ele>` get elevation interpolated from neighbours (all missing → error "the GPX has no elevation"). Test in Task 1.
2. Duplicate consecutive points (GPS standing still) → zero-length segments must not produce NaN grades. Test in Task 1.
3. A route file with a malformed `geo` (string, missing lon, out of range) → ignored, falls back to `WORLD_ORIGIN`, never throws. Tests in Task 3 (client) and Task 3 (server rejects nothing, just passes through valid objects).
4. The finish over 180 km: the server's lap/finish logic and the client's distance wrap at a length 14× the longest current route. Test in Task 5.
5. Valley world built after the scaling changes looks the same (no hole in the terrain, no missing horizon). Test in Task 6.

---

### Task 1: Converter core (`gpxImport.js`)

**Files:**
- Create: `client/public/js/route/gpxImport.js`
- Test: `client/test/gpxImport.test.js`

**Interfaces:**
- Produces:
  - `parseGpx(text: string) -> Array<{lat:number, lon:number, ele:number}>`
  - `projectTrack(points, origin = points[0]) -> Array<{x, y, elevation}>` (equirectangular on the 6371008.8 m sphere, inverse of `toLatLon`)
  - `resample(nodes, spacing = 10) -> nodes` (even horizontal spacing; keeps first and last)
  - `smoothElevation(nodes, sigma = 60) -> nodes` (Gaussian over distance, metres)
  - `clampGrades(nodes, { max = 0.12, window = GRADE_WINDOW_M }) -> nodes`
  - `detectClimbs(nodes, { minGrade = 0.03, minLength = 1000, minGain = 40, mergeGap = 300 }) -> Array<{distance, length, gain}>`
  - `simplify(nodes, { horizontal = 0.5, vertical = 0.3 }) -> nodes` (Douglas–Peucker in 3D with separate tolerances)
  - `gpxToRoute(text, { id, name, description?, seed = 1, lanes = 4, geo?, markers? = [], sigma?, targetLength?, targetClimb? }) -> { route, report }` where `report = { length, climb, steepest: {grade, distance}, climbs, lengthOff?, climbOff? }` (`*Off` as signed fractions). `markers` are `{type, name?, distance? , lat?, lon?, length?}`; lat/lon ones snap to the nearest route distance. Named climbs: a detected climb whose span contains a given `climb` marker's distance takes that marker's name; unmatched detected climbs are kept unnamed.
- Errors (`Error` messages, tested): `"the GPX has no track points"`, `"the GPX has no elevation"`, `"the track does not end within 200 m of its start"`.

- [ ] **Step 1: Write the failing tests** in `client/test/gpxImport.test.js`:
  - `parses trkpt in any attribute order, namespaced, over several segments` — three segments, one `gpx:`-prefixed, `lon` before `lat` in one → 6 points in order.
  - `interpolates missing elevation and rejects a track without any`.
  - `projection round-trips through toLatLon` — project a track, the distance between projected nodes matches the haversine distance between their lat/lon (helper as in `geo.test.js`) within 0.01 % at 20 km, and the first node is (0, 0).
  - `resampling keeps the length within 0.1 % and spacing at 10 m ± 0.01`.
  - `duplicate points do not create NaN` — track with repeated points → every node finite after the whole pipeline.
  - `clamps a 20 % ramp to 12 % over 50 m windows without changing total rise by more than 1 %` on a synthetic 200 m wall inside a 3 km profile.
  - `finds one climb of ~2 km on a synthetic 5 % ramp and merges across a 200 m dip`.
  - `rejects an open track` → throws the loop error; a closed one passes.
  - `gpxToRoute names climbs from markers and reports deviation` — synthetic loop with one ramp, `markers: [{type:"climb", name:"Femés", distance: <inside ramp>}]` → `route.markers` has `start_finish` at 0 and a climb named `Femés`; `report.lengthOff` equals `(report.length - targetLength) / targetLength`.

- [ ] **Step 2: Run tests, expect FAIL** (`Cannot find module .../gpxImport.js`). Command: Global Constraints Node line, filtered: `node --test test/gpxImport.test.js`.

- [ ] **Step 3: Implement** the functions above. Parse with regexes over `<(?:\w+:)?trkpt\b[^>]*>` and attribute regexes (no DOMParser, so it runs in Node and the browser). The route file's `points` are `[x, y, elevation]` rounded to 0.1 m; `loop: true`; `geo` included only when given. Climb detection: walk 50 m-window grades, open a run where grade ≥ `minGrade`, close it where the grade stays below for more than `mergeGap`, keep runs meeting `minLength` and `minGain`.

- [ ] **Step 4: Run tests and lint, expect PASS.**

- [ ] **Step 5: Commit** `Route: GPX to route converter core (#42, #16)`.

### Task 2: Converter CLI

**Files:**
- Create: `tools/gpx-route.mjs`

**Interfaces:**
- Consumes: `gpxToRoute` (Task 1).
- Produces: `node tools/gpx-route.mjs <in.gpx> --id <id> --name <name> [--description <text>] [--geo lat,lon] [--seed n] [--markers file.json] [--target-length m] [--target-climb m] [--out file]`. Writes JSON (2-space indent, points one per line like existing route files) to `--out` or stdout; prints the report to stderr: length km, climbing m, steepest grade and where, each climb (name, km, length, gain, avg grade), and deviations in %. Exit 1 with the error message on any thrown error.

- [ ] **Step 1: Smoke-test by hand** — build a tiny loop GPX in the scratchpad, run the CLI in Docker, check the JSON loads with `new RouteGeometry(...)` (one-liner `node -e`) and the report prints.
- [ ] **Step 2: Commit** `Tools: gpx-route CLI (#42, #16)`.

### Task 3: `geo` origin per route

**Files:**
- Modify: `client/public/js/route/geo.js` (`toLatLon`), `client/public/js/route/geometry.js` (constructor), `client/public/js/main.js:2754`
- Modify: `server/crates/server/src/route_file.rs` (struct + tests)
- Test: `client/test/geo.test.js`, `client/test/route.test.js`

**Interfaces:**
- Produces: `toLatLon(x, y, origin = WORLD_ORIGIN)`; `RouteGeometry#geo: {lat, lon}` — the file's `geo` when `lat` ∈ [−90, 90] and `lon` ∈ [−180, 180] are finite numbers, else `WORLD_ORIGIN`. Server: `RouteFile.geo: Option<Geo { lat: f64, lon: f64 }>`, `#[serde(default, skip_serializing_if = "Option::is_none")]`.

- [ ] **Step 1: Failing tests:**
  - geo.test.js `toLatLon uses a given origin`: `toLatLon(0, 0, {lat: 38, lon: 2.6})` deep-equals it; the existing tests (no third argument) stay unchanged.
  - route.test.js `geo falls back to the world origin when missing or malformed`: no `geo`, `"geo": "x"`, `{lat: 38}`, `{lat: 95, lon: 0}` → `WORLD_ORIGIN`; `{lat: 38, lon: 2.6}` → kept.
  - route_file.rs `json_geo_is_passed_through` (like `json_zones_are_passed_through_unchanged`) and `json_routes_without_geo_serialise_without_the_key`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**; in `main.js` call `toLatLon(position.x, position.y, app.route.geo)`. Check no other caller of `toLatLon` exists (`grep -rn toLatLon client/public/js`).
- [ ] **Step 4: Client tests + lint, `cargo test`, `cargo fmt --check`, `cargo clippy -- -D warnings`: PASS.**
- [ ] **Step 5: Commit** `Route: geo origin per route for exports (#42)`.

### Task 4: Lanzarote source tool and GPX

**Files:**
- Create: `tools/lanzarote.mjs`, `tools/dem.mjs`, `routes/sources/ironman-lanzarote.gpx`, `routes/sources/ironman-lanzarote-markers.json`
- Modify: `.gitignore` (`tools/.cache/`)

**Interfaces:**
- Produces: `tools/dem.mjs` exports `openCog(buffer) -> { elevation(lat, lon) -> number }` for a GLO-30 COG (TIFF tags 256/257/322/323/324/325/339/317/33550/33922, deflate tiles via `inflateSync`, horizontal predictor 3 for floats, bilinear). `tools/lanzarote.mjs` (run with network) writes the GPX; `--offline` reuses `tools/.cache/`.
- `load_routes` scans only `*.json` directly in `routes/` (not recursive), so `routes/sources/` is never loaded as a route.

- [ ] **Step 1: Write the waypoint list** at the top of `tools/lanzarote.mjs`, one `[lat, lon, "name"]` per line, in the spec's order (Puerto del Carmen → Tías → Yaiza → Playa Blanca side → Femés → Yaiza → LZ-67 Timanfaya → Tinajo → Teguise interior → Tabayesco → Mirador del Río → Haría → Los Valles → Teguise → San Bartolomé → coast → Puerto del Carmen). Take coordinates from OSM (Nominatim lookups by hand, recorded in the file).
- [ ] **Step 2: Implement OSRM fetch** (`https://router.project-osrm.org/route/v1/driving/<lon,lat;...>?overview=full&geometries=geojson`), DEM tile download (`https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N{lat}_00_W{lon:03}_00_DEM/<same>.tif` for N28/N29 × W014/W013 as needed) into `tools/.cache/`, elevation per point, GPX 1.1 writer with `<metadata><desc>` holding both attribution strings and "Course unconfirmed: built from public race guides, pending a check against the official IRONMAN map." Also print sanity checks: elevation at Puerto del Carmen seafront ≈ 0–15 m, Mirador del Río ≈ 450–480 m, Peñas del Chache ≈ 670 m; abort if off by > 30 m.
- [ ] **Step 3: Run it; then run `tools/gpx-route.mjs` with `--target-length 180000 --target-climb 2500 --geo 38,2.6 --markers routes/sources/ironman-lanzarote-markers.json`.** Iterate waypoints (extra pins where OSRM leaves the course) and `--sigma` until length is in 178.2–181.8 km, climbing in 2,375–2,625 m, steepest ≤ 12 %. If climbing can't reach the band honestly, stop and report the number to the user.
- [ ] **Step 4: Markers file:** climbs Femés, Timanfaya, Tabayesco, Mirador del Río by lat/lon at each climb's middle; sprints (300 m) at Yaiza, Teguise, Haría by lat/lon.
- [ ] **Step 5: Commit** `Tools: IRONMAN Lanzarote source from OSM and Copernicus DEM (#42)`.

### Task 5: The route file and a long-route server test

**Files:**
- Create: `routes/ironman-lanzarote.json` (from Task 4's CLI run; `id: "ironman-lanzarote"`, `name: "IRONMAN Lanzarote"`, description noting the course is unconfirmed, `seed: 1992`; seeds 777, 1337, 2026, 4242 are taken)
- Test: `server/crates/server/src/route_file.rs` (or the sim crate's route tests) and `client/test/route.test.js`

- [ ] **Step 1: Server test** `lanzarote_route_loads_with_the_course_figures`: `RouteFile::load("../../../routes/ironman-lanzarote.json")` (path as other file-based tests do), `to_route()` ok, length 178_200–181_800 m, `elevation_gain_m()` 2_375–2_625.
- [ ] **Step 2: Sim test** `a rider finishes a 180 km loop`: drive a rider's distance past the route length in the sim (as existing lap/finish tests do) → one lap counted, distance wraps, no panic.
- [ ] **Step 3: Client test** `the Lanzarote route has its climbs in course order`: names of climb markers in distance order equal `["Femés", "Timanfaya", "Tabayesco", "Mirador del Río"]`; every 50 m grade ≤ 0.12; `geo` deep-equals `{lat: 38, lon: 2.6}`.
- [ ] **Step 4: Run all tests and lints, PASS.**
- [ ] **Step 5: Commit** `Routes: IRONMAN Lanzarote (#42)`.

### Task 6: Scene build scaling

**Files:**
- Create: `tools/scene-bench.mjs`
- Modify: `client/public/js/view3d/world.js` (`ElevationField`, `buildTerrain`, `gridTerrain`), maybe `features.js`
- Test: `client/test/view3d.test.js`

**Interfaces:**
- Produces: `node tools/scene-bench.mjs <route.json> [--map id]` prints per-piece build time (ms), triangles and `process.memoryUsage().heapUsed` delta, and the totals.

- [ ] **Step 1: Bench first.** Wrap the pieces of `buildWorld` with timing (bench-only hooks or by calling the exported builders in order). Record numbers for `rolling-hills.json` and `ironman-lanzarote.json` in the commit message.
- [ ] **Step 2: Regression test before changes** in `view3d.test.js`: `the valley world keeps its terrain` — build `rolling-hills` terrain, record terrain triangle count and heights at 20 fixed points (route samples plus points 300 m, 1 km, 3 km off the road) as constants; also assert the outer ring covers the island box (`bounds` inside the horizon square).
- [ ] **Step 3: Long-route test** `a 50 km route builds its terrain with the horizon around the whole island` — synthetic 50 × 20 km loop: horizon square contains the island box; terrain heights are finite at its corners; build under a generous time bound (60 s in CI).
- [ ] **Step 4: Fix, re-bench, repeat, in order of measured cost:**
  - `gridTerrain`: compute heights lazily per used node (fine nodes only inside fine blocks; coarse blocks only at corners) — same triangles as today.
  - `buildTerrain`: `horizon = max(4200, islandRadius + 4200)` where `islandRadius` is the island box's half-diagonal; `outerColumns` follows.
  - `ElevationField`: store 64 × 64-node tiles only where a road sample lies within `reach`; `at()` returns `{ base: far, distance: reach }` outside tiles.
  - Features: only if the bench says they dominate; thin by distance from the start, never on the valley routes.
  Stop when Lanzarote builds < 10 s and < 500 MB on the dev box with margin (aim < 5 s there).
- [ ] **Step 5: All tests + lint PASS** (the Step 2 test unchanged).
- [ ] **Step 6: Commit** `Client: build long routes' worlds in time (#42)`.

### Task 7: End-to-end check, docs and screenshots

**Files:**
- Modify: `docs/routes.md` (bundled list, `geo` row in the field table, "On the map" paragraph on per-route origins, a "Converting a GPX" section with the CLI, an "Attribution" section with both strings), `README.md` credits if it has a credits/licence section (else `docs/routes.md` only), `CHANGELOG.md` (Added entry)
- Possibly modify: minimap / profile view / picker if the check finds them illegible at 180 km

- [ ] **Step 1: Run the server and client in Docker** (Playwright recipe from memory) with `OPENRADLR_ROUTES_DIR=../routes`. Check: picker lists IRONMAN Lanzarote with 180 km and its climbing; ride starts; 3D renders; minimap and profile legible; grade sent to the trainer follows the profile (fake trainer in tests or the HUD grade).
- [ ] **Step 2: Fix any illegible view** with the smallest change (e.g. profile window rather than whole route) and a unit test for it.
- [ ] **Step 3: Screenshots:** picker, 3D on Femés and on the Mirador del Río climb (seek by setting the rider distance via the dev hooks the tests use), minimap. Publish as an Artifact page for review and the colleague's course check, with the waypoint list and a "what to check" note.
- [ ] **Step 4: Docs + CHANGELOG**, then full test + lint run.
- [ ] **Step 5: Commit** `Docs: IRONMAN Lanzarote, GPX converter and geo (#42)`.
- [ ] **Step 6: File the follow-up issue** (write-issue skill): real Lanzarote terrain and coastline from the DEM, referencing #42.
