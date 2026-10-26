# 13. Scheduled events and group rides with power sharing

Date: 2026-10-16 · Status: accepted

## Context

Races are opt-in ([ADR 9](0009-opt-in-races.md)) but ad hoc: someone has to
start one, and on a quiet server nobody does. People with different fitness
also can't ride together — the strong ride away, the others sit alone. The
spin studio ([ADR 11](0011-spin-studio.md)) showed that a timetable derived
from wall time gets riders to the same place at the same moment, with no
coordination.

## Decision

- **A schedule shared with the studio.** `sim::schedule` turns Unix time into
  "upcoming, lobby or running" for repeating events (every N seconds from an
  offset, with a lobby before the start). The studio uses the same code, so
  every rider and every server agrees on what runs when.
- **Events on route worlds.** An event belongs to a route. Its lobby is the
  normal road: entrants ride around, then line up at the start. Built in: a
  group ride every hour, a race every two hours; routes can be overridden with
  an events file. The server refuses overlapping events on a route at startup.
- **Opt-in.** Like races, an event takes only those who join (button or
  <kbd>J</kbd>). Everybody else keeps riding through it. Group rides can also
  be joined while running; races close at the start.
- **Power sharing instead of speed caps.** In a group ride, whoever is ahead of
  the group's lower median for a while gives up to 40 % of their power to the
  riders behind, so the group stays together without anyone being held back by
  a rule. The strong spend watts, the weak get a tow. It acts on the physics
  only; the trainer, the recorded file and Strava keep the real power.
- **Bots matched once.** Event bots are drawn when the event starts, relative
  to the entrants' W/kg: mostly a pack around them, a few spread wider. They
  never change strength afterwards, so a result is not a moving target.
  Their level comes from a rider's *riding level*, an estimate the client keeps
  from rides and races and sends in `join` (`level_w`), so riders don't need to
  know their FTP.

## Consequences

- Additive protocol change (`join_event`, `leave_event`, `state.event`, three
  game events, `level_w` in `join`, `events` in `/api/info`); the version
  stays 2. Older clients ignore all of it.
- Group rides and races are only as good as the lobby: with few riders the
  bots carry the event.
- Sharing needs at least 3 riders in the group; the event bots make sure it
  does.
- Private events (invited groups) are not covered and remain open.
