# 7. One world per route

Date: 2026-10-14 · Status: superseded by [ADR 10](0010-one-connected-world.md) stage 2 (2026-10-15, #14): one world per map

## Context

Riders want to choose where to ride. A server could switch its single route
(everyone moves), let each rider ride a different route in one world (riders
no longer meet), or host several worlds.

## Decision

Every route file in `routes/` becomes its own world with its own game loop
and bots. A join names a `route_id`; everyone on the same route rides
together. The player cap counts riders across all worlds.

## Consequences

- No protocol break: `route_id` is optional, older clients join the default.
- CPU grows with the number of routes (bots ride even on empty routes); a few
  routes cost little, dozens would need idle worlds to pause.
- Riders on different routes can't see or chat with each other.
