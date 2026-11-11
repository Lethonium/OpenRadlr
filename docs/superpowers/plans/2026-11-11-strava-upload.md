# Reliable Strava uploads — implementation plan

Spec: `docs/superpowers/specs/2026-11-11-strava-upload-design.md`
Branch: `fix/strava-upload-state`, based on `origin/main`.

1. Add failing transport/controller tests for accepted-but-pending, resumable
   status checks, concurrency, submission uncertainty, persistence and disposal.
2. Implement the controller and transport status errors; bound HTTP requests.
3. Add failing view/lifecycle tests, implement shared panel rendering, wire finish
   and recovery with captured ride identity and retain unsaved finished rides.
4. Add English/German copy, responsive panel styling, documentation and changelog.
5. Run make check, inspect desktop/mobile in the real server, fix findings, open PR.

## Result

Implemented in PR #68. `make check` passes: 1,196 client tests and 511 Rust
tests, plus formatting and lint. Desktop and 390px browser verification used
the real local backend with an injected BLE power meter and intercepted Strava
responses (shortened polling delays for the ad-hoc UI check). Pending → menu
recovery → reload → failed check → success used exactly one POST. Downloading
a recovered FIT keeps the activity link/photos available. German disconnected
and missing-permission states were also checked. No real activity or live
OAuth round trip was performed. Screenshots are in
`~/.cache/openradlr/screenshots/strava-{ready-desktop,pending-desktop,pending-mobile,success-mobile,permission-mobile-de}.png`.
