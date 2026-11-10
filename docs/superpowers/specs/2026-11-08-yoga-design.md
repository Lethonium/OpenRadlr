# Yoga — design

Date: 2026-11-08 · Issue: #26 · Sub-project 1 of
`2026-11-07-whole-body-workouts-roadmap.md` · Status: agreed in brainstorming

## Goal

Yoga classes at the café gyms, aimed first at **cyclists after a ride** (short
sessions for what riding tightens: hip flexors, hamstrings, lower back, chest),
in a format that also carries longer classes later. Every class names what it
is based on. Yoga is the first sub-project to add exercise ids, so it also
builds the pipeline the bodyweight sub-project reuses.

## Decisions

| Question | Decision |
|---|---|
| Audience | Short cyclist sessions first; longer classes fit the same format later |
| Flows | A flow is **one exercise**: `sun_salutation` is a block whose clip loops one round |
| Two-sided poses | **One block covers both sides**: right for the first half, left for the second |
| Guidance | Name plus **one translated cue line** per pose; a TTS teacher can read the same keys later |
| Side visibility | The side is **rider state on the wire**, so every rider (and later a group class) sees the switch |
| Protocol version | No bump: only additions, like the workout additions within version 2 |

## Poses

Seven new exercise ids. The bodyweight exercises are unchanged.

| id | Kind | Sided | Statue plinth | Works on |
|---|---|---|---|---|
| `sun_salutation` | flow: 9 positions, one breath (~4 s) each, a ~36 s round, looped | no | upright (upward salute, arms overhead) | warm-up, whole body |
| `forward_fold` | hold, breathing loop | no | upright | hamstrings, back |
| `downward_dog` | hold, breathing loop | no | lying | hamstrings, calves, shoulders |
| `cobra` | hold, breathing loop | no | lying | chest, front of the trunk |
| `child_pose` | hold, breathing loop | no | lying | lower back, rest |
| `low_lunge` | hold, breathing loop | yes | lying | hip flexors |
| `pigeon` | hold, breathing loop | yes | lying | glutes, outer hip |

Sun Salutation A positions (Ashtanga count): upward salute, forward fold, half
lift, plank to chaturanga, upward dog, downward dog, half lift, forward fold,
upward salute; back to standing. The clip keys follow that order and are planted
on the feet (the hands are planted while down). Held poses breathe on a 4–6 s
loop, like `plank`, planted on what touches the mat.

Warrior II and balance poses wait for the longer classes.

## Classes

All three are held at **Beach Café** (the yoga deck). Times exclude the 30 s
Get ready the client adds to every plan.

**Sun Salutation A** (`sun-salutation`, ~4 min): `sun_salutation` 180 s (five
rounds), `child_pose` 60 s. Basis: the Ashtanga practice opens with five rounds
of Surya Namaskara A, nine vinyasas each
([ashtangayoga.info](https://www.ashtangayoga.info/practice/surya-namaskara-a-sun-salutation/opt/vinyasa/)).

**Post-ride cool-down** (`cool-down`, ~9 min): `forward_fold` 60, `low_lunge`
120, `pigeon` 120, `downward_dog` 60, `cobra` 45, `child_pose` 90, with 10 s rest
between poses. Basis: the ACSM flexibility guideline (holds of 10–30 s, about
60 s in total per muscle group; longer single holds may blunt strength and
power), [ACSM 2021 update](https://www.acsm.org/blog-detail/acsm-certified-blog/2021/03/18/stretching-and-flexibility-guidelines-update),
and common practice for riders. Holds stay at or under 60 s per side.

**Hip and hamstring flow** (`hip-flow`, ~15 min): `sun_salutation` 72 (two
rounds), `low_lunge` 120, `forward_fold` 60, `pigeon` 120, `downward_dog` 60,
`low_lunge` 120, `pigeon` 120, `forward_fold` 60, `child_pose` 90, with 10 s rest
between poses. Basis: as the cool-down, with a second round per muscle group.

The descriptions say exactly this. No trial of yoga in cyclists was found, so
none is cited.

## Client

**Exercise registry.** `EXERCISES` in `workout/plan.js` stays the single list.
Each entry may have `cue` (a getter on `workout.cue.<id>`) and `sided: true`
(`low_lunge`, `pigeon`). The seven new entries get both a name and a cue; the
bodyweight entries get cues too, so the HUD line is never empty during an
exercise.

**Session.** For a sided block `WorkoutSession` sends
`workout { exercise, side: "right" }` when the block starts and
`workout { exercise, side: "left" }` once at its midpoint (half the block's
plan seconds), with a single beep if beeps are on. The position it reports
carries `side` for sided blocks, so the HUD shows the cue line in the first half
and `workout.switchSides` ("Switch sides") in the second. Skipping or pausing
behaves as for any block: the midpoint is plan time.

**HUD.** The workout timer card gets one line under the exercise name: the
cue, or "Switch sides". It is empty at rest.

**View.** A new pure function `mirrorPose(pose)` in `view3d/clips.js` swaps
every L/R joint pair (the sideways `#z` angles count outward on both sides, so
swapping is enough; the spine and neck have no sideways joint and the root no
sideways component). The clip's `plant` is mirrored with it (`footR` ↔ `footL`). `#workoutParts` mirrors a rider whose `side` is
`"left"`; a side change does **not** restart the clip (`exerciseSince` stays)
and crossfades over `CLIP_FADE_S` like a clip change. My own rider uses the
session's side at once instead of waiting for the server's echo, in the way my
`exerciseSince` already comes from the block start.

**Clips and statues.** Seven clips in `CLIPS`, seven `STATUE_MOMENT` entries
(plinth kinds above). A statue shows the right side.

**Venues and menu.** `VENUES["beach-cafe"]` becomes `category: "yoga"`
(sandstone stays); the Core preset moves to `forge-hut`, so Forge Hut gets its
first statues (sit-ups, plank, push-ups in granite). The cards get a Yoga tag
(`workout.category.yoga`). `EXERCISE_COLORS` gets seven calm greens and blues,
distinct from the bodyweight oranges and reds.

**Translations.** `en.js` and `de.js`: per pose `workout.exercise.<id>` and
`workout.cue.<id>`; cues for the six bodyweight exercises; the three class
names and descriptions; `workout.switchSides`; `workout.category.yoga`.

## Server and protocol

- `Exercise` (in `protocol.rs`) gets the seven ids and `fn sided(self) -> bool`.
- New `enum Side { Right, Left }` (snake_case on the wire). `RiderTags` gets
  `side: Option<Side>`.
- `ClientMessage::Workout` gets `side: Option<String>`, default absent. A
  sided exercise without a side counts as `right`; a side on a non-sided
  exercise or on rest is dropped; an unknown side value is refused with
  `unknown_side`.
- The rider state sends `side` for sided exercises only, left out otherwise.
- `docs/protocol.md`: the new ids, the `side` field on `workout` and on
  `riders[]`, the `unknown_side` error, and a line in the version-2 additions.

No version bump: the server serves the client from the same build, old clients
never send the new ids or field, and an absent side has a meaning.

## Testing

Client (`node --test`):
- plan: the new ids load; `sided` and `cue` are set as listed; every exercise
  has a cue.
- presets: the three classes load and total the lengths above; Core is at
  `forge-hut`.
- workoutSession: a sided block sends `side: "right"` at its start and exactly
  one `side: "left"` at the midpoint, with one beep; the position reports the
  side; a non-sided block sends no side.
- clips: `mirrorPose(mirrorPose(p))` equals `p`; every L/R pair swapped;
  every exercise has a clip and a `STATUE_MOMENT`.
- view3d: another rider with `side: "left"` is mirrored; a side change keeps
  the clip time.
- venues: Beach Café is yoga with the seven poses as figures; Forge Hut has
  Core's figures.
- workoutCards: the Yoga tag; every exercise has a colour.
- i18n key sweep: every new key in both languages.

Server (`cargo test`): the new ids parse and serialize; `side` is stored and
broadcast for sided exercises, dropped for others, refused when unknown; a
sided exercise without a side reports `right`.

By eye: a Playwright screenshot per pose at the Beach Café gym, and one of the
statue row.

## Docs

`docs/workouts.md` (poses, classes, venue table, side switch), `docs/protocol.md`,
CHANGELOG under Unreleased (#26), and the roadmap's sub-project table.

## Out of scope

Warrior II, balance poses and longer classes; TTS; group yoga at the end of a
ride (the cross studio); rep counting.
