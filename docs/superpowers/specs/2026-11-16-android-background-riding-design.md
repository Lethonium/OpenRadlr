# Android background riding and connection recovery

## Intent

Android build 3 should keep a measured trainer ride going when the rider switches
apps or locks the screen. A visible foreground service owns the transport,
telemetry clock and private ride journal; WebView rendering is not the clock.

## Design

- A `connectedDevice` foreground service runs only during a real-trainer ride.
  It holds a partial wake lock, shows a localized return-to-ride notification,
  and stops when the ride ends. Collapsed stats show the brand mark and mm:ss;
  expanded stats include progress and a local End/save action. No boot receiver or sticky restart.
- The app's native ride plugin owns the WebSocket from the initial handshake.
  The client uses a WebSocket-shaped adapter; the server protocol is unchanged.
  Native reconnect uses the existing resume token and last route position.
- Reuse the BLE plugin's native listeners and operations through its public
  PluginCall API. Native listeners receive packets without executing JavaScript.
  Background reconnect restores the subscribed trainer/heart-rate characteristics.
- A deterministic native engine parses FTMS, cycling power and heart rate,
  rejects stale readings, advances telemetry and resistance, and records one
  sample per second. Heart rate stays local and is never sent to the game.
- The native journal is the Android ride's sample source in foreground too,
  avoiding duplicate/missing samples at handover. The web client enriches samples
  with virtual-route position and elevation and keeps the existing export flow.
  An app-private journal survives process loss; restart offers recovery rather
  than restarting a ride or replaying old power.
- Background control follows road grades with easing, manual ERG and serialized
  workout/class targets. User settings and workout progress cross the bridge;
  returning to the foreground reconciles the clock before continuing it.
- Bluetooth errors retain meaningful categories. Native settings actions are
  offered for adapter/permission errors. Timeout text suggests waking the device
  and closing competing apps; it must not claim that another app owns a trainer
  unless the control point actually refused control.

## Constraints and boundaries

Android only for background execution in this release. iOS background execution
is unchanged. Force-stop, reboot and OS process termination stop live riding;
recover recorded samples, never fabricate continuity or fresh sensor readings.
No battery-optimization exemption, location permission or automatic uploads.
Permission failure leaves foreground riding usable with an actionable explanation.

## Validation

Plain-node tests cover socket lifecycle, bridge handover, journal deduplication,
recovery, workout reconciliation and localized troubleshooting. Native JVM tests
use injected time and sinks for stale readings, packet decoding, control ramps,
recording and lifecycle. Android instrumentation verifies service notification,
background/lock transitions, stop and restart recovery with native packet fakes.
The emulator cannot validate actual radio interoperability: document a physical
trainer checklist and do not represent fake packets as physical-device testing.
