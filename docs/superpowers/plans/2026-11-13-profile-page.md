# Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A profile dialog on the start menu with three pages (Overview, Rides, Your data) that shows what the browser already records: totals, FTP over time, best laps, past rides, stored data with export and delete.

**Architecture:** Pure modules compute everything shown (`profile/stats.js`, `profile/localData.js`, `view/profilePage.js` row/line builders, `view/deleteConfirm.js` texts); `main.js` reads the stores when the dialog opens and writes the results into markup with `textContent`. The dialog is a second `createMenuDialog` (`view/menuDialog.js`) with its own root, sharing the app's panel stack.

**Tech Stack:** Plain ES modules (no build), `node --test`, canvas 2D for charts, IndexedDB and localStorage through the existing injected stores.

**Spec:** `docs/superpowers/specs/2026-11-13-profile-page-design.md`

## Global Constraints

- Client only. No new dependencies.
- UI text only through `t`/`tn` with keys in both `client/public/js/i18n/en.js` and `de.js` (ADR 0017; `i18nParity`, `i18nHtml` and `i18nSweep` tests enforce it). New keys under `profilePage.*`. Static markup uses `data-i18n` / `data-i18n-attr` like the rest of `index.html`.
- Every distance, climbing, weight in the rider's units via `util/format.js` (`formatDistanceWithUnit`, `formatElevation`, `formatDuration`, `formatWkg`).
- Weeks start Monday 00:00 local time; months are calendar months, local time. The clock is injected (`now` in ms) in every pure function.
- Storage failures never throw into the UI: `RideHistory`/`GhostStore` already swallow and log once; new store calls follow the same `#safely` pattern.
- Untrusted text (route names from the server, rider name) goes into the DOM with `textContent` only.
- New modules imported by `main.js` must be preloaded: run `npm run preload` (it rewrites the list in `index.html`; `modulePreload.test.js` checks it).
- CSS: no repeated selectors or overridden properties in `styles.css`; reuse `.menu-dialog`, `.menu-card`, `.menu-nav*`, `.menu-page` for the dialog.
- Run Node in Docker: `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "<cmd>"` from the repo root (`npm ci` once if `client/node_modules` is missing). `make check` before the PR.
- Commits: Conventional Commits, imperative, ending with the `Co-Authored-By` line. One PR for the whole plan.

## Review Focus

1. **A brand-new rider (no rides, no best laps, default profile)**: every page shows a friendly empty state, no `NaN`, no empty chart axes. Tests: Task 1 `periodTotals([])`, Task 3 `overviewLines` with no records, Task 4 `rideRows([])`.
2. **Old or partial records** (version 1, no `curve`, no `splits`, no `device`, `routeId: null`, `ftp: null`): rows and charts skip what is missing instead of breaking. Tests: Task 1 `ftpSeries` with `ftp: null` records, Task 4 `rideRows`/`curveRows` with a v1 record.
3. **Storage unavailable** (private mode, IndexedDB throws): the dialog opens, pages say the data can't be read, export and delete are disabled. Test: Task 6 `inventory` with throwing stores.
4. **Week and month edges**: a ride Sunday 23:30 counts for that week, Monday 00:10 for the next; DST weeks are still 7 local days. Test: Task 1 `weekStart` across the March DST change (run with `TZ=Europe/Zurich`).
5. **Deleting while things depend on the data**: after deleting rides the milestone totals and the profile pages refresh; after deleting the profile or everything the page reloads, so no stale `app.profile` is saved back. Tests: Task 5 confirm flow; Task 6 `deletePlan("everything")` lists the reload.

---

### Task 1: Pure stats: period totals, FTP series, week start

**Files:**
- Create: `client/public/js/profile/stats.js`
- Test: `client/test/profileStats.test.js`

**Interfaces:**
- Consumes: `estimateFtp(records, nowMs)` from `ride/ftpEstimate.js` (returns `?{ftp, basis}`).
- Produces:
  - `weekStart(nowMs: number) → number` (ms of Monday 00:00 local of that week)
  - `monthStart(nowMs: number) → number`
  - `periodTotals(records: object[], nowMs: number) → {week: Totals, month: Totals, all: Totals}` where `Totals = {rides, distanceM, durationS, elevationGainM}`; missing fields count as 0.
  - `ftpSeries(records: object[], nowMs: number) → {set: {t, ftp, test: boolean}[], estimated: {t, ftp: ?number}[]}`, both oldest first. `set`: one point per record with a finite `ftp` (`t = startedAt`, `test = Boolean(record.test)`). `estimated`: one point per week that has a ride, `t` = end of that week (next Monday 00:00 − 1 ms, capped at `nowMs`), `ftp = estimateFtp(records, t)?.ftp ?? null`.
  - `hasFtpChart(series) → boolean`: true when `set` or non-null `estimated` points span at least 2 distinct weeks.

- [ ] **Step 1: Write the failing tests**

```js
// TZ is set by the run command; dates below are local.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const ride = (t, extra = {}) => ({ startedAt: t, distanceM: 20000, durationS: 3600, elevationGainM: 150, ftp: 250, measured: true, ...extra });

test("weekStart: Monday 00:00 local, Sunday night still belongs to the week", () => {
  assert.equal(weekStart(at(2026, 11, 15, 23, 30)), at(2026, 11, 9, 0));   // Sunday
  assert.equal(weekStart(at(2026, 11, 16, 0, 10)), at(2026, 11, 16, 0));   // Monday
});
test("weekStart: the DST week is still 7 local days", () => {
  assert.equal(weekStart(at(2027, 3, 31, 12)), at(2027, 3, 29, 0));        // week of 28 March change
});
test("periodTotals: week, month and all", () => {
  const now = at(2026, 11, 13);
  const r = periodTotals([ride(at(2026, 11, 10)), ride(at(2026, 11, 2)), ride(at(2026, 10, 30))], now);
  assert.deepEqual(r.week, { rides: 1, distanceM: 20000, durationS: 3600, elevationGainM: 150 });
  assert.equal(r.month.rides, 2);
  assert.equal(r.all.distanceM, 60000);
});
test("periodTotals: no rides gives zeros, missing fields count as 0", () => {
  assert.deepEqual(periodTotals([], at(2026, 11, 13)).all, { rides: 0, distanceM: 0, durationS: 0, elevationGainM: 0 });
  assert.equal(periodTotals([{ startedAt: at(2026, 11, 12) }], at(2026, 11, 13)).week.distanceM, 0);
});
test("ftpSeries: set FTP per ride oldest first, tests marked, null FTP skipped", () => {
  const s = ftpSeries([ride(at(2026, 11, 10), { ftp: 260, test: "ramp" }), ride(at(2026, 11, 2), { ftp: null }), ride(at(2026, 10, 20))], at(2026, 11, 13));
  assert.deepEqual(s.set.map((p) => [p.ftp, p.test]), [[250, false], [260, true]]);
});
test("ftpSeries: one estimate per week with rides, null without a measured effort", () => {
  const s = ftpSeries([ride(at(2026, 11, 10), { measured: false }), ride(at(2026, 11, 3), { measured: false })], at(2026, 11, 13));
  assert.equal(s.estimated.length, 2);
  assert.deepEqual(s.estimated.map((p) => p.ftp), [null, null]);
  assert.ok(s.estimated[1].t <= at(2026, 11, 13));
});
test("hasFtpChart: needs two different weeks", () => {
  assert.equal(hasFtpChart({ set: [{ t: at(2026, 11, 10), ftp: 250 }, { t: at(2026, 11, 11), ftp: 250 }], estimated: [] }), false);
  assert.equal(hasFtpChart({ set: [{ t: at(2026, 11, 3), ftp: 250 }, { t: at(2026, 11, 11), ftp: 255 }], estimated: [] }), true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker run --rm -e TZ=Europe/Zurich -v "$PWD":/w -w /w/client node:22 node --test test/profileStats.test.js`
Expected: FAIL, cannot find module `profile/stats.js`.

- [ ] **Step 3: Implement the functions above in `client/public/js/profile/stats.js`**

`weekStart`: `new Date(nowMs)`, set hours to 0, step back `(getDay() + 6) % 7` days with `setDate` (not ms arithmetic, so DST weeks stay 7 local days).

- [ ] **Step 4: Run to verify they pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/public/js/profile/stats.js client/test/profileStats.test.js
git commit -m "feat(client): Add period totals and an FTP series from the ride history"
```

---

### Task 2: Store additions: delete a ride, list best laps, record the device

**Files:**
- Modify: `client/public/js/ride/rideHistory.js` (`rideRecord`, `RideHistory`)
- Modify: `client/public/js/ride/ghostLap.js` (`GhostStore`)
- Modify: `client/public/js/main.js` (`saveFinishedRide`, ~line 2921: pass `device: deviceKind(app.trainer)`)
- Test: `client/test/rideHistory.test.js`, `client/test/ghostLap.test.js`

**Interfaces:**
- Produces:
  - `rideRecord({..., device = null})` → record gains `device: "trainer" | "paddle" | "sim" | null` (additive; `version` stays 2).
  - `RideHistory#delete(id: string) → Promise<boolean>` (false on storage error).
  - `GhostStore#all() → Promise<{routeId, durationS, recordedAt}[]>` (no traces; fastest first is not needed, sorted by `routeId`), `[]` on storage error. The ghost store's `store` needs `keys`; `indexedDbStore` already has it.
  - `GhostStore#delete(routeId) → Promise<boolean>` (used by Task 6 only through `localData`; add it here with its test).

- [ ] **Step 1: Write the failing tests**

```js
// rideHistory.test.js
test("rideRecord: keeps the device kind", () => {
  const r = rideRecord({ recorder: recorder(), splits: [], splitMode: "5", routeId: null, measured: false, profile: {}, device: "paddle" });
  assert.equal(r.device, "paddle");
});
test("delete removes one ride", async () => {
  const store = mapStore();
  const history = new RideHistory({ store });
  await history.save(record(T0)); await history.save(record(T0 + 86_400_000));
  assert.equal(await history.delete(String(T0)), true);
  assert.deepEqual((await history.list()).map((r) => r.id), [String(T0 + 86_400_000)]);
});
test("delete reports a storage error as false", async () => {
  const history = new RideHistory({ store: { ...mapStore(), delete: async () => { throw new Error("quota"); } }, log: () => {} });
  assert.equal(await history.delete("1"), false);
});

// ghostLap.test.js
test("all lists the best lap per route without traces", async () => {
  const ghosts = new GhostStore({ store: mapStore(), now: () => 5 });
  await ghosts.offer({ routeId: "b", durationS: 300, trace: [[0, 0, 0]] });
  await ghosts.offer({ routeId: "a", durationS: 200, trace: [[0, 0, 0]] });
  assert.deepEqual(await ghosts.all(), [{ routeId: "a", durationS: 200, recordedAt: 5 }, { routeId: "b", durationS: 300, recordedAt: 5 }]);
});
test("all is empty when storage fails", async () => {
  const ghosts = new GhostStore({ store: { get: async () => { throw new Error("x"); }, put: async () => {}, keys: async () => { throw new Error("x"); } }, log: () => {} });
  assert.deepEqual(await ghosts.all(), []);
});
```

(`ghostLap.test.js` may need the same `mapStore()` helper as `rideHistory.test.js`; copy it if it has none. Use the trace shape the existing ghost tests use.)

- [ ] **Step 2: Run to verify they fail**

Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/rideHistory.test.js test/ghostLap.test.js`
Expected: FAIL (`delete`/`all` not functions, `device` undefined).

- [ ] **Step 3: Implement** the four additions; `delete` and `all` go through each class's `#safely`. In `main.js` import `deviceKind` (already imported from `ble/devices.js`) and pass `device: deviceKind(app.trainer)`.

- [ ] **Step 4: Run to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/public/js/ride/rideHistory.js client/public/js/ride/ghostLap.js client/public/js/main.js client/test/rideHistory.test.js client/test/ghostLap.test.js
git commit -m "feat(client): Let the ride history delete rides and the ghost store list best laps"
```

---

### Task 3: The profile dialog and its Overview page

**Files:**
- Create: `client/public/js/view/profilePage.js` (pure line builders; `view/profileView.js` is the elevation profile, don't touch it)
- Modify: `client/public/index.html` (dialog markup after the start menu's `</form>`; "Profile" button in the Rider `<legend>` row)
- Modify: `client/public/js/main.js` (create the dialog, `openProfile(page?)`, `renderProfileOverview()`)
- Modify: `client/public/styles.css`, `client/public/js/i18n/en.js`, `de.js`
- Test: `client/test/profilePage.test.js`

**Interfaces:**
- Consumes: `periodTotals`, `ftpSeries`, `hasFtpChart` (Task 1); `GhostStore#all` (Task 2); `levelLabel`, `levelOf` (`profile/level.js`); `ftpProvenance` (`view/ftpProvenance.js`); `routesOf` (`view/startMenu.js`) for route names.
- Produces:
  - `PROFILE_PAGES = ["overview", "rides", "data"]`
  - `routeName(routeId: ?string, routes: {id, name}[]) → string`: the server's name, `t("profilePage.studio")` for null, else the id.
  - `overviewLines({profile, totals, bests, routes}) → {rider: string, ftp: string, totals: {label, value}[], bests: string[], empty: ?string}`; `empty` is `t("profilePage.overview.empty")` when `totals.all.rides === 0`.
  - In `main.js`: `openProfile(page = "overview")` opens the dialog and re-renders its pages from fresh store reads; `app.profileDialog` holds the `createMenuDialog` instance.

Markup: copy the in-game menu's structure (`#menu`, index.html ~line 793) with root `id="profile-dialog"` and the same classes, nav buttons `data-menu-nav="overview|rides|data"`, pages `data-menu-page="…"`. Overview page contains: `#profile-rider`, `#profile-ftp`, `#profile-totals` (a `<dl>`), `<canvas id="profile-ftp-chart">` + `#profile-ftp-note` (filled in Task 7), `#profile-bests` (`<ul>`), `#profile-empty`. The dialog is created once in `initSetup` with `stack: panels`, `matchNarrow` (the same media query the in-game menu uses), `pages: PROFILE_PAGES`.

- [ ] **Step 1: Write the failing tests**

```js
const profile = { name: "Ralf", weightKg: 74, ftp: 245, ftpSource: "tested", ftpDate: null, levelW: 252, units: "metric" };
const zero = { rides: 0, distanceM: 0, durationS: 0, elevationGainM: 0 };

test("routeName: server name, Studio for null, id when unknown", () => {
  const routes = [{ id: "rolling-hills", name: "Rolling Hills" }];
  assert.equal(routeName("rolling-hills", routes), "Rolling Hills");
  assert.equal(routeName(null, routes), "Studio");
  assert.equal(routeName("gone", routes), "gone");
});
test("overviewLines: totals per period in the rider's units", () => {
  const totals = { week: { rides: 2, distanceM: 62000, durationS: 7800, elevationGainM: 400 }, month: { ...zero, rides: 5, distanceM: 210000 }, all: { ...zero, rides: 40, distanceM: 1240000, elevationGainM: 14200 } };
  const lines = overviewLines({ profile, totals, bests: [], routes: [] });
  assert.match(lines.rider, /Ralf/);
  assert.equal(lines.totals.length, 3);
  assert.match(lines.totals[0].value, /62(\.0)? km/);
  assert.equal(lines.empty, null);
});
test("overviewLines: a new rider gets the empty text, no NaN", () => {
  const lines = overviewLines({ profile: { ...profile, name: "", levelW: null }, totals: { week: zero, month: zero, all: zero }, bests: [], routes: [] });
  assert.equal(lines.empty, "No rides yet. Your totals, FTP and best laps show up here after your first ride."); // en copy, exact
  assert.ok(!JSON.stringify(lines).includes("NaN"));
});
test("overviewLines: best laps by route name with lap time", () => {
  const lines = overviewLines({ profile, totals: { week: zero, month: zero, all: zero }, bests: [{ routeId: "rolling-hills", durationS: 1318 }], routes: [{ id: "rolling-hills", name: "Rolling Hills" }] });
  assert.deepEqual(lines.bests, ["Rolling Hills · 21:58"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/profilePage.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `profilePage.js`** (the functions above) and the en/de keys (`profilePage.title`, `.open` ("Profile"), `.overview`, `.rides`, `.data`, `.studio`, `.overview.empty`, `.week`, `.month`, `.all`, `.bestLaps`, …).

- [ ] **Step 4: Run to verify they pass.** Expected: PASS.

- [ ] **Step 5: Wire it in `main.js`, markup and CSS**: on open, read `app.history.list()` and `app.ghosts.all()` in parallel, render Overview with `textContent`; the Profile button calls `openProfile()`. Re-render on `relocaliseHooks` and unit changes. Then `npm run preload`.

- [ ] **Step 6: Run the client suite and lint**

Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 sh -c "npm test && npm run lint"`
Expected: all PASS, lint clean (i18n parity/html/sweep and module preload included).

- [ ] **Step 7: Check it in the app**: `make dev`, then the screenshot recipe in AGENTS.md with a click on Profile (desktop and `--width 390`). Expected: dialog over the start menu, page list left (list first on the phone), Overview with the empty text in a fresh browser.

- [ ] **Step 8: Commit**

```bash
git add client/public/index.html client/public/styles.css client/public/js/main.js client/public/js/view/profilePage.js client/public/js/i18n/en.js client/public/js/i18n/de.js client/test/profilePage.test.js
git commit -m "feat(client): Add a profile dialog with an overview of your riding"
```

---

### Task 4: Rides page: list, detail

**Files:**
- Modify: `client/public/js/view/profilePage.js`, `index.html` (Rides page: `<ul id="profile-rides">`, `#profile-rides-more` button, `#profile-rides-empty`), `main.js` (`renderProfileRides()`), `styles.css`, i18n files
- Test: `client/test/profilePage.test.js`

**Interfaces:**
- Consumes: `splitRows` (`view/splitsView.js`), `routeName` (Task 3), `formatDuration`, `formatDistanceWithUnit`, `formatElevation`.
- Produces:
  - `RIDES_PAGE_SIZE = 20`
  - `rideRows(records, routes, {locale}) → {id, date, route, distance, time, power, climbing, device: ?("paddle"|"sim")}[]` (records already newest first; `device` only for paddle/sim; `power` is `"–"` when `avgPower` is not finite).
  - `curveRows(curve: ?object) → {label, watts}[]` for durations `[5, 60, 300, 1200]` plus the longest duration with a finite value; `[]` for a missing curve. Labels: "5 s", "1 min", "5 min", "20 min", "60 min".

Each row is a `<li>` with a `<button aria-expanded>` summary; expanding it shows the splits table (`renderSplits`, `view/splitsView.js`) when `record.splits?.length`, the curve rows, and a "Delete this ride" button (wired in Task 5). "Show more" adds the next 20.

- [ ] **Step 1: Write the failing tests**

```js
const rec = (extra = {}) => ({ id: "1", startedAt: Date.UTC(2026, 10, 10, 18), routeId: "rolling-hills", distanceM: 21400, durationS: 2700, avgPower: 198.4, elevationGainM: 210, device: "trainer", curve: { 5: 610, 60: 380, 300: 290, 1200: 241, 1800: 230, 3600: null }, ...extra });

test("rideRows: one row per ride with units and route name", () => {
  const [row] = rideRows([rec()], [{ id: "rolling-hills", name: "Rolling Hills" }], { locale: "en" });
  assert.equal(row.route, "Rolling Hills");
  assert.equal(row.time, "45:00");
  assert.equal(row.power, "198 W");
  assert.equal(row.device, null);
});
test("rideRows: paddles and simulator are marked, a v1 record without power still renders", () => {
  assert.equal(rideRows([rec({ device: "paddle" })], [], {}).at(0).device, "paddle");
  const [old] = rideRows([{ id: "2", startedAt: 1, distanceM: 1000, durationS: 60 }], [], {});
  assert.equal(old.power, "–");
  assert.equal(old.route, "Studio");
});
test("rideRows: empty history gives no rows", () => assert.deepEqual(rideRows([], [], {}), []));
test("curveRows: key durations and the longest one", () => {
  assert.deepEqual(curveRows(rec().curve).map((r) => r.label), ["5 s", "1 min", "5 min", "20 min", "30 min"]);
  assert.deepEqual(curveRows(undefined), []);
});
```

- [ ] **Step 2: Run to verify they fail.** Same command as Task 3. Expected: FAIL.
- [ ] **Step 3: Implement** `rideRows`, `curveRows`, the i18n keys.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Render the page in `main.js`** (`textContent` only; device icons reuse the SVGs of the mode cards), then run `npm test && npm run lint` in Docker. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(client): List past rides in the profile with their splits and power curve"
```
(`git add` the test file first if new tests went into a new file.)

---

### Task 5: Delete confirmation, and deleting a ride

**Files:**
- Create: `client/public/js/view/deleteConfirm.js`
- Modify: `index.html` (one confirm card inside `#profile-dialog`: `#delete-confirm` with `#delete-confirm-title`, `#delete-confirm-lines` (`<ul>`), `#delete-confirm-tick` (checkbox row, hidden by default), `#delete-confirm-error`, `#delete-confirm-export`, `#delete-confirm-cancel`, `#delete-confirm-go`), `main.js`, `styles.css` (a `.danger` button: `background: var(--danger)`), i18n files
- Test: `client/test/deleteConfirm.test.js`

**Interfaces:**
- Consumes: `createPanelStack`'s `stack.push({close}) → remove` (as `menuDialog` uses it); `RideHistory#delete` (Task 2).
- Produces:
  - `deleteTexts(item: "ride" | "rides" | "bestLaps" | "profile" | "progress" | "settings" | "everything", facts: {count?, from?, to?, routes?: string[]}) → {title, lines: string[], action: string, offerExport: boolean, requireTick: boolean}`
    - `lines` always ends with the not-undoable line; rides/ride lines say totals and estimated FTP start again from what is left and the set FTP stays; rides also say rides on Strava stay there; profile says name, weight, FTP and settings reset and servers will see a new rider; `offerExport` false only for `"ride"`; `requireTick` only for `"everything"`.
    - `action` names action and amount: `"Delete 42 rides"`, `"Delete this ride"`, `"Delete everything"`.
  - `createDeleteConfirm({els, stack, t}) → {ask({texts, onConfirm: () => Promise<boolean>, onExport?: () => void}): Promise<boolean>, close(): void, isOpen: boolean}`
    - Opens the card, focuses Cancel, pushes itself on `stack` (so Esc closes it before the profile dialog).
    - Cancel, Esc (stack close) and a click on the card's backdrop resolve `false` without calling `onConfirm`.
    - With `requireTick`, the go button is `disabled` until the tick box is checked.
    - Go calls `onConfirm`; `true` closes and resolves `true`; `false` shows `t("profilePage.delete.failed")` in the error line, keeps the card open.

- [ ] **Step 1: Write the failing tests** (fakes like `menuDialog.test.js`'s `fakeEl`; `createPanelStack` from `input/panelStack.js`)

```js
test("deleteTexts: rides say what changes and what stays", () => {
  const x = deleteTexts("rides", { count: 42, from: "3 Mar", to: "13 Nov" });
  assert.equal(x.action, "Delete 42 rides");
  assert.ok(x.lines.some((l) => l.includes("42 rides from 3 Mar to 13 Nov")));
  assert.ok(x.lines.some((l) => /set FTP stays/.test(l)));
  assert.ok(x.lines.some((l) => /Strava/.test(l)));
  assert.match(x.lines.at(-1), /cannot be undone/);
  assert.equal(x.offerExport, true);
  assert.equal(x.requireTick, false);
});
test("deleteTexts: one ride offers no export, everything needs the tick", () => {
  assert.equal(deleteTexts("ride", {}).offerExport, false);
  assert.equal(deleteTexts("everything", { count: 3 }).requireTick, true);
  assert.ok(deleteTexts("profile", {}).lines.some((l) => /new rider/.test(l)));
});
test("ask: focus starts on Cancel and Cancel deletes nothing", async () => { /* open, assert els.cancel focused, fire click on cancel, assert resolved false and onConfirm not called */ });
test("ask: Esc through the panel stack closes only the confirm", async () => { /* stack.closeTop() → resolves false; a second closeTop() then closes the profile entry pushed before ask() */ });
test("ask: everything stays disabled until ticked", async () => { /* go.disabled === true; tick.checked = true + fire change → go.disabled === false */ });
test("ask: a failed delete keeps the card open with an error", async () => { /* onConfirm → false; card not hidden; error text = failed copy; resolves only after cancel */ });
test("ask: a successful delete closes and resolves true", async () => {});
```

(Fill in the bodies as their comments say; the panel stack is `createPanelStack()` from `input/panelStack.js` with `push(panel) → remove` and `closeTop() → boolean`.)

- [ ] **Step 2: Run to verify they fail**

Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/deleteConfirm.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `deleteConfirm.js`** and the en/de copy (`profilePage.delete.*`).
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Wire "Delete this ride"** in `main.js`: `ask({texts: deleteTexts("ride", {}), onConfirm: () => app.history.delete(id)})`; on `true`, re-render Overview and Rides, and refresh the milestone totals (`app.milestones.totals = lifetimeTotals(await app.history.list())`, as `initSetup` does). Then `npm run preload`, `npm test && npm run lint`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add client/public/js/view/deleteConfirm.js client/test/deleteConfirm.test.js
git commit -am "feat(client): Confirm deleting a ride in a dialog that says what it removes"
```

---

### Task 6: Your data: inventory, export, delete

**Files:**
- Create: `client/public/js/profile/localData.js`
- Modify: `index.html` (Data page: `<ul id="profile-data">`, `#profile-export`, `#profile-delete-all`, `#profile-data-note`), `main.js`, `styles.css`, i18n files
- Test: `client/test/localData.test.js`

**Interfaces:**
- Consumes: `deleteTexts`, `createDeleteConfirm` (Task 5); the three `indexedDbStore`s already in `app` (`openradlr-history`, `openradlr-ghosts`, autosave) — pass their raw stores, not the wrapper classes.
- Produces:
  - `DATA_ITEMS`: ordered ids `["profile", "rides", "bestLaps", "progress", "unfinished", "settings"]` with their sources:
    - profile: localStorage `openride.profile.v1`
    - rides: store `history`; bestLaps: store `ghosts`; unfinished: store `autosave`
    - progress: localStorage `openradlr.summits`, `openradlr.lemons`
    - settings: every other localStorage key starting with `openradlr.` or `openride.` (devices, pairings, cockpit, locale, Strava receipts, ride mode, camera, coach voice)
  - `inventory({storage, stores}) → Promise<{id, count: ?number, readable: boolean}[]>`: counts are store key counts, `1`/`0` for profile, number of summits + lemon total for progress (as two numbers `{summits, lemons}` in `count`), number of keys for settings; a throwing store gives `readable: false`, never a throw.
  - `exportData({storage, stores, now}) → Promise<object>`: `{version: 1, exportedAt: now, profile, rides, bestLaps, progress, unfinished, settings}`; `profile` without `privateKeyJwk`; `settings` without `openradlr.screenKey`.
  - `exportFileName(now) → "openradlr-data-YYYY-MM-DD.json"` (local date).
  - `deleteItem(id, {storage, stores}) → Promise<boolean>`; `deleteItem("everything", …)` clears every item.
  - `needsReload(id) → boolean`: true for `"profile"`, `"settings"` and `"everything"`.

- [ ] **Step 1: Write the failing tests**

```js
function fakeStorage(entries) { /* Map-backed: getItem, setItem, removeItem, key(i), length */ }
const stores = () => ({ history: mapStore(["ride:1", "ride:2"]), ghosts: mapStore(["ghost:rolling-hills"]), autosave: mapStore([]) });
const storage = () => fakeStorage({ "openride.profile.v1": JSON.stringify({ name: "Ralf", privateKeyJwk: { d: "secret" }, publicKey: "pk" }), "openradlr.summits": '["a","b"]', "openradlr.lemons": "12", "openradlr.devices": "[]", "openradlr.screenKey": "s3cret", "other.app": "x" });

test("inventory counts each item", async () => {
  const items = await inventory({ storage: storage(), stores: stores() });
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by.rides.count, 2);
  assert.equal(by.bestLaps.count, 1);
  assert.deepEqual(by.progress.count, { summits: 2, lemons: 12 });
  assert.equal(by.unfinished.count, 0);
  assert.equal(by.settings.count, 2); // devices + screenKey, not other.app
});
test("inventory survives a store that throws", async () => {
  const broken = { ...stores(), history: { keys: async () => { throw new Error("blocked"); } } };
  const by = Object.fromEntries((await inventory({ storage: storage(), stores: broken })).map((i) => [i.id, i]));
  assert.equal(by.rides.readable, false);
  assert.equal(by.bestLaps.readable, true);
});
test("export leaves out the private key and the screen key", async () => {
  const data = await exportData({ storage: storage(), stores: stores(), now: 1 });
  assert.equal(data.version, 1);
  assert.equal(data.profile.privateKeyJwk, undefined);
  assert.equal(data.profile.publicKey, "pk");
  assert.equal(data.settings["openradlr.screenKey"], undefined);
  assert.equal(data.rides.length, 2);
});
test("exportFileName uses the local date", () => assert.equal(exportFileName(new Date(2026, 10, 13, 9).getTime()), "openradlr-data-2026-11-13.json"));
test("deleteItem everything clears all items but no other app's keys", async () => {
  const s = storage(); const st = stores();
  assert.equal(await deleteItem("everything", { storage: s, stores: st }), true);
  assert.deepEqual(await st.history.keys(), []);
  assert.equal(s.getItem("openride.profile.v1"), null);
  assert.equal(s.getItem("other.app"), "x");
  assert.equal(needsReload("everything"), true);
  assert.equal(needsReload("rides"), false);
});
```

(`mapStore(keys)` here is the `rideHistory.test.js` helper seeded with those keys and a placeholder value per key.)

- [ ] **Step 2: Run to verify they fail**

Run: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/localData.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `localData.js`.**
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Render the page in `main.js`**: one row per item with its count text and a Delete button (hidden when the count is 0 or `readable` is false), Export (a `Blob` of `JSON.stringify(data, null, 2)` downloaded through a temporary `<a download>`), "Delete everything on this device". Every delete goes through `ask` with `deleteTexts(item, facts)` (`facts.count`; for rides `from`/`to` dates of the oldest and newest ride via the same date format as `ftpProvenance`), `onExport` = the export action. After success: `needsReload(id)` → `location.reload()`, else refresh the pages and the milestone totals. The note line `#profile-data-note` carries the "what leaves this device" copy from the spec. Disable Export and every Delete when nothing is readable. `npm run preload`, `npm test && npm run lint`. Expected: PASS.
- [ ] **Step 6: Check in the app**: export downloads a file without `privateKeyJwk`; delete everything asks for the tick, then reloads to a fresh start menu.
- [ ] **Step 7: Commit**

```bash
git add client/public/js/profile/localData.js client/test/localData.test.js
git commit -am "feat(client): Show what this browser keeps, with export and delete"
```

---

### Task 7: FTP over time chart

**Files:**
- Modify: `client/public/js/view/profilePage.js` (pure model + `paintFtpChart(ctx, width, height, model, colors)`), `main.js`, `styles.css`, i18n files
- Test: `client/test/profilePage.test.js`

**Interfaces:**
- Consumes: `ftpSeries`, `hasFtpChart` (Task 1); `prepareCanvas`, `themeColors` (`view/canvas.js`).
- Produces: `ftpChartModel(series, width, height) → {set: {x, y, test}[], estimated: ({x, y} | null)[], yTicks: {y, label}[], xLabels: {x, label}[]}`
  - x: time from the first to the last point (or `now`) across the plot width; y: from `min − 10 W` to `max + 10 W` over all finite FTPs, rounded out to 10 W.
  - `estimated` keeps `null` where a week has no estimate, so the painter breaks the dashed line there (gap, not zero).
  - Without `hasFtpChart(series)`: the canvas is hidden and `#profile-ftp-note` shows `t("profilePage.ftp.notEnough")` ("Ride with a power meter or smart trainer for a few weeks to see your FTP move.").
  - Painter: set FTP as a solid step line with dots for tests, estimate dashed; a two-entry legend in the markup, not on the canvas.

- [ ] **Step 1: Write the failing tests**

```js
test("ftpChartModel: y range pads 10 W and rounds out", () => {
  const m = ftpChartModel({ set: [{ t: 0, ftp: 243 }, { t: 7 * 864e5, ftp: 251 }], estimated: [] }, 300, 100);
  assert.deepEqual(m.yTicks.map((t) => t.label).at(0), "230 W");
  assert.deepEqual(m.yTicks.map((t) => t.label).at(-1), "270 W");
});
test("ftpChartModel: a week without an estimate is a gap", () => {
  const m = ftpChartModel({ set: [], estimated: [{ t: 0, ftp: 240 }, { t: 7 * 864e5, ftp: null }, { t: 14 * 864e5, ftp: 248 }] }, 300, 100);
  assert.equal(m.estimated[1], null);
  assert.ok(m.estimated[2].x > m.estimated[0].x);
});
test("ftpChartModel: higher FTP is drawn higher", () => {
  const m = ftpChartModel({ set: [{ t: 0, ftp: 200 }, { t: 864e6, ftp: 260 }], estimated: [] }, 300, 100);
  assert.ok(m.set[1].y < m.set[0].y);
});
```

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement `ftpChartModel` and `paintFtpChart`.**
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Draw it on Overview** in `main.js` (after `prepareCanvas`, colours from `themeColors`), `npm test && npm run lint`, and a screenshot with a few seeded rides (seed IndexedDB through `page.evaluate` in an ad-hoc Playwright script, not in the repo). Expected: PASS; the chart shows both lines.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(client): Chart how your FTP moved, set and estimated from rides"
```

---

### Task 8: Finish

- [ ] **Step 1:** `make check`. Expected: lint and all tests pass (Rust included, untouched).
- [ ] **Step 2:** Screenshots at 1× of Overview, Rides (one ride open), Your data and the delete confirmation, desktop and phone width; upload per the PR screenshots memory.
- [ ] **Step 3:** Push `feat/profile-goals` and open the PR (title: `feat(client): Add a profile page with your rides, FTP over time and your data`), assign RalfLeonFasler, don't merge. Mention #99 as "step 1 of".
