# Rider profiles: several riders on one device

Step 1 of 3 for #112. Per-profile Strava is #113, an optional PIN per profile is #114; both build on this.

## Intent

A trainer setup with a tablet on the bars is often shared, e.g. by a couple. Today the device holds exactly
one rider, so a second rider needs a second device. Riders should pick **who is riding** on the start menu,
and each rider keeps their own profile, rides and progress. Handing over the bike must be quick: the trainer,
heart rate strap and controllers stay connected while switching.

## Goals

- Several riders per device. Each has their own profile and key pair (ADR 0003), FTP, weight, ride history,
  best laps, unfinished ride, summits, lemons, achievements, season goals and per-rider settings.
- A rider switcher on the start menu: the active rider's name, a list of the others, "Add rider".
- Switching **in place, without a page reload**: Bluetooth devices and the second-screen (cockpit) pairing
  stay connected.
- Existing users keep everything as their first rider, without a migration step that could fail.
- "Your data" works on the active rider only. A separate "This device" row covers what is shared, and a
  new "Delete this rider" removes one rider completely.
- The app remembers the last rider and starts with them; it does not ask "who's riding?" on every start.

## Non-goals

- Strava per rider (#113). The Strava login and upload receipts stay per device in this step.
- Locking a rider (#114).
- Syncing riders across devices (#97).
- Importing a rider from an export file.

## Anti-goals

- Losing or mixing riders' data: a rider's delete, export or settings change never touches another rider.
- Unpairing the trainer or the second screens for everyone when one rider clears their settings.
- Switching mid-ride, or switching that leaves the previous rider's state visible (old name, old goals, old
  unfinished-ride offer).
- A heavier start for single-rider users: with one rider the start menu looks like today plus a small
  "Add rider" entry.

## Constraints

- Client only, plain ES modules, no build step. UI text in `js/i18n/en.js` and `de.js` (ADR 0017).
- Pure logic with storage injected; tests in plain node (CONTRIBUTING.md).
- The multiplayer join happens at ride start (`connection.join` in `main.js`), not on the start menu, so a
  switch on the start menu needs no reconnect to the server.
- Storage today: localStorage keys `openradlr.*` / `openride.*`, read in `main.js` through
  `readSetting` / `writeSetting` / `browserStorage()`, plus a few modules defaulting to
  `globalThis.localStorage` (`ble/knownDevices.js`, `ble/nativeBluetooth.js`, `net/stravaUpload.js`,
  `profile/profileStore.js`). IndexedDB stores via `indexedDbStore(name)` in `ride/rideAutosave.js`:
  `openradlr-autosave`, `openradlr-history`, `openradlr-ghosts`.

## Approaches

- **A. A rider-scoped storage wrapper (chosen).** One wrapper maps rider keys to a per-rider prefix and
  passes device keys through; IndexedDB names get a per-rider suffix. Modules keep taking storage as an
  argument and do not change. Switching only changes which rider the wrapper points at, so no data is moved.
- **B. Swap data on switch** (copy the active rider out, the next one in). Least code, but a crash or closed
  tab mid-copy can mix or lose data, and copying ride databases is slow. Rejected.
- **C. One stored object per rider.** Cleanest model, but rewrites every module's storage and needs a big
  migration for no visible gain. Rejected.

The user first accepted A with a reload on switch, then asked that Bluetooth stay connected: hence the
in-place switch.

## Design

### Which keys belong to whom

| Device (shared, unscoped) | Rider (scoped) |
|---|---|
| `openradlr.riders` (the roster, below) | `openride.profile.v1` (profile and key pair) |
| `openradlr.devices`, `openradlr.nativeDevices` (paired BLE devices) | `openradlr.summits`, `openradlr.lemons`, `openradlr.achievements`, `openradlr.goals` |
| `openradlr.screenKey`, `openradlr.screenPaired`, `openradlr.cockpit`, `openradlr.cockpit.layout` (second screens) | `openride.view`, `openride.camera`, `openride.time`, `openride.biome`, `openride.layout`, `openride.route`, `openride.rideMode` |
| `openride.quality` (graphics, a property of the tablet) | `openradlr.studio-camera`, `openradlr.coach-voice`, `openradlr.locale` |
| `openradlr.strava-upload.*` (Strava is per device until #113) | IndexedDB: history, ghosts, autosave |

The device list is explicit and short; **every other key of ours is a rider key**, so a forgotten key
fails safe (per rider, never leaked across riders). A sweep test (like `i18nSweep.test.js`) collects every
`"openradlr.…"` / `"openride.…"` string literal in `client/public/js` and fails if one is in neither the
device list nor a known rider key list, so new keys get a conscious decision.

### Roster: `client/public/js/profile/riders.js` (pure)

- Stored in `openradlr.riders`: `{ active: "<id>", ids: ["<id>", …] }`, order as added. Names are not
  duplicated here; the switcher reads each rider's name from that rider's scoped profile.
- No roster yet → one rider with the fixed id `"main"`, active. This is the existing data.
- New ids: short random `[a-z0-9]` (8 chars, injected RNG), drawn again if a rider with that id or
  prefixed keys for it exist. `"main"` may come back after it was deleted: deleting it removed its data.
- Roster lost or unreadable but `openradlr.rider.<id>.*` keys exist (builder's call): rebuild the roster
  from those ids plus `"main"`, so no rider's data is orphaned.
- Reading another rider's name for the switcher: `ProfileStore.load()` through a one-off wrapper for
  that id. `load()` has no side effects (`ensureKeys` runs only on save paths), so this is safe.
- Functions: `loadRiders(storage)`, `addRider`, `removeRider` (refuses the last one; picks another active
  rider if the active one is removed), `setActive`. All return new state; saving is explicit.

### Scoped storage

`riderStorage(storage, riderOf)` returns a Storage-like object (`getItem`, `setItem`, `removeItem`, `key`,
`length`) where `riderOf()` gives the active rider id **at call time**, so switching needs no new wrapper.

- Device keys pass through to the raw storage unchanged (so `writeSetting(COCKPIT_KEY, …)` keeps working
  through the wrapper).
- Rider keys: rider `"main"` uses the **unprefixed keys** as today, so existing users need no migration.
  Other riders use `openradlr.rider.<id>.<key>`.
- `key(i)` / `length` enumerate only the active rider's keys (with the prefix stripped). For `"main"` that
  is the unprefixed rider keys, excluding device keys and other riders' prefixed keys. This keeps
  `profile/localData.js` working unchanged for counts, export and deletes.
- A matching `deviceStorage(storage)` view enumerates only device keys, for the "This device" row.

`profile/localData.js` needs only a small change: its `ours()` filter still matches because the
wrapper returns the original key names, and its "settings" item then covers only the rider's settings.
It gains a `device` item (counted and deleted through `deviceStorage`, **not exported**: the device row
holds pairing secrets, which the export already leaves out). The `stores` it receives are the rider's
(the name-resolving ones below). Deleting rider `"main"`'s data through the wrapper can never reach
`openradlr.rider.*` or `openradlr.riders`, because the wrapper never lists them for `"main"`.

IndexedDB: `indexedDbStore(name)` takes the name as a function (or a second variant does), resolved on
every call: `"main"` keeps `openradlr-history`, others use `openradlr-history.<id>`; the same for ghosts
and autosave. It already opens the database on each call, so this adds no lifecycle.

`main.js` creates the raw storage and the wrapper once; `readSetting`, `writeSetting`,
`browserStorage()`, `new ProfileStore({ storage })` and the three `indexedDbStore` calls use the wrapper.
`KnownDevices`, `nativeBluetooth`, `stravaUpload` keep their raw default (all device keys).

### Switching in place

`switchRider(id)` in `main.js`, only reachable from the start menu (the switcher is not shown on the
ride screen or during a workout). It sets the roster's active id, saves it, then reloads everything
`main.js` read for the previous rider. Known places (the builder must sweep `main.js` for others):

- `app.profile = profiles.load()`, then whatever the start menu renders from it (name, level, FTP, units).
- History, ghosts and autosave stores resolve the new names by themselves; refresh what is cached from
  them: the unfinished-ride offer, recent rides, stats.
- Season goals (`loadGoalsState`), achievements, `app.milestones.summits`, lemons.
- View settings: time of day, view mode, camera, layout choice, biome, route, ride mode, coach voice,
  studio camera (the startup block around `setTimeMode` / `setViewMode` / `setLayoutChoice`).
- Language: `initLocale` with the scoped storage, then re-apply UI text the same way `changeLanguage`
  does on the start menu (no reload there today). A new rider inherits the current language.
- The start menu's 3D preview and map, if they depend on the route or biome.

To keep this testable, the refresh lives in one function in `main.js` that calls small loaders; the
pure parts (roster, scoping, which keys are rider keys) are unit-tested. A test with a fake storage
shows that after a switch every rider key reads the new rider's value and device keys are unchanged.

Bluetooth devices, the cockpit pairing and the graphics quality are not touched by a switch. The cockpit
page runs on the phone with the phone's own storage, so its language and layout are unaffected. It
shows the live data of whoever rides.

Late async results (builder's call): the switcher is disabled while a dialog is open, and loads that
render rider data (unfinished-ride lookup, recent rides, stats) check a rider generation counter, which
increments on each switch. A result for an older generation is dropped instead of rendered.

### Adding and deleting riders

- **Add rider**: creates the id, makes it active, switches, and opens the profile dialog on the profile
  page with defaults so the new rider enters a name, weight and FTP. Its key pair is created like a fresh
  install (`ensureKeys`). Apart from the language (copied from the current rider), a new rider starts
  with defaults for every rider setting (view, camera, route, ...), as on a fresh install.
- **Delete this rider** (profile dialog, "Your data" page): confirmation via `view/deleteConfirm.js`,
  then removes all the rider's keys (through the wrapper, so all enumerated keys) and deletes its three
  IndexedDB databases, removes it from the roster and switches to the next rider. Hidden when there is
  only one rider. Deleting rider `"main"` is allowed when others exist; its unprefixed keys are removed.

### UI

Start menu, near the top (exact place left to the builder, following the menu's current style):

```
  ( R )  Ralf  ▾          →  list:  ( R ) Ralf   ✓
                                    ( A ) Anna
                                    +  Add rider
```

An initial in a circle plus the name. With one rider it shows the name and "Add rider" only.

"Your data" page: the existing rows apply to the active rider; "Settings" now covers only that rider's
settings. New: a **This device** row (paired devices, second screens, graphics quality, Strava upload
receipts) with its own delete, and a **Delete this rider** button.

### Docs

- ADR 0028: rider-scoped storage (the wrapper, `"main"` unprefixed, the device key list, in-place switch).
- No protocol change: each rider already has its own key pair, so the server sees separate riders.

## Left to the builder

- Exact placement and styling of the switcher on the start menu and its keyboard/controller navigation
  (the menu is navigable with Zwift Play buttons).
- German wording.
- Whether `indexedDbStore` takes a name function or a new sibling is added.
- The full list of state `main.js` caches per rider, found by sweeping it; the list above is a start.
- Test layout, as long as roster, scoping (including `"main"` enumeration), the key sweep, deleting a rider
  and the switch refresh are covered.
