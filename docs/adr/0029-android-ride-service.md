# 0029 — Own Android background rides in a foreground service

## Context

A WebView's animation frames and timers are not reliable background clocks.
Keeping Bluetooth connected alone does not keep game telemetry or recording alive.

## Decision

A ride-scoped Android connected-device service owns the WebSocket, native sensor
listeners, telemetry timer and local sample journal. A deterministic engine is
separate from Android lifecycle and transport. The foreground client uses the
same transport and journal, so backgrounding is a change of control ownership,
not a second rider or duplicate recorder. Existing BLE plugin native operations
are reused through public plugin APIs rather than a fork or a second GATT stack.

## Consequences

Android gains a visible ride notification, a scoped wake lock and native clock
and control tests. Android must declare the connected-device foreground service
in Play Console. The web deployment and app update must ship together. Native
control codecs mirror a small part of the client and require parity fixtures.
Force-stop does not auto-resume: the journal is recoverable, but live riding
requires an explicit new start. iOS remains under its existing lifecycle limits.
