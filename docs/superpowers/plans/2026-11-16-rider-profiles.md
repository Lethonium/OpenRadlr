# Rider Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several riders on one device, each with their own profile, rides, progress and settings, switched in place on the start menu (#112).

**Architecture:** A pure roster (`profile/riders.js`) and a rider-scoped Storage wrapper (`profile/riderStorage.js`) that resolves the active rider on every call; IndexedDB names resolve per call too. `main.js` routes all rider storage through the wrapper and gets one `switchRider(id)` that reloads every piece of rider state without a page reload, so Bluetooth stays connected.

**Tech Stack:** Plain ES modules in the browser (no build), `node --test` with fakes, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-16-rider-profiles-design.md` (read it first; the key table there is authoritative).

## Global Constraints

- Client only. No server or protocol change.
- Rider `"main"` uses today's unprefixed keys and DB names; other riders use `openradlr.rider.<id>.<key>` and `<db>.<id>` (e.g. `openradlr-history.k3x9q2ab`).
- Roster key `openradlr.riders`: `{ active: string, ids: string[] }`. New ids: 8 chars `[a-z0-9]` from an injected RNG.
- Device keys (unscoped): `openradlr.riders`, `openradlr.devices`, `openradlr.nativeDevices`, `openradlr.screenKey`, `openradlr.screenPaired`, `openradlr.cockpit`, `openradlr.cockpit.layout`, `openride.quality`, prefix `openradlr.strava-upload.`. Every other key of ours is a rider key.
- All UI text in `client/public/js/i18n/en.js` and `de.js` (ADR 0017); `i18nParity`/`i18nSweep` tests must stay green.
- Pure logic with storage/RNG injected; one reason to fail per test; no sleeps (CONTRIBUTING.md).
- No duplicate selectors or overridden properties in `client/public/styles.css`.
- Commits: Conventional Commits, imperative, user-facing description; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test/lint (no host node): from the repo root
  `docker run --rm -v "$PWD":/app -w /app/client node:22 sh -c 'node --test "test/**/*.test.js" && npx eslint .'`
  For one file: `... node:22 node --test test/<name>.test.js`.

## Review Focus

1. **Rider `"main"` enumeration leaking other riders' keys.** `key(i)`/`length` for `"main"` must never list `openradlr.rider.*` or device keys, or "Delete everything" on main wipes other riders and the trainer pairing. Test in Task 2.
2. **Late async results after a switch.** `loadProfile()` / `refreshUnfinished()` started for rider A and resolving after switching to B must not render A's data. Generation guard in Task 6.
3. **Storage unavailable (private mode / throws).** The wrapper and roster must not throw when the raw storage throws or is `undefined`; the app runs as one rider. Tests in Tasks 1 and 2.
4. **Deleting the active rider.** Must switch to another rider first and leave no keys or DBs behind; deleting the last rider is refused. Tests in Task 1 and Task 4.
5. **Language differs between riders.** Switching from an English to a German rider retranslates the start menu without a reload, and the new rider's own saved locale wins over the browser's. Covered in Task 6 by a manual check plus `initLocale` with scoped storage.

---

### Task 1: Roster of riders

**Files:**
- Create: `client/public/js/profile/riders.js`
- Test: `client/test/riders.test.js`

**Interfaces:**
- Produces:
  - `RIDERS_KEY = "openradlr.riders"`, `MAIN_RIDER = "main"`
  - `loadRiders(storage, { orphanIds = [] } = {}) -> {active: string, ids: string[]}` (missing/garbage → `{active: "main", ids: ["main", ...orphanIds]}`; never throws; an `active` not in `ids` → `ids[0]`)
  - `saveRiders(storage, roster) -> boolean` (false if storage throws)
  - `addRider(roster, random = Math.random) -> {roster, id}` (new id appended and made active; redraws on collision with `roster.ids`)
  - `removeRider(roster, id) -> roster | null` (null when `id` is the only rider; removing the active one activates the next in order, else the previous)
  - `setActive(roster, id) -> roster` (unknown id → unchanged roster)

- [ ] **Step 1: Write the failing tests** in `client/test/riders.test.js`, each one assertion:
  - `loadRiders` with empty storage → `{active: "main", ids: ["main"]}`
  - `loadRiders` with `"{nope"` stored → same default
  - `loadRiders` with a storage whose `getItem` throws → same default
  - `loadRiders` with `orphanIds: ["ab12cd34"]` and no roster → `ids: ["main", "ab12cd34"]`
  - `loadRiders` with `{active: "zz", ids: ["main", "x"]}` → `active: "main"`
  - `addRider` with `random` returning a fixed sequence produces `/^[a-z0-9]{8}$/`, is active, appended
  - `addRider` redraws when the first draw collides with an existing id
  - `removeRider(["main"], "main")` → `null`
  - `removeRider` of the active middle rider activates the next one
  - `saveRiders` then `loadRiders` round-trips
- [ ] **Step 2: Run** `... node --test test/riders.test.js` → FAIL (module missing)
- [ ] **Step 3: Implement** `riders.js` with the interfaces above. Pure, no globals.
- [ ] **Step 4: Run** the test file → PASS
- [ ] **Step 5: Commit** `feat(client): Keep a list of the riders on this device`

### Task 2: Rider-scoped storage

**Files:**
- Create: `client/public/js/profile/riderStorage.js`
- Test: `client/test/riderStorage.test.js`, `client/test/storageKeys.test.js` (sweep)

**Interfaces:**
- Consumes: `MAIN_RIDER`, `RIDERS_KEY` (Task 1)
- Produces:
  - `DEVICE_KEYS: string[]`, `DEVICE_PREFIXES = ["openradlr.strava-upload."]`, `isDeviceKey(key) -> boolean`
  - `RIDER_PREFIX = "openradlr.rider."`; `riderKey(id, key) -> string` (`"main"` → `key`)
  - `riderStorage(raw, riderOf: () => string) -> Storage-like {getItem, setItem, removeItem, key(i), length}`; `raw` may be `undefined` or throw: reads return `null`, writes are no-ops, `length` is 0.
  - `deviceStorage(raw) -> Storage-like` enumerating only device keys
  - `riderIdsInStorage(raw) -> string[]` (distinct ids found under `RIDER_PREFIX`, for `loadRiders`'s `orphanIds`)
  - `riderDbName(base, id) -> string` (`"main"` → `base`, else `` `${base}.${id}` ``)

- [ ] **Step 1: Write the failing tests** (a plain `Map`-backed fake Storage with `key`/`length`):
  - rider `"x"`: `setItem("openradlr.goals", v)` stores raw `openradlr.rider.x.openradlr.goals`
  - rider `"main"`: `setItem("openradlr.goals", v)` stores raw `openradlr.goals`
  - device key through the rider wrapper goes to the raw key unchanged (`openradlr.devices`)
  - `openradlr.strava-upload.abc` is a device key
  - enumeration for `"x"` lists exactly its stripped keys
  - enumeration for `"main"` given raw keys `openradlr.goals`, `openradlr.devices`, `openradlr.riders`, `openradlr.rider.x.openradlr.goals` lists only `openradlr.goals` (Review Focus 1)
  - `riderOf` changing between calls changes which value `getItem` returns (no new wrapper)
  - raw `undefined` → `getItem` null, `length` 0, `setItem` doesn't throw (Review Focus 3)
  - raw whose methods throw → same
  - `deviceStorage` lists only device keys
  - `riderIdsInStorage` returns `["x"]` for the raw keys above
  - `riderDbName("openradlr-history", "main")` and `(…, "x")`
  - **Sweep (`storageKeys.test.js`):** read every `.js` under `client/public/js`, collect string literals matching `/^open(radlr|ride)\.[\w.-]+$/`; every one must be `isDeviceKey` or in an explicit `RIDER_KEYS` list declared in the test (from the spec's key table) or be `RIDER_PREFIX`/a known prefix. Fails naming the file and literal.
- [ ] **Step 2: Run** both files → FAIL
- [ ] **Step 3: Implement** `riderStorage.js`. Enumeration builds the key list on each `key`/`length` call (storage is small).
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(client): Scope stored data to the active rider`

### Task 3: IndexedDB names per rider

**Files:**
- Modify: `client/public/js/ride/rideAutosave.js` (`indexedDbStore`)
- Test: `client/test/autosave.test.js` (add)

**Interfaces:**
- Produces: `indexedDbStore(name: string | (() => string), { idb = globalThis.indexedDB } = {})` — the name is resolved on every open. `deleteIndexedDb(name, { idb = globalThis.indexedDB } = {}) -> Promise<void>` in the same file.

- [ ] **Step 1: Failing tests** with a fake `idb` recording `open(name)` calls (resolve `onsuccess` with a fake db exposing a `kv` store, or just assert the recorded name and reject): a function name returning `"a"` then `"b"` opens `"a"` then `"b"`; a string still works; `deleteIndexedDb("n")` calls `idb.deleteDatabase("n")` and resolves on success.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** the optional `idb` and function name; default behaviour unchanged.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `refactor(client): Let a ride store open the database its name points at now`

### Task 4: "Your data" for one rider, the device and deleting a rider

**Files:**
- Modify: `client/public/js/profile/localData.js`, `client/public/js/view/profilePage.js` (`DATA_NAMES`, `DATA_DETAILS`), `client/public/js/view/deleteConfirm.js` (`ITEMS`), `client/public/js/i18n/en.js`, `de.js`
- Test: `client/test/localData.test.js`, `client/test/profilePage.test.js`, `client/test/deleteConfirm.test.js`

**Interfaces:**
- Consumes: `deviceStorage` (Task 2), `deleteIndexedDb` (Task 3)
- Produces:
  - `DATA_ITEMS` gains `"device"` (last). `sources` gains `deviceStorage`.
  - `inventory(sources)` counts `device` as the number of device keys present (excluding `openradlr.riders`).
  - `deleteItem("device", sources)` removes every device key except `openradlr.riders`. `deleteItem("everything", …)` does **not** include `device`.
  - `exportData` unchanged in shape: never includes device keys (the rider wrapper doesn't list them).
  - `deleteRider({ storage, dbNames: string[], deleteDb }) -> Promise<boolean>`: removes every key the rider wrapper enumerates, then `deleteDb(name)` for each; false if anything threw (continues past failures).
  - `needsReload("device")` → false (the menu re-renders device lines instead).

- [ ] **Step 1: Failing tests:** device count; `deleteItem("device")` leaves `openradlr.riders` and rider keys; `"everything"` leaves device keys; `deleteRider` removes the rider's keys and calls `deleteDb` with the three names; `deleteRider` keeps going after one `deleteDb` rejects and returns false; `dataRows` names the device row (i18n key `profilePage.data.device.name`); `deleteTexts("device")` and `deleteTexts("rider", {name})` produce lines.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**; add i18n keys in both locales: device row name/detail ("This device" / "Paired trainer and sensors, second screens, graphics quality, Strava upload receipts"), rider delete title/lines ("Delete rider {name}?" / "All of {name}'s rides, best laps, goals, progress and settings are removed from this device.").
- [ ] **Step 4: Run** the touched test files plus `i18nParity` → PASS
- [ ] **Step 5: Commit** `feat(client): Show what belongs to this device apart from the rider in Your data`

### Task 5: Route all rider storage in main.js through the wrapper

No visible change with one rider; this is the wiring.

**Files:**
- Modify: `client/public/js/main.js` (near `readSetting`/`writeSetting` ~l.150, `profiles` ~l.266, `app.autosave/history/ghosts` ~l.384, `browserStorage()` ~l.526, `dataSources()` ~l.3326, startup ~l.5352)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces in `main.js`: `rawStorage` (the old `browserStorage()` body), `app.riders` (roster), `activeRider = () => app.riders.active`, `riderStore = riderStorage(rawStorage, activeRider)`; `browserStorage()` returns `riderStore`; `readSetting`/`writeSetting` use `riderStore`; `new ProfileStore({ storage: riderStore })`; stores built with `indexedDbStore(() => riderDbName("openradlr-history", activeRider()))` etc. (autosave base `"openradlr-autosave"`); `dataSources()` adds `deviceStorage: deviceStorage(rawStorage)`.

- [ ] **Step 1:** Load the roster at startup before anything reads storage: `app.riders = loadRiders(rawStorage, { orphanIds: riderIdsInStorage(rawStorage) })`. `profiles`/`app` are module-level constants built before startup code, so define `rawStorage`, `app.riders`'s initial value and `riderStore` above `const profiles` (l.266).
- [ ] **Step 2:** Swap the call sites listed above. `KnownDevices`, `nativeBluetooth`, `stravaUpload`, `cockpit/main.js` stay on their raw defaults.
- [ ] **Step 3: Run** full client tests + eslint → PASS.
- [ ] **Step 4: Manual check:** `make dev`, then screenshot the start menu and profile "Your data" (recipe in AGENTS.md, Playwright image). Rows show as before plus "This device". Note: a fresh browser has empty storage.
- [ ] **Step 5: Commit** `refactor(client): Read and write the rider's data through rider-scoped storage`

### Task 6: Switch rider in place, and the switcher

**Files:**
- Modify: `client/public/js/main.js`, `client/public/index.html` (start menu, near the account/profile area rendered by `renderAccount()` ~l.998), `client/public/styles.css`, `i18n/en.js`, `de.js`
- Create: `client/public/js/view/riderSwitcher.js` (pure model) — Test: `client/test/riderSwitcher.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2, 5.
- Produces:
  - `riderRows(roster, nameOf: (id) => string) -> {id, name, initial, active}[]` in `riderSwitcher.js` (empty name → `t("riders.unnamed")`; `initial` = first grapheme uppercased, or "?").
  - In `main.js`: `app.riderGeneration` (number, starts 0); `async switchRider(id)`; `async addNewRider()`; `nameOf(id)` = `new ProfileStore({ storage: riderStorage(rawStorage, () => id) }).load().name`.

- [ ] **Step 1: Failing tests** for `riderRows`: order follows roster, active flagged, unnamed fallback, initial of "élise" is "É".
- [ ] **Step 2: Run** → FAIL; **Step 3:** implement; **Step 4:** → PASS.
- [ ] **Step 5: `switchRider(id)`** in `main.js`. Refuses (returns) when `app.ride` is set or a dialog/panel is open (`panels` stack non-empty). Then: `app.riders = setActive(...)`, `saveRiders(rawStorage, …)`, `app.riderGeneration += 1`, and reload rider state:
  - `app.profile = profiles.load()`; re-run the field fills from `initSetup` (name, weight, units, FTP fields, split mode, auto pause, level, difficulty, virtual shifting, chainring, cog) — extract them from `initSetup` into `fillSetupFields()` and call it from both; `initWorkoutSetup` pick/cues likewise (`app.workoutPick`, `$("workout-cues")`).
  - `initLocale({ storage: riderStore, languages: navigator.languages })` then `relocalise()`.
  - Rider settings: `app.timeMode`, `app.routeId`/`app.rideRouteId`, `app.rideMode`, `app.coachVoice` from `readSetting` as at l.421–484; `setLayoutChoice(readSetting(LAYOUT_KEY) ?? "auto", { remember: false })`; biome; view mode/camera only matter at ride start — confirm by reading l.4898–4903.
  - Progress: `app.goals` via `loadGoalsState()`, `app.profileData = null`, `app.goalData = null`, `app.lemonHunt = null`, `app.milestones = null`.
  - `refreshUnfinished()`, `renderMenuGoals()`, `renderStartMenu()`, `renderRideModes()`, the menu stage for the route (`app.menu?.showRoute?` or whatever `renderStartMenu` already calls).
  - Sweep `main.js` for other module-level reads of rider keys / `app.profile` caches and add them here; list what you found in the commit body.
- [ ] **Step 6: Generation guard** (Review Focus 2): `loadProfile()` and `refreshUnfinished()` capture `app.riderGeneration` before their first `await` and return without rendering if it changed.
- [ ] **Step 7: `addNewRider()`**: copies the current locale into the new rider (`saveLocale(getLocale(), …)` after switching), `addRider` → save → `switchRider(id)` → `profiles.ensureKeys(profiles.save(profiles.load()))` → open the profile dialog on the profile page with the name field focused.
- [ ] **Step 8: Switcher UI**: a button with initial + name in the start menu; opens a small list (radio-like buttons, one per `riderRows` row, then "Add rider"). Hidden on the ride screen. Navigable by keyboard and the controller's menu navigation like the other start-menu buttons. i18n: `riders.switch` ("Who's riding"), `riders.add` ("Add rider"), `riders.unnamed` ("New rider"). German: "Wer fährt", "Fahrer hinzufügen", "Neuer Fahrer".
- [ ] **Step 9: Run** full client tests + eslint → PASS.
- [ ] **Step 10: Manual check** with `make dev` + Playwright: add a rider, set name "Anna" and German, switch back and forth; the start menu name, language, goals and unfinished offer follow the rider; screenshot both riders (1×).
- [ ] **Step 11: Commit** `feat(client): Switch between riders on one device from the start menu`

### Task 7: Delete a rider from Your data

**Files:**
- Modify: `client/public/js/main.js` (`renderProfileData`, `deleteProfileData` area ~l.3331–3405), `client/public/index.html` (a "Delete this rider" button next to `profile-delete-all`), `i18n/en.js`, `de.js`

**Interfaces:**
- Consumes: `deleteRider`, `deleteTexts("rider", {name})` (Task 4), `removeRider`, `saveRiders` (Task 1), `switchRider` (Task 6), `deleteIndexedDb`, `riderDbName` (Tasks 2–3).

- [ ] **Step 1:** Button hidden when `app.riders.ids.length < 2`. On confirm (via `app.deleteConfirm.ask` with `deleteTexts("rider", { name })`, export offered): compute `next = removeRider(app.riders, id)`; close the profile dialog; `await switchRider(next.active)` **before** deleting (Review Focus 4); then `deleteRider({ storage: riderStorage(rawStorage, () => id), dbNames: ["openradlr-history", "openradlr-ghosts", "openradlr-autosave"].map((b) => riderDbName(b, id)), deleteDb: deleteIndexedDb })`; then save `next` as the roster (keep `next.active` = current).
- [ ] **Step 2:** The "This device" row's delete re-renders device lines (`renderDeviceLines()`) instead of reloading.
- [ ] **Step 3: Run** full client tests + eslint → PASS.
- [ ] **Step 4: Manual check:** with two riders, delete the active one; the other becomes active, its data intact; raw localStorage has no `openradlr.rider.<deleted>.*` keys (check in the Playwright script via `page.evaluate`).
- [ ] **Step 5: Commit** `feat(client): Delete one rider and everything they kept on this device`

### Task 8: ADR and docs

**Files:**
- Create: `docs/adr/0028-rider-scoped-storage.md` (context, decision, consequences: wrapper, `"main"` unprefixed, device key list + sweep test, in-place switch to keep Bluetooth, Strava per device until #113)
- Modify: `AGENTS.md` ("There are 27 so far" → 28)

- [ ] **Step 1:** Write the ADR (≤ 40 lines, same shape as 0027).
- [ ] **Step 2: Run** `make check` (or the Docker test + lint command) → PASS.
- [ ] **Step 3: Commit** `docs: Record rider-scoped storage as ADR 0028`
