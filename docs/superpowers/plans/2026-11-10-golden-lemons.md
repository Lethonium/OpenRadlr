# Golden Lemons Implementation Plan

**Goal:** Golden lemons over the road, collected by riding through them in their lane.

**Architecture:** Client only. A pure module places the day's lemons from the route seed and the UTC day and tracks pickups; the 3D and 2D views draw them; `main.js` wires them into the ride. No server or protocol change.

**Spec:** `docs/superpowers/specs/2026-11-10-golden-lemons-design.md`

## Global Constraints

- Branch `feat/golden-lemons`, based on `origin/main`.
- UI text through `t()` / `tn()` with keys in `en.js` and `de.js`.
- `make check` before every commit.

## Tasks

- [x] **1. Placement and pickups** — `client/test/lemons.test.js` first: same lemons for everyone on a day, new places the next day, count per spacing and bounds, whole lanes clear of the line in riding order; collect in the lane, not in another lane, halfway through a lane change, once only, not on the first position, not on a jump or off the route, across the line, grown back on the next lap, all-time total carried on. Then `client/public/js/ride/lemons.js`.
- [x] **2. 3D lemons** — `view3d.test.js`: a lemon ahead is drawn bright over its lane at handlebar height; collected and far-off ones are not; none without lemons; dispose frees the mesh. Then `view3d/lemonModel.js` and `View3D.setLemons`.
- [x] **3. 2D lemons** — `ui.test.js`: `lemonsInWindow` keeps the lemons still there within the peloton window, across the line. Then the dots in `drawPeloton`.
- [x] **4. Ride wiring** — `main.js`: hunt per route, pickup ticker line, finish row, all-time count in `openradlr.lemons`; i18n keys.
- [x] **5. Check in the real app** — ride Riverside Flats on the simulated trainer through the first lemon in its lane and past one in the next lane; screenshots in the PR.
