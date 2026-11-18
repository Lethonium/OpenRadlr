# The OpenRadlr app (iOS and Android)

**Android:** [Install OpenRadlr from Google Play](https://play.google.com/store/apps/details?id=com.openradlr.app)
on your phone or tablet. Open it, enter a rider name and connect your Bluetooth
trainer to start riding. Riding is free. The instructions below are for building
and testing the native shells; they are not required to install the Android app.

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

## Fullscreen on Android

The Android start screen keeps the clock and system icons visible over the island
background, which extends behind the transparent status bar. During a ride, the
status and navigation bars are hidden to give the road more room. Swipe from the screen edge to reveal Android's controls
temporarily; returning to the start screen shows the bars again. The keyboard
still opens normally for names, chat and other text fields.

Deploy the web client together with the shell update: it switches the native
SystemBars API when entering and leaving the ride screen.

Device regression checks (with an Android emulator or phone attached):

```bash
cd app/android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w com.openradlr.app.test/androidx.test.runner.AndroidJUnitRunner
```

The device tests check status-bar visibility, content extending underneath it,
and light icons, including visibility after backgrounding and in landscape.
Client tests cover entering and leaving immersive mode. With more than one
device attached, select one with `adb -s`.

## Android background rides

During a measured trainer ride, Android runs a `connectedDevice` foreground
service with its own sensor callbacks, WebSocket, telemetry clock and local
journal. Switching to another app or locking the screen does not depend on
WebView animation frames to keep power, cadence and recording going. Native
reconnect restores the trainer/strap subscriptions and resumes the server rider
using the existing protocol token. Virtual gears retain the web client's drafting
savings, including loop start-line gaps. Readings older than five seconds are not
replayed as fresh power; a lost server connection does not invent distance.

An ongoing notification shows the OpenRadlr emblem, live watts, distance and a
minutes/seconds clock even when collapsed. Expand it for cadence, elapsed time,
route/workout progress and **Return to ride** / **End & save**. Android asks for
notification permission the first time. Declining it does not prevent Android
from running the service, but its notification is then subject to Android's
notification-permission visibility rules. End/save keeps the recording locally,
leaves the game and releases trainer resistance; it never uploads a ride.

The service runs only for a real-trainer ride. It stops its timer and wake lock
when the ride ends. The native journal is private to the app and excluded from
Android backups; it is reconciled with the usual unfinished-ride recovery on the
next launch. Snapshots carry a local `profileId`; recovery accepts only the active
profile's journal. Older unscoped journals belong to the original `main` rider.
Snapshot creation and recovery use the active local rider roster. Recovery reads
are discarded if the rider generation changes while they are pending.
Force-stop, reboot or process termination stop live riding: recovery
preserves completed samples without pretending the ride kept running. Background
support here is Android-specific; iOS keeps the limitations below.

Bluetooth connection failures distinguish a switched-off adapter, unavailable
hardware, denied permission and a timeout. Native permission/adapter explanations
offer Android settings shortcuts. A timeout suggests waking the trainer and
closing other apps without claiming another app definitely owns it. A refused
control point remains distinguishable from a power-only trainer.

Deploy this web client with the updated Android shell. Older shells retain their
existing foreground behavior. The unreleased Android version code remains **3**.
For Google Play, declare the connected-device foreground service and describe its
user-started trainer connection, ongoing notification, and stop action.

For an untethered developer test of an unmerged client against production, build
an opt-in bundled-client debug APK. It uses the configured server origin for
API, authentication and ride sockets, while loading this checkout's static
client assets from the APK. No local server or `adb reverse` is needed after
installation. This changes the client on the test device only.

```bash
cd app
npx cap sync android # default: https://app.openradlr.com
cd android
./gradlew -PbundledPreview=true :app:assembleDebug
adb -s <device> install -r app/build/outputs/apk/debug/app-debug.apk
```

The preview uses the debug signing key; it can update a matching debug install,
but cannot replace a Play-signed app in place. Release bundles always use the
server-delivered client. Keep the Android version code unchanged for this preview.

Native checks (alongside `make check`):

```bash
cd app/android
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w com.openradlr.app.test/androidx.test.runner.AndroidJUnitRunner
```

The background instrumentation test uses the real Android service, screen lock,
WebSocket and journal with a fake peripheral/peer at their I/O boundaries. It
checks measured telemetry, notification controls and completed-ride recovery.
`RidePreviewTest` is an opt-in interactive smoke fixture (`-e interactive true`)
for the local server, not an automatic CI test or production simulator.

Before store rollout, test a physical FTMS trainer and heart-rate strap: switch
apps, lock for several minutes, disconnect/reconnect the trainer, interrupt the
network, resume a workout and end from the notification. Emulator fakes verify
lifecycle and data flow, not radio/firmware interoperability.

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
     memory only; heart rate stays on the device unless a second screen is
     paired, and then passes through the server to that screen only (ADR
     0026); with Strava, the athlete ID
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
11. Android: lock the phone or switch apps mid-ride. Check the live notification,
    continued samples, reconnection and End/save. Returning restores the recorded
    ride. Test on physical hardware as well as the emulator.

## Android release optimisation

Release builds enable R8 code shrinking, optimisation and obfuscation, plus
[optimised resource shrinking](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)
with AGP 8.13. Debug builds retain readable code.
Capacitor supplies its reflection/annotation consumer rules; avoid broad package
keep rules, which defeat optimisation. Add a rule only for a reproduced failure.

After building the bundle, audit its embedded R8 report and retrace mapping:

```bash
cd app
./android/gradlew -p android :app:bundleRelease
node scripts/check-android-optimization.mjs
```

CI runs this audit too. Keep the bundle and its matching
`android/app/build/outputs/mapping/release/mapping.txt` for each shipped release.
The bundle includes the mapping for Google Play crash deobfuscation. R8 report
percentages describe compiler coverage, not measured startup, RAM or frame rate.

Test the **signed, optimised release APK**, in addition to the debug service tests
above, on an Android 12+ emulator with WebView 140+ and network access (the client
loads from the configured server). Older WebViews use Capacitor's protective
native insets, so the zero-padding edge-to-edge assertion does not apply there. Use an explicit device serial for every adb command:

```bash
cd app/android
./gradlew -PandroidTestBuildType=release :app:assembleRelease :app:assembleReleaseAndroidTest
adb -s SERIAL install -r app/build/outputs/apk/release/app-release.apk
adb -s SERIAL install -r app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
adb -s SERIAL shell pm grant com.openradlr.app android.permission.BLUETOOTH_SCAN
adb -s SERIAL shell pm grant com.openradlr.app android.permission.BLUETOOTH_CONNECT
adb -s SERIAL shell am instrument -w com.openradlr.app.test/com.openradlr.app.ReleaseSmokeRunner
```

Both APKs must have the same signing certificate. Debug and release certificates
usually differ: use a dedicated emulator rather than uninstalling a rider's app
and losing their data. The release runner uses platform instrumentation to avoid
sharing AndroidX/Kotlin test-helper ABIs with R8-optimised target code. It checks
native plugin dispatch, filesystem round trips and edge-to-edge insets. The native
document picker and OAuth UI still need manual checks. It does not establish
physical Bluetooth radio reliability; repeat the ride/background/reconnect checklist on a trainer before shipping.

## Known limitations

- **iOS background:** `bluetooth-central` keeps fitness-device connections
  available, but the page and server connection can still pause. Android's native
  background-ride service does not change iOS execution. App Review may ask for
  the purpose of the background mode: keeping the rider's fitness devices connected.
- **Picker filters:** the native picker takes one filter (see ADR 0021).
  Zwift controllers are found by their name prefix "Zwift".
- **App Store review:** an app that wraps a website must offer more than the
  website (rule 4.2). Native Bluetooth is the argument; expect questions.
- The app icon is scaled up from the 512 px maskable icon, the largest master
  in the repo. A 1024 px original would look sharper on the App Store.

## App release information on requests

The native web view appends its platform and the installed package's version and
build number to the standard HTTP user agent. For example:

```text
OpenRadlr/0.1.0 (android; build/3)
OpenRadlr/1.0 (ios; build/1)
```

This is set before the first navigation and also accompanies the web view's API
requests and WebSocket upgrade. It describes the native shell; `client_version`
in the WebSocket protocol continues to describe the web client served by the
server. A client can forge a user agent, so it is not an authentication signal.

The server exports `openradlr_client_requests_total` on its existing
`/internal/metrics` endpoint, grouped by `client` (`android`, `ios`, or `browser`),
`app_version` and `app_build`. The `browser` bucket also includes older app builds
without the marker and requests with an invalid marker. Only successful `GET /api/info` responses are counted: the start menu requests
this endpoint when it loads and while it remains open. Static files, failures,
health checks, scrapes and WebSocket messages do not contribute. This measures
menu-load and refresh activity, not unique users, installations or ride sessions.

The counter keeps no raw user agents, IP addresses, device identifiers, rider
names, request paths or individual request records. It lives in memory and resets
when the server restarts. Separate release labels come only from an operator
allowlist, never from request-controlled allocation. The default is
`android/0.1.0/3,ios/1.0/1`; override `OPENRADLR_APP_METRIC_RELEASES` with a
comma-separated `platform/version/build` list (at most 32 entries, empty disables
release detail). Include the releases you still support when adding a new one.
Unknown valid releases use `other` version/build buckets per platform. iOS build
numbers may contain dot-separated numeric components. All counters are atomic;
no global request lock is needed. Keep the endpoint on
the host's private monitoring network as described in [Deployment](deploy.md).

Example PromQL for a dashboard connected to the endpoint:

```promql
sum by (client) (rate(openradlr_client_requests_total[5m]))
```

Start-menu requests by Android release over the last day:

```promql
sum by (app_version, app_build) (
  increase(openradlr_client_requests_total{client="android"}[24h])
)
```
