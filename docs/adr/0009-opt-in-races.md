# 9. Races are opt-in

Date: 2026-10-14 · Status: accepted

## Context

Starting a race used to put every rider on the server into it and move them
all to the start line — whoever was in the middle of a workout or a chat ride
was suddenly racing.

## Decision

A race is announced with a countdown (30 s by default). The rider who starts
it is entered; others join with a button or <kbd>J</kbd> until the start; a
share of the bots enters too. Only entrants line up and race; everybody else
keeps riding where they are. The countdown state lists the entrants.

## Consequences

- Free riders, workouts and races share the road without interfering.
- Racers ride through non-racers; drafting still works between both.
- New client messages `join_race` and `leave_race`; additive, so the protocol
  version stays 1.
