# Workout venues and statues — design

Date: 2026-11-05 · Issue: #26 (groundwork) · Status: agreed in discussion, awaiting spec review

## Goal

Each café workout happens at its own outdoor gym, and the figures you will do
stand around that gym as statues. In the start menu the workouts become cards
with a block strip and a list of figures; picking a card flies the drone to its
gym, picking a figure flies close to its statue. During a workout the statue of
the next exercise glows in every rest. The preview stays inside the world
instead of in a dialog.

This is the first of four sub-projects for a whole-body offer (workout cards
and venues; more research-based cycling workouts; more bodyweight exercises and
presets; yoga). It uses only the six existing exercises and three presets; the
later sub-projects add figures, and the statues follow automatically.

## Decisions

| Question | Decision |
| --- | --- |
| Gym and workout | A gym hosts a **category**, not one workout; a preset names its venue (café id) |
| Venues | Valley Café: full body (marble). Hilltop Café: HIIT (bronze). Beach Café: core (sandstone) until yoga arrives, then core moves to Forge Hut. Forge Hut: strength (granite), no preset yet |
| Where venues live | Client data (`workout/venues.js`). No server or protocol change |
| Which route to join | The first route offered in `/api/info` whose start lies within 30 m of the venue's café; otherwise the default route as today |
| Statues | The rider body frozen at a defining moment of its clip, on a plinth, in the venue's material; one per distinct figure of the presets held there |
| Statue rendering | A separate per-gym layer built on the main thread, not baked into the worker's chunks, so a row can be rebuilt and the highlight switched |
| Menu | Preset `<select>` replaced by cards (radio group) with a block strip; the selected card lists its figures as chips |
| Camera | Card → drone flies to the venue's gym; chip → close shot of that statue, swinging ±20° |
| In the workout | During rest blocks (get-ready included) the next exercise's statue glows; off during exercise blocks. Local only |
| Out of scope | Yoga, new exercises, new presets, server-side venues, highlights while riding past, the in-game menu |

## Venues

`client/public/js/workout/venues.js`, pure and frozen:

```js
export const VENUES = Object.freeze({
  "valley-cafe": { category: "fullBody", material: "marble" },
  "hill-cafe": { category: "hiit", material: "bronze" },
  "beach-cafe": { category: "core", material: "sandstone" }, // core moves to forge-hut with yoga
  "forge-hut": { category: "strength", material: "granite" },
});
```

- Every preset in `presets.js` gets `venue`: `full-body` → `valley-cafe`,
  `tabata` → `hill-cafe`, `core` → `beach-cafe`. `createPlan` keeps the field;
  an unknown venue is a load error (like an unknown exercise).
- `figuresAt(venueId, presets)` returns the distinct exercise ids of the presets
  held at that venue, in order of first appearance across those presets.
  Valley: the six exercises; Hilltop: squats, burpees; Beach: sit-ups, plank,
  push-ups; Forge Hut: none.
- `venueRoute(venueId, routes, cafes)` returns the id of the first route (in
  `/api/info` order) whose start lies within 30 m of the café node with that id,
  or `null`. `routes` are the offered routes with their start positions, `cafes`
  the map's café nodes. `joinWorkout` uses it, falling back to
  `workoutRoute(info)` (the default route).
- A venue without presets keeps its gym as today, without statues, and nothing
  in the menu points to it.

The history record and the saved `workoutPreset` preference are unchanged.

## Statues

### Placement

The gym model's pad spans local x −8.6…8.6 and z −3.6…6.6, with the bench at
z 4.8 and the mat at the origin; local −z faces the road. The statue row stands
behind the pad at local z ≈ 8, plinths spread evenly over x −7.5…7.5 (one
statue centred, six at 3 m spacing), facing the road. `buildOutdoorGym`
reserves that strip in the occupancy grid and returns, besides `center`, `yaw`
and `spots`, the gym's `cafeId` and a `statueRow` transform (origin and yaw).
On worlds without a road network a gym has `cafeId: null`.

### Figure

`clips.js` gets `STATUE_MOMENT`, the clip time at which each exercise is shown:

| Exercise | Moment |
| --- | --- |
| squats | bottom of the squat |
| pushups | arms bent, chest low |
| plank | the hold |
| situps | halfway up |
| jumping_jacks | arms and legs out |
| burpees | top of the jump |

The statue is the rider's body parts (no bike) posed with
`bodyTransforms(poseAt(clip, t))`, scaled 1.15×. Upright figures (squats,
jumping jacks, burpees) stand on a 0.9 × 0.9 m plinth 1 m tall; lying figures
(push-ups, plank, sit-ups) on a 2 × 0.8 m plinth 0.6 m tall. Which plinth a
figure gets is part of the table, so a later exercise states it.

### Material

Flat colours per material, the plinth a darker shade of the figure's:
marble warm white, bronze dark gold with a green-patina band at the plinth's
top edge, sandstone ochre, granite speckled grey (per-face variation). The
look is the same in every biome.

### Layer

`client/public/js/view3d/statues.js`: `buildStatues(figures, material)` returns
the meshes of one row (figures with plinths, plus one glow ring per plinth),
in the row's local frame. The scene keeps one statue layer per gym, drawn
like the studio scene's meshes, placed with the gym's `statueRow`. A row is
built once when the world is ready, from `figuresAt(gym.cafeId)`.

Fallback: when the picked workout's venue has no offered route and the rider
is sent to the default gym, that gym's row is rebuilt with the picked workout's
figures (and its venue's material), so the preview matches what you will do.
It goes back to its own figures when another card is picked.

## Menu

### Cards

The workout tab replaces `#workout-preset` (a `<select>`) with a radio group of
cards; arrow keys move between them, the saved `workoutPreset` is preselected,
and the first preset otherwise. A card shows the name, the duration, the
category tag (translated: Full body, HIIT, Core, Strength), the café's name from
the map node (not translated, as everywhere), the description, and the block
strip. The cue checkbox and **Start workout** stay below, unchanged.

### Block strip

`blockStrip(plan)` (pure) returns `{fraction, kind, exercise, label, seconds}`
per block of the stored plan; the get-ready block is not part of it. It renders
as a flex row of divs: exercise blocks in the exercise's colour from a fixed
palette (`EXERCISE_COLORS`, one per exercise id), rests pale neutral. Each
segment has `title` and `aria-label` "Push-ups 40 s"; on touch, tapping a
segment writes that text into the card's hint line. Only `textContent` is
used.

### Figures

The selected card shows one chip per distinct exercise, in strip order, in the
same colour as its segments. Selecting a chip flies to its statue; selecting it
again, picking another card or Escape returns to the gym orbit.

### Camera

- Selecting a card (or opening the tab) calls `showGym(gym)` with the gym of
  the card's venue, or the default gym in the fallback.
- New `showStatue(gym, index)` and pure `statuePose(gym, index, overview,
  angle)`: the eye about 4.5 m in front of the plinth and 2 m above its top,
  looking at the figure's chest, swinging ±20° around it over time. Kept above
  the ground like `gymPose`. Flights blend as today; with reduced motion the
  camera cuts.
- Before the world is built the cards and strips work; the camera follows once
  the gyms exist.

## In the workout

`highlightedFigure(position, figures)` (pure) takes `planPositionAt`'s result
for the plan with its get-ready block and returns the index of the next
exercise's statue during a rest block, else `null` (exercise block, finished,
or next exercise without a statue at this gym). `main.js` calls it every frame
and passes the index to the gym's statue layer, which draws only that glow
ring (a strip of the unlit `bright` layer around the plinth top). Pausing
leaves it as it is. The glow does not pulse, so reduced motion needs nothing.
It is local: other riders at the gym see their own highlight or none, and no
message goes over the wire.

## Testing

Client tests, plain node, written first:

- `venues.test.js`: `figuresAt` order, no duplicates, venue without presets;
  `venueRoute` picks the route at the café, the first in `/api/info` order,
  and `null` without one; presets with an unknown venue fail to load.
- Clips: every id in `EXERCISES` has a `STATUE_MOMENT` and a plinth kind; the
  posed body stays above the plinth top.
- `statues.test.js`: one figure per exercise, plinth kind by figure, venue
  colours, row width for 1…6 figures, a glow ring per plinth.
- Menu camera: `statuePose` in front of the plinth, looking at it, within
  ±20°, above the ground; flights between gym orbit and statue.
- `blockStrip` (fractions sum to 1, rests marked, no get-ready) and
  `highlightedFigure` (rest → next, exercise → null, end → null, missing
  statue → null).
- Start menu: card text and tags, preselection, strip segments and chips.

`make check` passes (server tests untouched). Playwright screenshots of the
workout tab at each gym, a statue close-up and the glow during get-ready.

## Docs

- `docs/workouts.md`: venues, statues, cards, highlight; "Not yet" gains
  server-side venues.
- ADR 0019 "Workout venues as client data": category per gym, statues as their
  own layer, local highlight, venues not on the server.
- `CHANGELOG.md` under `[Unreleased]` with #26; en and de strings.

## Delivery

Branch `feat/workout-venues` from `main`, one PR with ordered commits
(venues and route choice; statues; cards and strip; camera; highlight; docs).
