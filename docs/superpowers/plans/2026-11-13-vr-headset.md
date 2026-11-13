# VR Headset Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paired Meta Quest 3 shows the tablet's ride: first as a floating 3D window, then in immersive WebXR on the rider's own saddle. A headset-free stereo preview makes every part of it checkable, and screenshots repeatable. The pairing UI gets the app's look and a list of paired screens.

**Architecture:**
- **The page.** A new page `vr.html` + `js/vr/main.js` watches the ride through the #87 relay (`watch` with `view: "world"`) and drives a normal `View3D`.
- **Per-eye drawing.** `View3D.render` is split into a once-per-frame part and a once-per-view part. A new `renderXr(input, frame)` draws each view of an `XrFrame`.
- **Two frame sources.** An `XrFrame` comes from one of two sources behind the same interface: `webXrSource` (the Quest) or `previewSource` (side-by-side stereo on a normal canvas, head pose from the mouse, the keys or the URL).

**Tech Stack:** Plain ES modules (no build step), WebGL2, WebXR Device API, `node --test` with fakes. Rust (axum/tokio) server, `cargo test`. Playwright only for ad-hoc screenshots.

**Spec:** `docs/superpowers/specs/2026-11-13-vr-headset-design.md` (read it first). It builds on `docs/superpowers/specs/2026-11-12-second-screen-cockpit-design.md`.

**Branch:** `feat/vr-headset`, based on `feat/cockpit` (PR #88). It is one PR; each task below is one commit (Conventional Commits, imperative).

## Global Constraints

- **Read first:** `CONTRIBUTING.md` and `AGENTS.md`.
  - TDD: the failing test comes first.
  - One reason to fail per test; no sleeps.
  - Time, RNG, sockets, storage and `navigator.xr` are injected.
- **How to run the checks.** Node and cargo are not on the host; run them in Docker from the repo root:
  - Client: `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js" && npx eslint .'`
  - Server: `docker run --rm -v "$PWD":/w -w /w/server rust:1 sh -c 'rustup component add rustfmt clippy >/dev/null 2>&1; cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'`
  - A single client test file: replace the glob with the file, e.g. `node --test test/vr/seatAnchor.test.js`.
- **UI text:** in `client/public/js/i18n/en.js` **and** `de.js`. The i18n parity and sweep tests enforce both.
- **Protocol:** additive only, no `PROTOCOL_VERSION` bump. Every addition goes in `docs/protocol.md`, on both server and client.
- **Comfort rule in VR:** the camera never moves except with the head (headset/preview pose) and with the bike's smoothed position and heading.
  - No bob, no easing, no scripted moves.
  - My own body is hidden in VR; the bike stays visible.
- **Preview gate:** `OPENRADLR_XR_PREVIEW`, default `true`, advertised as `/api/info` `xr_preview`. `docs/deploy.md` sets it `false`.
- **Preview geometry:**
  - eyes 0.064 m apart;
  - per-eye field of view 100° horizontal × 96° vertical;
  - URL `?preview=1&head=<yawDeg>,<pitchDeg>[,<x>,<y>,<z>]`.
- **Codes:**
  - 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`;
  - shown grouped `ABC DEF`;
  - device names at most 40 characters.
- **No duplicate CSS rules:** in `styles.css` a selector must not repeat, and a property must not be overridden in the same rule. Reuse `.menu-dialog`, `.secondary` and the existing input rules.
- **Commits:** use `git -c user.email=lethonium.software@gmail.com commit …` and end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The host switches world mid-watch** (it turns onto another route, joins a studio class, or leaves the studio). The VR page must build the new world and drop the old one's GPU buffers, not draw the old world with the new rider. Pinned in Task 3: `vrWorld` asks for a new world on a route change and on studio enter and leave.
2. **The host's rider is not in `state` yet, or has left it** (a reconnect, the first frames). Nothing may throw, and the camera keeps the last anchor. Pinned in Tasks 3 and 5: `pickHost` returns null, and `renderXr` with no `me` draws nothing.
3. **The tablet unpairs everything while the Quest watches** (`bad_screen_key`). The VR page shows "Pair now" and stops retrying, like the cockpit. Pinned in Task 3.
4. **Entering VR fails or the session ends unexpectedly** (the headset is removed, or the system menu ends it). The page goes back to the 2D window and its normal frame loop. Pinned in Task 6: on the session's `end`, the source calls `onEnd` once and the 2D loop restarts.
5. **Code entry gets messy input:** lower case, spaces, a pasted `abc-def` or `ABC DEF`, look-alike characters, or more than 6 characters. The result is the clean 6-character code, or nothing submitted. Pinned in Task 8: `cleanCode` tests.

---

### Task 1: Share the rider stamps and the studio rider mapping (refactor)

**Files:**
- Create: `client/public/js/ride/riderStamps.js`
- Modify:
  - `client/public/js/main.js` (`stampParked` ~2101, `stampExercise` ~2108, the `app.parkedSince` and `app.exerciseSince` cleanup ~2047, `studioSceneRiders` ~2540)
  - `client/public/js/view/studioWorld.js` (add `studioSceneRiders`)
- Test:
  - `client/test/riderStamps.test.js`
  - `client/test/studioWorld.test.js` (create it if absent)

`followMyRoad` and `onMyOwnRoad` stay in `main.js`. They exist for the tablet's own steering, and `View3D.#onRoad` already places riders that are off every route. Also amend the spec's "Sharing the app's code" bullet to say only the stamps and the studio mapping move.

**Interfaces:**
- Produces:
  - `class RiderStamps { constructor({ now: () => number }); stamp(rider): rider & { parkedSince: number|null, exerciseSince: number }; keep(riders): void }`. `keep` forgets ids that are not in `riders`.
  - `studioSceneRiders(studioState): rider[]`, exported from `view/studioWorld.js`. It is moved unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `stamp marks parkedSince at the first parked sighting and keeps it`: `now` 10, then 12; the same parked rider gives `parkedSince === 10` both times.
  - `stamp gives parkedSince null to a rolling rider`.
  - `exerciseSince restarts when the exercise changes`: 10 for `"plank"`, still 10 for `"plank"` at 11, 12 for `"squat"` at 12.
  - `keep forgets riders that left`: after `keep([])`, a parked rider stamped at 20 gets 20.
  - `studioSceneRiders seats room riders and appends road riders` (moved from wherever the behaviour is implicitly tested; it asserts `route: null` and `studio: { room, seat }`).
- [ ] **Step 2: Run them.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement and switch `main.js` over.**
  - `RiderStamps` holds the two maps.
  - `main.js` creates one `app.stamps = new RiderStamps({ now })` per ride, where it reset `parkedSince` and `exerciseSince`.
  - In the state handler: `rider => app.stamps.stamp(rider === mine ? me : onMyOwnRoad(rider))`, then `app.stamps.keep(message.riders)`.
- [ ] **Step 4: Run the full client checks.** Expected: all pass, eslint clean.
- [ ] **Step 5: Commit** `refactor(client): Share the rider stamps and studio seating between pages`.

### Task 2: Server: preview flag and the host's rider id for watchers

**Files:**
- Modify:
  - `server/crates/server/src/config.rs` (next to `allow_simulated_trainer`: field ~93, read ~446, tests ~658)
  - `lib.rs` (~96)
  - `app.rs` (~275, ~330)
  - `http.rs` (`AppState` ~84, `Info` ~124, ~446)
  - `protocol.rs` (`WatchStatus` ~346)
  - `screens.rs` (lines 103 and 137 send `WatchStatus`; the hub must keep the host's `rider_id`)
  - `docker-compose.yml`, `.env.example`, `README.md` settings table, `docs/deploy.md`, `docs/protocol.md`
  - `client/public/js/cockpit/cockpitConnection.js` (emit `riderId`)
- Test:
  - `config.rs` and `http.rs` unit tests;
  - `screens.rs` tests;
  - `server/crates/server/tests/websocket_flow.rs`;
  - `client/test/cockpit/cockpitConnection.test.js`.

**Interfaces:**
- Produces:
  - Config `xr_preview: bool` (env `OPENRADLR_XR_PREVIEW`, default `true`).
  - `/api/info` field `xr_preview: bool`.
  - `ServerMessage::WatchStatus { live, name, #[serde(skip_serializing_if = "Option::is_none")] rider_id: Option<RiderId> }`: `Some` while live, `None` otherwise.
  - Client: `CockpitConnection` emits `status` as `{ live, name, riderId: number|null }`.

- [ ] **Step 1: Write the failing tests.**
  - `config`: `xr_preview` is true by default and false with `OPENRADLR_XR_PREVIEW=false`.
  - `http`: `/api/info` has `xr_preview` mirroring the config.
  - `screens`:
    - `a watcher that arrives during a ride is told the host's rider id`;
    - `watchers are told the rider id when the host arrives`;
    - `rider id is absent when the host leaves`.
  - e2e in `websocket_flow.rs`: a tablet joins with `screen_key`; a watcher's first `watch_status` carries `rider_id` equal to the tablet's `welcome` rider id.
  - Client: `status carries riderId` (with `null` when the field is missing).
- [ ] **Step 2: Run them.** Expected: FAIL (compile errors or missing fields).
- [ ] **Step 3: Implement.**
  - The hub's `Host` stores `rider_id` next to `name`.
  - Wire the config the same way as `allow_simulated_trainer` throughout.
  - In the docs, follow the simulated trainer's lines for the flag, and add `rider_id`? to the `watch_status` row of `docs/protocol.md`.
- [ ] **Step 4: Run the server and client checks.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(server): Tell paired screens which rider is the tablet's and advertise the VR preview`.

### Task 3: The VR page as a floating 3D window (#86 step 3)

**Files:**
- Create:
  - `client/public/vr.html`
  - `client/public/js/vr/main.js` (composition root, no logic worth testing)
  - `client/public/js/vr/vrWorld.js`
  - `client/public/js/vr/hud2d.js`
- Modify:
  - `client/public/js/cockpit/cockpitConnection.js` (`view` option)
  - `client/public/js/main.js` (the start-menu button "Use this device as a VR display", next to `screens-cockpit` ~1605; same claim flow; opens `vr.html`)
  - `client/public/index.html` (`#screens-vr` button)
  - `client/public/styles.css` (`.vr-*` rules only)
  - i18n `en.js` / `de.js` (`vr.*` keys)
  - `AGENTS.md` ("one composition root per page" lists `vr/main.js`)
- Test:
  - `client/test/vr/vrWorld.test.js`
  - `client/test/vr/hud2d.test.js`
  - `client/test/cockpit/cockpitConnection.test.js`

**Interfaces:**
- Consumes:
  - `CockpitConnection` events (Task 2 `riderId`);
  - `RiderStamps` and `studioSceneRiders` (Task 1);
  - `buildScene` (`view3d/worldScene.js`);
  - `fetchMapNeighbours` and `fetchMapNetwork` (`route/worldMap.js`);
  - `studioWorld` (`view/studioWorld.js`);
  - `RiderSmoother` (`ride/smoothing.js`);
  - `CockpitModel` (derived numbers);
  - `ScreenWakeLock`.
- Produces:
  - `new CockpitConnection({ ..., view = "data" })`, which sends `watch(key, view)`.
  - `pickHost(riders, riderId): rider|null`.
  - `worldWanted(message, riderId): { kind: "route", routeId: string } | { kind: "studio" } | null`.
    - It returns null while the host is unknown, and for `state` while the host is off every route (it keeps the current world).
  - `class VrWorld extends Emitter { constructor({ buildRouteWorld: (routeId) => Promise<{route, scene, routes, network}>, buildStudioWorld: () => Promise<...> }); want(wanted): void }`.
    - It emits `"world"` with the built world. It ignores a `want` equal to the current one. A newer `want` wins over a build still in flight: the stale result is dropped.
  - `hudValues(model, rider): { power, cadence, speedKmh, grade, heartRate|null, workout|null }`.
    - It takes power, cadence and speed from `rider` (state) and heart rate and workout from the latest display frame (spec: state first, display only for heart rate and workout).
  - `vr/main.js` exposes `window.openradlrVr = { view3d, source }` for the screenshot script (Task 10).

- [ ] **Step 1: Write the failing tests.**
  - `cockpitConnection`: `watches with the given view` (`view: "world"` gives `{type:"watch", key, view:"world"}`).
  - `vrWorld`:
    - `pickHost finds the rider by id`;
    - `pickHost is null before the rider id is known`;
    - `worldWanted asks for the host's route`;
    - `worldWanted asks for the studio on studio_state`;
    - `worldWanted keeps the world while the host is off every route` (null);
    - `a route change builds the new world`;
    - `the same want twice builds once`;
    - `a newer want drops the older build's result`. This uses deferred promises; the first resolves after the second and no `"world"` is emitted for it.
  - `hud2d`:
    - `power and cadence come from the state rider`;
    - `heart rate comes from the display frame`;
    - `heart rate is null without a frame`.
  - `cockpitConnection`: `bad_screen_key stops retrying` already exists. Add `invalid is emitted for a world watcher too`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `vr.html` reuses the cockpit page's structure: the status messages, "Forget this tablet", a link back, `#world3d` with `#labels3d`, the `.vr-hud` overlay, and the `#vr-enter` / `#vr-preview` buttons (hidden until Tasks 5 and 6).
  - `vr/main.js` wires:
    - the connection (`view: "world"`);
    - `VrWorld`, which on `"world"` disposes the old `View3D` and creates a new one, with `StudioCamera` for the studio as `buildStudioWorld` in `main.js` does, and the saved chase-camera mode on the road;
    - the stamps and smoother on `state`;
    - a `requestAnimationFrame` loop calling `view3d.render({ riders: smoother.sample(now), myId: riderId, myCadence: host.cadence, timeS, colors })`;
    - the HUD at 4 Hz;
    - the wake lock while live.
  - Camera cycling uses the `C` key and a button, as in the app.
- [ ] **Step 4: Run the full client checks.** Expected: all pass.
- [ ] **Step 5: Check by hand.**
  - `make dev`, ride with the simulated trainer in one tab, pair, then open `vr.html` in another tab.
  - Shoot it with `make screenshot` (Playwright image recipe in AGENTS.md) at 1×.
  - Expected: the host's ride seen from the chase camera, and the HUD numbers changing.
- [ ] **Step 6: Commit** `feat(client): Show your ride in a 3D window on a paired headset`.

### Task 3b: The tablet's ride HUD in the VR window

Added after Task 3, at the user's request: the window shows the tablet's ride HUD, in the same look and layouts, not a reduced bike computer. The headset only watches, so the HUD's controls stay on the tablet. Two commits: a refactor that shares the HUD, then the feature.

**Files:**
- Create: `client/public/js/view/rideHud.js`
- Modify:
  - `client/public/js/main.js`: the number filling in `frame()` (~4575–4615), `renderGauge` (~3845), the per-layout canvases in `frame()`, and `updateLayout` (~3743).
  - `client/public/vr.html`, `client/public/js/vr/main.js`: the `.vr-hud` boxes and `hud2d.js` are replaced.
  - `styles.css`, only if the ride rules are scoped to `#ride`.
- Delete: `client/public/js/vr/hud2d.js` and `client/test/vr/hud2d.test.js`.
- Test:
  - `client/test/rideHud.test.js`
  - `client/test/vr/vrHudMarkup.test.js`

**Interfaces:**
- Produces:
  - `rideHudValues(snapshot): Record<string, string|number>`. It is pure and gives the values for every `data-m` key the tablet sets in `frame()` today: `power`, `wkg`, `zone`, `target`, `target-suffix`, `cadence`, `hr`, `speed`, `grade`, `distance`, `avg-speed`, `time`, `intensity`, `next-marker`.
    - `snapshot = { power, cadence, heartRate, me, route, rideDistanceM, elapsedS, target: number|null, intensity, weightKg, ftp }`.
    - Unknown numbers render as `–`, exactly as the tablet does now.
  - `class RideHud { constructor(root: Element, { drawProfile, drawMinimap, drawUpcoming, drawRaceTimeline }); render(snapshot, { layout, riders, myId, standing, colors }): void }`.
    - It sets the `data-m` values through `MetricBinder`, draws the gauge (`renderGauge` moves in here), toggles `on-target` / `off-target`, and draws only the visible layout's canvases.
    - `main.js` calls it each frame. The banner, splits, milestones, recorder, draft pill and race lists stay in `main.js`.
- VR page:
  - `vr.html` contains the `#ride` section's `.hud-info` bar and the four `.layout` blocks, copied from `index.html` with the same markup and ids.
    - It does not contain `.hud-actions`, `.hud-gear`, the junction, the calls, or the studio layout.
    - The `<section>` carries `data-layout`, so the existing CSS shows the right layout.
  - `vr/main.js` builds the snapshot:
    - power, speed and distance from the smoothed host rider (`state`);
    - cadence and heart rate from the latest `display` frame (`hr`, `cadence`);
    - the ride time from `display.stats`;
    - the target from `display.workout.target_w`;
    - FTP from `display.ftp`;
    - the weight from the local profile (or the default).
  - The layout comes from `chooseLayout({ choice: "auto", workoutRunning: Boolean(display.workout), racePhase: state.race?.phase ?? null, inRace })`. The standing comes from `raceStanding`, as on the tablet.

- [ ] **Step 1 (refactor): Write the failing tests.**
  - `rideHudValues`:
    - `fills every metric the tablet shows`: the key set above;
    - `unknown cadence and heart rate show a dash`;
    - `the target suffix is empty without a target`;
    - `grade reads the route at my distance`.
  - `RideHud`:
    - `draws only the visible layout's canvases`: with fakes for the draw functions; cockpit calls `drawUpcoming` only, and broadcast calls `drawProfile` and `drawMinimap`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Move the code and switch `main.js` to `RideHud`.**
  - Behaviour stays the same. The existing tests still pass.
  - Check a ride screenshot against the previous one.
- [ ] **Step 4: Commit** `refactor(client): Share the ride HUD between pages`.
- [ ] **Step 5 (feature): Write the failing tests.**
  - `vrHudMarkup`: `the VR page's HUD layouts match the ride screen's`. It extracts each `.layout-cockpit|broadcast|training|race` block and the `.hud-info` block from both HTML files and compares them after normalising whitespace.
  - `the VR page's HUD has no controls`: no `#pause-ride`, `#shift-up`, `#take-photo` or `#open-menu`.
- [ ] **Step 6: Implement the VR side.** Delete `hud2d.js` and its test.
- [ ] **Step 7: Run the full client checks.** Expected: all pass.
- [ ] **Step 8: Commit** `feat(client): Show the full ride HUD in the headset window`.

### Task 4: Draw the 3D view per view (refactor)

**Files:**
- Modify:
  - `client/public/js/view3d/view3d.js` (`render` 709–905, `#drawWorld` 906)
  - `client/public/js/view3d/renderer.js` (`createContext` 174, `endShadows` 303, `resize` 378, `viewport` 392)
- Test:
  - `client/test/view3d.test.js` (`StubRenderer` ~332, `gymView` ~376)
  - a new `client/test/view3d/renderer.test.js` with a fake `gl` recording calls

**Interfaces:**
- Produces:
  - `#prepareFrame(input): Frame | null`. It does everything in `render` up to and including the shadow pass, except computing `viewProjection`. It returns `null` when there is no camera eye.
  - `#drawView(frame, { viewProjection, eye, forward, rect|null })`. It covers `#drawWorld`, the occlusion probes and the weather.
  - `render()` = prepare, then `#drawView` with the camera's view, then the side view and labels as now. It keeps its signature and output.
  - `Renderer#target(framebuffer: WebGLFramebuffer|null, size: {width, height})`. It sets the framebuffer that `endShadows`, `viewport(null)` and `resize` return to, in place of the hard-coded `null` and canvas size.
  - `createContext(canvas, { xrCompatible = false } = {})`.

- [ ] **Step 1: Write the failing tests.**
  - `renderer`:
    - `endShadows returns to the target framebuffer`: after `target(fb, {width: 100, height: 50})`, `endShadows()` binds `fb` and sets viewport `0,0,100,50`;
    - `viewport(null) returns to the target size`;
    - `createContext passes xrCompatible`.
  - `view3d`: `render draws the same calls as before`. Snapshot the `StubRenderer` call names for the existing `gymView` ride fixture before the refactor: write the test first and run it on the old code, where it passes. It must still pass after the split.
- [ ] **Step 2: Run them.** Expected: the renderer tests FAIL and the snapshot passes.
- [ ] **Step 3: Implement the split.** It moves code; it changes no behaviour.
- [ ] **Step 4: Run the full client checks.** Expected: all pass, the snapshot unchanged.
- [ ] **Step 5: Commit** `refactor(client): Split the 3D view's frame from the views it is drawn into`.

### Task 5: Stereo preview, seat anchor and `renderXr`

**Files:**
- Create:
  - `client/public/js/vr/xrFrame.js` (typedef plus the shared matrix helpers)
  - `client/public/js/vr/previewSource.js`
  - `client/public/js/vr/seatAnchor.js`
- Modify:
  - `client/public/js/view3d/view3d.js` (add `renderXr`)
  - `client/public/js/view3d/studioCamera.js` (export the bob-free pov pose)
  - `client/public/js/vr/main.js`, `vr.html` (the "Preview VR" button, shown with `info.xr_preview`; `?preview=1` starts it)
  - i18n
- Test:
  - `client/test/vr/previewSource.test.js`
  - `client/test/vr/seatAnchor.test.js`
  - `client/test/view3d.test.js`

**Interfaces:**
- Consumes: `#prepareFrame` and `#drawView` (Task 4), `riderPosition` (`view3d/world.js:68`), `studioCamera` (`view3d/studioCamera.js`), `math.js` (`multiply`, `invert`, `perspective`, `placement`).
- Produces:
  - `XrFrame = { timeS, framebuffer: WebGLFramebuffer|null, size: {width, height}, head: Float32Array /*4×4, seated space*/, views: [{ rect: {x,y,width,height}, projection: Float32Array, headFromEye: Float32Array }] }`.
  - `XrFrameSource = { start(onFrame: (frame: XrFrame) => void): Promise<void>, stop(): void, onEnd?: () => void }`.
  - `parseHead(search: string): { yawDeg, pitchDeg, position: [x,y,z] } | null`.
  - `previewFrame({ width, height, timeS, pose }): XrFrame`.
    - It has two views, left half and right half.
    - Each projection is from the per-eye field of view 100° × 96°. The rect's own aspect is used only for letterboxing: draw a centred rect with the field of view's aspect.
    - `headFromEye` is a translation of ∓0.032 m on x.
    - `head` is the yaw (about +Y) and pitch (about X) rotation at `position`.
  - `class PreviewSource` (implements `XrFrameSource`) `constructor({ canvas, schedule = requestAnimationFrame, now, input /* {onDrag(fn), onKey(fn)} */, initial })`.
    - Dragging changes yaw and pitch at 0.25°/px; pitch is clamped to ±80°.
    - The arrow keys change them by 5°. `R` resets to `initial`.
  - `seatAnchor(placed: { position, forward }, { studioPov = null } = {}): Float32Array` (4×4 world-from-seat).
    - On the road, its origin is at `position + up * RIDER_GEOMETRY.headHeight`, and its −Z points along `forward` flattened to the horizontal.
    - In the studio it uses the `studioPov` eye and target.
  - `View3D#renderXr({ riders, myId, myCadence, timeS, colors }, frame: XrFrame)`.
    - It calls `renderer.target(frame.framebuffer, frame.size)` and prepares the frame once.
    - For each view: `eye = anchor · head · headFromEye`, `viewProjection = projection · invert(eye)`, then `#drawView` into `view.rect`.
    - It hides my torso and limbs, updates no labels, and adds no bob.
    - It draws nothing when my rider isn't placed.
    - The lens is `RIDE_LENS`, with shadows off.

- [ ] **Step 1: Write the failing tests.**
  - `parseHead`:
    - `reads yaw and pitch` (`?head=40,-10` gives 40 and −10, position `[0,0,0]`);
    - `reads a position`;
    - `ignores garbage` (null).
  - `previewFrame`:
    - `has two views side by side`: for 800×400, rects with x 0 and 400;
    - `eyes are 64 mm apart` (the `headFromEye` translations differ by 0.064);
    - `the field of view is 100° by 96°` (recover it from the projection: `2*atan(1/p[0])` and `2*atan(1/p[5])`, within 1e-6).
  - `PreviewSource`:
    - `dragging 100 px turns the head 25°`;
    - `pitch stops at 80°`;
    - `R recenters`.
  - `seatAnchor`:
    - `sits at head height above the road position`;
    - `faces along the road on a curve`: `forward` (1,0,0) gives local −Z mapped to world +X;
    - `ignores the road's slope for the facing`;
    - `uses the studio pov without bob` (two `timeS` values, cadence 90, the same anchor).
  - `view3d` (StubRenderer):
    - `renderXr draws every view into its own rect`: two `viewport` calls with the rects, and two world passes;
    - `renderXr prepares the frame once`: the pedal phase advances once per call;
    - `renderXr hides my body but not my bike`;
    - `renderXr draws nothing without my rider` (Review Focus 2).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces above.
  - In `vr/main.js`, "Preview VR" stops the 2D loop and starts `PreviewSource` with `onFrame = (f) => view3d.renderXr(input(), f)`. "Leave preview" or Escape reverses it.
  - In preview, the HUD overlay is hidden; the VR HUD panel comes in Task 7.
- [ ] **Step 4: Run the full client checks.** Expected: all pass.
- [ ] **Step 5: Check by hand.** Screenshot `vr.html?preview=1&head=0,-15` and `…&head=60,0` while the simulated ride runs.
  - Expected: two eye images, the road ahead from the saddle with the bars visible, and the second shot looking to the side.
- [ ] **Step 6: Commit** `feat(client): Preview the VR view in stereo without a headset`.

### Task 6: Immersive WebXR on the Quest

**Files:**
- Create: `client/public/js/vr/webXrSource.js`
- Modify:
  - `client/public/js/vr/main.js`, `vr.html` (the "Enter VR" button, shown when `navigator.xr.isSessionSupported("immersive-vr")` resolves true)
  - the `View3D` construction on the VR page (pass a renderer made with `createContext(canvas, { xrCompatible: true })`)
  - i18n
- Test: `client/test/vr/webXrSource.test.js` with a fake `xr` (session, reference space, frame, pose and views as plain objects; the layer constructor injected)

**Interfaces:**
- Consumes: `XrFrame`, `XrFrameSource` (Task 5).
- Produces: `class WebXrSource` (implements `XrFrameSource`) `constructor({ xr = navigator.xr, gl, Layer = XRWebGLLayer, onEnd })`.
  - **`start`:**
    - `requestSession("immersive-vr", { optionalFeatures: ["local-floor"] })`;
    - `updateRenderState({ baseLayer: new Layer(session, gl) })`;
    - `requestReferenceSpace("local")`.
  - **Each frame:**
    - `views` from `getViewerPose(space).views`: `rect` from `layer.getViewport(view)`, `projection` = `view.projectionMatrix`, `headFromEye` = `invert(pose.transform.matrix) · view.transform.matrix`;
    - `head` = `pose.transform.matrix` with its yaw taken relative to the yaw captured at the first pose;
    - `framebuffer` = `layer.framebuffer`.
  - **Recentering:** the space's `reset` event re-captures the yaw.
  - **Ending:** `stop()` ends the session. The session's `end` event calls `onEnd` once.

- [ ] **Step 1: Write the failing tests.**
  - `asks for an immersive seated session`.
  - `one frame gives one view per XR view with its viewport`.
  - `the head starts facing forward`: first pose yaw 30° gives head yaw 0.
  - `reset recenters`.
  - `the session's end calls onEnd once`.
  - `stop ends the session`.
  - Review Focus 4: in a `vr/main.js`-free helper `xrLoop.js` (`switchToXr(source, { stop2d, start2d })`), `ending the session restarts the 2D loop`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full client checks.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(client): Ride in VR on your own saddle with a Quest headset`.
  - Tell the user it is ready for the Quest test (road, studio, recenter, comfort, frame rate).

### Task 7: The bike computer on the handlebars in VR

**Files:**
- Create: `client/public/js/vr/hudPanel.js`
- Modify:
  - `client/public/js/view3d/pixelFont.js` (add the glyphs the panel needs: `W`, `B`, `P`, `M`, `H`, `R`, `/`, `.`, `:` and the digits that are missing)
  - `view3d.js` (`renderXr` draws the panel's glyph models with `drawBright`)
- Test:
  - `client/test/vr/hudPanel.test.js`
  - `client/test/pixelFont.test.js` (create it if absent)

**Interfaces:**
- Consumes: `hudValues` (Task 3), `powerZone` (`view/hud.js`), `GLYPHS` (`view3d/pixelFont.js`), `ZONE_COLORS` (`view/workoutView.js`).
- Produces:
  - `hudLines(values): [{ text: string, color: [r,g,b] }]`. The lines are:
    - `"250 W"`, coloured by zone;
    - `"92 RPM"`;
    - `"31.2 KM/H"` (or the mph text per the units setting);
    - `"HR 142"` when heart rate is known;
    - `"→ 260 W 2:15"` when a workout runs (target and step time left; `→` is a new glyph).
  - `hudPanelModels(lines, anchor): [{ model: Float32Array, color }]`. It gives one quad model per lit pixel, so the existing glyph mesh is reused.
    - The panel sits 0.6 m ahead of and 0.35 m below the anchor origin, tilted 35° towards the eye.
    - Pixels are 4 mm, lines 40 mm apart, and the panel is centred.
    - It moves with the anchor, not the head.

- [ ] **Step 1: Write the failing tests.**
  - `hudLines`:
    - `shows power in its zone colour`;
    - `leaves heart rate out until it is known`;
    - `adds the workout target`.
  - `hudPanelModels`:
    - `centres the panel ahead of the anchor` (the mean position of the models is within 1 mm of the expected point);
    - `turns with the anchor, not the head` (rotate the anchor 90°, and the centre rotates with it);
    - `one model per lit pixel` (`"1"` gives its glyph's `#` count).
  - `pixelFont`: `has every character the HUD uses`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full client checks, and screenshot** `vr.html?preview=1&head=0,-40`.
  - Expected: a readable panel on the bars, numbers changing between shots.
- [ ] **Step 5: Commit** `feat(client): Show power, cadence and heart rate on the handlebars in VR`.

### Task 8: Pairing UI in the app's style

**Files:**
- Create: `client/public/js/view/codeInput.js`
- Modify:
  - `client/public/index.html` (lines ~420–434: replace the `<details id="screens">` block with a "Second screen" row that opens a `.menu-dialog` panel; the tablet's code view and the claim view live in it)
  - `client/public/js/main.js` (the pairing handlers ~1590–1640; remove `prompt()`)
  - `client/public/cockpit.html` and `vr.html` ("Pair now" button + an inline code entry in place of the `cockpit.notPaired` paragraph)
  - `client/public/js/cockpit/main.js`, `client/public/js/vr/main.js`
  - `client/public/styles.css` (`.screens-code` at ~6570 grows the grouped look and the countdown bar; reuse `.menu-dialog`, `.secondary` and the input rules)
  - i18n (the hint covers phone and headset; the error texts)
- Test:
  - `client/test/codeInput.test.js`
  - `client/test/menuDialog.test.js` (if the panel goes through the existing menu-dialog helper)
  - `client/test/i18nHtml.test.js` runs as is

**Interfaces:**
- Consumes: `claimCode` (`net/screenPairing.js`; its rejection's `code` is `pair_code_invalid`, otherwise a connection failure), `PairingSession`.
- Produces:
  - `CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"`.
  - `cleanCode(text): string`. It upper-cases, drops every character outside the alphabet and keeps the first 6.
  - `groupCode(code): string` (`"ABC DEF"`).
  - `codeEntryState(event, state)`, a reducer over the states `idle` → `connecting` → (`paired` | `invalid` | `offline`) → `idle` on edit.
  - `mountCodeInput(root, { onSubmit: (code) => Promise })`. It builds six inputs, handles moving focus, Backspace and paste, auto-submits on the 6th character, and shows the state text in a `role="status"` element.
  - `countdownShare(expiresAtS, nowS, ttlS = 300): number` in [0, 1], for the bar.

- [ ] **Step 1: Write the failing tests.**
  - `cleanCode` (Review Focus 5):
    - `upper-cases`;
    - `drops spaces and dashes` (`"abc-def"` gives `"ABCDEF"`);
    - `drops look-alikes` (`"O0I1L"` gives `""`);
    - `keeps the first six`.
  - `groupCode splits three and three`.
  - `codeEntryState`:
    - `submitting goes to connecting`;
    - `pair_code_invalid goes to invalid`;
    - `a connection failure goes to offline`;
    - `editing after an error goes back to idle`.
  - `countdownShare`:
    - `is 1 at issue and 0 at expiry`;
    - `never goes below 0`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The tablet's code view shows the grouped code, the countdown bar, "Waiting for a screen…", then "Paired" on `pair_claimed` (the device name comes in Task 9), and "New code" on expiry.
  - The panel lists "Pair a new screen", "Unpair all" (with a confirmation), "Use this device as a cockpit" and "Use this device as a VR display".
- [ ] **Step 4: Run the full client checks.** Expected: all pass.
- [ ] **Step 5: Screenshot and compare.** Shoot the panel, the code view and the code entry at 390×844 and 1280×800 (the app at 1×). Compare them with an existing `.menu-dialog` screen in the same shots: the same fonts, buttons, spacing and centring.
- [ ] **Step 6: Commit** `feat(client): Pair second screens in a dialog that looks like the rest of the app`.

### Task 9: The list of paired screens

**Files:**
- Modify:
  - Server:
    - `protocol.rs` (`PairClaim` ~148 and `Watch` ~152 gain `#[serde(default)] device: Option<String>`; `PairClaimed` ~344 gains `device: Option<String>`; new `ClientMessage::ScreensQuery { key }`; new `ServerMessage::ScreensWatching { devices: Vec<String> }`)
    - `session.rs` (`ScreensQuery` is allowed in `AwaitingJoin`, like `PairOffer` ~310)
    - `pair_codes.rs` (it carries the claimant's device to the offering connection)
    - `screens.rs` (watchers keep a `device`; `watching(key) -> Vec<String>`; the host gets `ScreensWatching` pushed when watchers change)
    - `docs/protocol.md`
  - Client:
    - `client/public/js/net/protocol.js` (`pairClaim(code, device)`, `watch(key, view, device)`, `screensQuery(key)`, the server types `screens_watching`)
    - `net/screenPairing.js`
    - `cockpit/cockpitConnection.js` (it sends `device`)
    - `main.js` (the list in the panel)
    - i18n
- Create:
  - `client/public/js/net/deviceName.js`
  - `client/public/js/net/pairedScreens.js`
- Test:
  - the `protocol.rs`, `pair_codes.rs` and `screens.rs` tests;
  - `tests/websocket_flow.rs`;
  - `client/test/deviceName.test.js`, `client/test/pairedScreens.test.js`, `client/test/screenPairing.test.js`.

**Interfaces:**
- Produces:
  - Server:
    - `device` is trimmed and cut to 40 characters; it is never stored past the connection or code lifetime, and never logged.
    - `ScreensQuery { key }` gets one `ScreensWatching { devices }` (empty for an unknown key, and never an error, so key holders learn nothing new).
    - While a host rides, `ScreensWatching` goes to the host on every watcher arrival or departure. It is not relayed to watchers.
  - Client:
    - `deviceName(userAgent: string): string`:
      - `"Quest 3"` / `"Quest"` for `OculusBrowser` (with `Quest 3` in the UA when present);
      - `"iPhone"`, `"iPad"`, `"Android phone"`, `"Android tablet"` (Android without `Mobile`);
      - otherwise `"Browser"`.
    - `class PairedScreens { constructor(storage); list(): [{ device, pairedAt }]; add(device, nowMs); clear() }`, stored under `openradlr.pairedScreens`. At most 20 entries; the oldest drop.
    - `liveDevices(list, watching: string[]): Set<number>` gives the indexes that are live. Equal names are all live; that is accepted.
    - `PairingSession` emits `claimed` with `{ device }`, and gains `query()`, which emits `watching` with `devices`.

- [ ] **Step 1: Write the failing tests.**
  - Server:
    - `a claim's device reaches the tablet`;
    - `device names are cut to 40 characters`;
    - `screens_query lists the connected watchers`;
    - `screens_query on an unknown key is empty`;
    - `the host hears when a watcher arrives and leaves`;
    - an e2e: tablet pairs, phone claims with `device: "Pixel 8"`, tablet gets `pair_claimed { device: "Pixel 8" }`.
  - Client:
    - `deviceName`: `knows the Quest 3`, `knows an Android phone from a tablet`, `falls back to Browser`;
    - `PairedScreens`: `adds with the date`, `clear empties it`, `keeps 20`;
    - `liveDevices marks every entry with a watching name`;
    - `screenPairing`: `claimed carries the device`, `query asks with the key and emits watching`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The panel lists the paired screens: the device name, the date paired (locale format) and a "live" dot. It shows "No screens paired yet" when the list is empty.
  - "Unpair all" also clears `PairedScreens`.
  - Opening the panel sends `screens_query` over the pairing connection.
- [ ] **Step 4: Run the server and client checks.** Expected: all pass.
- [ ] **Step 5: Screenshot** the panel with two entries, one live (cockpit open in a second page).
- [ ] **Step 6: Commit** `feat: See which screens are paired with your tablet and which are live`.

### Task 10: Screenshots of the VR preview, and the docs

**Files:**
- Modify:
  - `client/screenshot.mjs` (a `--ride` option: the first page starts a ride with the simulated trainer and pairs; the second page claims the code and opens the given URL, e.g. `vr.html?preview=1&head=30,-10`)
  - `Makefile` (only if `ARGS` passing needs it)
- Create:
  - `docs/adr/0027-vr-display-as-a-world-watcher.md`
  - `docs/vr.md`
- Modify: `AGENTS.md` (the UI verification section: the preview recipe; "There are 28 so far" for ADRs), `docs/app.md` (a link to `docs/vr.md`)

**Interfaces:**
- Consumes: `window.openradlrVr` (Task 3), the start menu ids, `#screens-*` (Task 8).

- [ ] **Step 1: Implement `--ride`.**
  - It drives the real UI: pick the simulated trainer, start, open the second-screen panel, read the code, claim it on page 2 via the code entry, then open the target URL.
  - It waits for the `vr-live` state (a `data-live` attribute on `<body>` set by `vr/main.js`), not a fixed time.
- [ ] **Step 2: Check it.** Run `make screenshot ARGS="--ride vr.html?preview=1&head=0,-20 --out vr.png"` with the Playwright image recipe.
  - Expected: the stereo saddle view with the HUD panel.
  - Also shoot the studio: `--ride` with a studio class, if the start menu allows that headlessly; otherwise note it in `docs/vr.md` as a manual step.
- [ ] **Step 3: Write the docs.**
  - The ADR (context: relay from ADR 0026; decision: world watcher page plus injected `XrFrameSource`, preview behind `OPENRADLR_XR_PREVIEW`, no camera motion; consequences: the per-view split in `View3D`, no labels in VR).
  - `docs/vr.md`: using it on the Quest (pair, open, Enter VR, recenter) and the developer preview.
  - AGENTS.md.
- [ ] **Step 4: Run the full server and client checks.** Expected: all pass.
- [ ] **Step 5: Commit** `docs: Explain the VR display and how to preview it without a headset`.

## After the last task

- Run the whole branch review, then use superpowers:finishing-a-development-branch.
- The PR goes against `feat/cockpit` until #88 merges, then rebase onto `main`.
  - The PR body has screenshots via the `pr-screenshots` branch.
  - Assign RalfLeonFasler; never merge.
- Quest checks for the user: the floating window; Enter VR on the road and in the studio; recenter; comfort on turns; the frame rate (72 Hz target); whether 4 Hz smoothing is smooth enough for my own bike.
