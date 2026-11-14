# Where season goals (and later quests) live on the ride screen

Investigation and design, 2026-11-14. Follow-up to season goals (#99), part of the
Progress and motivation milestone (#98). Client only.

## Problem

The season goal shows in the ride HUD as **one pill in the shared status row**
(`#goal-pill` in `.hud-status`, `view/goalsView.js` `hudGoal`, `main.js`
`updateGoalPill`). The status row is a centred flex of small pills ("Free ride",
drafting, ghost gap, race group, sharing, "Power only"). Putting the goal there:

- mixes a slow, self-chosen intention with fast, transient status (draft, ghost gap,
  group gap), which read as "what is happening right now";
- competes for the one-line, nowrap space, so a long goal line ("Long ride 31 / 41 km")
  squeezes out the status pills beside it, and vice versa;
- sits front and centre on the screen, the most valuable space, for something that
  changes at most once a second and rarely — unlike the pills next to it.

The user's direction for the milestone: later add **NPC quests**, and quests are
conventionally a **list on the left** of the screen, not pills. Season goals belong in
that same list. So the goal should move out of the status row and into a left-hand
**goals/quests list** that, for now, holds season goals and later grows quests.

The constraint: it must work on **all four ride HUD layouts** (cockpit, broadcast,
training, race), plus the studio layout and the separate phone cockpit page, not just
the layout we happen to look at.

## What exists today (the four layouts)

`view/hud.js`: `LAYOUTS = ["cockpit", "broadcast", "training", "race"]`;
`chooseLayout` picks one from the rider's choice or the ride (race > workout > free
ride). `#ride` carries `data-layout` and CSS shows the matching `.layout-*` block. A
fifth, `.layout-studio`, replaces them in the studio (`data-mode="studio"`). Everything
outside `.layout-*` (the `hud-info` bar top-left, `hud-actions` top-right, gear tile,
`.hud-notices`, lane/sim controls) is **shared by every layout**.

Where the shared pieces sit, and where the left side is already used:

| Area | Position / what uses the left | Conflicts for a left list |
| --- | --- | --- |
| `.hud-info` (brand, route, km · time · avg) | top-left, shared | a left list must start below it |
| `.hud-status` (pills, incl. the goal pill) | `position: absolute; left: 50%; top: 92px` (broadcast & race `140px`; phone `66px`; landscape `var(--gap)`) | centred, not left — but it's the thing we're moving the goal *out of* |
| **cockpit** | centred power gauge at the bottom (`bottom: 28px`) with a scrim; nothing on the mid-left | **free** mid-left |
| **broadcast** | `.nearby` rider list at `left: var(--gap); top: 140px; width: 300px`; minimap top-right; lap strip bottom | **taken** by the "Nearby" list |
| **training** | workout chip + chart in the bottom band; 3D view shrinks to the top | **free** upper/mid-left (the band is bottom) |
| **race** | `.nearby`-style list and groups; race timeline | **taken** by riders/groups on the left |
| studio | `.layout-studio` block; ticker moved to the right, coach cue top centre | **free** mid-left |
| phone cockpit page (`cockpit.html`) | a tile grid the rider arranges; **no goal data at all** | needs new frame field + tile |

Consequences:

1. A left list is **free** in cockpit and training, but **collides with the rider list**
   in broadcast and race, which already own `left: var(--gap); top: 140px; width: 300px`.
2. The phone cockpit (second screen) has **no goal data**: the opaque `display` frame
   (`display/displayFrame.js`) would need a goal line added, within its 2048-byte
   budget, plus a new catalog tile (`cockpit/tiles.js`).
3. Small screens (`.hud-status` moves to `top: 66px` on phones, `var(--gap)` in
   landscape) have little vertical room; a left list must collapse, not stack on the
   status row.

## Options

**1. Left list in every layout, stacked with the rider list where one exists.**
Cockpit and training show the goal list mid-left. Broadcast and race put the goal list
*above* the nearby list (or share one "left column" that stacks goal list + nearby
list). One widget, one position, every layout. Cost: broadcast/race left column gets
taller; on short screens it squeezes both.

**2. Left list in cockpit and training; a compact line elsewhere.**
The mid-left is free only in cockpit and training, so the list goes there. Broadcast
and race keep the goal as a compact single line (still out of the centred pill row —
e.g. under the nearby list heading, or a slim left item). Cost: two presentations of
the same thing.

**3. A shared left column component, ordered by what the layout has.**
Introduce one `LeftColumn` (or reuse an existing container) that holds optional
sections in this order: **Goals/Quests**, then the layout's own left content (nearby
riders, race groups). Cockpit and training show only the goals section; broadcast and
race show goals above riders. On small screens the column collapses to a toggle/edge
drawer. This is option 1 generalised and made future-proof for NPC quests.

**4. Keep a pill but move it.** Rejected: the user explicitly wants a list, and a pill
anywhere still carries the "transient status" reading.

## Recommendation

**Option 3**, built in two steps so this PR-sized follow-up stays small:

- **Step A (this work): a "Goals" block at the top of a shared left column**, rendered
  by one component reused across layouts. It shows the active goals as a short list —
  each a title line and this week's step ("2,000 km by March · this week 79 / 80 km ✓"),
  the same items `goalLine`/`goalCard` already produce, no edit buttons. In cockpit and
  training it is the only thing on the mid-left; in broadcast and race it sits above
  the existing nearby list. The HUD pill is removed (`#goal-pill` and
  `updateGoalPill`). Empty/without goals: nothing.
- **Step B (later, with quests): the same column hosts NPC quests** below the goals,
  under a "Quests" heading, when the quest system lands (#98 follow-up). The design of
  the column already reserves the place; quests need no second widget.

For the phone cockpit (second screen), the goal appears as a **new catalog tile**
reusing the same line, fed by a new `goals` field in the `display` frame (one short
string, well under the frame budget). This keeps the "arrange your own cockpit" model
rather than imposing a fixed block.

## Design details

### The left column

- A shared container `.hud-left` inside `#hud` (not inside a `.layout-*`), positional,
  like `.hud-notices` and `.hud-info`. It stacks sections; Step A adds one section,
  `.hud-goals`.
- Default place: `left: var(--gap)`, below `.hud-info` (`top` clears the info bar).
  Cockpit and training: only `.hud-goals` sits there. Broadcast and race: the layout's
  `.nearby`/groups move **into** the column below `.hud-goals`, so the two never
  overlap (instead of two absolutely-positioned left boxes at `top: 140px`).
- Styling: the existing `.glass` panel look, the goal lines use the profile card's
  vocabulary but short — a checklist, not a dashboard wall (season-goals anti-goals).
  Done steps keep the ✓; recovery weeks keep "easy week".

### Per layout

| Layout | Left column |
| --- | --- |
| cockpit | `.hud-goals` only, mid-left above the gauge's left edge |
| training | `.hud-goals` only, upper-left (the workout band owns the bottom) |
| broadcast | `.hud-goals` above `.nearby` |
| race | `.hud-goals` above the groups/nearby list |
| studio | none: the studio leaves the left free, but goals are left out there for now (workouts don't count toward goals; revisit with quests) |

### Small screens

- Phones (portrait, `max-width: 520px`) and short landscape
  (`max-height: 500px; orientation: landscape`): the column must not eat the little
  height. Collapse `.hud-goals` to **one line** (the HUD's former pill content) at the
  top-left under `.hud-info`, or hide it behind a small goals button that opens a
  sheet. Pick one in the plan after checking both breakpoints; default: one line, no
  button, so it stays glanceable.
- Verify against the existing phone/landscape rules that already move `.hud-status`
  (`top: 66px`, `var(--gap)`) and the paddling variant (`body.paddling`).

### Seat-count / rider-list interplay (broadcast, race)

- The nearby list is currently `position: absolute; left; top: 140px; width: 300px`.
  Move it into the column so both are flow-siblings; the column grows downward and
  never double-books `top: 140px`.
- If both are long (5 goals + many riders), the column caps its height and the lower
  section scrolls, or the goals list caps at 3 visible items with "+2 more" (a goal is
  slow; the top 3 are the most relevant, ordered like the HUD's `hudGoal` priority:
  lap on this route, then long ride, then total).

### What it shows

- Reuse `goalsView.js`: one line per active goal via `goalLine(goal, week)` (the same
  text the pill and menu status use), ordered by `hudGoal`'s relevance rule so the most
  relevant is on top. Reached/finished goals drop out as today. Live numbers from
  `liveGoals()` in `main.js`, updated with the menu/status refresh (at most once a
  second), not per frame.

### Phone cockpit (second screen)

- Add `goals: string | null` to the `display` frame (`display/displayFrame.js`),
  set from the same `goalLine` of the most relevant goal; keep it one short string.
- New catalog tile `goals` in `cockpit/tiles.js` (a text tile, not a number tile),
  hidden when the frame has none. The rider adds it in edit mode like any tile.
- Check `DISPLAY_LIMIT_BYTES` (2048) headroom: one line is ~40–60 bytes.

### Tests

- `goalsView.js` / a new pure `goalsPanel(entries, {routes, locale})` returning the
  ordered lines, tested in en/de and metric/imperial (reuse `goalLine` cases).
- `main.js` wiring is not unit-tested (DOM); the pure ordering and line building are.
- `displayFrame.test.js`: the frame carries the goal line and stays within the byte
  limit; `tiles.test.js`: the goals tile renders the string and hides without one.
- `modulePreload` after adding modules; `npm run preload`.
- UI check with Playwright across the four layouts + phone portrait/landscape + studio:
  screenshots of the left column in each (the four-layout matrix the user asked for).

## Non-goals

- Quests/NPCs themselves (later, milestone #98).
- Moving the other status pills (draft, ghost gap, group gap, sharing, power-only): they
  are transient status and stay in the centred row. Only the goal leaves.
- A goals dashboard on the ride screen: one short line per goal, top 3, as above.
- Anything that changes the simulation or the server (still cosmetic/meta only).
- Editing goals during a ride (that stays on the profile, before a ride).

## Decisions (2026-11-14)

1. **Broadcast and race:** the goals list sits **above** the nearby riders, both in
   the shared left column.
2. **Phones:** one glanceable line, no button or sheet.
3. **Studio:** no goals section for now (revisit with quests).

## Left to the builder

- Exact column width, spacing and glass styling within the existing HUD CSS.
- Phone collapse markup and wording for the one line (reuse `goalLine`'s text).
- Whether the cockpit tile is added by default to new cockpit layouts or offered in the
  add-tile catalogue only.
