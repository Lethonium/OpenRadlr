# AGENTS.md — OpenRadlr

Guidance for AI agents working in this repo. **Read `CONTRIBUTING.md` first** — it
defines the workflow (TDD, dependency injection, code style) and this file does not
repeat it. Here is the operational knowledge on top of that.

## Running locally
- `make dev` — Rust server on 127.0.0.1:8080, serves `client/public` statically
  (`OPENRADLR_STATIC_DIR=../client/public`, route file `rolling-hills.json`).
  Cold cargo build takes ~75s. It reads `.env.dev` if present (gitignored; see
  `.env.dev.example`): e.g. all routes, or Strava as in production.
- `make up` — Docker Compose stack (creates `.env` from `.env.example` via `make setup`).
- The client is plain ES modules — **no build step**. But the start menu fetches
  `/api/info` on load; served statically without a backend, it renders with an empty
  route list. A meaningful UI check requires the real server (or Docker).

## Testing
- `make check` = lint + all tests; it runs exactly what CI runs. Run it before
  claiming anything is done.
- Client: `node --test "test/**/*.test.js"` (plain node, fakes for sockets/timers/
  storage/devices — no browser needed). Server: `cargo test --workspace`, including
  the end-to-end WebSocket tests in `server/crates/server/tests/`.
- New behaviour starts with a failing test (see CONTRIBUTING.md for the rules:
  one reason to fail per test, no sleeps, time/RNG/I/O injected).

## UI verification (screenshots)
- `playwright` is a client devDependency; `client/screenshot.mjs` drives the
  running server with headless chromium. Start the app first (`make dev`), then:
    make screenshot ARGS="--out shot.png"   # or: cd client && npm run screenshot -- [url] [--width n] [--height n] [--wait ms]
  It prints the saved path; default output is `~/.cache/openradlr/screenshots/`.
  Keep screenshots out of the repo (that cache dir, not `/tmp`).
- On a fresh machine: `cd client && npx playwright install chromium` (the npm
  package does not bundle browsers).
- No local node/Chromium (the Makefile then falls back to a `node:22` container,
  which has neither browsers nor access to the host's `localhost`): run the target in
  the Playwright image matching the version in `client/package.json` (tag
  `v<version>-noble`), on the host network:
    make screenshot NPM="docker run --rm --network host -v $PWD/client:/app -v $HOME/.cache/openradlr:/root/.cache/openradlr -w /app mcr.microsoft.com/playwright:v1.64.1-noble npm" ARGS="--out shot.png"
- A fresh headless browser has empty localStorage → the Rider panel shows default
  profile values (165.3 lb, FTP 200 W), not real data.
- Client *tests* stay plain node (no browser); Playwright is for ad-hoc UI
  verification, not the test suite.

## Issues and pull requests (via `gh`)
- Repo: `github.com:Lethonium/OpenRadlr` (local dir may be named Open-Ride).
- Issues are referenced by number in code comments and CHANGELOG entries (`#73`).
  Look them up with `gh issue view <n>` when a change mentions one.
- PRs: short description of *why*, focused (refactorings split from behaviour
  changes), imperative commit messages.

## Documentation conventions
- **Protocol changes:** update `docs/protocol.md`, both sides, bump
  `PROTOCOL_VERSION` for breaking changes.
- **Structural decisions:** add an ADR to `docs/adr/` (NNNN-short-name.md;
  context, decision, consequences). There are 17 so far.
- **Feature design:** significant features go through the superpowers workflow —
  a design spec and an implementation plan in `docs/superpowers/{specs,plans}/`
  (see the 2026-10-19 examples). Follow that pattern for new features.
- **CHANGELOG.md:** Keep a Changelog format; add user-visible changes under
  `[Unreleased]` with the issue number.

## Key layout
- `client/public/` — browser app (`js/` modules, `index.html`, `styles.css`;
  UI text lives in `js/i18n/en.js` + `de.js`, see ADR 0017);
  `client/test/` — node tests; `main.js` is the only composition root
- `server/crates/sim/` — pure simulation (no I/O, async or third-party deps);
  `server/crates/server/` — game core + WebSocket server; `tests/` — e2e
- `routes/` — bundled route JSON (regenerate with `make routes`)
- `docs/` — protocol, ADRs, feature docs; `.superpowers/` — workflow state
