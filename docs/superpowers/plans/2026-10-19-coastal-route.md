# Coastal Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cape Loop, a mostly flat route along the south coast of Valley Island from a new Beach Café, with a low cliff and guard rail on the south-east cape; Island Tour rides the coast too.

**Architecture:** The map generator (`tools/valley-map.mjs`) gets a per-edge shore distance, hand-placed cliff spots and a `cliff` edge zone; two new coastal edges and a café are added and the map and route files regenerated. The client reads the `cliff` zone and puts a guard rail on the sea side.

**Tech Stack:** Node 22 ES modules (generator, client, `node:test`), Rust (server test only), all run through Docker.

**Spec:** `docs/superpowers/specs/2026-10-19-coastal-route-design.md`

## Global Constraints

- Coastal edges: `shore: 70`; the generator fails if a coastal edge comes nearer the sea than its `shore`, or rides below 1.5 m.
- Cliff on the south-east cape about 25–40 m high; Cape Loop about 19–20 km, mostly at 2–10 m.
- Island Tour walk: `valley-east`, `river-east`, `south-coast` −1, `west-coast` −1, `west-valley` −1, `forge-west` −1, `forge-east` −1, `high-road` 1, `west-valley` 1, `valley-west` 1 (about 33 km).
- Every other road, the terrain away from the coast, and the other five routes stay as they are.
- Commands (from the repo root):
  - Generator: `docker run --rm -v "$PWD":/w -w /w node:22 node tools/valley-map.mjs --png /w/.map.png` (move the PNG to the scratchpad afterwards; never commit it).
  - Client: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js"; npx eslint .'`
  - Server: `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'`
- Never commit `server/Cargo.lock` or the map PNG. Commits end with the `Co-Authored-By` line.

## Review Focus

- The coastal roads change the island's outline: the client draws the coast from `coast.radius`, which the generator bakes from the landness, not the roads — confirm the outline in the PNG is unchanged except at the cape cliff.
- A coastal road too close to the waterline: the terrain blend (about 50 m around the road) would raise the beach or lower the sea floor; the new client test checks the sea is still sea 60 m seaward of the road.
- The turn from `west-coast` onto `west-valley` at the west fork (Island Tour) can be a hairpin; the existing "turns on curves" and the 20 m junction check catch it, fix with `through`/`leaves`.
- The guard rail must be on the sea side in both riding directions of a two-way road; the rail test checks the side from terrain, not from the route direction.
- Island Tour passes Beach Café mid-route: the café must stand once, beside the road, and the route must ride straight through it (existing café tests).

---

### Task 1: Generator mechanics — per-edge shore, cliff spots, `cliff` zone, coast checks

No new roads yet: after this task the regenerated map and route files are byte-identical to before.

**Files:**
- Modify: `tools/valley-map.mjs` (`SHORE` area ~line 77, `cliffAt` line 220, `layRoad` line 417 and its call ~line 809, `edgeZones` line 863, the report at ~line 1293)

**Interfaces:**
- Produces:
  - Edge spec field `shore` (metres, optional): replaces `SEARCH.shore` in `layRoad` for that edge.
  - `CLIFFS`: array of `[x, y, radius]`; `cliffAt(x, y)` = `max(noise cliff, max over spots of exp(-(d/radius)²) mapped through smoothstep(0.3, 0.7, ·))`, so a spot is 1 at its centre and fades out by about its radius.
  - Edge zone type `cliff` with `from`/`to` fractions, passed through `edgeZones` like `forest` (the existing `> 120 m` filter applies).
  - `layRoad(from, to, roadDistance, { startDir, endDir, shore })`.

- [ ] **Step 1: Add the `shore` option to `layRoad`** — default `SEARCH.shore`; the build loop passes `shore: spec.shore`. Document `shore` in the EDGES comment next to `through`/`leaves`/`zones`.
- [ ] **Step 2: Add `CLIFFS = []`** (empty for now) next to `SHORE` with a comment, and make `cliffAt` take the spots into account as above.
- [ ] **Step 3: Coast checks** — after the edges are built, for each edge with `shore` throw `` `${edge.id} comes ${n} m from the sea` `` if any point has `inland(x, y) < edge.shore`, and `` `${edge.id} rides at ${z} m` `` if any point's elevation is below 1.5. Add `cliff` to the documented zone types.
- [ ] **Step 4: Regenerate and verify nothing changed**

Run the generator, then `git status --short routes/`.
Expected: no changes in `routes/`.

- [ ] **Step 5: Commit** — `git add tools/valley-map.mjs && git commit -m "Map generator: per-road shore distance, cliff spots and cliff zones (#28)"`

---

### Task 2: Beach Café, the coastal roads, Cape Loop and the new Island Tour

**Files:**
- Modify: `tools/valley-map.mjs` (`NODES`, `EDGES`, `CLIFFS`, `ROUTES`)
- Regenerate: `routes/maps/valley.json`, `routes/*.json` (new `routes/cape-loop.json`, changed `routes/island-tour.json`)
- Modify: `client/test/world3.test.js` (`ROUTE_IDS` line 203; the island test line 443)
- Modify: `server/crates/server/src/route_file.rs` (bundled list ~line 380)

**Interfaces:**
- Consumes: Task 1's `shore`, `CLIFFS`, `cliff` zone.
- Produces: node `beach-cafe` ("Beach Café", kind `cafe`, `through: ["south-coast", "west-coast"]`); edges `south-coast` (`beach-cafe` → `south-east`, `shore: 70`, `zones: [{ type: "cliff", from, to }]` over the cape) and `west-coast` (`west-fork` → `beach-cafe`, `shore: 70`), both `type: "road"`; route `cape-loop` ("Cape Loop", walk `south-coast` 1, `lower-valley` 1, `west-coast` 1, its own seed e.g. 8642, a description naming the beaches and the cape).

- [ ] **Step 1: Write the failing client tests** in `client/test/world3.test.js`:
  - Add `"cape-loop"` to `ROUTE_IDS`.
  - Replace the first loop of "the map is an island…" (300 m all round) with: every road point stays above `seaLevel + 1.5`, and land at 60 m in all 16 directions is above `seaLevel` (the beach is not eaten by the road). Rename the test "the map is an island: every road above the sea and off the beach, the sea all around".
  - New test "Cape Loop runs along the sea": the route has at least 3 km (sum of 40 m samples) where some point 150 m away (16 directions) is below `seaLevel`; its highest point is under 60 m; its length is between 17 and 23 km.
  - New test "Island Tour rides the coast": `network.routes.find((w) => w.id === "island-tour").walk` includes `south-coast` and `west-coast`, not `lower-valley`.
- [ ] **Step 2: Run the client tests** — expected FAIL: `cape-loop.json` missing.
- [ ] **Step 3: Add the node, the two edges, a cape `CLIFFS` spot (about `[3900, -4100, 900]`), Cape Loop and the new Island Tour walk.** Start from the spec's positions: café about (700, −3300); `south-coast` via points about 100 m inland along the coast eastwards to the cape (coast at y≈−3360 for x 400–2000, y≈−4100 for x 3200–4400) then north to the south-east junction; `west-coast` via points from the west fork down to about (−3000, −2900), then east along the coast (y≈−3000…−3700 for x −2800…−400) to the café, crossing the river near its mouth. Tune via points, `shore` and `leaves`/`through` until the generator runs without errors and reports Cape Loop at 17–23 km, gain under about 120 m.
- [ ] **Step 4: Regenerate and look at the PNG** — the coastal roads follow the beaches, the cape shows a cliff, the rest of the map unchanged. `git diff --stat routes/` shows only `maps/valley.json`, `cape-loop.json`, `island-tour.json`.
- [ ] **Step 5: Add `"cape-loop"` to the server bundled list.**
- [ ] **Step 6: Run client and server checks** — expected: all pass, ESLint and clippy clean. A failing turn or terrain test means re-tuning in Step 3, not loosening the test.
- [ ] **Step 7: Commit** — map, route files, generator, both tests: "Routes: Cape Loop along the south coast, Island Tour rides it too (#28)".

---

### Task 3: Guard rail along cliff zones

**Files:**
- Modify: `client/public/js/view3d/zones.js` (`KNOWN`, `resolveZones` output gains `cliffs: {from, to}[]`)
- Modify: `client/public/js/view3d/features.js` (`buildRoadside` gains option `cliffs = []`)
- Modify: `client/public/js/view3d/world.js` (~line 1048: pass `cliffs: zonesOf.get(r).cliffs`)
- Test: `client/test/world3.test.js`

**Interfaces:**
- Consumes: `cliff` zones on network edges (Task 2) and in route files.
- Produces: `resolveZones(route).cliffs`; `buildRoadside(route, terrain, { …, cliffs })`.

- [ ] **Step 1: Write the failing tests**
  - In "zones from the route file are used as given" style: a route with `{ type: "cliff", from: 100, to: 400 }` resolves to `cliffs: [{ from: 100, to: 400 }]`; default zones have `cliffs: []`.
  - "a cliff zone gets a guard rail on the sea side": build `buildRoadside` for the `south-coast` road into a `MeshBuilder` with a terrain whose height falls on one side; for a few distances in the cliff zone, the rail posts are on the side where `terrain.height` 15 m off the road is lower, and there are none on the other side (count boxes by side, as the existing structure tests do).
- [ ] **Step 2: Run** — expected FAIL (`cliffs` undefined).
- [ ] **Step 3: Implement** — `KNOWN` gets `cliff`; ranges go to `zones.cliffs`. In `buildRoadside`, for `d` in a cliff stretch (step `railStep`, skipping `skip(d)`), pick the side whose terrain 15 m out is lower and add the same post and rail as the descent rails on that side only; a spot already railed by the descent rule is not doubled (skip the cliff rail when the descent rail ran at that `d`).
- [ ] **Step 4: Run client checks** — expected: all pass, ESLint clean.
- [ ] **Step 5: Commit** — "Client: guard rail on the sea side along cliffs (#28)".

---

### Task 4: Docs, changelog and the 3D check

**Files:**
- Modify: `docs/routes.md` (bundled routes list; `zones` rows at lines ~50 and ~182 gain `cliff`; the Roads step mentions `shore` and `CLIFFS`)
- Modify: `CHANGELOG.md` (Unreleased → Added: Cape Loop, Beach Café, guard rails on cliffs; Changed: Island Tour rides the coast)

- [ ] **Step 1: Update the docs and changelog.**
- [ ] **Step 2: 3D check with Playwright** per the memory recipe (server with `OPENRADLR_ROUTES_DIR=../routes`): Cape Loop in the menu; screenshots at the start (Beach Café), on the beach stretch, on the cliff with its rail; Island Tour passing Beach Café. Publish them on an Artifact page; clean up the containers.
- [ ] **Step 3: Run all checks once more** (client, server).
- [ ] **Step 4: Commit and push** `feat/coastal-route`; open the PR against `feat/more-routes` (or `main` once #92 is merged), "Part of #28" (boats, a lighthouse and a harbour village stay open), assigned to RalfLeonFasler. Never merge.
