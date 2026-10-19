# The OpenRadlr app (iOS and Android)

No browser on iOS has Web Bluetooth, so on an iPhone or iPad you can only
connect a trainer through the app. `app/` is a [Capacitor](https://capacitorjs.com)
project that shows the normal OpenRadlr page and connects it to native
Bluetooth. Why we chose this approach: [ADR 0015](adr/0015-native-app-shell.md).

## How it works

- The app does not bundle the client. It opens the page of an OpenRadlr server
  (`server.url` in `app/capacitor.config.ts`, by default
  https://openradlr.com), so the app always runs the client that server
  serves. Shipping a new client to the server updates the app too, without an
  App Store release.
- The page sees `window.Capacitor`, which the native shell injects.
  `client/public/js/native/app.js` then sets up:
  - **`navigator.bluetooth`**: `ble/nativeBluetooth.js`, Web Bluetooth on top
    of `@capacitor-community/bluetooth-le`. Trainers, heart rate straps and
    Zwift controllers connect through the app's device picker. Reconnecting
    and remembered devices (#43) work as in Chrome.
  - **`navigator.wakeLock`**: keeps the screen on through `@capacitor-community/keep-awake`.
  - **Saving files**: ride files and photos open the share sheet (*Save to
    Files*, Strava, AirDrop…) through `@capacitor/filesystem` and
    `@capacitor/share`, since a phone has no downloads folder.
    `navigator.share` uses the same path.
  - **Connect with Strava**: through the system sign-in sheet, see
    [below](#strava-sign-in).
- In a browser `window.Capacitor` does not exist, and nothing changes.
- If the server can't be reached, the app shows `app/www/index.html` with a
  *Try again* button.

## Strava sign-in

Google and Apple don't allow sign-in inside an embedded web view. So in the
app, *Connect with Strava* opens the system sign-in sheet instead:
`ASWebAuthenticationSession` on iOS (the app's own `WebAuth` plugin,
`app/ios/App/App/WebAuthPlugin.swift`), and a Custom Tab on Android
(`@capacitor/browser`). The sheet has its own cookies, so the session is
handed over to the web view in steps:

1. The page calls `POST /auth/strava/app`. The server answers with the URL to
   open, `/auth/strava?app=<id>`, and keeps a secret as a cookie in the web
   view.
2. The sheet signs in with Strava as usual. The callback sends it to
   `openradlr://strava?result=connected&ticket=<ticket>`, which closes the
   sheet. Android routes that link back to the app with an intent filter.
3. The page sends the ticket to `POST /auth/strava/app/claim`. The server
   checks it against the secret in the web view's cookie and sets the
   session cookie. The page then shows the account without reloading, so
   connected devices stay connected.

The ticket only reaches the phone that signed in. Someone who sends a victim
their own login link holds the secret but never sees the ticket, and another
app that grabs the `openradlr://` link has no secret. The server code is
`AppLogins` in `server/crates/server/src/strava.rs`. In a browser nothing
changes.

## Build and run

You need Node 22+. For iOS: macOS with Xcode 16+ and an Apple ID (a free one
can install on your own device for 7 days; TestFlight and the App Store need
the paid Developer Program). For Android: Android Studio.

```bash
cd app
npm install
npm run ios        # cap sync ios + opens Xcode
npm run android    # cap sync android + opens Android Studio
```

In Xcode: select the *App* target → *Signing & Capabilities* → pick your
team (change the bundle id `com.openradlr.app` if Xcode says it's taken), then
run on a **real device**. The iOS simulator has no Bluetooth.

Run `npx cap sync` again after changing `capacitor.config.ts` or the
plugins. Changes to the client need no rebuild: deploy them to the server and
restart the app.

### Your own server

```bash
OPENRADLR_APP_URL=http://192.168.1.20:8080 npx cap sync
```

Plain `http://` is allowed for addresses in the local network (iOS:
`NSAllowsLocalNetworking`; Android: `cleartext` is turned on for `http://`
URLs). iOS asks for local network access the first time. For a dev server on
your Mac, use the Mac's LAN address, not `localhost`.

### App icon and splash screen

The app icon comes from the client's maskable icon
(`client/public/icons/icon-maskable-512.png`). The splash screen is the README
emblem (`docs/assets/openradlr-emblem.png`), centred on the icon's dark
background `#080a0e`. To regenerate every size for iOS and Android after one
of them changes:

```bash
npm run assets   # scripts/make-assets.mjs → app/assets/ → capacitor-assets generate
```

### Debugging

- iOS: Safari → *Develop* → your iPhone → the OpenRadlr page shows the
  page's console. Enable *Settings → Safari → Advanced → Web Inspector* on the
  phone. Debug builds are inspectable.
- Android: `chrome://inspect` in desktop Chrome.
- In the app, *Menu → Devices → Device diagnostics* logs every Bluetooth step,
  just like in the browser.

## Test checklist on a device

1. Start screen: the "can't reach Bluetooth trainers" warning is gone.
2. *Connect trainer* opens the device picker; pick the trainer → status
   shows its name, power and cadence arrive. Cancelling the picker shows
   *Cancelled*.
3. Resistance changes on a climb (simulation mode) and ERG holds its target.
4. A heart rate strap and a Zwift Click/Play connect, and the buttons shift.
5. Switch the trainer off and on mid-ride → it reconnects by itself.
6. Close and reopen the app → remembered devices connect without the picker.
7. The screen stays on during a ride.
8. *Finish ride* → *Download FIT* opens the share sheet → *Save to Files*
   works. Photos too.
9. *Connect with Strava* opens the sign-in sheet. Signing in with email,
   Google and Apple each comes back connected, with devices still connected.
   Closing the sheet changes nothing.
10. Lock the phone or switch apps for a minute mid-ride, then come back: the
    trainer is still connected (iOS) and the ride goes on.

## Known limitations

- **Background:** on iOS the app declares the `bluetooth-central` background
  mode, so the trainer, strap and controllers stay connected while the app is
  in the background. The page and its server connection are still paused
  there, so your rider stops and the ride picks up again when you come back. App Review asks why an app uses this mode; the answer is "keeps the
  rider's fitness devices connected". Android has no equivalent yet (it would
  need a foreground service); there the devices reconnect when you return.
- **Picker filters:** the native picker takes one filter (see ADR 0015).
  Zwift controllers are found by their name prefix "Zwift".
- **App Store review:** an app that wraps a website must offer more than the
  website (rule 4.2). Native Bluetooth is the argument; expect questions.
- The app icon is scaled up from the 512 px maskable icon, the largest master
  in the repo. A 1024 px original would look sharper on the App Store.
