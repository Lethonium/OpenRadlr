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
