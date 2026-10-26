# Splits and laps

OpenRadlr splits every ride the way a bike computer does. You see the last
split while riding, all splits on the finish screen, and the FIT and TCX files
carry one lap per split. Design: [the spec](superpowers/specs/2026-10-18-splits-laps-ride-history-design.md).

## Modes

The profile setting **Splits** is one of:

| Setting | Splits |
| --- | --- |
| Auto (default) | decided once at ride start from the route: a loop under 20 km → every lap, a route over 60 km → every 10 km, otherwise every 5 km. In the studio: every 5 km |
| Every lap | at each start/finish line crossing |
| Every 1 / 5 / 10 km | at that distance (miles with imperial units) |
| Off | none |

## Laps and free splits

A split closes at every crossing of the start/finish line. It is a **lap**
only when it was ridden from line to line on one route without leaving it.
Anything else is a **free split**: the first stretch when you join mid-loop,
a stretch where you turned off at a junction, or a stretch that switched
route. Free splits are shown and exported but never compared.

A stretch that left its route is cut after 10 km, so it does not run on
without a split. A lap on one route is never cut, however long (Col de la
Forge laps are 12.9 km).

## Details

- A split ends at the first sample at or past its boundary (one sample a
  second, so at most 1 s of error).
- Pauses (crash recovery) are not riding time and are left out of split
  times; standing still without pausing counts.
- A last stretch under 200 m joins the split before it on the finish screen.
- The finish screen shows a table when there are at least two splits. The
  fastest lap (or full distance split) is bold; each comparable row shows how
  it differs from the average.
- FIT: one `lap` message per split, session `laps` = number of splits. TCX:
  one `<Lap>` per split. GPX has no laps.

## Ride history

When the finish screen opens, a summary of the ride is saved in the browser
(IndexedDB `openradlr-history`): totals, whether the power was measured, the
profile's FTP and weight, the resolved split mode and the splits (record
version 2 adds the power curve, weighted power, Load and a flag for ramp-test
rides). Nothing leaves the browser. It is the base for measured FTP and
fitness (#48), see [ftp.md](ftp.md); there is no screen for the history yet.
