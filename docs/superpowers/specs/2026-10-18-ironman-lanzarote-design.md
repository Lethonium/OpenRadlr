# IRONMAN Lanzarote bike course — design

Date: 2026-10-18 · Issue: #42 (builds step 1 of #16) · Status: agreed in discussion, awaiting spec review

## Goal

Riders training for IRONMAN Lanzarote (a colleague is) can ride the bike
course on the trainer: one ~180 km loop from Puerto del Carmen with the real
distance, the same climbs in the same order and a realistic profile.

## Decisions

| Question | Decision |
| --- | --- |
| Course order | No official map reachable from here. Build the most common public order (below), mark it *unconfirmed*; the colleague checks the draft before merge |
| Data source | OpenStreetMap roads (ODbL) via the public OSRM router, elevation from Copernicus DEM GLO-30. No user GPX |
| GPS placement | Option a: its own offset in open sea. A new optional `geo` field on the route; the valley origin 39.0° N, 2.6° E is untouched |
| 3D island | Generated island around the route, as for any route without a map. Real DEM terrain is a follow-up issue |
| Converter | General GPX → route CLI (#16 step 1); Lanzarote is its first user |
| Scaling | Measure the scene build for the real route first, then fix the costliest pieces until under budget |
| PR | One PR, ordered commits |

## Scope

In:

- `tools/gpx-route.mjs`: GPX → route JSON converter.
- `tools/lanzarote.mjs`: waypoints → OSRM → DEM → `routes/sources/ironman-lanzarote.gpx`.
- `routes/ironman-lanzarote.json`, with markers and `geo`.
- `geo` support in `client/public/js/route/geo.js` (and the server if it
  touches positions).
- Client scene-build scaling for long routes.
- Docs (`docs/routes.md`, credits, CHANGELOG), screenshots.

Out:

- Real Lanzarote terrain and coastline from the DEM (follow-up issue).
- Wind, lava / barren scenery zones.
- Server admin upload and user upload (#16 steps 2 and 3).
- Confirming the course against the official IRONMAN map (the colleague does
  this on the draft; fixes are waypoint edits plus a rerun).

## Course (to be confirmed)

Puerto del Carmen → Tías → Yaiza → Femés climb (from Playa Blanca side) →
Yaiza → Timanfaya edge (LZ-67) → Tinajo → Teguise interior → Tabayesco climb
→ Mirador del Río → Haría → Los Valles → Teguise → San Bartolomé → coast →
Puerto del Carmen. Target: 180 km ± 1 %, climbing 2,420–2,550 m (within 5 %
of ~2,500 m).

The waypoints (about 25, lat/lon with a name each) live at the top of
`tools/lanzarote.mjs`, one per line, so the colleague's corrections are
one-line edits.

## Data pipeline

```
waypoints ──OSRM (OSM, driving profile)─────────▶ track lat/lon
          ──Copernicus GLO-30 tiles (cached)─────▶ elevation per point
          ──▶ routes/sources/ironman-lanzarote.gpx   (committed, attributed)
          ──tools/gpx-route.mjs──────────────────▶ routes/ironman-lanzarote.json
```

### `tools/lanzarote.mjs`

- Calls OSRM `route/v1` with all waypoints, `overview=full`,
  `geometries=geojson`. If OSRM picks a road off the course, an extra
  waypoint fixes it.
- Downloads the GLO-30 Cloud-Optimized GeoTIFF tiles covering the track
  (public S3 bucket, `Copernicus_DSM_COG_10_N28_00_W014_00_DEM` and
  neighbours) into an ignored cache dir and reads them with Node built-ins
  only (TIFF tags, tiles, deflate via `node:zlib`, predictor). No new
  dependencies, like `tools/valley-map.mjs`.
- Bilinear elevation per track point; writes a GPX 1.1 with
  `<metadata>` carrying the attribution and "course unconfirmed".
- Network is only needed to regenerate; the GPX and the route are committed.

### `tools/gpx-route.mjs` (general)

The conversion itself lives in a pure, browser-safe module,
`client/public/js/route/gpxImport.js` (no Node APIs, no DOMParser), so a
later upload (#16 steps 2–3) can convert GPX files in the browser. The CLI
only reads files and prints.

`node tools/gpx-route.mjs in.gpx --id … --name … [--geo lat,lon] [--seed n] > out.json`

1. Parse `<trkpt lat lon><ele>` (trk only; error on no points).
2. Project to local metres around the track's start (equirectangular, the
   same sphere as `geo.js`), so the route starts at (0, 0).
3. Resample to even horizontal spacing (10 m).
4. Smooth elevation (distance-based Gaussian, window tuned so the climbing
   lands on target), then clamp grades over 50 m windows to ≤ 12 % by
   redistributing, never by scaling the whole profile.
5. Loop check: the track must end within 200 m of its start, or the
   converter errors (routes are ridden as loops).
6. Detect climbs: sustained ≥ 3 % average over ≥ 1 km with ≥ 40 m gain,
   merged across short dips. Named climbs and sprints come from an optional
   `--markers markers.json` (distance or lat/lon → name), so the Lanzarote
   tool passes Femés, Timanfaya, Tabayesco, Mirador del Río and sprints at
   Yaiza, Teguise, Haría.
7. Simplify points (Douglas–Peucker, 0.5 m horizontal / 0.3 m vertical) to
   keep the file reasonable, then print a report: length, climbing, steepest
   50 m grade, each climb, and the deviation from `--target-length` /
   `--target-climb` if given. It never fudges to hit a target.

Unit tests (node test runner, as the client uses): projection round-trip,
resampling length, grade clamp, climb detection on synthetic profiles, loop
check.

## Route file

`routes/ironman-lanzarote.json`: the usual fields (no `map`, so it is its own
world), `lanes: 4` like the other routes, a seed, markers, and

```json
"geo": { "lat": 38.0, "lon": 2.6 }
```

`geo` is the latitude and longitude of the route's local (0, 0). Coordinates
stay small, so 3D float precision is unchanged. 38.0° N, 2.6° E is open sea
between the Balearics and Algeria, ~110 km south of the valley origin, room
for any island of this size.

`client/public/js/route/geo.js`: `toLatLon(x, y, origin = WORLD_ORIGIN)`;
callers pass `route.geo ?? WORLD_ORIGIN`. `WORLD_ORIGIN` keeps its value and
comment. Every export path (TCX, GPX, FIT, Strava) is checked to pass the
route's origin; a test pins a valley-route export to the same coordinates as
before.

## Client scaling

The scene is built once in a worker and drawn in 300 m chunks; the problem is
build time and memory. Expected cost for a ~50 × 20 km route:

| Piece | Today | Fix |
| --- | --- | --- |
| `buildTerrain` fine grid | 16 m over the whole island box (~4M height samples, each with a road lookup and noise) | Heights computed only where fine cells are used (a corridor of `detailReach` around roads); coarse blocks sample their corners only |
| Horizon ring | Fixed 4,200 m around the centre | Island radius + 4,200 m |
| `ElevationField` | 25 m grid over the box (~1.6M nodes) | Sparse tiles near roads; constant (`far`) elsewhere |
| Trees, villages, posts | ~20× today | Only if the measurement says so |

Process:

1. `tools/scene-bench.mjs` builds the scene for a route in Node and prints
   time, triangles and memory per piece.
2. Fix the costliest piece, re-measure, repeat until the Lanzarote build is
   under **10 s and 500 MB** on a normal laptop (bench numbers from the dev
   box scaled conservatively).
3. Valley routes must look the same: compare their built meshes before and
   after (triangle counts and sampled heights within a small tolerance).

## End-to-end checks

- Server: loads the route, distance, drafting and finish over 180 km (one
  test with the real file).
- Route picker: length and climbing shown.
- Minimap and profile view: 180 km legible.
- Trainer resistance follows the grade (existing grade path, spot check).
- Export: Lanzarote rides land at the `geo` offset; valley rides unchanged.
- Playwright screenshots (Docker recipe): picker, 3D at Femés and Mirador del
  Río, minimap; shared as an Artifact page for review and for the colleague.

## Attribution

`docs/routes.md` and the credits: "Road geometry © OpenStreetMap
contributors, ODbL" and "Elevation: Copernicus DEM GLO-30 © DLR e.V.
2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under
COPERNICUS by the European Union and ESA". The route description says the
course is unconfirmed until checked.

## Commits

1. Converter `tools/gpx-route.mjs` with tests.
2. `tools/lanzarote.mjs` and `routes/sources/ironman-lanzarote.gpx`.
3. `routes/ironman-lanzarote.json`.
4. `geo` field in geo.js and exports.
5. Client scaling (bench, then fixes).
6. Docs, credits, CHANGELOG.
7. Screenshots and the follow-up issue for real DEM terrain.

## Risks

- The public OSRM server routes for cars, which may avoid a road the race
  uses; extra waypoints pin the course to the right roads.
- DEM elevation on narrow coastal roads can include cliff edges; smoothing
  and the grade clamp handle it, and the report shows the steepest stretches
  to check (Femés, Mirador del Río).
- Climbing may land off target honestly (the official figures disagree);
  then we report it rather than fudge.
- The client build may need more than the listed fixes; the bench tells us.
