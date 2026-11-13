# Ride goals — design

Date: 2026-11-13 · Status: implementation

## Goal

Give a free ride a personal finish line: time, distance or climbing, without
ending the ride automatically.

## Decisions

- One optional goal per ride, set or replaced in Menu → Overview. Targets count
  from the start of the recording, including when set midway through a ride.
- Time is active recorded time (pauses excluded); distance and climbing use
  the recorder's summary, matching the ride file and Overview.
- Targets are entered in minutes, kilometres/miles, or metres/feet according
  to the selected units, converted to seconds/metres internally.
- A compact HUD pill shows progress, with a native progress bar in Overview.
  Completion emits one notification and stays visible; riding continues.
- Removing a goal hides progress. New rides start without a goal. Autosave
  preserves the goal and its completion flag; Continue restores both.
- First version supports road rides, including road workouts. Studio and café
  workouts have their own session structure and are excluded.
- Client-only, no protocol, server, account or structural architecture change.

## Verification

Plain node tests cover validation, each metric, progress clamping, one-time
completion, replacing/removing, restore, units and paused recorder time.
Run make check and inspect the UI with the real server and Playwright.
