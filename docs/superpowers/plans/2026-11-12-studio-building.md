# Spin Studio Building Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the spin studio into the valley world as a glass building across the road from the Valley Café, one floor per room, seen from the road and looking out onto it.

**Architecture:** The server mirrors studio seats into the valley game's `riders[]` and road riders into `studio_state.road_riders` through a shared `StudioMirror` registry (like `DistanceStats`/`VehicleCodes`). The client finds the site in the world worker, draws the building and its riders as a main-thread layer of `View3D` (like the statues), and rides studio classes in `View3D` with a `StudioCamera`; the separate `studio3d` canvas goes.

**Tech Stack:** Rust (tokio, serde) server and sim; plain ES-module client with WebGL2; `node --test`, `cargo test --workspace`.

**Spec:** `docs/superpowers/specs/2026-11-12-studio-building-design.md`

## Global Constraints

- Branch `feat/studio-building`; one PR, commits in task order; Conventional Commits, imperative.
- `make check` (lint + all tests, as CI) must pass after every task.
- TDD: failing test first, one reason to fail per test, no sleeps; time/RNG/I/O injected.
- Node tooling runs in Docker (`node:22-alpine`, repo root mounted at `/w`); Rust in `rust:1` with rustfmt/clippy.
- Protocol stays version 2; every addition optional. Document in `docs/protocol.md`.
- UI text only in `js/i18n/en.js` + `de.js`; no duplicate selectors/properties in `styles.css`.
- Studio rider ids start at `0xE000_0000`; OpenBikeNet stays at `0xF000_0000`.
- Floors drawn: `max(2, rooms)`. Floor height 4.6 m + 0.3 m slab = **4.9 m**. Glass front set back **8 m** from the road edge.
- Valley detection everywhere: the map/network has a node with id **`valley-cafe`**.
- Screenshots at deviceScaleFactor 1, saved under `~/.cache/openradlr/screenshots/`, never in the repo.

## Review Focus

1. A middle room empties while the top one is busy → the middle floor stays (dark-ish, bots only), nobody above changes floor. (Task 1)
2. A road client that did not send `features` → sees exactly today's `riders[]`, no studio riders at route position 0. (Task 2)
3. The server has no valley map (e.g. only `rolling-hills` without network) → no mirror, `road_riders` empty, the menu orbits the island, a studio ride still renders the room alone. (Tasks 3, 7, 8)
4. The studio closes or restarts while road riders watch → stale seats vanish from `riders[]` within one second, not frozen forever. (Task 2)
5. A saved studio camera value from an older version (`"seat"`, `"wide"`, `"coach"`, or garbage) → still valid or falls back to `seat`. (Task 8)

---

### Task 1: Rooms close from the top; studio ids start high

**Files:**
- Modify: `server/crates/sim/src/studio.rs` (`balance_bots` ~606, `Studio::new` ~383)
- Test: same file, `mod tests`

**Interfaces:**
- Produces: `pub const STUDIO_FIRST_ID: RiderId = 0xE000_0000;` in `sim/src/studio.rs`; room indices stable for seated riders.

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn an_empty_middle_room_stays_open_while_a_room_above_is_busy() {
    let mut studio = studio(12, SLOT_START);
    let ids: Vec<RiderId> = (0..33).map(|i| studio.join_human(&format!("R{i}"), 70.0, 250.0)).collect();
    assert_eq!(studio.rooms().len(), 3);
    for id in &ids[16..32] { studio.leave(*id); }
    assert_eq!(studio.rooms().len(), 3, "room 1 waits for room 2");
    assert_eq!(studio.seat_of(ids[32]).map(|(room, _)| room), Some(2));
    studio.leave(ids[32]);
    assert_eq!(studio.rooms().len(), 1, "then both close from the top");
}

#[test]
fn studio_ids_start_far_from_route_ids() {
    let mut studio = studio(0, SLOT_START);
    assert_eq!(studio.join_human("A", 70.0, 250.0), STUDIO_FIRST_ID);
}
```

- [ ] **Step 2:** `cargo test -p openradlr-sim studio` → both FAIL (rooms 2, id 1).
- [ ] **Step 3:** In `balance_bots`, replace the backward scan with: while `rooms.len() > 1` and the last room has no humans, pop it. `next_id: STUDIO_FIRST_ID` in `new`. Fix any test asserting small studio ids.
- [ ] **Step 4:** `cargo test --workspace` → PASS (the existing seventeenth-human test still passes).
- [ ] **Step 5:** Commit `feat(sim): Close studio rooms from the top and number studio riders apart`.

---

### Task 2: Studio seats on the road (server)

**Files:**
- Create: `server/crates/server/src/studio_mirror.rs`
- Modify: `lib.rs` (mod), `protocol.rs` (`RiderState.studio`, `ClientMessage::Join.features`, factor `nearest_riders`), `runtime.rs` (`Command::SetStudioRiders`, `Game::set_studio_riders`), `connection.rs:163` (send it after join), `session.rs` (carry `features` through `Action::Join`), `game.rs` (`with_studio_mirror`, append seats)
- Test: `studio_mirror.rs` tests, `game.rs` tests, `protocol.rs` tests

**Interfaces:**
- Produces:
  - `#[derive(Clone, Default)] pub struct StudioMirror` (an `Arc<Mutex<..>>` inside) with
    `pub fn publish_seats(&self, seats: Vec<StudioSeat>, now_s: f64)`,
    `pub fn seats(&self, now_s: f64) -> Vec<StudioSeat>` (empty if the last publish is older than `SEAT_TTL_S = 1.0`),
    `pub fn publish_road(&self, riders: Vec<RiderState>)`, `pub fn road(&self) -> Vec<RiderState>`.
  - `pub struct StudioSeat { pub id: RiderId, pub name: String, pub is_bot: bool, pub power: f64, pub cadence: Option<f64>, pub room: usize, pub seat: usize }`
  - `RiderState.studio: Option<StudioPlace>` (`#[serde(skip_serializing_if = "Option::is_none")]`), `pub struct StudioPlace { pub room: usize, pub seat: usize }`; `RiderState::studio_seat(s: &StudioSeat) -> RiderState` (route `None`, distance 0, speed 0, lane 0, `parked: false`).
  - `pub fn nearest_riders(world: &World, at: (f64, f64), max: usize, tags_of: &dyn Fn(RiderId) -> RiderTags) -> Vec<RiderState>`: humans before bots, nearest first (the sort `state_message` uses today; `state_message` calls it for its `others`).
  - `GameCore::with_studio_mirror(self, mirror: StudioMirror, anchor: (f64, f64)) -> Self`; `anchor` is the `valley-cafe` node's `(x, y)`.
  - `ClientMessage::Join { #[serde(default)] features: Vec<String>, .. }`; `"studio_riders"` turns it on, unknown entries ignored.
  - `Command::SetStudioRiders { rider_id: RiderId }` → `Game::set_studio_riders(&mut self, rider_id)` (default no-op).

- [ ] **Step 1: Write failing tests**
  - `studio_mirror.rs`: `seats_expire_after_a_second` (publish at t=0; `seats(0.5)` has 1, `seats(1.5)` is empty); `road_is_what_was_published_last`.
  - `protocol.rs`: `a_studio_seat_serialises_with_its_place_and_no_route` (JSON has `"studio":{"room":1,"seat":4}`, `"route":null`); `join_features_default_to_empty`.
  - `game.rs`:
    - `studio_riders_reach_only_clients_that_asked` — two clients joined, one `set_studio_riders`; mirror publishes one seat; after a broadcast tick the flagged client's last `State` has a rider with `studio.is_some()`, the other has none.
    - `studio_riders_are_not_counted_as_route_riders` — `route_riders.humans`/`bots` unchanged; `player_count()` unchanged.
    - `studio_riders_respect_max_visible_riders` — `max_visible_riders = 3`, 2 road riders + 5 seats → 3 riders total.
    - `the_game_publishes_road_riders_near_the_anchor` — after a tick, `mirror.road()` holds riders sorted nearest the anchor first, at most `max_visible_riders`.
- [ ] **Step 2:** `cargo test -p openradlr-server` → the new tests FAIL to compile/fail.
- [ ] **Step 3:** Implement as in Interfaces. In `GameCore`, a `studio: Option<StudioLink { mirror, anchor, viewers: HashSet<RiderId> }>`; each broadcast tick: `mirror.publish_road(nearest_riders(&world, anchor, max_visible, ..))`; when building a viewer's state, if the viewer is in `viewers`, extend `riders` with `RiderState::studio_seat` for `mirror.seats(now)`, humans first, up to `max_visible_riders - riders.len()` (all seats share one place, so no distance sort). Remove a leaving rider from `viewers`. The session passes `features` through `Action::Join`; `connection.rs` sends `SetStudioRiders` after a successful join when `features` contains `"studio_riders"` (next to `SetDevice`).
- [ ] **Step 4:** `cargo test --workspace` → PASS; `cargo clippy --workspace -- -D warnings` clean.
- [ ] **Step 5:** Commit `feat(server): Show the spin studio's riders to road riders who ask for them`.

---

### Task 3: The road in the studio, `rooms` in `/api/info`, wiring

**Files:**
- Modify: `server/crates/server/src/studio.rs` (`with_mirror`, publish seats, `road_riders`), `protocol.rs` (`StudioState.road_riders`, `studio_state_message` signature), `http.rs` (`StudioSummary.rooms`), `worlds.rs`/`runtime.rs` if a room count must be shared (see Step 3), `app.rs` (create the mirror, attach to the valley game and the studio)
- Test: `studio.rs` tests, `http.rs` tests, `server/crates/server/tests/websocket_flow.rs`

**Interfaces:**
- Consumes: `StudioMirror`, `StudioSeat`, `RiderState::studio_seat` (Task 2); `STUDIO_FIRST_ID` (Task 1).
- Produces:
  - `StudioCore::with_mirror(self, mirror: StudioMirror) -> Self`
  - `studio_state_message(studio: &Studio, room: usize, tick: u64, road: &[RiderState]) -> ServerMessage`; `ServerMessage::StudioState.road_riders: Vec<RiderState>` (`skip_serializing_if = "Vec::is_empty"`) = road riders from the mirror + `RiderState::studio_seat` of every seat **not** in `room`.
  - `/api/info` `studio.rooms: usize` (open rooms, ≥ 1).

- [ ] **Step 1: Write failing tests**
  - `studio.rs`: `seats_of_every_room_are_published_each_broadcast` (17 humans → 2 rooms → `mirror.seats(now)` has 16 + room-1 riders with correct `room`/`seat`); `studio_state_carries_road_riders_and_other_rooms_not_my_own` (publish one road rider; room 0's state has it plus room-1 seats and no room-0 seat in `road_riders`).
  - `http.rs`: `info_reports_the_studios_open_rooms` (`rooms` is 1 with a fresh studio).
  - `websocket_flow.rs` (valley map server config, as other e2e tests build one): `a_road_rider_near_the_cafe_sees_a_studio_rider` (road client joins with `features:["studio_riders"]`, studio client joins; within N state messages the road client sees a rider with `studio`); `a_studio_rider_sees_a_road_rider` (`studio_state.road_riders` contains the road client's id).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. Room count for `/api/info`: add `rooms: Arc<AtomicUsize>` to `StudioEntry`, set by `StudioCore` via a `with_room_count(Arc<AtomicUsize>)` builder each tick (same pattern as `players`). In `app.rs`: create one `StudioMirror` before the map loop; for the group whose `maps.network(id)` has node `valley-cafe`, call `.with_studio_mirror(mirror.clone(), (node.x, node.y))`; give the studio `.with_mirror(mirror.clone())` only if such a map exists.
- [ ] **Step 4:** `cargo test --workspace` → PASS.
- [ ] **Step 5:** Commit `feat(server): Send studio riders the road outside and report the studio's rooms`.

---

### Task 4: The building site in the world

**Files:**
- Modify: `client/public/js/view3d/features.js` (`studioSite`, `buildStudioSite`), `client/public/js/view3d/world.js` (~1062, call it for the café with id `valley-cafe`), `client/public/js/view3d/worldScene.js` (pass `studio` through)
- Test: `client/test/view3d/studioSite.test.js`

**Interfaces:**
- Produces:
  - `export const STUDIO_DISTANCE = CAFE_DISTANCE + 12;` `export const STUDIO_FOOTPRINT = Object.freeze({ halfWidth: 8.5, front: -10, back: 8 });` (local, riders face −Z; the glass at `front`)
  - `export function studioSite(route, terrain, { occupancy, avoid = () => false }) -> { position: [x, y, z], yaw: number } | null` — on the side opposite the café (`side = -1`), at `route.wrap(STUDIO_DISTANCE)`, local −Z towards the road, the glass `8` m from the road edge (`roadHalfWidth(route.lanes) + 8 - STUDIO_FOOTPRINT.front` from the centre line to the origin), `y` = highest ground under the footprint; reserves the footprint + 1 m in `occupancy`. `null` if `avoid`/`occupancy` blocks it.
  - World/scene: `scene.studio = { position, yaw } | null` (only for café id `valley-cafe`).

- [ ] **Step 1: Write failing tests** (use the fake route/terrain helpers the gym tests in `client/test/view3d/` already use):
  - `the studio stands across the road from the café` — café side +1, studio origin's lateral offset < 0.
  - `its glass front faces the road and stands 8 m off the edge` — local −Z rotated by `yaw` points at the road; distance from the road edge to the front = 8 ± 0.01.
  - `it reserves its footprint` — after the call, `occupancy.blocked` at the origin is true.
  - `it is skipped where something already stands` → `null`.
  - `only the valley café gets one` — world build with café id `hill-cafe` → `scene.studio === null`.
- [ ] **Step 2:** Run `node --test test/view3d/studioSite.test.js` (in Docker) → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full client tests → PASS.
- [ ] **Step 5:** Commit `feat(client): Find a site for the spin studio across from the Valley Café`.

---

### Task 5: Building and light interior meshes

**Files:**
- Create: `client/public/js/view3d/studioBuilding.js` (shell), `client/public/js/view3d/studioRoom.js` (interior, props)
- Modify: `client/public/js/view3d/studioScene.js` (export `ROOM`, `STAGE`, `seatPosition`, `studioCamera` from here still; drop the dark room builder)
- Test: `client/test/view3d/studioBuilding.test.js`, `client/test/view3d/studioRoom.test.js`

**Interfaces:**
- Produces:
  - `export const FLOOR_HEIGHT = 4.9;`
  - `buildStudioShell() -> { base: MeshBuilder, floor: MeshBuilder, roof: MeshBuilder, glass: MeshBuilder }` — `floor` is one storey's slab, side/back walls and mullions in local frame `y ∈ [0, FLOOR_HEIGHT]`; `glass` one storey's front pane; `roof` sits at `y = 0` (placed on top by the layer); the sign "Spin Studio" (i18n-ok brand name) on the roof's road side.
  - `buildStudioRoom() -> { room: MeshBuilder, accents: MeshBuilder, props: {kind, x, z}[] }` — light oak floor, white walls, pale ceiling with light panels (`accents` drawn bright), lemon stage edge and back-wall stripe; props: dumbbell rack, kettlebells, rolled mats, plants, water station, towel bench, wall screen.
  - `export const ROOM_COLORS` (floor oak `#d9b98c`, walls `#f4f1ea`, ceiling `#eceae4`, lemon `#f5d000`, orange `#ff7a1a`) — values may be tuned visually; tests compare against the constant, not literals.
- [ ] **Step 1: Write failing tests**
  - Shell: `all shell parts stay inside the footprint`; `a floor storey reaches exactly FLOOR_HEIGHT`; `the glass is at the front only` (all glass vertices have `z ≈ STUDIO_FOOTPRINT.front`).
  - Room: `the floor is light` (luma of `ROOM_COLORS.floor` > 0.6); `every prop stands along a side wall, clear of the aisles` (`|x| > ROOM.halfWidth - 1.2` and no prop within 1 m of any `seatPosition` or stage); `no prop blocks a camera` (no prop within 0.8 m of any `studioCamera(mode, seat).eye` for all modes, seats 0–15).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `MeshBuilder` as `structures.js` does; the old neon dark room builder is deleted.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(client): Build the studio as a light glass box with a training room`.

---

### Task 6: The studio layer in `View3D`, with mirrored riders

**Files:**
- Create: `client/public/js/view3d/studioLayer.js`
- Modify: `client/public/js/view3d/view3d.js` (own a `StudioLayer` when `scene.studio`; draw it; route riders with `rider.studio` to it instead of the road), `client/public/js/net/protocol.js` (`join` sends `features: ["studio_riders"]`)
- Test: `client/test/view3d/studioLayer.test.js`, `client/test/net/protocol.test.js`

**Interfaces:**
- Consumes: `scene.studio` (Task 4); `buildStudioShell`, `buildStudioRoom`, `FLOOR_HEIGHT` (Task 5); `seatPosition`, `INSTRUCTOR` (`studioScene.js`).
- Produces:
  - `export function floorCount(rooms) -> number` = `Math.max(2, rooms | 0)`.
  - `export function floorTransform(site, floor) -> Float32Array(16)` and `export function seatWorld(site, room, seat) -> { position: [x,y,z], yaw }` (pure).
  - `class StudioLayer { constructor(renderer, site); setRooms(rooms); setOpen(openRooms); riders(list) -> placed[]; draw(pass, ctx) }`: closed floors draw interior unlit and glass darker; the coach on every open floor; glass via `renderer.drawTransparent` after opaque meshes.
  - `View3D.setStudioRooms(rooms)`; `View3D.studioSite` getter (`scene.studio` or `null`).
- [ ] **Step 1: Write failing tests**
  - `floorCount`: 0→2, 1→2, 3→3.
  - `seatWorld`: floor 1 seat 0 is `FLOOR_HEIGHT` above floor 0 seat 0; yaw rotates the offset; riders face the road (forward = site's −Z).
  - Layer riders: a rider with `studio: {room: 2, seat: 5}` is placed at `seatWorld(site, 2, 5)` and opens floor 3 (`setOpen` max); a rider without `studio` is not placed by the layer.
  - `join sends the studio_riders feature`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. In `View3D.render`, split `riders` into `rider.studio` and the rest before `#onRoute`; draw studio riders with the existing `#riderParts` at their seat transform (pedalling at `rider.cadence ?? 0`, wheel speed 0).
- [ ] **Step 4:** Tests → PASS; start `make dev` with all routes (`.env.dev`), ride `rolling-hills`/valley route past the café and confirm the building shows (Playwright, 1×).
- [ ] **Step 5:** Commit `feat(client): Draw the studio building and its riders in the valley`.

---

### Task 7: Menu flies to the studio

**Files:**
- Modify: `client/public/js/view3d/menuCamera.js` (`studioPose`, `showStudio`), `client/public/js/view/menuStage.js` (studio card picks the valley world; `#build`/`#show` use `showStudio`; `setStudioRooms(info.studio.rooms)`), `client/public/js/view/startMenu.js` if the card needs the valley route id
- Test: `client/test/view3d/menuCamera.test.js`, `client/test/view/menuStage.test.js`

**Interfaces:**
- Consumes: `View3D.studioSite`, `View3D.setStudioRooms` (Task 6).
- Produces: `export function studioPose(site, overview, angle, settings = MENU_CAMERA) -> {eye, target}` — orbit radius `settings.studioDistance = 40`, height `settings.studioHeight = 15`, target the building at half its 2-floor height; above ground like `gymPose`. `MenuCamera.showStudio(site)`. Pure `studioRouteId(routes, maps) -> string | null`: first route whose map has node `valley-cafe`.
- [ ] **Step 1: Write failing tests**
  - `studioPose`: eye 25 m from the site horizontally, above ground, looking at it; two angles a half turn apart are on opposite sides.
  - Menu stage: picking the studio card builds the valley route's world and calls `showStudio(site)`; with no valley route, `showIsland()` as today; `setStudioRooms` gets `info.studio.rooms`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; reduced motion cuts (existing `#go` behaviour).
- [ ] **Step 4:** Tests → PASS; Playwright screenshot of the start menu with the Studio card picked.
- [ ] **Step 5:** Commit `feat(client): Fly the menu drone to the spin studio`.

---

### Task 8: Ride classes inside the building, with a POV camera

**Files:**
- Modify: `client/public/js/view3d/studioScene.js` (`STUDIO_CAMERAS`, `studioCamera("pov")`; `StudioView3D` reduced to the room-only fallback using the new room meshes), `client/public/js/view3d/view3d.js` (`StudioCamera`), `client/public/js/main.js` (studio ride builds the valley world in `View3D`; `studioFrame` renders it; fallback), `client/public/index.html` (drop `studio3d`/`studio-labels` unless the fallback keeps them — keep one canvas: the fallback renders into `world3d`), `client/public/js/i18n/en.js`, `de.js`
- Test: `client/test/view3d/studioScene.test.js`, `client/test/view3d/studioCamera.test.js`, `client/test/main*.test.js` where studio setup is covered

**Interfaces:**
- Consumes: Tasks 4–6 (`seatWorld`, `floorTransform`, `StudioLayer`).
- Produces:
  - `STUDIO_CAMERAS = ["seat", "pov", "wide", "coach"]`; `studioCamera("pov", seat, { cadence, timeS, reducedMotion })` → eye at `seatPosition(seat)` + head height (from `RIDER_GEOMETRY`), target 10 m ahead on −Z at eye height − 0.3; vertical bob `0.03 * sin(2π · cadence/60 · timeS)`, 0 with `reducedMotion`.
  - `export function cameraModeOf(saved) -> string` — saved value if in `STUDIO_CAMERAS`, else `"seat"`.
  - `class StudioCamera { constructor(site, room, seat, mode); mode; setMode(m); cycle(); update(_d, _l, dt); eye; target }` — applies `floorTransform(site, room)` to `studioCamera`'s room-frame pose.
  - `View3D` hides my own body in `pov` (bike, bar and front wheel still drawn).
  - Studio riders of my room come from `studio_state.riders` (mapped to `{ ...r, studio: { room, seat } }`); other floors and the road from `studio_state.road_riders`.
  - i18n: `studio.camera.pov` = "My view" / "Meine Sicht".
- [ ] **Step 1: Write failing tests**
  - `pov sits at my head and looks forward through the glass` (eye y ≈ seat y + head height; target z < eye z).
  - `pov bobs with cadence and not with reduced motion`.
  - `cameraModeOf` keeps `"wide"`, maps `"bogus"`/`null` to `"seat"`.
  - `StudioCamera` on room 2 is `2 * FLOOR_HEIGHT` above room 0 for the same mode and seat.
  - `my own body is hidden in pov` (View3D part list for my id has no body in pov; has one in seat).
  - i18n key parity test (existing) covers the new key.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. In `main.js` studio join: `app.view3d` built from the valley route's scene (same path as a road ride) with `camera = new StudioCamera(scene.studio, room, seat, cameraModeOf(readSetting(STUDIO_CAMERA_KEY)))`; `studioFrame` calls `app.view3d.render` with own-room + `road_riders`; `app.view3d.setStudioRooms(state.rooms)`. Without a valley route or on a build error: `StudioView3D` room alone in `world3d`, glass as flat sky colour.
- [ ] **Step 4:** `make check` → PASS. Playwright (1×): POV through the glass during a class; road view of a 3-floor building (three studio clients or a test server with `target_riders` making 3 rooms).
- [ ] **Step 5:** Commit `feat(client): Ride spin classes inside the studio building, with a POV camera`.

---

### Task 9: Docs

**Files:**
- Create: `docs/adr/0025-spin-studio-building.md`
- Modify: `docs/adr/0011-spin-studio.md` (a "Since ADR 0025" note), `docs/protocol.md` (`join.features`, `riders[].studio`, `studio_state.road_riders`, `/api/info` `studio.rooms`, the 2.x additions list), `docs/architecture.md` (the mirror between cores), `CHANGELOG.md` (`[Unreleased]`, Added)

- [ ] **Step 1:** Write the ADR (context, decision: floors as rooms, top-only closing, two-way mirror via shared registry, feature flag, ids from `0xE000_0000`; consequences) and the doc edits.
- [ ] **Step 2:** `make check` → PASS.
- [ ] **Step 3:** Commit `docs: Record the spin studio building`.
