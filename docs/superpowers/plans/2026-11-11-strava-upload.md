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

Implemented in PR #68. `make check` passes: 1,212 client tests and 549 Rust
tests, plus formatting and lint. Desktop and 390px browser verification used
the real local backend with an injected BLE power meter and intercepted Strava
responses (shortened polling delays for the ad-hoc UI check). Pending → menu
recovery → reload → failed check → success used exactly one POST. Downloading
a recovered FIT keeps the activity link/photos available. German disconnected
and missing-permission states were also checked. No real activity or live
OAuth round trip was performed. Screenshots are in
`~/.cache/openradlr/screenshots/strava-{ready-desktop,pending-desktop,pending-mobile,success-mobile,permission-mobile-de}.png`.

Visual follow-up: reused the existing compact Strava account row, removed ready
prose and coloured card treatment, collapsed file formats, and moved the footer
into normal flow. Added an explicit summary PNG save action and one short manual
image-attachment hint. Verified the downloaded PNG filename and short-screen
button/footer bounds in the browser, alongside the existing desktop/mobile flow.
The interactive preview now leaves native confirmation dialogs open for a human
response; Playwright's default auto-dismiss caused the reported flicker.

Inline-state follow-up: spinner and progress inside the busy action, a checked
Uploaded activity link, and error/retry actions in the same row. No visible
status/detail paragraphs; explanations remain in tooltips and accessible
descriptions, with live announcements. All six settled states retain the same
row height at 320, 390 and 1280px, including German and a long account name.
The browser flow also reproduced and verified the fix for periodic menu info
refreshes cancelling recovery polling. The complete flow still submits once.
