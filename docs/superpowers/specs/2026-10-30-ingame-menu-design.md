# In-game menu overhaul — design

Date: 2026-10-30 · Issue: to be filed · Status: agreed in discussion, awaiting spec review

## Goal

The in-ride controls are easy to reach, organised and good-looking on desktop,
landscape tablet (9–10") and phone. What a rider uses mid-ride (view, vehicle,
race) is one or two taps away; setup stays available but out of the way. The
menu shows how the ride is going, live. Finishing a ride really finishes it.

Today the right drawer is one flat scroll of eleven equal panels, about 1,800 px
tall on every device, with View, Vehicle and Race below the fold. Camera and
layout buttons in the top bar are blind cycle buttons and are hidden on phones
and short landscape screens, so there the view is only reachable at the bottom
of the drawer.

## Decisions

| Question | Decision |
| --- | --- |
| Menu shape | A centred dialog (replaces the right drawer) on desktop and tablet; full screen on phone. The ride keeps running dimmed behind it |
| Top bar | Riders, Pause, Photo, one **View** button, Menu. The two cycle buttons (camera, layout) go |
| View controls | The View button opens a small popover: camera, layout, 3D/2D, time of day. The same controls are a page in the menu. Works on every screen size. Keys C, L, V, T stay |
| Menu pages | Overview (opens first), View, Vehicle, Race, Events, Training, Settings. Photo and **Finish ride** are pinned in the dialog footer |
| Overview | Live ride stats and charts from the recorder. No server or protocol change |
| Finishing | Finish ride asks for confirmation inside the dialog; confirming really finishes the ride. The summary has no "Keep riding" |
| Left drawer (riders, chat) | Unchanged in this work |
| Phone live view | A compact live stat strip (power, speed, grade) at the top of the dialog. No second live canvas |

## Scope

In:

- The menu dialog and its pages, the View popover, the compact top bar.
- The live Overview page.
- The finish flow: confirmation step, a real finish, the summary screen.
- Responsive behaviour at desktop, tablet and phone; keyboard, focus and
  controller navigation.
- Removing the right-drawer code and its competing CSS blocks.

Out:

- The left drawer, the HUD gauges, the start menu.
- A live picture-in-picture of the 3D view.
- New settings; every existing control keeps its element id and behaviour.
- Protocol changes.

## Top bar

Left to right: Riders (count), Pause (when allowed), Photo (badge), **View**,
Menu. The same five buttons at every size; on a phone the bar is exactly what
it is now plus View.

The View button opens a popover anchored under it (a bottom sheet on a phone)
with: camera as small static illustrations of the four modes (Chase, Close,
Drone, TV side; `view3d/chaseCamera.js`), layout (Auto, Cockpit, Broadcast,
Training, Race), 3D/2D, time of day. No live preview renders. A
choice applies at once and the popover stays open until a tap outside or Esc, so
a rider sees the effect and can adjust again. The graphics-quality choice lives
in the menu's View page only.

In the spin studio the popover shows the studio's own cameras (seat, wide, coach;
`studioScene.js`), which `#hud-camera` cycles today, and no layout row. Removing
the old camera button must not leave the studio without a camera control.

## The menu dialog

Layout at 1000 px and wider (desktop, tablet): a card about 860×560 centred over
the ride, ride dimmed and blurred behind it. Left: the page list (icon and name,
live state as a second line where it has one). Right: the page. Footer: Photo and
**Finish ride**, always visible. Below 1000 px wide or 560 px tall the card fills
the screen; on a phone the page list is the first screen (one row per page with
its status, e.g. "Vehicle · Not boarded") and a page opens with a back arrow.

Pages and where today's controls go:

| Page | Holds |
| --- | --- |
| Overview | New. Live stats, see below |
| View | Camera, layout, 3D/2D, time of day, graphics (`#layout-mode`, `#view-3d`, `#view-2d`, `#camera-mode`, `#time-mode`, `#quality-mode`) |
| Vehicle | Create / board a tandem or beer bike (`#vehicle-panel`) |
| Race | Laps, start, leave, results (`#start-race`, `#leave-race`, `#race-results`) |
| Events | `#events-panel` |
| Training | Road/ERG, ERG target and intensity, FTP test, workouts (`#training-panel`), simulated power (`#sim-panel`), climb feel |
| Settings | Units, trainer diagnostics (`#ride-copy-diagnostics`), keyboard shortcuts |

Route-only pages (`.route-only`) hide where they do today (studio, workout
rooms). A page with nothing to show is dropped from the list, not left empty.

Behaviour: opens with M or the Menu button, closes with M, Esc, the close
button or a tap on the dimmed backdrop. `role="dialog"`, focus moves in and is
trapped, returns to the Menu button on close. The page list and controls work
with the existing focus navigation and controller `toggleMenu` action.

Moving the controls keeps their ids and handlers; the change is markup and
styling around them, so existing wiring in `main.js` stays. Code that reads or
opens the drawer directly moves to the dialog with them: `toggleDrawer`/
`closeDrawers`, `navigationRoot` (which lists `menu`/`social`), the controller's
screen detection and its "drawer" navigation mode (`input/controller.js`), the FTP
test result check on `$("menu").hidden`, `eventFinished` (opens the Race page), and
the footer Photo button replacing `#menu-photo` (which waits a frame before
shooting). The View popover joins the same open-panel bookkeeping so Esc and the
controller's back close it first.

## Overview page

Computed from the recorder's one-second samples with the existing pure
functions in `ride/powerAnalysis.js`:

All figures cover the whole ride: best efforts and load need all samples, and
at 1 Hz a full recompute from prefix sums is cheap, so the view recomputes
once a second and draws only the last 10 minutes.

- Elapsed time, distance, climbed, average power, weighted power, work (kJ),
  average heart rate when present.
- Live power chart: the last 10 minutes, one line, with the FTP level as a
  reference and zone bands behind it.
- Best efforts so far (5 s, 1 min, 5 min, 20 min where the ride is long enough),
  from `bestEfforts`.
- A load figure when an FTP is known (`rideLoad`).

A new pure module `ride/liveStats.js` turns the samples into the figures and the
chart series; a small view draws them. They refresh once a second, only while
the Overview page is visible, so a closed menu costs nothing. The finish summary reuses the
same module so both always agree.

## Finishing a ride

Today "Finish ride" only opens the summary; the ride, the recorder and the
autosave carry on behind it, "Keep riding" closes the modal, and every
`openFinish()` saves another history record, so finish, continue, finish stores
the ride twice.

New flow:

1. **Finish ride** in the dialog footer swaps the dialog to a confirmation card:
   "Finish this ride? You can't continue it afterwards." with **Cancel** and
   **Finish ride**. Cancel returns to the menu page the rider was on.
2. **Confirm** finishes the ride, exactly once (below).
3. The **summary screen** is the current finish modal in the dialog style: stats
   and the Overview charts, splits, Upload to Strava, .fit/.tcx/.gpx, photos.
   **Keep riding** is removed; the one way out is **Back to menu**, which keeps
   today's warning when nothing has been saved or exported.
4. Another ride is a new ride from the start menu.

### What "finished" means in code

A finished state (`app.finished`) with these effects:

- **Recording stops.** The frame loop keeps running (the summary image is drawn
  from the live scene, `requestScene`, which only works inside the ride loop), but
  `recorder.add` is skipped once finished, as it is while paused.
- **No reconnect.** `finishRide()` clears `app.connection` before calling
  `connection.leave()`, so the socket's `close` handler (`connectionLost`) ignores
  it; otherwise the reconnector would rejoin the world under the summary. The
  summary reads the server name from a copy taken before that.
- **Trainer released** to a flat road, the rider freed on the server at once.
- **History saved once**, by `finishRide()`, not by showing the summary.
- **Keys and controller.** Esc and the controller's back (`closePanels`) no longer
  hide the summary, and M/`toggleMenu` does not open the menu over it. The only
  exits are Back to menu and the summary's own controls.
- **Autosave marked finished.** The snapshot gets a `finished` field;
  `continueAllowed` returns false for it, `saveRide`'s periodic and
  `pagehide`/`visibilitychange` saves must not overwrite the mark, and the start
  menu's line reads as a finished ride to save ("Finished ride · ..."), with Save
  only. A crash on the summary therefore cannot lose the ride. Phone paddle rides
  have no autosave and no files (`canExportRide`), so this does not apply to them.

`endRide()` today does finishing and teardown together. It splits into
`finishRide()` and the teardown, which runs on Back to menu. Other `endRide()`
callers keep the teardown behaviour unchanged: `leaveRide`, `joinFailed`, the
30-minute pause leave (which deliberately keeps the autosave for *Continue*), and
the café workout's `workout-back`. The plan decides where `learnLevel`,
`saveWorkoutRecord` and `app.album.clear()` go; the album must survive until Back
to menu.

### Callers

Only the dialog's Finish ride button asks for confirmation. The lost-connection
banner's *Finish and save* (`#finish-and-save`, in route rides) finishes at once,
with no confirmation card. The café workout has its own end path (`finishWorkout`
and `#workout-summary`, and in workout rooms `#finish-and-save` runs
`app.workout.end()`) and keeps it; this work does not change it. Recovering an
autosaved ride from the start menu is unchanged.

### Testability

`main.js` holds no logic by project rule, so the finish logic lives in a new
`ride/finishController.js` with history, autosave, connection, trainer, recorder
and the clock injected. Tests cover it there, not through `main.js`.

## Responsive behaviour

| Size | Top bar | Menu | View popover |
| --- | --- | --- | --- |
| Desktop (≥ 1000 px) | Five buttons, top right | Centred card, two panes | Anchored popover |
| Tablet landscape (≈ 9–10", ≥ 1000 px wide, ≥ 560 px tall) | Same | Same card, scaled to fit, large touch targets | Anchored popover |
| Short landscape phone, phone | Same five buttons | Full screen: page list first, page with back arrow, live stat strip on top | Bottom sheet |

Touch targets stay at the existing coarse-pointer sizes. Safe-area insets and
`prefers-reduced-motion` are honoured as the drawer does today.

## Testing

Client tests are plain node (fakes, no browser, no sleeps):

- `liveStats`: figures and chart series from sample fixtures, short rides,
  rides with pauses, missing heart rate, no FTP.
- `finishController`: one history save per finished ride, no recorder samples
  after finishing, no reconnect after leaving, trainer released, the autosave
  marked finished and not continuable, paddle rides, Back to menu warning.
- Key handling while finished (Esc, M, controller back do nothing to the summary).
- Menu state: page list for each context (route, studio, workout rooms), dropped
  empty pages, open/close/focus return, the popover closing before the dialog.

UI is checked with Playwright screenshots at 1440×900, 1180×820 and 390×844,
plus a short landscape phone, as in `AGENTS.md`. `make check` before done.

## Docs

CHANGELOG entry under `[Unreleased]`. No protocol change. An ADR is not needed:
the structure stays "plain ES modules, `main.js` the only composition root".

## Order of work

The finish-flow fix is independent of the new UI and the most valuable bug fix, so
it lands first in the PR's commit order: finish controller and flow, then the
menu dialog and its pages, then the top bar and View popover, then Overview, then
removing the old drawer code and CSS.

## Open points for the plan

- Whether the Overview chart gets a small shared canvas helper or draws like
  `minimapView` does.
- Exact names of the new view modules (`menuDialog.js`, `viewPopover.js`,
  `liveStatsView.js`) and how they split out of `main.js`, which is already large.
