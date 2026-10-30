# In-game menu overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right drawer with a centred menu dialog, add a View popover and a live Overview, and make "Finish ride" really finish the ride.

**Architecture:** Logic goes into small pure modules with injected dependencies (`ride/finishController.js`, `ride/liveStats.js`, `view/menuPages.js`, `view/viewControls.js`) tested with plain node; DOM modules and `main.js` only wire them. The finish-flow fix lands first on the existing UI, so it ships even if the visual work changes. Existing element ids and handlers are kept; markup and CSS move around them.

**Tech Stack:** Plain ES modules (no build step), `node --test`, hand-written CSS, Playwright for screenshots. Run Node tooling per `AGENTS.md` / the global notes (the repo's `make check` is the gate).

**Spec:** `docs/superpowers/specs/2026-10-30-ingame-menu-design.md`

## Global Constraints

- Dialog card about 860×560, centred, ride dimmed and blurred behind; full screen below 1000 px wide or below 560 px tall; on a phone the page list is the first screen and a page opens with a back arrow.
- Top bar is exactly: Riders, Pause (when allowed), Photo, View, Menu. `#hud-camera` and `#hud-layout` are removed.
- Camera modes are Chase, Close, Drone, TV side (`view3d/chaseCamera.js`) shown as static illustrations, no live previews. Layouts: Auto, Cockpit, Broadcast, Training, Race. Studio shows its own cameras (seat, wide, coach) and no layout row.
- Keys stay: C, L, V, T, M, P, J, Esc closes the popover first, then the dialog.
- Menu pages: Overview (opens first), View, Vehicle, Race, Events, Training, Settings; Photo and Finish ride pinned in the footer. Empty pages are dropped from the list.
- Overview: whole-ride figures (elapsed, distance, climbed, avg power, weighted power, kJ, avg HR if present, load if FTP known, best efforts 5 s / 1 min / 5 min / 20 min when long enough); chart of the last 10 minutes; refresh once a second, only while the Overview is visible.
- Finish confirmation text: "Finish this ride? You can't continue it afterwards." with **Cancel** / **Finish ride**. No "Keep riding" anywhere.
- Finishing happens once: recorder stops, history saved once, `app.connection` cleared before `leave()`, trainer to flat road, autosave kept and marked `finished` (never continuable). Phone paddle rides have no autosave.
- Every existing element id and handler the spec lists keeps working; no protocol or server changes.
- Project rules: TDD, one reason to fail per test, no sleeps, time/RNG/I/O injected, `main.js` holds no logic (`CONTRIBUTING.md`). `make check` before claiming done. CHANGELOG entry under `[Unreleased]` with the issue number.

## Review Focus

- Double-tapping Finish ride (or the banner's "Finish and save" while the dialog's confirm is open) must not save history twice. Pinned in Task 1.
- Finishing while paused or parked, or with fewer samples than a ride needs: no crash, no empty history record, the summary says to ride longer. Pinned in Task 1.
- Page hidden or crash while the summary shows: the autosave holds the finished ride and the start menu offers Save, never Continue. Pinned in Task 2.
- Esc, controller back and M while the summary shows must not hide the summary or open the menu over it. Pinned in Task 3.
- Resizing across 1000 px or rotating the device with the dialog or popover open keeps one page and its focus. Pinned in Task 5.

---

### Task 1: Finish controller

**Files:**
- Create: `client/public/js/ride/finishController.js`
- Test: `client/test/finishController.test.js`

**Interfaces:**
- Produces: `createFinishController({ recorder, saveHistory, markAutosaveFinished, detachConnection, leaveWorld, releaseTrainer, exportable }) -> { finish(): {saved: boolean}, readonly finished: boolean }`
  - `recorder`: `{ empty: boolean }`; `saveHistory(): Promise<void>`; `markAutosaveFinished(): Promise<void>`; `detachConnection(): void` (clears `app.connection` so its close handler ignores the socket); `leaveWorld(): void`; `releaseTrainer(): void`; `exportable: boolean` (false for paddle rides).
  - `finish()` is idempotent: the first call runs the steps in this order: `detachConnection`, `leaveWorld`, `releaseTrainer`, then `saveHistory` and `markAutosaveFinished` unless `recorder.empty`; `markAutosaveFinished` only when `exportable`. Later calls do nothing and return `{saved:false}`.

- [ ] **Step 1: Write failing tests** in `finishController.test.js`: `finish runs the steps in order`, `finish twice saves history once and leaves once`, `an empty ride saves no history and no autosave mark but still leaves`, `a paddle ride marks no autosave`, `finished is false before and true after`.
- [ ] **Step 2: Run** `node --test test/finishController.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `createFinishController`** per the Interfaces block (a closure over a `done` flag).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Add a finish controller that finishes a ride once`.

### Task 2: Autosave knows a finished ride

**Files:**
- Modify: `client/public/js/ride/rideAutosave.js` (`continueAllowed`, `unfinishedLabel`)
- Test: `client/test/autosave.test.js`

**Interfaces:**
- Produces: snapshots may carry `finished: true`; `continueAllowed(snapshot, ctx)` is false for them; `unfinishedLabel(snapshot, ctx)` starts "Finished ride · " instead of "Unfinished ride · " for them.

- [ ] **Step 1: Write failing tests:** `a finished snapshot is never continuable even when recent and from this server`, `the label of a finished ride says Finished ride`, `an unfinished snapshot behaves as before`.
- [ ] **Step 2: Run** `node --test test/autosave.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** both changes (a `finished` check in each function).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Never offer to continue a finished ride`.

### Task 3: Wire the finish flow into main.js (existing UI)

**Files:**
- Modify: `client/public/js/main.js` (`openFinish` ~2181, `endRide` ~1457, `leaveRide`, `initFinish` ~2137, `saveRide` ~2441, frame loop recorder add ~3584, `closePanels` ~1740 and ~2016, `toggleMenu`, disconnect banner ~1685, `connectionLost` ~2290)
- Modify: `client/public/index.html` (remove `#ride-on`; add `#finish-confirm` card to the existing drawer's Ride panel)
- Test: `client/test/finishFlow.test.js` for the key-handling rule (below); the rest is verified in the browser.

**Interfaces:**
- Consumes: `createFinishController` (Task 1); the `finished` snapshot field (Task 2).
- Produces: `app.finished` (boolean, true after `finishRide()`); `finishRide()` builds the controller from live app state and calls `finish()`; `endRide()` stays the teardown. Pure helper `panelKeyAction(key, { finished, anyPanelOpen }) -> "close" | "toggle" | "none"` exported from a new `client/public/js/input/panelKeys.js`: while `finished`, Esc and M return `"none"`.

- [ ] **Step 1: Write failing tests** `panelKeys` in `finishFlow.test.js`: `Esc closes an open panel while riding`, `Esc and M do nothing while finished`, `M toggles while riding`.
- [ ] **Step 2: Run** `node --test test/finishFlow.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `panelKeyAction`** and use it in `closePanels` and `toggleMenu` (both actions tables).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Split `endRide()`:** `finishRide()` = build the controller (history via `app.history.save(rideRecord(...))` moved out of `openFinish`; autosave mark via `app.autosave.save({...snapshot, finished:true})`; `detachConnection` clears `app.connection` after copying `serverInfo`; `leaveWorld` = `connection.leave()` plus `app.reconnector?.stop()`, session stop, wake lock; `releaseTrainer` = `setGrade(0)`), set `app.finished = true`, then `openFinish()`. Keep the frame loop alive but skip `recorder.add` and `saveRide` when `app.finished`. `endRide()` keeps its current teardown for every other caller (`leaveRide`, `joinFailed`, the pause leave, `workout-back`). The album survives until Back to menu.
- [ ] **Step 6: Replace the entry points:** the Finish ride button now shows `#finish-confirm` (text from Global Constraints, Cancel/Finish ride); its confirm and the banner's "Finish and save" call `finishRide()`; `openFinish()` only renders the summary; delete `#ride-on` and its handler. The café workout path is untouched.
- [ ] **Step 7: Verify in the browser** (Playwright, `AGENTS.md` recipe): start a simulated ride, Finish, confirm; the summary shows with no Keep riding; Esc does nothing; the server reports the rider gone; reloading offers only Save for the ride. Run `make check`.
- [ ] **Step 8: Commit** `Finish a ride for real: stop recording, leave, and offer only Save afterwards`.

### Task 4: Menu page model

**Files:**
- Create: `client/public/js/view/menuPages.js`
- Test: `client/test/menuPages.test.js`

**Interfaces:**
- Produces: `MENU_PAGES` (ordered ids: `overview, view, vehicle, race, events, training, settings`); `visiblePages({ studio, workoutRoom, hasEvents, canTrain, sim }) -> string[]` dropping empty pages (Vehicle, Race, Events, Training hidden in the studio and workout rooms as `.route-only` is today; Events only when `hasEvents`); `createMenuNav(pages) -> { page, open(id), back(), setPages(pages) }` where `page` is `null` on a phone's list screen and `setPages` keeps the current page when it still exists, else falls back to the first.

- [ ] **Step 1: Write failing tests:** `overview is first`, `studio drops vehicle race events training`, `events only with events`, `setPages keeps the open page when it survives and falls back when it does not`, `back returns to the list`.
- [ ] **Step 2: Run** `node --test test/menuPages.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the three exports.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Model the menu's pages`.

### Task 5: The menu dialog

**Files:**
- Modify: `client/public/index.html` (replace `<aside id="menu">` and `#drawer-backdrop` with the dialog: page list, page containers holding the existing panels and their ids, footer with Photo and Finish ride, `#finish-confirm` moved into it, `role="dialog" aria-modal="true"`)
- Create: `client/public/js/view/menuDialog.js` (binds a `createMenuNav`, shows/hides pages, focus trap and return, backdrop tap, Esc, `data-narrow` toggled by a `matchMedia("(max-width: 999px), (max-height: 559px)")` listener)
- Modify: `client/public/js/main.js` (`toggleDrawer`/`closeDrawers` for the menu, `navigationRoot` ~1162, controller screen detection ~1107 and `controller.js` "drawer" mode ~104, FTP result check ~3005, `eventFinished` ~2825 opens the Race page, `#menu-photo` replaced by the footer Photo button keeping its one-frame wait)
- Modify: `client/public/styles.css` (new dialog section; drawer-right rules stay until Task 9)
- Test: `client/test/menuDialog.test.js` (fake elements, injected `matchMedia`)

**Interfaces:**
- Consumes: `visiblePages`, `createMenuNav` (Task 4).
- Produces: `createMenuDialog({ root, matchNarrow, onClose }) -> { open(pageId?), close(), isOpen, page, refreshPages(ctx) }` and `openMenu(pageId)` / `closeMenu()` in `main.js` that every old caller uses.

- [ ] **Step 1: Write failing tests:** `open shows the overview first`, `close returns focus to the opener`, `Esc closes`, `a narrow screen starts on the page list and a wide one on the first page`, `crossing the breakpoint with a page open keeps that page`, `refreshPages drops an empty page and falls back`, `Esc closes an open popover before the dialog` (popover is a stub registered by Task 6).
- [ ] **Step 2: Run** `node --test test/menuDialog.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `createMenuDialog`** in `view/menuDialog.js`.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Move markup and wire `main.js`** as listed under Files; no handler changes, ids kept.
- [ ] **Step 6: Style** the dialog (card, two panes, footer, narrow layout, safe-area insets, coarse-pointer targets, `prefers-reduced-motion`) matching the mockups in the spec discussion (`mock-D-dialog.png`).
- [ ] **Step 7: Verify** with Playwright at 1440×900, 1180×820, 390×844 and 844×390; open every page; Finish ride opens the confirm in the dialog; `make check`.
- [ ] **Step 8: Commit** `Replace the right drawer with a centred menu dialog`.

### Task 6: View controls and the top bar

**Files:**
- Create: `client/public/js/view/viewControls.js` (pure model), `client/public/js/view/viewPopover.js` (DOM)
- Modify: `client/public/index.html` (top bar: remove `#hud-camera`, `#hud-layout`; add `#hud-view`; popover markup; the dialog's View page reuses the same controls component)
- Modify: `client/public/js/main.js` (`initHudCommon`, `initHud`, `updateLayout` label code, `cycleCamera`, studio camera cycling ~3223), `client/public/styles.css` (remove the `#hud-camera, #hud-layout { display: none }` rules; popover and bottom-sheet styles)
- Test: `client/test/viewControls.test.js`, `client/test/viewPopover.test.js`

**Interfaces:**
- Produces: `viewControls({ studio, viewMode }) -> { cameras: {id,label}[], layouts: {id,label}[] | null, showTime: boolean }` (route: Chase/Close/Drone/TV side and the five layouts; studio: seat/wide/coach and `layouts: null`); `createViewPopover({ root, button, controls, onPick }) -> { open(), close(), isOpen }` where `onPick(kind, id)` calls the existing `setLayoutChoice`, camera and time handlers. Keys C, L, V, T keep calling the same handlers.

- [ ] **Step 1: Write failing tests:** `route rides offer four cameras and five layouts`, `the studio offers its own cameras and no layouts`, `picking a camera calls onPick and keeps the popover open`, `a tap outside and Esc close it`, `opening the popover closes the dialog's page overlays`.
- [ ] **Step 2: Run** both test files — Expected: FAIL.
- [ ] **Step 3: Implement** the model, then the popover (anchored under the button; a bottom sheet when narrow, per `menuDialog`'s breakpoint).
- [ ] **Step 4: Run them** — Expected: PASS.
- [ ] **Step 5: Wire the top bar and the View page** to the shared component; draw the four camera illustrations as small inline SVGs.
- [ ] **Step 6: Verify** with Playwright at the four sizes, in a road ride and in the studio; `make check`.
- [ ] **Step 7: Commit** `Add a View popover to the top bar`.

### Task 7: Live ride stats

**Files:**
- Create: `client/public/js/ride/liveStats.js`
- Test: `client/test/liveStats.test.js`

**Interfaces:**
- Consumes: `bestEfforts`, `weightedPower`, `rideLoad`, `powerSeries` from `ride/powerAnalysis.js`; recorder `samples` and `pauses`.
- Produces: `liveStats({ samples, pauses, ftp }) -> { elapsedS, distanceM, climbedM, avgPower, weightedPower, kJ, avgHeartRate, load, efforts: {s:number, w:number}[] }` (`avgHeartRate` and `load` are `null` when unknown; `efforts` limited to 5, 60, 300 and 1200 s windows the ride is long enough for) and `powerWindow(samples, pauses, { windowS = 600 }) -> {t:number, w:number}[]` for the chart.

- [ ] **Step 1: Write failing tests:** `figures from a steady 200 W ride`, `a ride shorter than a window gets no effort for it`, `pauses are not counted as riding time`, `no heart rate gives null`, `no FTP gives a null load`, `powerWindow returns only the last ten minutes`, `an empty recording returns zeros and no efforts`.
- [ ] **Step 2: Run** `node --test test/liveStats.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement both functions** over the existing `powerAnalysis` helpers (no new maths).
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** `Compute live ride stats from the recording`.

### Task 8: Overview page and summary

**Files:**
- Create: `client/public/js/view/overviewView.js`
- Modify: `client/public/index.html` (Overview page container, chart canvas), `client/public/js/main.js` (`finishStats` ~2163 uses `liveStats`; Overview refresh timer), `client/public/styles.css`
- Test: `client/test/overviewView.test.js`

**Interfaces:**
- Consumes: `liveStats`, `powerWindow` (Task 7); the dialog's open page (Task 5).
- Produces: `createOverviewView({ root, canvas, read, setInterval, clearInterval, format }) -> { show(), hide() }` where `read()` returns `{ samples, pauses, ftp }`; `show()` renders at once and every 1000 ms until `hide()`.

- [ ] **Step 1: Write failing tests** (fake timers and canvas): `show renders immediately and then once a second`, `hide stops the timer`, `no timer runs while hidden`, `figures use the injected formatters` (units), `an empty ride shows dashes, not NaN`.
- [ ] **Step 2: Run** `node --test test/overviewView.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the view; chart: last 10 minutes, FTP reference line, zone bands (the colours `hud.js` uses), drawn like `minimapView`.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Wire it** to the dialog (`show` when the Overview page opens, `hide` on leaving or closing); the finish summary uses the same `liveStats` figures and chart.
- [ ] **Step 6: Verify** with Playwright over a simulated ride at the four sizes; the chart moves; `make check`.
- [ ] **Step 7: Commit** `Show live ride stats in the menu`.

### Task 9: Remove the old drawer, docs, final check

**Files:**
- Modify: `client/public/styles.css` (delete `.drawer-right`, the right-drawer parts of the competing drawer media blocks, and `#hud-camera`/`#hud-layout` leftovers; keep the left drawer working), `client/public/index.html` (leftovers), `CHANGELOG.md`, `docs/architecture.md` if it names the drawer
- Test: whole suites

- [ ] **Step 1: Delete** the dead markup, CSS and handlers; `grep` for `drawer-right`, `menu-photo`, `hud-camera`, `hud-layout`, `ride-on` — Expected: no hits except the left drawer.
- [ ] **Step 2: Add the CHANGELOG entry** under `[Unreleased]` (new menu dialog, View popover, live Overview, finishing a ride is final) with the issue number; if no issue exists, file one with `gh issue create` first and use its number.
- [ ] **Step 3: Run `make check`** — Expected: lint and all tests pass (client node tests and `cargo test --workspace`).
- [ ] **Step 4: Final Playwright pass** at 1440×900, 1180×820, 390×844, 844×390: road ride and studio; screenshots saved to `~/.cache/openradlr/screenshots/`, not the repo.
- [ ] **Step 5: Commit** `Remove the old right drawer`, push `feat/ingame-menu`, open one PR (assignee RalfLeonFasler, never merged by us), description explains the why; refactorings and behaviour changes are separate commits as ordered above.
