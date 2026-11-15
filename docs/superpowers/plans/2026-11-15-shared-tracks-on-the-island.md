# Shared Tracks on the Island Implementation Plan

**Goal:** Both velodromes on the island, Herne Hill shared with other apps, everybody seeing each other (#107).

**Architecture:** Server first: bots per route instead of per world, the shared length from the route file, one OpenBikeNet link for every shared route of a world, riders of other apps shown to the whole world. Then the Herne Hill routes, their place on the island and the client.

**Spec:** `docs/superpowers/specs/2026-11-15-shared-tracks-on-the-island-design.md`

## Global Constraints

- Branch `feat/shared-tracks`, one PR, one commit per task, each green.
- Failing test first (CONTRIBUTING.md). `make check` (via Docker) before every commit.
- Wire stays additive: protocol version unchanged.

## Tasks

- [x] **1. Bots per route** — sim: a route can be marked without bots; `balance_population` leaves it at zero, the others at `target_riders`. Server: `sim_config_for` goes, routes with `openbikenet` are marked. Tests: a world of a road and a shared track has bots on the road only.
- [x] **2. Shared length from the route file** — `RouteFile.openbikenet_length`, required with `openbikenet`, positive; `routes/velodrome.json` gets 250. `Outbox` and `Remotes` take lengths per route; `OBN_LENGTH_M` goes.
- [x] **3. One link for several routes** — `LocalRider.route`; `Outbox` keyed by rider with its route: leave and join on a change of route, leaves before joins; `spawn_link` takes the routes and their lengths and subscribes to each. Tests in `outbox.rs` and `tests/openbikenet.rs`.
- [ ] **4. Several shared routes in a world, seen by everyone** — `GameCore::with_openbikenet` takes the list; one `Remotes` per route with its own id range; frames carry every shared route's humans; `with_remotes` adds riders of other apps for every viewer, nearest first. `app.rs` wires all shared routes of a world to one link.
- [ ] **5. Docs for the server part** — ADR 0027 (amends 0020), `docs/routes.md` (`openbikenet_length`, several shared routes), `docs/architecture.md` if it describes the link.
- [ ] **6. Herne Hill routes** (after protocol#6) — generator for the 450 m oval both ways, route files with `map` `valley`; the 250 m velodrome moves onto the island.
- [ ] **7. Client** — tracks drawn on the island, start menu (one Herne Hill entry with a direction choice), i18n, screenshots.
