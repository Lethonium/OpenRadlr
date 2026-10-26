# Measured FTP and the ramp test

OpenRadlr can measure your FTP instead of asking you to know it: from your own
rides, or with a guided ramp test. Design: [the spec](superpowers/specs/2026-10-19-ftp-estimation-design.md).

## What is measured

For every ride the finish screen stores, next to the splits (the record notes
whether the power came from a real trainer or power meter):

- **Power curve:** the best average power for 5 s, 15 s, 1, 3, 5, 8, 12, 20,
  30 and 60 min. A duration longer than the ride is empty. Each stretch
  between pauses (and across sample gaps over 5 s) is resampled to one value
  a second, and a single reading counts as at most 2000 W.
- **Weighted power:** the 4th root of the mean 4th power of the 30 s rolling
  average, so surges count for more than steady riding. Empty under 30 s.
- **Load:** how hard the ride was relative to your FTP at the time: 100 is an
  hour at FTP (hours × (weighted power / FTP)² × 100).

These are the same ideas other training tools use under trademarked names;
OpenRadlr only says "weighted power" and "Load".

## Estimating FTP from rides

After a ride is saved, the best efforts of the **last 90 days** (all rides
with measured power pooled; trainer-measured, not simulated or tapped) are
checked. After you typed an FTP or accepted a test result, only rides since
then count, so a lowered FTP is not argued back up by older rides:

1. Take the best 3, 5, 8, 12 and 20 min powers that exist. With at least two,
   and the longest at least twice the shortest, fit **critical power** (CP) by
   least squares of work (power × time) against time: the slope is CP, the
   intercept W'. **FTP = 0.97 × CP.**
2. If that fit is not possible but a 20 min effort exists, **FTP = 0.95 ×
   the 20 min power.**
3. Otherwise there is no estimate.

An estimate is offered ("New FTP detected") only if it passes all of these:

- **Only higher.** It must be at least 5 W or 3 % (whichever is larger) above
  your profile FTP. OpenRadlr never proposes lowering it: a ride without a
  hard effort says little about your ceiling, so a low estimate would be noise,
  and for a lower FTP you can type it or take the ramp test.
- It is between 50 and 600 W.
- It is higher than any estimate you dismissed with **Not now**; that value is
  remembered, so the same number does not ask again. A new, higher one does.
- The ride was not a ramp test (the test has its own result).

**Use it** sets the FTP and marks it *estimated*. Nothing changes without
your confirmation.

## The ramp test

Open it from the training panel (menu) during a ride on a trainer.

1. **Warm-up:** free, as long as you like, with live power for the last
   minute. Press *I'm warm, set up the ramp* when ready. Starting the test stops any running workout and puts the trainer in free-ride (simulation) mode.
2. **Settings:** a suggested start and step from your best warm-up minute:
   start ≈ 60 % of it (rounded to 5 W), step = start / 8 rounded to 5 W, kept
   between 10 and 30 W. Without a usable warm-up (best minute under 40 W) it
   starts at the minimum ERG power with 10 W steps. You can change both
   (start 50 to 400 W, step 5 to 40 W).
3. **Countdown** of 3 s, then the ramp: one minute per step in ERG mode, up
   to 600 W and at most 3 × your profile FTP. The workout is locked: no skip,
   no intensity changes.
4. **End:** the test ends when you press *I'm done*, when you stop the
   workout, or on failure: your power below 85 % of the target for 10 s in a
   row, after the first 60 s.
5. **Result:** **FTP = 0.75 × the best rolling minute** of the ramp. A ramp
   shorter than 5 min gives no result. You choose whether to keep it; it is
   marked *tested*, and the ride is flagged and does not itself trigger an
   estimate prompt (a later ride can).

Limits: the 0.75 factor suits an average rider. A sprinter (strong minute
power) gets too high a number, an endurance rider too low; if the result
feels wrong, type your own or rely on a long hard effort. The ramp clock
pauses when cadence falls under 15 rpm; if you stay stopped for 10 s (after
the first 60 s of the ramp) the test ends as a failure, like falling below the
target. Estimates depend on your
trainer's calibration, and the ramp is capped at 3 × FTP, so with a very low
profile FTP the top steps are cut.

## Where the FTP came from

The profile shows one line under FTP, from `ftpSource`:

| Value | Meaning |
| --- | --- |
| default | the built-in value, never set |
| typed | entered by hand |
| estimated | accepted from a ride estimate |
| tested | accepted from the ramp test |

with the date of the change.

## Where the data lives

Ride records (version 2: curve, weighted power, Load, test flag) are kept in
the browser's IndexedDB; the profile (FTP, source, dismissed estimate) in
local storage. Nothing leaves the browser. Clearing site data removes the
history and with it the basis for estimates. See [splits](splits.md#ride-history).
