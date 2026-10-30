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
| View controls | The View button opens a small popover: camera thumbnails, layout, 3D/2D, time of day. The same controls are a page in the menu. Works on every screen size. Keys C, L, V, T stay |
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
with: camera as three small preview thumbnails (Chase, Cockpit, Top),
layout (Auto, Cockpit, Broadcast, Training, Race), 3D/2D, time of day. A
choice applies at once and the popover stays open until a tap outside or Esc, so
a rider sees the effect and can adjust again. The graphics-quality choice lives
in the menu's View page only.

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
styling around them, so existing wiring in `main.js` stays.

## Overview page

Computed from the recorder's one-second samples with the existing pure
functions in `ride/powerAnalysis.js`:

- Elapsed time, distance, climbed, average power, weighted power, work (kJ),
  average heart rate when present.
- Live power chart: the last 10 minutes, one line, with the FTP level as a
  reference and zone bands behind it.
- Best efforts so far (5 s, 1 min, 5 min, 20 min where the ride is long enough),
  from `bestEfforts`.
- A load figure when an FTP is known (`rideLoad`).

A new pure module `ride/liveStats.js` turns the samples into the figures and the
chart series; a small view draws them. They refresh once a second, only while
the Overview page is visible, and only over the last window of samples, so an
open Overview costs nothing during a long ride. The finish summary reuses the
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
2. **Confirm** finishes the ride, exactly once:
   - the recorder stops and the ride is saved to history once;
   - the rider leaves the world at once (`connection.leave()`, as
     `endRide()` already does) and the trainer is released to a flat road;
   - the autosave is kept, marked finished, so a crash on the summary cannot
     lose the ride; the start menu offers *Save* for it, never *Continue*.
3. The **summary screen** is the current finish modal in the dialog style: stats
   and the Overview charts, splits, Upload to Strava, .fit/.tcx/.gpx, photos.
   **Keep riding** is removed; the one way out is **Back to menu**, which keeps
   today's warning when nothing has been saved or exported.
4. Another ride is a new ride from the start menu.

`endRide()` today does both the finishing and the teardown. It splits into
`finishRide()` (stop, leave, release, keep recorder, photos and route for the
summary) and the existing teardown, which runs on Back to menu.

Callers that already mean "finish now" skip the confirmation card: the
lost-connection banner's *Finish and save* and the end of a workout.
Recovering an autosaved ride from the start menu is unchanged.

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
- The finish flow: the confirmation card, one history save per finished ride,
  no continue after finishing, the autosave marked finished, Back to menu
  warning, the callers that skip the confirmation.
- Menu state: page list for each context (route, studio, workout), dropped empty
  pages, open/close/focus return.

UI is checked with Playwright screenshots at 1440×900, 1180×820 and 390×844,
plus a short landscape phone, as in `AGENTS.md`. `make check` before done.

## Docs

CHANGELOG entry under `[Unreleased]`. No protocol change. An ADR is not needed:
the structure stays "plain ES modules, `main.js` the only composition root".

## Open points for the plan

- Whether the Overview chart gets a small shared canvas helper or draws like
  `minimapView` does.
- Exact names of the new view modules (`menuDialog.js`, `viewPopover.js`,
  `liveStatsView.js`) and how they split out of `main.js`, which is already large.
