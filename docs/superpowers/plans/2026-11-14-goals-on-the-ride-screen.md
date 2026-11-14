# Goals on the Ride Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the season goal out of the centred HUD status pill into a left-hand goals list, in a shared left column that stacks above the nearby riders in broadcast and race, stays one line on phones, and is left out of the studio. Add a goals tile to the phone cockpit. The column is shaped so NPC quests can join it later.

**Architecture:** A pure `goalsPanel(entries, …)` in `view/goalsView.js` orders the active goals and returns one short line each (reusing `goalLine`). `main.js` renders those lines into a new shared `#hud-goals` section inside a `#hud-left` column, placed by CSS per layout; the pill element and its updater go away. The `display` frame carries one goal line for the phone cockpit, which gets a new text tile.

**Tech Stack:** Plain ES modules, no build step; `node --test`; i18n in `js/i18n/en.js` + `de.js`.

**Spec:** `docs/superpowers/specs/2026-11-14-goals-on-the-ride-screen-design.md` (decisions: goals above riders in broadcast/race, one line on phones, no goals in the studio).

## Global Constraints

- Client only. No change to the simulation or the server.
- Branch `feat/season-goals` (same PR #102, ordered commits after the season-goals ones).
- The goal leaves `.hud-status` only; the other pills (race, draft, ghost gap, group gap, sharing, power only) stay in the centred row.
- One line per goal, at most 3 shown (most relevant first, `hudGoal`'s order: lap on this route, then long ride, then total); "+N more" when longer. Never a dashboard wall.
- Updated with the menu/status refresh (at most once a second), not per frame.
- Phone cockpit line ≤ ~80 bytes; the `display` frame stays under `DISPLAY_LIMIT_BYTES` (2048).
- Every en key used; en/de parity (`i18n` tests); `npm run preload` after adding modules.
- No goals section in the studio (`data-mode="studio"`).
- Run Node via Docker (`node:22`, repo mounted).
- No model identifiers in commits; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Each of the four layouts (`cockpit`, `broadcast`, `training`, `race`) shows the goals list without overlapping `hud-info`, `hud-actions`, the gear tile, the centred status pills, the gauge (cockpit), the workout band (training) or the nearby list (broadcast/race).
2. Phone portrait and short landscape: the column collapses to one line and does not collide with `.hud-status` (`top: 66px` / `var(--gap)`) or `.hud-info`.
3. Broadcast/race: goals above the nearby list, in one flowing column, never two boxes at `top: 140px`.
4. Without goals, in a race where the goal is hidden (existing `racing` rule), or with only reached/finished goals: the column section is absent, and nothing shifts.
5. The phone cockpit tile hides without a goal line; the frame stays within the byte limit.

---

### Task 1: The pure goals panel

**Files:**
- Modify: `client/public/js/view/goalsView.js` (`goalsPanel`)
- Modify: `client/public/js/i18n/en.js`, `de.js` (`goals.panel.more`, `goals.panel.title` if used)
- Test: `client/test/goalsView.test.js`

**Interfaces:**
- Produces: `goalsPanel(entries, { routeId = null, racing = false, max = 3 } = {}) → { title: string | null, lines: string[], more: number }`
  - Drops finished and reached entries and, when `racing`, returns `{ title, lines: [], more: 0 }`.
  - Orders by `hudGoal`'s relevance: a lap goal on `routeId` first, then long ride, then total; other kinds after.
  - Each line is `goalLine(goal, week)`.
  - `lines` holds at most `max`; `more` is how many were dropped beyond that.
  - `title` is the i18n "Goals" heading, or null (used to decide whether to show the section).

- [ ] **Step 1: Write the failing tests** — `goalsPanel` returns null lines when there are no open goals; a lap-on-route line first, then long, then total; at most `max` with `more`; `racing` empties it; finished/reached dropped.
- [ ] **Step 2: Run to see them fail.** `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/goalsView.test.js`
- [ ] **Step 3: Implement `goalsPanel`** and the i18n keys (en + de).
- [ ] **Step 4: Run to see them pass**, plus `test/i18n*.test.js`.
- [ ] **Step 5: Commit** `feat(client): Order the ride's goals for a left-hand list`.

### Task 2: The shared left column and the goals section

**Files:**
- Modify: `client/public/index.html` (add `#hud-left` with `#hud-goals` inside `#hud`, outside every `.layout-*`; remove `#goal-pill`)
- Modify: `client/public/styles.css` (`.hud-left`, `.hud-goals`; per-layout placement; move `.nearby` into the column for broadcast/race; phone + landscape collapse; studio hides it)
- Modify: `client/public/js/main.js` (remove `updateGoalPill` and its call; add `renderGoalPanel()` driven by the menu/status refresh)
- Modify: `client/public/js/i18n/en.js`, `de.js` (remove the now-unused `goals.pillTitle`; `i18nHtml.test.js` fails on unused keys)
- Test: `client/test/goalsView.test.js` (Task 1's); `client/test/i18nHtml.test.js`

**Interfaces:**
- Consumes: `goalsPanel` (Task 1), `liveGoals()`, `menuStatusContext()` in `main.js`.
- Produces in `main.js`: `renderGoalPanel()` that reads `goalsPanel(liveGoals(), { routeId: app.route?.id, racing })` and shows/hides `#hud-goals`.

- [ ] **Step 1: Failing test** for any pure gap found (e.g. a test that the goals section is empty in a race).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the markup, CSS and wiring. `#hud-goals` is a `.glass` panel with a small "Goals" heading and a `<ul>`; each `<li>` is a line, `+N more` at the end. Broadcast/race: move `.nearby` (and race groups) into `#hud-left` under `#hud-goals` so they stack. Phones (`max-width: 520px`, and `max-height: 500px; orientation: landscape`): `#hud-goals` shows one line only. Studio: `#hud-goals` hidden under `data-mode="studio"`.
- [ ] **Step 4: Suite + lint, expect PASS.**
  `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm test && npm run lint"`
- [ ] **Step 5: UI check** with Playwright across the four layouts (choose each with the layout control), phone portrait, phone short-landscape, and the studio: the goals list shows top-left, above the nearby list in broadcast/race, one line on phones, absent in the studio. Screenshots.
- [ ] **Step 6: Commit** `feat(client): Show the ride's goals in a left-hand list, not a pill`.

### Task 3: The goal line on the phone cockpit

**Files:**
- Modify: `client/public/js/display/displayFrame.js` (`goals` field)
- Modify: `client/public/js/view/goalsView.js` (a `goalLine`-based short string already exists; reuse it) and `main.js` (pass the goal line into `displayFrame`)
- Modify: `client/public/js/cockpit/tiles.js` (a text tile `goals`), `cockpit/cockpitModel.js` if the model must carry it
- Modify: `client/public/js/i18n/en.js`, `de.js` (`cockpit.tile.goals`)
- Test: `client/test/displayFrame.test.js`, `client/test/cockpit/*.test.js`, `client/test/i18n*.test.js`

**Interfaces:**
- Consumes: `goalsPanel`/`goalLine`.
- Produces: `displayFrame(...)` gains `goals: string | null` (the top line, or null); a cockpit tile `goals` reading `model.goals`.

- [ ] **Step 1: Failing tests** — the frame carries the goal line and stays under the byte limit; the tile returns the line and `"–"`/hidden without one.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, add i18n keys, `npm run preload`.
- [ ] **Step 4: Suite + lint, expect PASS;** UI check of the cockpit page with a goals tile (screenshot).
- [ ] **Step 5: Commit** `feat(client): Show the goal on the phone cockpit`.

### Task 4: Docs

**Files:**
- Modify: `docs/architecture.md` ("Ride screen": the left column and the goals list; the pill gone)
- Modify: `docs/superpowers/specs/2026-11-14-goals-on-the-ride-screen-design.md` (mark decisions done, note what shipped)

- [ ] **Step 1: Update the architecture table** (the four layouts' left column) and the design doc.
- [ ] **Step 2: Commit** `docs: Note the ride screen's goals list`.

## Out of scope

- NPC quests (the column reserves their place; the quest system is a later milestone #98 step).
- Moving the other status pills.
- Goals in the studio.
