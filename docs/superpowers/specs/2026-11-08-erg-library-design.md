# Cycling (ERG) library — design

Date: 2026-11-08 · Issue: #26 · Sub-project 2 of
`2026-11-07-whole-body-workouts-roadmap.md` · Status: agreed in brainstorming

## Goal

Add research-backed interval sessions to the ERG library, each naming what it is
based on, and show riders the shape of a session before they start it.

## Decisions

| Question | Decision |
|---|---|
| Scope | New sessions plus a preview under the existing dropdown. No cards |
| Sessions | Seiler 4×8, Rønnestad 30/15, 40/20, over-unders |
| Intensity | **Fixed % of FTP**, chosen by us, and each description says so |
| Over-unders | Kept, labelled as coaching practice: no peer-reviewed protocol was found |
| Source | In the description text, translated. No new data field |
| Server and protocol | No change: ERG sessions run entirely on the client |
| Base branch | `origin/main`. Yoga (#43) does not touch `ride/workout.js`, so the two PRs stay independent |

## Why the intensities are ours

The studies prescribe **effort, not power**. Riders went as hard as they could
sustain, and the prescription was adjusted as they went. ERG needs a fixed
target, so the percentages below are our estimate of those efforts and are not
published numbers. Riders correct them with the existing ERG intensity control
(+/− during a workout, `trainingControl.js`). Every description says this.

## Sources checked

| Source | What it says | How it was checked |
|---|---|---|
| Rønnestad, Hansen, Vegge, Tønnessen, Slettaløkken 2015, Scand J Med Sci Sports 25:143–151, doi 10.1111/sms.12165 | 3 series of 13 × 30 s on / 15 s off, 3 min between series; recovery at 50 % of work power; first intervals at power at VO2max, then adjusted to each rider's highest sustainable power; trained to well-trained cyclists | Full text, Methods and Table 2 |
| Seiler, Jøranson, Olesen, Hetlelid 2013, Scand J Med Sci Sports 23:74–83, PMID 21812820 | 4 × 8 min at "maximal tolerable intensity" (90 ± 2 % of peak heart rate) gave greater gains than 4 × 4, 4 × 16 or low intensity only, in trained recreational cyclists | Abstract only |
| ClinicalTrials.gov NCT04075929 | 4 sets of 8 or 12 × 40/20 s with 2 min between sets, compared with 4 × 8 min with 2 min recovery; completed 2017 | Registry record. Its arm labels are swapped against their descriptions; we use the 8-rep sets, which total 32 min like the 4 × 8 |
| INSCYD and BikeTips articles on over-unders | 2 min around 95 % and 1 min around 105 % of threshold, in sets | Coaching articles; no peer-reviewed protocol found |

Not confirmed: the 2 min recovery of Seiler's 4 × 8 is not in the abstract. It
comes from the registry entry above, which uses the same format, and from
secondary reports. We use it and describe the session as "based on" the study.

## Sessions

Same frame as the existing sessions: 10 min warm-up ramp from 45 % to 75 % FTP,
5 min cool-down ramp from 60 % to 45 % FTP. Added after VO2max 5×3, so that ERG
check 10 stays last.

| Session | Main set | Work | Recovery | Total |
|---|---|---|---|---|
| Seiler 4×8 | 4 × 8 min, 2 min between | 105 % | 50 % | 53 min |
| Rønnestad 30/15 | 3 series of 13 × 30 s / 15 s, 3 min between series | 120 % | 60 % (half of work) | 49.5 min |
| 40/20 4×8 | 4 sets of 8 × 40 s / 20 s, 2 min between sets | 115 % | 58 % (half of work) | 53 min |
| Over-unders 3×9 | 3 sets of 3 × (2 min under, 1 min over), 5 min between sets | 95 % / 105 % | 50 % | 52 min |

No recovery follows the last rep of a series or the last series, as in the
Rønnestad protocol (12 reliefs in a series of 13).

Descriptions (English; German is a direct translation in `de.js`):

- **Seiler 4×8:** "Four 8-minute efforts with 2 minutes easy between them. Based on Seiler et al. 2013, where riders held the hardest effort they could sustain. 105 % FTP is our estimate: adjust it to your effort."
- **Rønnestad 30/15:** "Three series of 13 × 30 s on, 15 s off, with 3 minutes between series. From Rønnestad et al. 2015, where riders held the hardest effort they could sustain. 120 % FTP is our estimate: adjust it to your effort."
- **40/20 4×8:** "Four 8-minute sets of 40 s on, 20 s off, with 2 minutes between sets. Format from clinical trial NCT04075929. 115 % FTP is our estimate: adjust it to your effort."
- **Over-unders 3×9:** "Three sets of 2 minutes just under and 1 minute just over threshold, with 5 minutes between sets. Common coaching practice, not from a published study."

## Building blocks (`ride/workout.js`)

- `intervals(repeat, onS, onPower, offS, offPower, { lastRecovery = true } = {})`:
  the new option drops the recovery after the last rep. Existing callers and the
  `.zwo` importer keep today's behaviour.
- `series(count, restS, restPower, makeSet)`: calls `makeSet()` `count` times,
  prefixes each block's label with `Series 2/3 · `, and puts a `Series break`
  block (kind `off`) between sets but not after the last.
- `overUnders(repeat, underS, underPower, overS, overPower)`: `Under i/n` and
  `Over i/n` blocks, kind `on`.

Labels: `segmentLabel` learns the `Series i/n · <label>` prefix (translating the
rest of the label through itself), `Under i/n`, `Over i/n` and `Series break`.
New keys in `en.js` and `de.js`: `workout.label.series`, `.seriesBreak`,
`.under`, `.over`, and `workout.lib.{seiler,ronnestad,fortyTwenty,overUnders}.{name,description}`
registered in `LIBRARY_KEYS`.

## Preview

- A `<canvas id="workout-preview" class="canvas-workout-preview">` in
  `#workout-picker`, above `#workout-description`, with a translated `aria-label`.
  Fixed height (a percentage would grow with the backing store, see
  `.canvas-workout`), lower than the in-ride chart.
- `drawWorkout` accepts `elapsedS: null`: every block is drawn at full alpha and
  the "now" line is left out. The zone colours and `workoutShapes` are unchanged.
- `renderWorkoutDescription` in `main.js` also draws the preview, so selecting a
  session and importing a `.zwo` both update it.
- The picker can be hidden when this runs, leaving the canvas 0 px wide. A
  `ResizeObserver` on the canvas redraws it when it gets its size.

## Testing

Client tests only, plain node, added to `client/test/erg.test.js` first:

- `intervals` with `lastRecovery: false` ends on a work block; the default still
  ends on a recovery.
- `series` prefixes labels, inserts breaks only between sets, and keeps durations.
- `overUnders` alternates its blocks with the given powers and durations.
- Each new preset has the block count, total duration and work power in the table
  above; the Rønnestad session has 12 reliefs in each series.
- `segmentLabel` translates the series prefix, `Under`, `Over` and `Series break`
  in English and German.
- `drawWorkout` with `elapsedS: null` draws no "now" line and full-alpha blocks,
  against a fake canvas; with a number it behaves as before.
- The existing i18n sweep and key-parity tests cover the new strings.

Manual:

- Screenshot of the preview and the description in the running app, with the
  picker opened after load so the `ResizeObserver` path runs.
- **A ride on a real smart trainer.** Trainers take a few seconds to change
  resistance, so the 15 s and 20 s recoveries may feel blurred in ERG. The tests
  cannot show this. If it is unusable, the fallback is to say so in those two
  descriptions, not to change the protocols.

## Out of scope

Cards for ERG sessions, a source field or link, rep-based or heart-rate targets,
new `.zwo` elements, more than these four sessions.

## Docs

`CHANGELOG.md` under `[Unreleased]` with #26. Roadmap state table updated in this
branch.
