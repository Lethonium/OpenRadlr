# Android background riding implementation plan

Spec: `../specs/2026-11-16-android-background-riding-design.md`.

- [x] Add failing deterministic native engine and client adapter tests.
- [x] Implement native sensor parsing, clocks, control and private journal.
- [x] Implement foreground service, native BLE subscriptions and WebSocket bridge.
- [x] Wire measured Android rides, recording, recovery and workout reconciliation.
- [x] Add categorized connection failures, settings shortcuts and EN/DE text.
- [x] Run `make check`, native tests and emulator lifecycle/visual checks.
- [x] Rebuild signed build 3, update follow-up PR #120 and release artifact checksums.

Developer testing also includes an opt-in bundled-client APK against production,
so manual trainer tests can continue without a local server or USB connection.
