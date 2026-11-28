# Roadside Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Billboards beside the road in the Three.js world: funny motivational default posters, push boards on climbs and in the last km, goal boards from the season goals, and the rider's own uploads (local only).

**Architecture:** The world builder plans fixed board sites per ridden route (pure placement data, `world.boards`). A board layer draws all frames instanced and all static posters from one atlas texture. Posters are chosen and painted on the main thread (canvas) per screen; uploads live in a per-rider IndexedDB and never leave the device. Goal boards come from a pure planner fed at ride start and are anchored ahead of the rider by the view, like the lemons.

**Tech Stack:** Plain ES modules, Three.js (vendored `js/three.js`), node:test with fakes, Canvas 2D (OffscreenCanvas or `<canvas>`), IndexedDB via `ride/rideAutosave.js indexedDbStore`.

**Spec:** `docs/superpowers/specs/2026-11-27-roadside-boards-design.md`

## Global Constraints

- Branch `feat/roadside-boards` (base `feat/polished-world`). One PR, ordered commits, Conventional Commit messages with imperative descriptions (`feat(client): …`).
- TDD: each task starts with a failing test (CONTRIBUTING.md): one reason to fail per test, no sleeps, time/RNG/I/O injected.
- Assets (`view3d/assets/`) never touch the document; canvas painting lives outside `assets/` and gets a canvas factory injected.
- Every new world field that crosses the worker must be added to `sceneOf` in `view3d/worldScene.js`.
- UI text only through `js/i18n/en.js` + `de.js` (parity test `i18nParity.test.js`).
- Density: general boards ~1 per 7–10 km of route, at least 2 per loop, at least 3 km apart; climb boards on climb markers with `length >= 1500` (one ~150 m before the top, a second at the climb's middle when `length >= 2500`), clear of arches/banners by `BANNERS.clearOfArchM` (60 m); one lastKm board 600–900 m before the start/finish (loop: before `route.length`; point-to-point: before the route's end).
- Uploads: max 12 per rider; pictures downscaled to 1024×512 and re-encoded (JPEG 0.85); stored in IndexedDB `riderDbName("openradlr-boards", riderId)`; never in `backupSnapshot`, `exportData`, WebSocket messages; deleted with the rider and with "everything".
- Upload posters get a red bar along the bottom (12 % of the poster height, the text bold at 0.75 of the bar, colour `#d62828`) with "Your upload" / "Dein Upload" in white, painted in; default posters carry no marker.
- Uploads show only in the ride view; the menu drone view shows default posters only and no goal boards. No goal boards in a race or an entered event (same rule as `hudGoal`'s `racing`).
- Draw calls: the board layer adds at most 4 at Low (frames 1, static posters 1, goal posters 1).
- Run client tests and lint per the dev-machine rule (Docker `node:22-alpine`, see `~/.claude/CLAUDE.md`); `make check` before claiming done.

## Review Focus

1. **A rider who switches routes at a junction (shared tracks, ADR 0027) mid-ride** must not see goal boards jump or stand on the wrong road: goal boards are anchored on the route the rider is on when they come into reach (Task 6 test "anchors on the current route and drops a board when the rider leaves it").
2. **A broken or huge uploaded file** (corrupt JPEG, 40 MB HEIC the browser can't decode, a 10000×200 panorama) must fail with a message and store nothing, never throw out of the page or store a full-size image (Task 7 tests "rejects an image the browser cannot decode" and "a panorama is cropped, not squashed").
3. **A short loop (< 7 km) or a route without climbs or a start/finish marker** still gets sensible boards: at least 2 general boards on a loop longer than 3 km, none on routes under 1 km, lastKm before the end on point-to-point (Task 1 tests).
4. **A rider who already met this week's step, or whose goal is time/climb while stopped**, sees no goal board and no flicker (Task 6 tests "no board for a reached step" and "no projection while stopped").
5. **Deleting a rider or "everything" while uploads exist** removes the boards database too, and the data page counts uploads (Task 7 test on `deleteItem("everything")` and `riderDbNames`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `client/public/js/view3d/boards.js` (new) | Pure board placement: `boardSites`, `boardClearings`, `placeBoards`, `BOARD` constants |
| `client/public/js/view3d/world.js` (modify) | Plan board clearings before plants, place boards, return `world.boards` |
| `client/public/js/view3d/worldScene.js` (modify) | `sceneOf` passes `boards` |
| `client/public/js/view3d/assets/props/billboard.js` (new) | Billboard frame geometry and the poster rectangle |
| `client/public/js/view3d/posters/lines.js` (new) | The default poster pool: ids, kind, art, i18n keys |
| `client/public/js/view3d/posters/choose.js` (new) | Pure: which poster on which site, atlas slots |
| `client/public/js/view3d/posters/art.js` (new) | Flat illustrations drawn on a 2D context |
| `client/public/js/view3d/posters/paint.js` (new) | Paints default, upload and goal posters and the atlas |
| `client/public/js/view3d/scene/boardLayer.js` (new) | Frames + atlas posters + goal posters, night glow |
| `client/public/js/view3d/scene/worldScene.js` (modify) | Register layer; `setBoardPosters`, frame `goalBoards` |
| `client/public/js/view3d/view3d.js` (modify) | `setBoardPosters`, `setGoalBoards`, per-frame anchoring |
| `client/public/js/ride/goalBoards.js` (new) | Pure goal-board planner, projection and anchoring |
| `client/public/js/profile/myBoards.js` (new) | Uploads store (per rider), cap, downscale |
| `client/public/js/profile/localData.js` (modify) | `boards` data item: count + delete; never exported/backed up |
| `client/public/js/view/boardCrop.js` (new) | Pure crop math for the 2:1 frame |
| `client/public/js/view/myBoardsView.js` (new) | Profile > My boards page lines and wiring helpers |
| `client/public/index.html`, `styles.css`, `main.js`, `view/profilePage.js`, `view/menuStage.js` (modify) | Page markup, wiring |
| `client/public/js/i18n/en.js`, `de.js` (modify) | All copy below |
| `docs/adr/0036-roadside-boards.md`, `docs/boards.md` (new) | ADR and feature note (check the next free ADR number first) |

---

### Task 1: Board sites (pure placement) and `world.boards`

**Files:**
- Create: `client/public/js/view3d/boards.js`
- Modify: `client/public/js/view3d/world.js` (clearings into `planWorld`, placement after the café block, `boards` in the return), `client/public/js/view3d/worldScene.js` (`sceneOf`)
- Test: `client/test/boards.test.js`

**Interfaces:**
- Produces:
  - `BOARD = { width: 6, height: 3, setback: 5, clearing: 7, angle: 0.35 }` (poster metres, metres from the verge edge to the board's centre, clearing radius, radians the face turns toward oncoming riders).
  - `boardSites(route, { villages = [] }) → { kind: "general"|"climb"|"lastKm", distance: number }[]` sorted by distance, from route geometry, markers and village zones alone (deterministic, no seed needed beyond `route.seed`).
  - `boardClearings(route, sites) → {x, z, radius}[]` for `planWorld`'s `clearings`.
  - `placeBoards(route, terrain, sites, { occupancy, avoid }) → { kind, distance, position: number[3], yaw: number }[]`; a site `avoid` rejects is dropped; each placed board claims `occupancy.add(x, z, BOARD.clearing)`. Boards stand on the right of the riding direction; `yaw` turns the poster's front (+z of the asset) toward riders approaching, `BOARD.angle` off square to the road.
  - `world.boards` = that array (empty when the route has none); passed by `sceneOf`.

General-site rule (left to the implementer within it): candidates every 100 m, scored by straightness of the next 300 m (`roadFrame` forward dot product) plus a bonus within 150 m of a village zone's ends; never inside a village zone; greedy pick by score with spacing ≥ `min(3000, route.length / 2)` (measured around the loop on loops) and ≥ 300 m from climb/lastKm sites and arches; count = `max(route.loop ? 2 : 0, round(route.length / 8500))`, none when `route.length < 1000`.

- [ ] **Step 1: Write the failing tests** (`straight(points, markers, loop)` helper as in `features.test.js`)

```js
test("a 20 km loop gets two or three general boards at least 3 km apart", () => {
  const sites = boardSites(loop20km(), {}).filter((s) => s.kind === "general");
  assert.ok(sites.length >= 2 && sites.length <= 3, `${sites.length} general boards`);
  for (let i = 1; i < sites.length; i += 1) assert.ok(sites[i].distance - sites[i - 1].distance >= 3000);
});
test("a climb of 1.5 km gets one board 150 m before the top, one of 2.5 km a second at its middle", () => {
  const route = straight(flat(6000), [{ type: "climb", distance: 1000, length: 1500 }, { type: "climb", distance: 3000, length: 2600 }]);
  const climbs = boardSites(route, {}).filter((s) => s.kind === "climb").map((s) => s.distance);
  assert.deepEqual(climbs, [2350, 4300, 5450]);
});
test("a climb under 1.5 km gets no board", () => { /* length 1400 → no climb site */ });
test("the last-km board stands 600-900 m before the end of a loop and of a point-to-point route", () => { /* both cases */ });
test("routes under 1 km get no boards", () => {});
test("no general board inside a village", () => {});
test("placed boards stand beside the road, face oncoming riders and claim their ground", () => {
  // position is roadHalfWidth + VERGE + BOARD.setback off the centre line on the right; dot(face normal, -forward) > cos(BOARD.angle + 0.01); occupancy.blocked(x, z, 1) is true after.
});
test("a site the world avoids is dropped", () => {});
```

Also extend the existing `sceneOf` test (or add one in `boards.test.js`) asserting `sceneOf({ ...world, boards: [b] }).boards` is `[b]`.

- [ ] **Step 2: Run** `node --test test/boards.test.js` (in the Docker node container, from `client/`). Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `boards.js`, then wire `world.js`: `boardClearings(route, boardSites(route, { villages: zonesOf.get(route).villages }))` joins the `clearings` list passed to `planWorld`; after the café/gym loop, `const boards = placeBoards(route, terrain, sites, { occupancy, avoid })`; return `boards`. Skip arch distances via `archPlacements(route)` distances.
- [ ] **Step 4: Run** the test file, then the whole client suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): Plan billboard sites beside the ridden road`

---

### Task 2: Billboard asset

**Files:**
- Create: `client/public/js/view3d/assets/props/billboard.js` (export from `assets/props/index.js` like the other props so the workbench lists it)
- Test: `client/test/billboard.test.js`

**Interfaces:**
- Produces: `billboardFrame({ detail: boolean }) → THREE.BufferGeometry` (vertex colours, merged: two posts, a back panel, a frame lip around the poster; with `detail` also a walkway rail and a small lamp housing over the top edge), origin at ground centre, poster front facing +z. `POSTER = { width: 6, height: 3, lift: 2.2, inset: 0.05 }` (bottom edge height, how far in front of the back panel the poster plane sits). `posterQuad(uv: [u0, v0, u1, v1]) → { positions: Float32Array(12), uvs: Float32Array(8), index: [0,1,2,0,2,3] }` in the asset's local space.

- [ ] **Step 1: Failing tests:** frame bounding box is 6.3 ± 0.2 m wide, top at `POSTER.lift + POSTER.height + 0.15 ± 0.1`; `detail: false` has fewer vertices than `detail: true`; `posterQuad([0, 0.5, 0.5, 1])` corners lie at x = ±3, y = 2.2 and 5.2, z = `POSTER.inset`, uvs as given.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with `assets/geom.js` `box`/`merge` and the biome-free palette (posts `pole`, panel dark grey, frame white-ish).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Add a billboard asset`

---

### Task 3: Poster pool and choice

**Files:**
- Create: `client/public/js/view3d/posters/lines.js`, `client/public/js/view3d/posters/choose.js`
- Modify: `client/public/js/i18n/en.js`, `de.js` (keys `boards.line.<id>`)
- Test: `client/test/posterChoice.test.js`

**Interfaces:**
- Produces:
  - `POSTERS: readonly { id: string, kind: "general"|"climb"|"lastKm", art: "lemon"|"glass"|"cheers"|"rider"|"hill"|"flag" }[]` — the list below, text via `t("boards.line." + id)`.
  - `ATLAS_SLOTS = 8`.
  - `choosePosters(boards, { routeId: string, uploads: { id: string }[], dateKey: string }) → { slots: ({ type: "default", id } | { type: "upload", id })[], slotOf: number[] }` — `slotOf[i]` is board `i`'s slot. Rules: general boards in distance order take uploads first (uploads ≤ general boards: in stored order; more: a rotation seeded by `routeId + dateKey` picks which); remaining boards get defaults of their kind seeded by `routeId` + board index, no default twice in a row; at most `ATLAS_SLOTS` distinct slots — beyond, boards reuse slots of the same kind. Pure, uses `world/noise.js seededRandom`.

Copy (owner reviews and cuts before merge; ids → en / de):

| id | kind | art | en | de |
|----|------|-----|----|----|
| halfLegend | general | lemon | Half lemon. Half legend. | Halb Zitrone. Halb Legende. |
| painRadler | general | glass | Pain is temporary. Radler is forever. | Schmerz vergeht. Radler bleibt. |
| notThereYet | general | glass | The Radler is cold. You're not there yet. | Das Radler ist kalt. Du bist noch nicht da. |
| pedalPour | general | cheers | Pedal now, pour later. | Erst treten, dann zapfen. |
| lifeLemons | general | lemon | When life gives you lemons, ride faster. | Gibt dir das Leben Zitronen, fahr schneller. |
| legsCalled | general | rider | Your legs called. They want more. | Deine Beine haben angerufen. Sie wollen mehr. |
| forecast | general | rider | Today: 100 % sweat, 0 % excuses. | Heute: 100 % Schweiß, 0 % Ausreden. |
| mixFun | general | cheers | Like a Radler: half effort, half fun. | Wie ein Radler: halb Mühe, halb Spaß. |
| lemonProud | general | lemon | You're doing great. The lemon is proud. | Du machst das super. Die Zitrone ist stolz. |
| everyKm | general | glass | Every km makes the Radler taste better. | Jeder Kilometer macht das Radler besser. |
| sofaZero | general | rider | Sofa 0 : You 1 | Sofa 0 : Du 1 |
| freshStrong | general | cheers | Fresh as a lemon. Strong as a stout. | Frisch wie eine Zitrone, stark wie ein Bock. |
| noRegret | general | hill | Nobody regrets a ride. Except uphill. Briefly. | Keiner bereut eine Fahrt. Außer bergauf. Kurz. |
| squeezeOn | general | lemon | Keep calm and squeeze on. | Ruhig bleiben, weiter auspressen. |
| believes | general | lemon | This board believes in you. | Diese Tafel glaubt an dich. |
| zestMode | general | lemon | Zest mode: ON | Zitronenmodus: AN |
| squeeze | climb | lemon | Squeeze the lemon! | Quetsch die Zitrone! |
| gravity | climb | hill | Gravity is just a suggestion. | Schwerkraft ist nur ein Vorschlag. |
| topView | climb | glass | The top has the view. And the Radler. | Oben gibt's die Aussicht. Und das Radler. |
| ambition | climb | hill | Hills are flat roads with ambition. | Berge sind flache Straßen mit Ehrgeiz. |
| almost | climb | hill | Almost there. Probably. | Fast oben. Wahrscheinlich. |
| sourSweet | climb | lemon | Sour now, sweet at the top. | Jetzt sauer, oben süß. |
| lemonadeUp | climb | glass | Climb like the lemonade is up there. | Kletter, als wäre oben Limo. |
| emptyGlass | lastKm | glass | Last km. Empty the glass! | Letzter Kilometer. Glas leeren! |
| sprintWarm | lastKm | flag | SPRINT! The Radler is getting warm. | SPRINT! Das Radler wird warm. |
| allOut | lastKm | rider | Everything left. Now. | Alles raus. Jetzt. |
| legsKnow | lastKm | flag | Finish ahead. Legs, you know what to do. | Ziel voraus. Beine, ihr wisst Bescheid. |
| lastDrop | lastKm | lemon | Squeeze out the last drop! | Den letzten Tropfen rauspressen! |
| lastOrders | lastKm | cheers | Last orders: full gas! | Letzte Runde: Vollgas! |

- [ ] **Step 1: Failing tests:** every `POSTERS` id has en and de text; each kind has ≥ 6 posters; same input → same output; 3 uploads and 4 general boards → the first 3 general boards (by distance) are those uploads in order and the 4th a general default; 5 uploads and 2 general boards → 2 different uploads, and a different `dateKey` can pick a different pair (find one within 10 keys); climb boards only get climb posters; 20 boards → `slots.length <= 8` and every `slotOf` points to a slot of the board's kind (uploads count as general).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** (incl. `i18nParity`).
- [ ] **Step 5: Commit** `feat(client): Write the billboard posters and choose one per board`

---

### Task 4: Poster painting

**Files:**
- Create: `client/public/js/view3d/posters/art.js`, `client/public/js/view3d/posters/paint.js`
- Modify: `en.js`/`de.js` (`boards.yourUpload`: "Your upload" / "Dein Upload")
- Test: `client/test/posterPaint.test.js` (a recording fake 2D context: records `fillText`, `fillRect` with current `fillStyle`, `drawImage`)

**Interfaces:**
- Consumes: `POSTERS`, `ATLAS_SLOTS` (Task 3).
- Produces:
  - `drawArt(ctx, art, { x, y, size })` — flat shapes, one function per art id.
  - `paintPoster(ctx, poster, { width, height })` where `poster` is `{ type: "default", id }` | `{ type: "upload", image?: CanvasImageSource, text?: string }` | `{ type: "goal", text: string }`. Default: background colour per kind (general lemon yellow `#ffd23f`, climb teal `#1b998b`, lastKm red-orange `#f46036`), art on the left third, text wrapped right (bold `system-ui`, auto-sized to fit, max 3 lines). Upload: image fills (cover), text over a dark band if both, then the red bar + `t("boards.yourUpload")`. Goal: white text on deep blue `#22356f` with a small lemon.
  - `paintAtlas(createCanvas, slots, { slotWidth, slotHeight, uploadsById: Map }) → canvas` — slots in a 2-column grid, slot `i` at column `i % 2`, row `i >> 1`; `slotUv(i) → [u0, v0, u1, v1]` for the fixed 2 × 4 grid of `ATLAS_SLOTS` (row 0 at the top, so v from 1 down).
  - `createCanvas(width, height)` default factory: `OffscreenCanvas` if defined, else `document.createElement("canvas")` (only in `paint.js`'s browser default, injected everywhere else).

- [ ] **Step 1: Failing tests:** an upload poster paints a `fillRect` with `#d62828` covering the bottom 12 % and a `fillText` of "Your upload"; a default poster paints its line's text (joined across wrapped lines) and never "Your upload"; a goal poster paints its given text; long text never draws wider than the text box (fake `measureText` = 0.6 × font px × chars); `slotUv(3)` is `[0.5, 0.5, 1, 0.75]` and `slotUv(0)` is `[0, 0.75, 0.5, 1]`; `paintAtlas` with 3 slots calls `paintPoster` area for each slot (3 `drawImage`/paint regions within bounds).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(client): Paint the billboard posters`

---

### Task 5: Board layer in the world scene

**Files:**
- Create: `client/public/js/view3d/scene/boardLayer.js`
- Modify: `client/public/js/view3d/scene/worldScene.js` (maker `boards`, push after `furniture`, include in the quality `rebuild` list, `setBoardPosters`), `client/public/js/view3d/quality.js` (key `boards: { atlas: 1024|2048, detail: bool }`: low `{atlas: 1024, detail: false}`, medium `{2048, true}`, high/ultra `{2048, true}`), `client/public/js/view3d/view3d.js` (`setBoardPosters(canvas, slotOf)` forwards; frame field `goalBoards`)
- Test: `client/test/boardLayer.test.js`

**Interfaces:**
- Consumes: `world.boards` (Task 1), `billboardFrame`, `posterQuad`, `POSTER` (Task 2), `slotUv` (Task 4).
- Produces:
  - `createBoardLayer(world, { settings, uniforms, track })` with `object` (Group named `"boards"`), `setPosters(atlas: CanvasImageSource, slotOf: number[], slotCount: number)`, `setGoalPosters(canvas: CanvasImageSource)` (2 goal posters side by side, slot 0 left, 1 right), `update(frame)` reading `frame.goalBoards: { position, yaw, slot: 0|1 }[]` (≤ 2), `setEnvironment(env)` (poster `emissiveIntensity = 0.1 + 0.6 * night`, as `furnitureLayer`'s GLOW), `stats() → { boards, goal }`, `dispose()`.
  - Meshes: `"board-frames"` InstancedMesh with capacity `boards.length + 2` (the last two for goal boards, hidden by zero scale until used); `"board-posters"` one merged mesh of all static poster quads using the atlas (before `setPosters`: a plain cream `#f4ecd8` material); `"goal-posters"` a 2-instance mesh (or merged pair) with `count` 0..2. No mesh at all when `world.boards` is empty and no goal boards are possible (menu: still create the goal mesh only on the ride view's request — simplest: always create, `count = 0`).
  - `worldScene.setBoardPosters(atlas, slotOf, slotCount)` and `worldScene.setGoalPosters(canvas)`; posters re-sent to a rebuilt layer (like `highlightBands`).

- [ ] **Step 1: Failing tests:** 3 boards → `board-frames` has 3 visible instances at their positions/yaws; the static poster mesh has 3 quads whose uvs match `slotUv(slotOf[i])` after `setPosters`; `frame.goalBoards` with 2 entries shows 2 goal posters and 5 frame instances, then `[]` hides them; night 1 → emissiveIntensity 0.7; layer adds ≤ 3 draw-call meshes (count `isMesh` children that are visible); `dispose` leaves the tracker empty (same pattern as `furnitureLayer.test.js`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, add the quality key and its freeze in `quality.js`, register the layer.
- [ ] **Step 4: Run** test + whole client suite, expect PASS.
- [ ] **Step 5: Commit** `feat(client): Draw billboards and their posters in the 3D world`

---

### Task 6: Goal boards

**Files:**
- Create: `client/public/js/ride/goalBoards.js`
- Modify: `en.js`/`de.js`, `client/public/js/view3d/view3d.js` (`setGoalBoards(planned)`, per-frame anchoring into `frame.goalBoards`), `client/public/js/main.js` (at ride start, after `goalEntries` is available: plan, paint the 2 goal posters as needed, hand to the view; skip in a race/event)
- Test: `client/test/goalBoards.test.js`

**Interfaces:**
- Consumes: `goalWeek` entries `{ goal, week }` as `main.js goalEntries(now, null)` returns them (`week.step`, `week.soFar`, `week.done`, `week.finished`, `week.reached`; `goal.kind` total|long|lap, `goal.metric` distance|time|climb, `goal.routeId`).
- Produces:
  - `planGoalBoards(entries, { routeId: string|null, routeLength: number, loop: boolean }) → GoalBoard[]` where `GoalBoard = { id: string, text: string, at: { rideM: number } | { lapM: number } | { pending: { metric: "time"|"climb", remaining: number } } }`. Rules: total+distance: `remaining = step − soFar`; at `rideM = remaining` text `t("boards.goal.weekDone", {amount})`, and at `remaining − 2000` (only if ≥ 500) `t("boards.goal.weekSoon", {left: "2 km", amount})`. long+distance: `lead = min(5000, 0.1 * step)`; at `step − lead` `boards.goal.longSoon` and at `step` `boards.goal.longDone`. lap on `routeId`: `lapM = routeLength − 400` text `boards.goal.lap` with `{time}`. time/climb metrics: one `pending` board with `remaining` in seconds / metres, text `weekDone`/`longDone`. Skip entries with `done`, `reached`, `finished` or `step === null`.
  - `resolvePending(board, { distanceM, durationS, elevationGainM, speedMps }) → number|null` — the ride distance where the pending amount is reached; `null` when `speedMps < 1`; time: `distanceM + (remaining − durationS) * speedMps`; climb: rate = `elevationGainM / max(distanceM, 500)` metres per metre, `null` if rate < 0.002.
  - `anchorGoalBoards(planned, anchored: Map, { rideM, routeId, routeDistance, routeLength, loop }, { reach = 1500, behind = 50, max = 2 }) → { routeId, distance }[]` — a board whose ride distance is within `reach` ahead gets anchored once at `routeDistance + (board.rideM − rideM)` (wrapped on loops) on the current route; anchored boards on another route than the rider's are dropped from the frame (and from `anchored`); passed by more than `behind` → dropped for good. `lapM` boards anchor on every lap when within reach. At most `max` returned, nearest first.
  - `view3d.setGoalBoards(planned)` / the view converts anchored `{routeId, distance}` with `roadFrame` into `{ position, yaw, slot }` like the static boards (right side, same setback).

Copy: `boards.goal.weekDone` "Week done! {amount} ✓" / "Woche geschafft! {amount} ✓"; `boards.goal.weekSoon` "{left} to your weekly {amount}" / "Noch {left} bis zu deinen {amount} der Woche"; `boards.goal.longSoon` "{left} to your long ride" / "Noch {left} bis zur langen Ausfahrt"; `boards.goal.longDone` "Long ride done ✓" / "Lange Ausfahrt geschafft ✓"; `boards.goal.lap` "Beat {time} this lap" / "Schlag {time} in dieser Runde". Amounts via the formatters `goalsView.js` uses.

- [ ] **Step 1: Failing tests:** week total 80 km, soFar 62 km → boards at 18000 and 16000 m; remaining 1200 m → only the 1200 m board; long step 50 km → 45000 and 50000 m; long step 20 km → 18000 and 20000; lap goal on another route → none; "no board for a reached step" (done/reached/finished → `[]`); time pending: 30 min left at 8 m/s, 10 km ridden, 10 min elapsed → `resolvePending` = 10000 + 1200 × 8 = 19600; "no projection while stopped" (speed 0.5 → null); anchoring: a board 2000 m ahead is not anchored, at 1400 m it anchors at `routeDistance + 1400`, then moving 100 m keeps the same anchor; on a loop of 5000 m anchoring from route distance 4500 with gap 1000 gives 500; "anchors on the current route and drops a board when the rider leaves it"; never more than 2.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `goalBoards.js`; then the view: keep `#goalAnchors` Map, call `anchorGoalBoards` each frame with my rider's `route`/`distance` and the ride distance from the last `setGoalRide({ rideM, durationS, elevationGainM, speedMps })` (main.js calls it with the recorder summary at the same 1 s cadence as `liveGoals`), resolve pending boards there; main.js paints the goal canvas (`paintPoster` type goal, 2 slots) when the planned list is set, and calls nothing in a race/event.
- [ ] **Step 4: Run** the test file and the full client suite, expect PASS.
- [ ] **Step 5: Commit** `feat(client): Put up boards where this week's goal is reached`

---

### Task 7: My boards store and data handling

**Files:**
- Create: `client/public/js/profile/myBoards.js`
- Modify: `client/public/js/profile/localData.js` (`DATA_ITEMS` gains `"boards"`; `COUNTS.boards`, `STORE_OF.boards = "boards"`; `exportData` and `backupSnapshot` unchanged — they must not read `stores.boards`), `client/public/js/ride/rideStores.js` (`boards: new MyBoards({ store: store("openradlr-boards") })`), `client/public/js/main.js` (`riderDbNames` adds `"openradlr-boards"`), `view/deleteConfirm.js` + i18n (`profilePage.delete.boards.*`, `profilePage.data.boards`)
- Test: `client/test/myBoards.test.js`, extend `client/test/localData.test.js` (or the file holding `backupSnapshot` tests) and `deleteConfirm.test.js`

**Interfaces:**
- Produces:
  - `MAX_BOARDS = 12`, `UPLOAD_SIZE = { width: 1024, height: 512 }`.
  - `class MyBoards { constructor({ store, now = Date.now }) ; list() → Promise<{ id, text, blob: Blob|null, crop, addedAt }[]> (oldest first); add({ blob?: Blob, text?: string }) → Promise<{ ok: true, id } | { ok: false, reason: "full"|"empty"|"tooLong" }>; remove(id) → Promise<void> }` — `text` trimmed, max 80 chars (`tooLong`), at least one of blob/text (`empty`).
  - `prepareImage(file: Blob, crop: { x, y, scale }, { decode, createCanvas }) → Promise<{ ok: true, blob } | { ok: false, reason: "unreadable" }>` — `decode` defaults to `createImageBitmap`; draws the cropped region into a 1024×512 canvas and re-encodes JPEG 0.85 (`convertToBlob` or `toBlob`); a decode rejection → `unreadable`.
  - Store items keyed by id; `id` = `b-${now()}-${counter}`.

- [ ] **Step 1: Failing tests:** add/list/remove round trip on an in-memory store fake; 13th add → `full`; empty → `empty`; 81 chars → `tooLong`; "rejects an image the browser cannot decode" (`decode` rejects → `unreadable`, nothing stored); "a panorama is cropped, not squashed" (10000×200 source, crop scale 1 → `drawImage` source rect has aspect 2:1 and the target is 1024×512); `backupSnapshot` with a `stores.boards` holding an entry contains no key or value mentioning boards (stringify and check `!includes("openradlr-boards")` and no blob/text from the entry); `exportData` likewise; `deleteItem("everything", …)` clears `stores.boards`; `inventory` counts boards.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** (full client suite).
- [ ] **Step 5: Commit** `feat(client): Keep a rider's own board pictures and lines on the device`

---

### Task 8: Profile > My boards page

**Files:**
- Create: `client/public/js/view/boardCrop.js`, `client/public/js/view/myBoardsView.js`
- Modify: `client/public/js/view/profilePage.js` (`PROFILE_PAGES` gains `"boards"` after `"achievements"`), `client/public/index.html` (page section: list, add form with file input `accept="image/*"`, text input `maxlength=80`, a 2:1 crop frame with the picture draggable and a zoom slider, a live poster preview canvas, remove buttons), `client/public/styles.css` (no duplicate selectors), `client/public/js/main.js` (open/render/add/remove wiring, using `rideStores(...).boards`), i18n
- Test: `client/test/boardCrop.test.js`, `client/test/myBoardsView.test.js`

**Interfaces:**
- Consumes: `MyBoards`, `prepareImage`, `MAX_BOARDS` (Task 7), `paintPoster` (Task 4) for the preview.
- Produces:
  - `initialCrop(imageW, imageH) → { x, y, scale }` (cover the 2:1 frame, centred, `scale` = 1 means "just covers").
  - `dragCrop(crop, dx, dy, { imageW, imageH, frameW }) → crop` clamped so the frame stays covered; `zoomCrop(crop, scale, size) → crop` (scale 1..4, keeps the centre, clamped).
  - `sourceRect(crop, imageW, imageH) → { sx, sy, sw, sh }` with `sw / sh === 2` (used by `prepareImage`).
  - `myBoardsLines(entries, { max }) → { count: string, canAdd: boolean, empty: string|null }`.

Copy: `profilePage.tab.boards` "My boards" / "Meine Tafeln"; `boards.page.intro` "Put your own pictures and lines on the billboards by the road. They stay on this device and only you see them." / "Bring eigene Bilder und Sprüche auf die Plakatwände am Straßenrand. Sie bleiben auf diesem Gerät und nur du siehst sie."; `boards.page.count` "{n} of {max}" / "{n} von {max}"; `boards.page.add` "Add" / "Hinzufügen"; `boards.page.picture` "Picture" / "Bild"; `boards.page.text` "Line of text" / "Spruch"; `boards.page.remove` "Remove" / "Entfernen"; `boards.page.empty` "No boards of your own yet." / "Noch keine eigenen Tafeln."; `boards.error.full` "You have {max} boards. Remove one first." / "Du hast {max} Tafeln. Entferne zuerst eine."; `boards.error.unreadable` "This picture could not be read. Try a JPEG or PNG." / "Dieses Bild konnte nicht gelesen werden. Versuch es mit JPEG oder PNG."; `boards.error.empty` "Add a picture, a line, or both." / "Füge ein Bild, einen Spruch oder beides hinzu."; `boards.error.save` "Could not save. Check that this browser allows site storage." / "Speichern fehlgeschlagen. Prüfe, ob dieser Browser Website-Speicher erlaubt."

- [ ] **Step 1: Failing tests:** `initialCrop(4000, 1000)` covers a 2:1 frame (source rect 2000×1000 centred at x 1000); `dragCrop` cannot move the rect past the image edge; `zoomCrop` to 2 halves the source rect and keeps its centre; `sourceRect` aspect is 2 for portrait, landscape and panorama inputs; `myBoardsLines` at 12 of 12 → `canAdd` false, 0 → `empty` set.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the pure modules, then the markup and wiring (`i18nHtml`/`i18nSweep` tests guard untranslated markup).
- [ ] **Step 4: Run** the full client suite, expect PASS.
- [ ] **Step 5: Commit** `feat(client): Let riders add their own billboard pictures and lines`

---

### Task 9: Wire posters into the ride and menu, docs, verification

**Files:**
- Modify: `client/public/js/main.js` (ride start: `choosePosters(world.boards, { routeId, uploads: await stores.boards.list(), dateKey: local YYYY-MM-DD })`, `paintAtlas`, `view3d.setBoardPosters`; rider switch or upload change → repaint on the next ride), `client/public/js/view/menuStage.js` (defaults only: `uploads: []`), `docs/protocol.md` untouched
- Create: `docs/adr/00NN-roadside-boards.md` (next free number; context, decision = shared sites + per-screen posters + local-only uploads, consequences), `docs/boards.md` (what riders see, density rules, privacy rules for uploads, where the copy lives)
- Test: a `main`-free unit where possible; otherwise covered by Tasks 3–5. Add one test that `menuStage`'s poster call passes no uploads if it is a pure helper; skip if it is DOM-only and say so in the commit.

- [ ] **Step 1: Implement the wiring** (posters painted once per ride view build; atlas at `settings.boards.atlas` size; slot size = atlas / 2 wide, atlas / 4 high).
- [ ] **Step 2: Run** `make check`. Expected: lint clean and all tests pass.
- [ ] **Step 3: Screenshots** (AGENTS.md recipe, 1× scale, ~/.cache/openradlr/screenshots/boards/): menu drone view; a ride near a general board; a climb board; the last-km board; a goal board (seed `openradlr.goals` with a week total close to done); an upload with the red bar (seed via the My boards page); the My boards page in en and de; Low and High. Check the posters read at riding distance and nothing clips into trees or houses. Draw calls with `?stats` before/after at Low: ≤ +4.
- [ ] **Step 4: Commit** `docs: Record the roadside boards decision and how uploads stay on the device`, then any fixes the shots demand as their own `fix(client): …` commits.
