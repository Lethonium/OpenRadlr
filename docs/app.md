# The OpenRadlr app (iOS and Android)

No browser on iOS has Web Bluetooth, so on an iPhone or iPad you can only
connect a trainer through the app. `app/` is a [Capacitor](https://capacitorjs.com)
project that shows the normal OpenRadlr page and connects it to native
Bluetooth. Why we chose this approach: [ADR 0021](adr/0021-native-app-shell.md).

## How it works

- The app does not bundle the client. It opens the page of an OpenRadlr server
  (`server.url` in `app/capacitor.config.ts`, by default
  https://app.openradlr.com), so the app always runs the client that server
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

## Back button

On Android, the back button and the back gesture go one step back, like Esc
(`client/public/js/input/back.js`, wired up in `native/app.js`). They never
end a ride or a workout without asking:

| Where | Back |
|---|---|
| A menu, drawer or popover is open | One step back: on a phone a menu page returns to the page list, then the menu closes |
| On the road or in the spin studio | Opens the menu at *Finish this ride?*; back again cancels |
| In a café workout | Pauses it and asks *End the workout?*; cancelling goes on where it was |
| The ride's or the workout's summary | Back to the menu (asks first if the ride is not saved) |
| An exercise in the Workout tab | Closes it |
| The start menu | The app goes to the background, as at the home screen; devices stay connected |

iOS has no back button, and in a browser the back button still leaves the
page.

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
background `#080a0e`. Android 12 and later draw their own splash screen: there
the emblem is `splash_icon` (one per density, scaled so all of it fits the
circle Android shows) on the same colour (`res/values/styles.xml`). To regenerate every size for iOS and Android after one
of them changes:

```bash
npm run assets   # scripts/make-assets.mjs → app/assets/ → capacitor-assets generate (fetched by npx)
```

### Debugging

- iOS: Safari → *Develop* → your iPhone → the OpenRadlr page shows the
  page's console. Enable *Settings → Safari → Advanced → Web Inspector* on the
  phone. Debug builds are inspectable.
- Android: `chrome://inspect` in desktop Chrome.
- In the app, *Menu → Devices → Device diagnostics* logs every Bluetooth step,
  just like in the browser.

## Google Play

Google Play takes an Android App Bundle (`.aab`) signed with your **upload
key**. Play App Signing then re-signs it with the app signing key that Google
keeps. If the upload key is lost, Play support can reset it; the app signing
key never leaves Google.

### The upload key (once)

Create it outside the repo, with the JDK that comes with Android Studio.
`keytool` asks for a password:

```bash
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
  -genkeypair -v -keystore ~/keys/openradlr-upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

Keep the `.jks` file and its password in your password manager. Then tell
the build where it is, in `app/android/keystore.properties`. Git ignores
this file, and `*.jks`:

```properties
storeFile=/Users/you/keys/openradlr-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

In CI, set `OPENRADLR_UPLOAD_STORE_FILE`, `OPENRADLR_UPLOAD_STORE_PASSWORD`,
`OPENRADLR_UPLOAD_KEY_ALIAS` and `OPENRADLR_UPLOAD_KEY_PASSWORD` instead.

### Build the bundle

```bash
cd app
npm run android:bundle   # → android/app/build/outputs/bundle/release/app-release.aab
```

The script stops if the upload key is missing, or if the app would open a
server that is not `https://` (a leftover `OPENRADLR_APP_URL`). The client
comes from the server, so a new bundle is only needed when the native shell
changes: plugins, permissions, icons, Capacitor. Raise `versionCode` in
`app/android/app/build.gradle` for every upload; Play accepts each number
once. A release build doesn't install over a debug build on the same phone,
because their signatures differ: uninstall the debug build first.

### In the Play Console

1. **Create app**: name *OpenRadlr*, type *App*, *Free*. The package name
   `com.openradlr.app` is fixed with the first upload.
2. **Testing → Internal testing**: upload the `.aab`, add yourself as a
   tester, and install it from Play. When asked, accept Play App Signing.
3. **App content** (*Policy → App content*):
   - Privacy policy: <https://openradlr.com/privacy/>
   - App access: all of it works without a login (Strava is optional).
   - Ads: none.
   - Content rating: the questionnaire. Users interact (names, chat).
   - Target audience: 13 and older. Choosing *not for children* keeps the
     app out of the Families policy.
   - Data safety, as in the privacy policy: name and fitness data (power,
     cadence, position) go to the server for the ride and are processed in
     memory only; heart rate stays on the device; with Strava, the athlete ID
     and name are stored until logout (30 days at most). Nothing is shared or
     sold; uploads to Strava happen only when you press *Upload to Strava*.
     All traffic is encrypted (https). There are no accounts to delete:
     *Log out* deletes the Strava login.
   - Health apps: fitness (indoor cycling with a trainer and heart rate).
4. **Store listing**: category *Health & Fitness*, type *App*. Title, short
   and full description and release notes, in English and German, are in
   `app/android/fastlane/metadata/android/` (the layout `fastlane supply`
   uploads). Images: the 512 px icon (`client/public/icons/icon-maskable-512.png`),
   a 1024×500 feature graphic and 2–8 phone screenshots (9:16 or 16:9).
5. **Production**: promote the tested release from internal testing.

Play rejects apps that only wrap a website. OpenRadlr's argument is native
Bluetooth to trainers, heart rate straps and controllers: put it in the
description.

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
10. Android: back works as in [Back button](#back-button). Mid-ride it asks
    before finishing, mid-workout it pauses and asks, and on the start menu
    the app goes to the background.
11. Lock the phone or switch apps for a minute mid-ride, then come back: the
    trainer is still connected (iOS) and the ride goes on.

## Known limitations

- **Background:** on iOS the app declares the `bluetooth-central` background
  mode, so the trainer, strap and controllers stay connected while the app is
  in the background. The page and its server connection are still paused
  there, so your rider stops and the ride picks up again when you come back. App Review asks why an app uses this mode; the answer is "keeps the
  rider's fitness devices connected". Android has no equivalent yet (it would
  need a foreground service); there the devices reconnect when you return.
- **Picker filters:** the native picker takes one filter (see ADR 0021).
  Zwift controllers are found by their name prefix "Zwift".
- **App Store review:** an app that wraps a website must offer more than the
  website (rule 4.2). Native Bluetooth is the argument; expect questions.
- The app icon is scaled up from the 512 px maskable icon, the largest master
  in the repo. A 1024 px original would look sharper on the App Store.
