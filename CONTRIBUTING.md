# Contributing

Thanks for helping build OpenRadlr! This guide covers how we work.

## Workflow

1. Create a branch from `main`.
2. Write a failing test, make it pass, refactor (see below).
3. Run `make check` — it runs exactly what CI runs.
4. Open a pull request with a short description of *why* the change is needed.

Commit messages use the imperative mood (`Add sprint marker to route format`).
Keep pull requests focused; split refactorings from behaviour changes.

## Test-driven development

New behaviour starts with a test. The architecture is designed so that almost
everything can be tested without network, Bluetooth, timers or randomness:

| Layer | Where | How it is tested |
| --- | --- | --- |
| Simulation | `server/crates/sim` | Pure functions and a deterministic `World` with a seeded RNG |
| Game core | `server/crates/server/src/game.rs` | In-memory `MessageSink` instead of WebSockets |
| Connection protocol | `server/crates/server/src/connection.rs` | `Session` state machine fed with JSON strings |
| End to end | `server/crates/server/tests/` | Real server on a random port, real WebSocket client |
| Client logic | `client/public/js/**` | `node:test` with fakes for sockets, timers, storage and devices |

Rules of thumb:

- Test behaviour through public interfaces, not private details.
- One reason to fail per test; name tests as sentences (`drafting_rider_closes_the_gap_at_equal_power`).
- No sleeps in unit tests. Time, randomness and I/O are injected.
- A bug fix starts with a test that reproduces the bug.

## Dependency injection

Dependencies are passed in, never reached for globally:

- **Rust:** `World` takes a `Box<dyn RandomSource>`; `GameCore` talks to clients
  through the `MessageSink` trait; `Config::from_lookup` takes the environment
  lookup as a function. `app::build` is the single composition root.
- **JavaScript:** constructors take their collaborators with production defaults
  (`createSocket`, `setInterval`, `storage`, `subtle`, …). `main.js` is the only
  composition root and contains no logic of its own.
- Devices share one small interface (`on("data")`, `setGrade()`, `disconnect()`),
  so a real trainer, the simulated trainer and test fakes are interchangeable.

## Code style

- **Rust:** `cargo fmt` (max width 120) and `cargo clippy -D warnings`. No `unsafe`.
  The `sim` crate must stay free of I/O, async and third-party dependencies.
- **JavaScript:** ES modules, no build step, ESLint recommended rules.
  Never use `innerHTML` with data from the network — rider names come from other players.
- **Language:** code, comments, docs and commit messages are in English.
- **Protocol changes:** update `docs/protocol.md`, both sides, and bump
  `PROTOCOL_VERSION` for breaking changes.

## User-facing text

New UI text goes through the i18n module: `data-i18n` / `data-i18n-attr` in
`index.html`, `t()` / `tn()` in JS, with the key in both
`client/public/js/i18n/en.js` and `de.js` (same `{params}`). Numbers shown to
the rider use `formatNumber`, never `toFixed` into the page. The `i18nHtml`,
`i18nSweep` and `i18nParity` tests fail on missing keys or stray English; mark
a deliberate English literal (a log line, a file format) with `// i18n-ok`.
A new bundled route needs a `route.<id>.description` key in both dictionaries (route
names stay as they are); `i18nRoutes` fails without it.

## Architecture decisions

Significant decisions are recorded in `docs/adr/` as short markdown files
(context, decision, consequences). Add one when you change something structural.

## Licensing of contributions

By contributing, you agree that your code is licensed under the
[GNU AGPL v3 or later](LICENSE) and your artwork under
[CC BY-SA 4.0](ASSETS-LICENSE.md), the same licences as the project. There is
no separate contributor agreement.
