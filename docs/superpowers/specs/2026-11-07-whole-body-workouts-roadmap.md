# Whole-body workouts — roadmap

Date: 2026-11-07 · Issue: #26 · Status: agreed direction; each sub-project still
gets its own spec, plan and PR

## Why

Workouts are where OpenRadlr can stand out from other indoor cycling apps: a
whole-body offer that combines **cycling, bodyweight exercise and yoga**, and
later joins them in one session (ride → bodyweight → yoga cool-down, the cross
studio of #26). Every workout we ship is **based on a real, published protocol**
rather than invented, and its description names the source.

Yoga fits the existing café-workout machinery: it is time-based, a class is a
sequence of figures (poses), and the avatar shows each one.

## Sub-projects

| # | Sub-project | State |
|---|---|---|
| 0 | UI fixes for the shipped workout | in review (`fix/workout-ui`) |
| 1 | Yoga | after 0 |
| 2 | Cycling (ERG) library | after 1 |
| 3 | Bodyweight exercises and research-based presets | after 2 |
| — | Themed gyms and statues | done, #35, spec `2026-11-05-workout-venues-design.md` |

Order: yoga moves ahead of the other content sub-projects, at the user's request
(2026-11-07). Because of that, yoga is the first sub-project to add exercise ids,
so it carries the extension work that the old order had given to the bodyweight
sub-project: the server enum, the protocol docs, clips, statue moments and
translations. Sub-project 3 then reuses it.

### 0. UI fixes (bugs in the shipped workout)

Reported on a real device after #35:

- **Flicker** on the gym pad and the plinths (coplanar surfaces; z-fighting).
- **Camera angle during the workout**: too far and high; the rider is small at
  the right edge and the timer card covers the gym.
- **Black screen while the world builds** when joining a workout, instead of the
  usual 2D view or another preview.
- **Empty blue rectangle** beside the statue in the menu preview (already
  visible in the #35 screenshots as a dark rectangle in the middle).
- ~~Workout card list clipped and running off the right edge~~: not a bug. The
  list scrolls inside its panel, and nothing overflows at 1024–1366 px in
  German; the photo was cropped.

These are bugs in existing code: debug each, then a short design, no spec. One
PR.

### 1. Yoga

- Poses are exercises: held, or with a slow breathing clip, time-based like
  every block. Rep counting is not needed.
- Classes (each cites its source or tradition): **Sun Salutation A**, a
  **post-ride cool-down**, a **hip and hamstring flow**.
- Candidate poses, to be picked in the spec: mountain, forward fold, downward
  dog, cobra or upward dog, child's pose, low lunge, warrior II, pigeon.
- A "Yoga" category in the menu cards.
- Venues (planned in ADR 0019): **Beach Café becomes the yoga deck**;
  **Core moves to Forge Hut** (granite, strength and core), Forge Hut's first
  preset. The statues follow automatically from the presets.
- Touches: `Exercise` enum in `server/crates/server/src/protocol.rs`,
  `docs/protocol.md`, `view3d/clips.js` (clip, `STATUE_MOMENT`, plinth kind per
  figure), `workout/presets.js`, `workout/venues.js`, `EXERCISE_COLORS`, i18n
  (`en.js`, `de.js`), `docs/workouts.md`.
- Open: does a new exercise id need a protocol version bump (an old server
  rejecting unknown ids)? Decide in the spec.

### 2. Cycling (ERG) library

The ERG library (`client/public/js/ride/workout.js`) has four sessions:
Endurance 45, Sweet Spot 3×8, VO2max 5×3, ERG check 10. Add research-backed
sessions, each with its source in the description. Candidates:

- **Seiler 4×8 min** (Seiler et al. 2013, Scand J Med Sci Sports).
- **Rønnestad 30/15**, 3 series of 13 × 30 s on / 15 s off (Rønnestad et al.
  2015, Scand J Med Sci Sports).
- **40/20** intervals and **threshold over-unders**: common coaching sessions;
  find a citable source in the spec or label them as coaching practice.

Mostly data and translations, no 3D work. "Improved ERG workouts" may also mean
presenting them better (e.g. cards with a block strip like the café workouts);
decide the scope at the start of the spec.

### 3. Bodyweight exercises and research-based presets

- New exercises the published protocols need: wall sit, lunges, high knees,
  step-ups on the gym bench, triceps dips on the bench, side plank. Each needs a
  clip, a statue moment, an enum entry and translations (the pipeline from
  sub-project 1).
- Presets with sources: the **7-minute workout** (Klika & Jordan 2013, ACSM's
  Health & Fitness Journal), **Tabata's original protocol** (Tabata et al. 1996,
  Med Sci Sports Exerc) next to the existing Tabata preset, and strength presets
  for Forge Hut.
- First exercises that use gym equipment (bench); equipment spots are open in
  `docs/workouts.md`.

## Later (not in these sub-projects)

From #26 and `docs/workouts.md` "Not yet": the combined ride → bodyweight →
yoga session (cross studio), the workout studio with a timetable, road
circuits, FIT export and Strava upload for workouts, rep-based sets, custom
plans and plan import, server-side venues.

## Sources to verify

Every citation above was named from memory when this direction was agreed
(2026-11-05). Each sub-project's spec checks the protocol details against the
paper before the preset is written.
