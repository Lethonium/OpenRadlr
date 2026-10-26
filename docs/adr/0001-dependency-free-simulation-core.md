# 1. Dependency-free simulation core

Date: 2026-10-10 · Status: accepted

## Context

The same game logic must run in the Docker server today and inside native
clients (LAN hosting) later. It also has to be easy to test.

## Decision

All gameplay — route maths, physics, drafting, lanes, bots, races — lives in the
`openradlr-sim` crate. It has no third-party dependencies, no I/O, no async and no
clock. Time advances only through `World::tick(dt)`; randomness comes from an
injected `RandomSource`.

## Consequences

- Tests are fast and deterministic; a seed reproduces a whole session.
- Native clients can embed the crate unchanged.
- Networking, serialisation and configuration live in `openradlr-server` as adapters.
