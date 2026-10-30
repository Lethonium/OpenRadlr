# In-game menu overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right drawer with a centred menu dialog, add a View popover and a live Overview, and make "Finish ride" really finish the ride.

**Architecture:** Logic goes into small pure modules with injected dependencies (`ride/finishController.js`, `input/panelStack.js`, `ride/liveStats.js`, `view/menuPages.js`, `view/viewControls.js`) tested with plain node; DOM modules and `main.js` only wire them. The finish-flow fix lands first on the existing UI, so it ships even if the visual work changes. Existing element ids and handlers are kept; markup and CSS move around them.

**Tech Stack:** Plain ES modules (no build step), `node --test`, hand-written CSS, Playwright for screenshots. Run Node tooling per `AGENTS.md` / the global notes (the repo's `make check` is the gate).

**Spec:** `docs/superpowers/specs/2026-10-30-ingame-menu-design.md`

## Global Constraints

- Dialog card about 860×560, centred, ride dimmed and blurred behind; full screen below 1000 px wide or below 560 px tall; on a phone the page list is the first screen and a page opens with a back arrow.
- Top bar is exactly: Riders, Pause (when allowed), Photo, View, Menu. `#hud-camera` and `#hud-layout` are removed.
- Camera modes are Chase, Close, Drone, TV side (`view3d/chaseCamera.js`) shown as static illustrations, no live previews. Layouts: Auto, Cockpit, Broadcast, Training, Race. Studio shows its own cameras (seat, wide, coach) and no layout row.
- Keys stay: C, L, V, T, M, P, J. One panel stack decides Esc: it closes the top panel (popover first, then dialog). While a ride is finished, Esc, M, lanes, J and junction turns do nothing.
- Menu pages: Overview (opens first), View, Vehicle, Race, Events, Training, Settings; Photo and Finish ride pinned in the footer. Empty pages are dropped (the studio drops Vehicle, Race, Events; Training stays for climb feel and simulated power). Each page row shows a status line ("Vehicle · Not boarded").
- The left drawer and its `#drawer-backdrop` are unchanged; the dialog has its own backdrop.
- Overview: whole-ride figures (elapsed, distance, climbed, kJ, avg HR if present from `RideRecorder.summary()`; avg power, weighted power, load if FTP known, best efforts 5 s / 1 min / 5 min / 20 min when long enough from `powerAnalysis`). On a phone a live strip (power, speed, grade) sits at the top of the dialog; chart of the last 10 minutes; refresh once a second, only while the Overview is visible.
- Finish confirmation text: "Finish this ride? You can't continue it afterwards." with **Cancel** / **Finish ride**. No "Keep riding" anywhere.
- Finishing happens once: recorder stops, history saved once, `app.connection` cleared before `leave()`, trainer to flat road, autosave kept and marked `finished` (never continuable). Phone paddle rides have no autosave.
- Every existing element id and handler the spec lists keeps working; no protocol or server changes.
- Project rules: TDD, one reason to fail per test, no sleeps, time/RNG/I/O injected, `main.js` holds no logic (`CONTRIBUTING.md`). `make check` before claiming done. CHANGELOG entry under `[Unreleased]` with the issue number.

## Review Focus

- Double-tapping Finish ride, or the banner's "Finish and save" while the confirm card is open, must not save history twice or leave twice. Pinned in Task 1 (one controller per ride).
- Finishing while paused or parked, or with an empty recording: no crash, no empty history record, the open pause is closed, the summary says to ride longer. Pinned in Task 1.
- Anything that still ticks after finishing (auto-pause, the 30-minute pause leave, lanes, J, junction turns, studio sampling) must not touch a finished ride. Pinned in Tasks 3 and 4.
- A crash or hidden page on the summary: the autosave holds the finished ride and the start menu offers Save, never Continue. Pinned in Task 2.
- Resizing across 1000 px or rotating with the dialog or popover open keeps one page and its focus; the next ride does not inherit the old ride's listeners. Pinned in Tasks 7 and 10.

---

### Task 1: Finish controller

**Files:**
- Create: `client/public/js/ride/finishController.js`
- Test: `client/test/finishController.test.js`

**Interfaces:**
- Produces: `createFinishController({ recorder, closePause, saveHistory, markAutosaveFinished, detachConnection, leaveWorld, releaseTrainer, exportable }) -> { finish(): void, readonly finished: boolean, readonly canRecord: boolean }`
  - `recorder`: `{ empty: boolean }` read at `finish()`; `closePause(): void`; `saveHistory(): Promise<void>`; `markAutosaveFinished(): Promise<void>`; `detachConnection(): void`; `leaveWorld(): void`; `releaseTrainer(): void`; `exportable: boolean` (false for paddle rides).
  - First `finish()` runs: `closePause`, `detachConnection`, `leaveWorld`, `releaseTrainer`, then `saveHistory` unless `recorder.empty`, then `markAutosaveFinished` unless `recorder.empty` or not `exportable`. Later calls do nothing. `canRecord` is `!finished`.
  - `leaveWorld` must not read `app.connection`: the caller passes a closure over a connection captured before `detachConnection` runs (Task 4).
- Also produces: `backToMenuWarning({ exportable, saved, empty, albumSize }): string | null` — today's `leaveRide` question text when something would be lost (ride unsaved and not empty and exportable, or photos present), else `null`.

- [ ] **Step 1: Write failing tests:** `finish runs the steps in order`, `finish twice saves history once and leaves once`, `finishing while paused closes the pause first`, `an empty ride saves nothing but still leaves`, `a paddle ride marks no autosave`, `canRecord turns false after finish`, and for `backToMenuWarning`: `nothing unsaved gives null`, `an unsaved exportable ride warns about the ride and photos`, `a paddle ride warns about photos only`.
- [ ] **Step 2: Run** `node --test test/finishController.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** both exports (a closure over a `done` flag; warning strings copied from `leaveRide`, main.js ~2125).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Add a finish controller that finishes a ride once`.

### Task 2: Autosave knows a finished ride

**Files:**
- Modify: `client/public/js/ride/rideAutosave.js` (`continueAllowed`, `unfinishedLabel`)
- Test: `client/test/autosave.test.js`

**Interfaces:**
- Produces: snapshots may carry `finished: true`; `continueAllowed` is false for them; `unfinishedLabel` starts "Finished ride · " for them.

- [ ] **Step 1: Write failing tests:** `a finished snapshot is never continuable even when recent and from this server`, `the label of a finished ride says Finished ride`, `an unfinished snapshot behaves as before`.
- [ ] **Step 2: Run** `node --test test/autosave.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** both changes.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Never offer to continue a finished ride`.

### Task 3: One panel stack and keys that ignore a finished ride

**Files:**
- Create: `client/public/js/input/panelStack.js`
- Modify: `client/public/js/main.js` (both actions tables with `closePanels`/`toggleMenu` ~1738 and ~2015; lanes ~1723; `toggleRace` ~2790; `chooseTurn` ~3390; `$("finish").hidden = true` in `closePanels`), `client/public/js/input/keyboard.js` only if it filters keys itself
- Test: `client/test/panelStack.test.js`

**Interfaces:**
- Produces: `createPanelStack() -> { push(panel: {close(): void}): () => void, closeTop(): boolean, readonly isOpen: boolean }` (`push` returns a remover; `closeTop` closes the most recently pushed panel and returns whether there was one) and `inputAllowed(app) -> boolean` is **not** added; instead `main.js` guards each listed handler with `if (app.finishController?.finished) return` (the controller exists from Task 4; until then the guard is `app.finished`, a boolean set by Task 4).

- [ ] **Step 1: Write failing tests:** `closeTop closes the last pushed panel first`, `closeTop with nothing open returns false`, `the remover takes a panel out without closing it`.
- [ ] **Step 2: Run** `node --test test/panelStack.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `createPanelStack`.**
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: In `main.js`** route `closePanels` through one app-level stack (the existing drawers register on it for now), and add the finished guards to Esc, M, lanes, J and junction turns; `closePanels` no longer sets `$("finish").hidden`.
- [ ] **Step 6: Run `make check`** — Expected: pass; commit `Route Esc through one panel stack`.

### Task 4: finishRide, endRide and the frame guards

**Files:**
- Modify: `client/public/js/main.js` (`startRide`/ride setup, `endRide` ~1457, `saveRide` ~2440, frame loop recorder add ~3584 and studio ~2115, `updatePause` ~3462, `openFinish` ~2181, `summaryImage` ~2642, `leaveRide` ~2125)

**Interfaces:**
- Consumes: `createFinishController`, `backToMenuWarning` (Task 1); the `finished` snapshot field (Task 2).
- Produces: `app.finishController` (one per ride, created when the ride starts, reset by the teardown); `finishRide()`; `rideSnapshot()` (the snapshot object `saveRide` builds inline today, extracted so `markAutosaveFinished` can add `finished: true`); `app.finishedServerName` (copied from `app.connection.serverInfo.server_name` before detaching; `openFinish` and `summaryImage` read it instead of `app.connection`).

- [ ] **Step 1: Extract `rideSnapshot()`** from `saveRide` unchanged; run `make check` — Expected: pass.
- [ ] **Step 2: Build the controller once per ride** with: `closePause` = `app.recorder.resume(Date.now())`; `detachConnection` = clear `app.connection` after capturing it in a local `const connection`; `leaveWorld` = `connection.leave()` plus `app.reconnector?.stop()`, `app.session?.stop()`, `app.wakeLock.release()`; `releaseTrainer` = the existing `setGrade(0)` call; `saveHistory` = the `app.history.save(rideRecord(...))` moved out of `openFinish`, then `offerFtp`; `markAutosaveFinished` = `app.autosave.save({ ...rideSnapshot(), finished: true })`; `exportable` = `canExportRide(app.trainer)`.
- [ ] **Step 3: Implement `finishRide()`:** return early if `app.finishController.finished`; call `finish()`; set `app.finished = true`; call `openFinish()`. `openFinish()` only renders the summary now.
- [ ] **Step 4: Guard what still ticks:** skip `recorder.add` (both sites), `saveRide` and the whole `updatePause` call when finished (`!app.finishController.canRecord`), so auto-pause and the 30-minute leave cannot fire; clear `app.finished` and the controller in the teardown.
- [ ] **Step 5: `endRide()` stays the teardown** for `leaveRide`, `joinFailed`, the pause leave and `workout-back`; `learnLevel`, `saveWorkoutRecord` and `app.album.clear()` stay in it (they read state `finishRide` does not touch, and the album must survive until Back to menu). `leaveRide` uses `backToMenuWarning`.
- [ ] **Step 6: Make the banner's "Finish and save"** (~1685) call `finishRide()`. The café workout path is untouched.
- [ ] **Step 7: Verify in the browser** (Playwright recipe in `AGENTS.md`): simulated ride, call finish from the console or the banner; the summary opens, the server shows the rider gone within a second, no reconnect, lane keys and J do nothing, reloading the page offers only Save. Run `make check`.
- [ ] **Step 8: Commit** `Finish a ride for real`.

### Task 5: The confirmation card and entry points

**Files:**
- Modify: `client/public/index.html` (remove `#ride-on`; add `#finish-confirm` inside the existing drawer's Ride panel), `client/public/js/main.js` (`initFinish` ~2137), `client/public/styles.css` (card styles)

**Interfaces:**
- Consumes: `finishRide()` (Task 4), the panel stack (Task 3).
- Produces: `#finish-confirm` with the Global Constraints text and buttons `#finish-confirm-cancel`, `#finish-confirm-ok`; the Finish ride button (`#finish-ride`) shows it; Cancel hides it; OK calls `finishRide()`. It is a panel on the stack, so Esc closes it.

- [ ] **Step 1: Implement** as above; delete the `#ride-on` handler and element.
- [ ] **Step 2: Verify** with Playwright: Finish ride, Cancel returns, Finish ride again then confirm shows the summary with no Keep riding; `make check`.
- [ ] **Step 3: Commit** `Ask before finishing a ride`.

### Task 6: Menu page model

**Files:**
- Create: `client/public/js/view/menuPages.js`
- Test: `client/test/menuPages.test.js`

**Interfaces:**
- Produces: `MENU_PAGES` (ordered ids: `overview, view, vehicle, race, events, training, settings`); `visiblePages({ studio, hasEvents }) -> string[]` (studio drops vehicle, race, events; events needs `hasEvents`); `pageStatus(id, ctx) -> string` (view: "3D · Chase", vehicle: "Not boarded" or the kind, race: phase or "None running", training: "Road (sim)" or "ERG 150 W", events: "2 happening", settings: units, overview: ""), `ctx` carrying the values; `createMenuNav(pages) -> { page, open(id), back(), setPages(pages) }` (`page` is `null` on a phone's list screen; `setPages` keeps the open page when it survives, else falls back to the first).

- [ ] **Step 1: Write failing tests:** `overview is first`, `studio drops vehicle race events and keeps training`, `events only with events`, `setPages keeps the open page when it survives and falls back when it does not`, `back returns to the list`, `status lines read as in the spec`.
- [ ] **Step 2: Run** `node --test test/menuPages.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the exports.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Model the menu's pages`.

### Task 7: The menu dialog module

**Files:**
- Create: `client/public/js/view/menuDialog.js`
- Test: `client/test/menuDialog.test.js` (fake elements, injected `matchNarrow` with `addEventListener`/`removeEventListener`)

**Interfaces:**
- Consumes: `createMenuNav` (Task 6), `createPanelStack` (Task 3).
- Produces: `createMenuDialog({ root, stack, matchNarrow, onPage }) -> { open(pageId?), close(), showConfirm(), cancelConfirm(), refreshPages(pages), isOpen, page, dispose() }`. `open` pushes the dialog on `stack`; `onPage(id | null)` fires when the page changes (Overview uses it); `dispose()` removes the `matchNarrow` listener and any document listeners. Created once per ride and disposed with it (`#ride` is re-cloned per ride, main.js ~1555).

- [ ] **Step 1: Write failing tests:** `open shows the overview first on a wide screen and the page list on a narrow one`, `close returns focus to the opener`, `closing through the stack closes the dialog`, `the popover registered later closes first`, `crossing the breakpoint with a page open keeps that page`, `refreshPages drops an empty page and falls back`, `cancelConfirm returns to the page that was open`, `dispose removes the media listener`, `onPage reports page changes`.
- [ ] **Step 2: Run** `node --test test/menuDialog.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `createMenuDialog`** (focus trap on Tab, `aria-modal`, backdrop tap handled on the dialog's own backdrop element).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Add the menu dialog module`.

### Task 8: Move the menu into the dialog

**Files:**
- Modify: `client/public/index.html` (replace `<aside id="menu">` with the dialog: its own `#menu-backdrop`, page list, page containers holding the existing panels with their ids, footer with Photo and Finish ride, `#finish-confirm` moved in; keep `#drawer-backdrop` for the left drawer), `client/public/js/main.js` (`toggleDrawer`/`closeDrawers` for the menu, `navigationRoot` ~1160, controller screen detection ~1107, FTP result check ~3005, `eventFinished` ~2825 opens the Race page, `#menu-photo` replaced by the footer button keeping its one-frame wait), `client/public/styles.css` (minimal rules so it is usable)
- Keep: the controller's `"drawer"` navigation mode name (`input/controller.js:104`, asserted in `controller.test.js:390`); the dialog counts as a drawer-type screen.

**Interfaces:**
- Consumes: `createMenuDialog` (Task 7), `visiblePages`, `pageStatus` (Task 6). Produces `openMenu(pageId?)` and `closeMenu()` used by every old caller.

- [ ] **Step 1: Move the markup;** ids and handlers unchanged.
- [ ] **Step 2: Create the dialog per ride** and dispose it in the teardown; refresh the page list on route/studio/event changes.
- [ ] **Step 3: Retarget** the callers listed under Files.
- [ ] **Step 4: Run `make check`** — Expected: pass (no test reads `index.html`).
- [ ] **Step 5: Verify** every page opens and works in a road ride and the studio; commit `Show the in-game menu in a dialog`.

### Task 9: Style the dialog

**Files:**
- Modify: `client/public/styles.css`

- [ ] **Step 1: Style** the card (about 860×560, centred, dimmed and blurred ride), two panes, page list with icons and status lines, footer, and the narrow layout below 1000 px wide or 560 px tall (page list first, back arrow, a live strip slot at the top), matching `mock-D-dialog.png` from the design discussion; safe-area insets, coarse-pointer targets, `prefers-reduced-motion`.
- [ ] **Step 2: Re-scope** the rules that styled panels because they sat in `.drawer` (`.drawer label`, `.view-switch`, `.scene-controls`, the coarse-pointer button/select/input rules ~2267-2281 and ~3546) to the dialog, so nothing loses its styling.
- [ ] **Step 3: Verify** with Playwright at 1440×900, 1180×820, 390×844 and 844×390, every page; `make check`.
- [ ] **Step 4: Commit** `Style the menu dialog`.

### Task 10: View controls and the top bar

**Files:**
- Create: `client/public/js/view/viewControls.js` (pure), `client/public/js/view/viewPopover.js` (DOM)
- Modify: `client/public/index.html` (top bar: remove `#hud-camera` and `#hud-layout`, add `#hud-view`, popover markup; the dialog's View page keeps its existing controls), `client/public/js/main.js` (`initHudCommon`, `initHud`, `updateLayout` label code, `cycleCamera` ~3222; new `setCamera(id)` that calls `view3d.setCameraMode(id)` or sets `studioView.cameraMode = id` and is used by both `cycleCamera` and the popover), `client/public/styles.css` (remove the `#hud-camera, #hud-layout { display: none }` rules ~3619 and ~3835; popover and bottom-sheet styles)
- Test: `client/test/viewControls.test.js`, `client/test/viewPopover.test.js`

**Interfaces:**
- Consumes: the panel stack (Task 3), the dialog's `matchNarrow`.
- Produces: `viewControls({ studio }) -> { cameras: {id,label}[], layouts: {id,label}[] | null, modes: {id,label}[], showTime: boolean }` (route: Chase/Close/Drone/TV side, five layouts, 3D/2D, time; studio: seat/wide/coach, `layouts: null`, no 3D/2D row if the studio has one view); `createViewPopover({ root, button, controls, stack, matchNarrow, onPick }) -> { open(), close(), isOpen, dispose() }` where `onPick(kind, id)` calls `setCamera`, `setLayoutChoice`, the 3D/2D and time handlers. Created per ride, disposed with it. Keys C, L, V, T keep their handlers.

- [ ] **Step 1: Write failing tests:** `route rides offer four cameras five layouts and 3D/2D`, `the studio offers its own cameras and no layouts`, `picking calls onPick and keeps the popover open`, `a tap outside and closing through the stack close it`, `opening the popover pushes it above the dialog`, `dispose removes the document listener`.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement** the model, then the popover (anchored under the button; a bottom sheet when narrow); camera illustrations as small inline SVGs.
- [ ] **Step 4: Wire the top bar** and `setCamera`; the camera-button label code and `#hud-layout` text code go.
- [ ] **Step 5: Verify** with Playwright at the four sizes in a road ride and the studio; `make check`; commit `Add a View popover to the top bar`.

### Task 11: Live ride stats

**Files:**
- Create: `client/public/js/ride/liveStats.js`
- Test: `client/test/liveStats.test.js`

**Interfaces:**
- Consumes: `RideRecorder.summary()` (elapsed, distance, climbed, kJ, avg HR), `bestEfforts`, `weightedPower`, `rideLoad` from `ride/powerAnalysis.js`.
- Produces: `liveStats({ summary, samples, pauses, ftp }) -> { elapsedS, distanceM, climbedM, kJ, avgHeartRate, avgPower, weightedPower, load, efforts: {s:number, w:number}[] }` (`avgHeartRate`/`load` null when unknown; `efforts` for 5, 60, 300 and 1200 s windows the ride is long enough for) and `powerWindow(samples, { windowS = 600 }) -> {t:number, w:number}[]` (seconds before now, from the samples' timestamps).

- [ ] **Step 1: Write failing tests:** `figures from a steady 200 W ride`, `a ride shorter than a window gets no effort for it`, `pauses are not counted as riding time`, `no heart rate gives null`, `no FTP gives a null load`, `powerWindow returns only the last ten minutes`, `an empty recording returns zeros and no efforts`.
- [ ] **Step 2: Run** `node --test test/liveStats.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** both over the existing helpers (only the window slicing is new).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Compute live ride stats from the recording`.

### Task 12: Overview page and phone stat strip

**Files:**
- Create: `client/public/js/view/overviewView.js`
- Modify: `client/public/index.html` (Overview page container, chart canvas, narrow-only stat strip in the dialog header), `client/public/js/main.js` (Overview wiring; the finish summary keeps `finishStats()` including "Max power" and the seat rows and gains the chart), `client/public/styles.css`
- Test: `client/test/overviewView.test.js`

**Interfaces:**
- Consumes: `liveStats`, `powerWindow` (Task 11); the dialog's `onPage` (Task 7); `ZONE_COLORS` from `view/workoutView.js`.
- Produces: `createOverviewView({ root, canvas, strip, read, setInterval, clearInterval, format }) -> { show(), hide(), dispose() }`; `read()` returns `{ summary, samples, pauses, ftp, live: {power, speed, grade} }`; `show()` renders at once and every 1000 ms until `hide()`; the strip shows the live power, speed and grade.

- [ ] **Step 1: Write failing tests** (fake timers and canvas): `show renders immediately and then once a second`, `hide stops the timer`, `no timer runs while hidden`, `figures use the injected formatters`, `an empty ride shows dashes, not NaN`, `the strip shows live power speed and grade`.
- [ ] **Step 2: Run** `node --test test/overviewView.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the view; chart: last 10 minutes, FTP reference line, zone bands, drawn like `minimapView`.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Wire it** (`onPage` shows/hides it; per-ride create and dispose); the summary draws the same chart.
- [ ] **Step 6: Verify** over a simulated ride at the four sizes; the chart moves; `make check`; commit `Show live ride stats in the menu`.

### Task 13: Remove the old drawer, docs, final check

**Files:**
- Modify: `client/public/styles.css` (delete `.drawer-right`, the right-drawer parts of the competing drawer media blocks and the `#hud-camera`/`#hud-layout` leftovers; the left drawer keeps working), `client/public/index.html` (leftovers), `CHANGELOG.md`, `docs/architecture.md` if it names the drawer

- [ ] **Step 1: Delete** dead markup, CSS and handlers; `grep` for `drawer-right`, `menu-photo`, `hud-camera`, `hud-layout`, `ride-on` — Expected: no hits except the left drawer.
- [ ] **Step 2: CHANGELOG** entry under `[Unreleased]` (menu dialog, View popover, live Overview, finishing a ride is final) with the issue number; if none exists, file one with `gh issue create` first.
- [ ] **Step 3: Run `make check`** — Expected: lint and all tests pass (client node tests and `cargo test --workspace`).
- [ ] **Step 4: Final Playwright pass** at 1440×900, 1180×820, 390×844, 844×390: road ride and studio; screenshots in `~/.cache/openradlr/screenshots/`, not the repo.
- [ ] **Step 5: Commit** `Remove the old right drawer`, push `feat/ingame-menu`, open one PR (assignee RalfLeonFasler, never merged by us), description explains the why.
