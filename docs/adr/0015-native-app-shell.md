# 15. A native app shell around the browser client

Date: 2026-10-19 · Status: accepted

## Context

Every browser on iOS uses WebKit, and WebKit has no Web Bluetooth. iPhone and
iPad riders can only use the simulated trainer or phone paddles. The Android
WebView has no Web Bluetooth either, so an app wrapper is needed on Android too
(Chrome on Android does have Web Bluetooth).

The client is plain ES modules with no build step, and the BLE layer only
depends on part of the Web Bluetooth API. Devices take the `bluetooth` object
as a parameter, so the code can run on anything that offers that part of the
API.

We looked at three wrappers: Capacitor with a community BLE plugin, Flutter
with a webview and a BLE package, and a plain Swift WKWebView with
CoreBluetooth.

## Decision

- **Capacitor** (`app/`), for iOS and Android from one project. The plugins
  are `@capacitor-community/bluetooth-le`, `keep-awake`, `share` and
  `filesystem`. Flutter would add a Dart layer and a JS bridge we would have
  to write and maintain ourselves, and it gives nothing in return while the
  whole UI is web. Flutter only becomes worth it if the UI is rewritten
  natively.
- The app **loads the client from a server** (`server.url`, by default
  https://openradlr.com) and does not bundle it. The page keeps its origin,
  so these work unchanged: the WebSocket URL, the same-origin `/api` calls,
  the Strava session cookie and the OAuth redirect. The client in the app is
  always the version its server speaks. A self-hosted server is set at build
  time with `OPENRADLR_APP_URL`.
- `ble/nativeBluetooth.js` is a **polyfill**: it provides the part of Web
  Bluetooth that we use on top of the raw plugin (`Capacitor.Plugins`, which
  the native bridge injects into any page, so there is no npm import and no
  build step). `native/app.js` installs it, together with a wake lock and a
  share-sheet replacement for downloads, only when it runs inside the app.
  The device classes stay the same.

## Consequences

- The web client stays the main product, and features only need to be built
  once. Without Capacitor (in any browser) nothing changes.
- The polyfill is tested in Node: a fake of the native plugin drives the real
  `SmartTrainer` and `HeartRateMonitor` classes. Whether it works with real
  native Bluetooth, on iOS and Android, can only be checked on devices.
- Each Web Bluetooth chooser is a list of alternative filters, but the
  plugin's picker takes a single filter. Names win, then services, then a name
  prefix. Manufacturer-data filters are dropped (Zwift controllers are still
  found by their name prefix).
- An app that just shows a website risks App Store rule 4.2 ("minimum
  functionality"). The native Bluetooth integration is the argument against
  that. A bundled client with a server picker in the app is a possible next
  step, but it needs CORS and token auth on the server.
- Strava sign-in happens inside the web view. Providers that block embedded
  web views (Google, for example) will not work there. `ASWebAuthenticationSession`
  would fix that and is left for later.
