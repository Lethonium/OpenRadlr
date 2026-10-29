# Internationalization (German) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser client is available in English and German, picks the language from the browser on first visit, and has a persisted language selector.

**Architecture:** A dependency-free `client/public/js/i18n/` module (`t`, `tn`, locale state, DOM application) with flat `en`/`de` dictionaries. Static HTML carries `data-i18n` keys; dynamic strings call `t()`. Two static-analysis tests (HTML coverage, JS literal sweep) plus an en/de key-parity test keep untranslated text from slipping in.

**Tech Stack:** Plain ES modules (no build), `node --test`, `Intl`.

**Spec:** `docs/superpowers/specs/2026-10-29-internationalization-design.md`

## Global Constraints

- Supported locales: `en` (source and fallback), `de`. `de-AT`, `de-CH` etc. map to `de`.
- Locale key in `localStorage`: `openradlr.locale`. Detection order: saved, then first `navigator.languages` entry with a supported base language, then `en`.
- No new dependencies, no build step. Client tests are plain node (no browser); inject `storage`/`languages` instead of touching globals.
- Server-provided content (route names, event titles, bot names, server error text) is not translated and is only ever inserted with `textContent`.
- Data, protocol, FIT files and `<input type="number">` values are never localized. Only displayed text is.
- Units stay a separate metric/imperial setting.
- Locale is module state like `util/format.js`; tests that call `setLocale("de")` reset to `"en"` in `afterEach`.
- German uses informal "du" (decision of this plan; flagged for review).
- Language names `English` / `Deutsch` are autonyms and are never translated.
- Key style: dotted, grouped by screen (`menu.routes.title`); interpolation `{name}`; plurals are `key.one` / `key.other`.
- Run client checks via `make test-client` / `make lint-client` (falls back to a `node:22` container). Single file: `docker run --rm -v "$PWD":/w -w /w/client node:22 node --test test/<file>`.
- Commit messages are imperative; end each with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Odd browser language values (`"DE"`, `"de-DE-u-co-phonebk"`, `""`, `undefined`, `"zh-Hans"`): resolve to `de`/`en`, never throw. (Task 1)
- `localStorage` throwing (private mode) or holding junk (`"fr"`, `""`): app still starts, junk ignored. (Task 3)
- Params containing `<`, `{`, `$&`: `t` returns them literally, DOM application uses `textContent`; a missing param leaves `{name}` visible rather than throwing. (Tasks 1, 2)
- Plurals at 0, 1, 2 in both languages (`0 riders`, `1 Fahrer`). (Task 1)
- Number-input values and exported data stay dot-decimal when the locale is `de`. (Task 8)
- Switching language leaves no stale-language text; the ride screen is a pre-cloned template, so translating only the live DOM is not enough. (Tasks 3, 4)
- German text is 20-30 % longer: no clipped or overflowing buttons/HUD. (Task 9)

---

### Task 1: i18n core

**Files:**
- Create: `client/public/js/i18n/i18n.js`, `client/public/js/i18n/en.js`, `client/public/js/i18n/de.js`
- Test: `client/test/i18n.test.js`

**Interfaces:**
- Produces (`i18n.js`):
  - `SUPPORTED_LOCALES = ["en","de"]`, `DEFAULT_LOCALE = "en"`, `LOCALE_KEY = "openradlr.locale"`
  - `detectLocale({ saved, languages }): "en"|"de"` (pure)
  - `getLocale(): string`, `setLocale(code): string` (returns the locale actually set; unsupported becomes `en`)
  - `t(key: string, params?: object): string`; `tn(key: string, count: number, params?: object): string` (adds `n: count` to params, picks `key.one`/`key.other` via `Intl.PluralRules(getLocale())`, falls back to `.other`)
  - `initLocale({ storage, languages }): string` (reads `LOCALE_KEY` from `storage` in a try/catch, runs `detectLocale`, calls `setLocale`); `saveLocale(code, storage): void` (try/catch, never throws)
- `en.js` / `de.js` default-export flat `{ key: string }` objects. Seed `en.js` with `"test.hello": "Hello {name}"`, `"test.rider.one": "{n} rider"`, `"test.rider.other": "{n} riders"` (deleted again in Task 9). Seed `de.js` with `"test.rider.one": "{n} Fahrer"`, `"test.rider.other": "{n} Fahrer"`.

- [ ] **Step 1: Write failing tests in `client/test/i18n.test.js`**: `detectLocale` cases (saved `de` wins over `["en"]`; `["fr","de-AT"]` gives `de`; `["DE"]` gives `de`; `["de-DE-u-co-phonebk"]` gives `de`; `["zh-Hans"]`, `[]`, `undefined` give `en`; saved `"fr"` is ignored); `t` (interpolates `{name}`; `de` key missing in `de.js` falls back to `en`; unknown key returns the key; param `"<b>$&{x}"` returned literally; missing param leaves `{name}`); `tn` (en: 0 and 2 give `"0 riders"`, `"2 riders"`, 1 gives `"1 rider"`; de: 1 gives `"1 Fahrer"`, 2 gives `"2 Fahrer"`); `initLocale` with a fake storage that throws on `getItem` returns detected locale; `saveLocale` with a throwing storage does not throw; `setLocale("xx")` returns `"en"`.
- [ ] **Step 2: Run** `node --test test/i18n.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `i18n.js` per the Interfaces block. Lookup order for a key is current-locale dictionary, then `en`, then the key. Interpolation is a single `replace(/\{(\w+)\}/g, ...)` with a function replacer (so `$&` is not special) that leaves unknown names untouched.
- [ ] **Step 4: Run** the test file. Expected: PASS. Then `make lint-client`.
- [ ] **Step 5: Commit** `Add i18n core: locale detection, t and tn`.

### Task 2: Applying translations to the DOM

**Files:**
- Create: `client/public/js/i18n/apply.js`
- Test: `client/test/i18nApply.test.js`

**Interfaces:**
- Consumes: `t` from Task 1.
- Produces: `applyTranslations(root: ParentNode = document): void`. For each `[data-i18n]` element sets `textContent = t(key)`; for each `[data-i18n-attr]` element, whose value is comma-separated `attr:key` pairs (`"title:menu.build.copy,aria-label:menu.build.copy"`), sets each attribute to `t(key)`. Also handles `root` itself when it matches.

- [ ] **Step 1: Write failing tests** with a hand-rolled fake element tree (objects with `querySelectorAll`, `dataset`, `setAttribute`, `textContent`; see `test/helpers.js` and `ui.test.js` for the project's fake style): text is set; attributes are set for two pairs; a param-like text `"<img>"` supplied through a key is assigned as text (assert `textContent`, and that the fake records no `innerHTML` write); a key missing in `de` renders the English text.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** `applyTranslations` in `apply.js` (textContent and `setAttribute` only).
- [ ] **Step 4: Run** the file, expected PASS; `make lint-client`.
- [ ] **Step 5: Commit** `Apply translations to data-i18n elements`.

### Task 3: Language selector, persistence, live switch, offline

**Files:**
- Modify: `client/public/index.html` (selector markup), `client/public/js/main.js` (wiring), `client/public/styles.css`, `client/public/sw.js`
- Test: `client/test/i18nSelector.test.js`, extend `client/test/i18n.test.js`

**Interfaces:**
- Consumes: `initLocale`, `saveLocale`, `setLocale`, `getLocale`, `applyTranslations`.
- Produces: in `main.js`, `changeLanguage(code)` and `relocalise(): void`, a function that re-runs `applyTranslations(document)` and `applyTranslations(rideTemplate)`, sets `document.documentElement.lang`, and calls the re-render hooks registered in a module-level `const relocaliseHooks = []` (later tasks `push` their renderers there). Markup: a `<div class="lang-switch" role="group" aria-label="Language">` with `<button type="button" class="toggle" data-lang="en" aria-pressed>English</button>` and `data-lang="de"` `Deutsch`, in the start menu header (`.start-head`, next to `.server-status`) and next to `.unit-switch` in the Rider panel. A single delegated `click` handler for `[data-lang]` (same pattern as `[data-units]`) keeps both in sync via `aria-pressed`.

- [ ] **Step 1: Write failing tests**: extract the pure part into `client/public/js/i18n/selector.js` as `languageButtonStates(current): {en: boolean, de: boolean}` (pressed state) and assert it; extend `i18n.test.js` with a round trip `saveLocale("de", storage)` then `initLocale({storage, languages:["en"]})` gives `de`; junk `""` in storage gives detected locale.
- [ ] **Step 2: Run**, expect FAIL; **Step 3: implement** `selector.js`, the markup, the CSS (match `.unit-switch`), and the `main.js` wiring: call `initLocale({ storage: localStorage, languages: navigator.languages })` and `relocalise()` before anything else that renders. `changeLanguage` saves, sets, then `relocalise()`; if the ride screen is showing (`!$("ride").hidden`) it reloads the page instead. Use the existing `readSetting`/`writeSetting` try/catch style where it fits.
- [ ] **Step 4: Service worker**: add `/js/i18n/i18n.js`, `/js/i18n/apply.js`, `/js/i18n/en.js`, `/js/i18n/de.js`, `/js/i18n/selector.js` to `SHELL`; bump `CACHE` to `openradlr-shell-v2`.
- [ ] **Step 5: Run** `make test-client lint-client`; start `make dev`, load with a German-preferring browser context (Playwright `locale: "de-DE"`), confirm `<html lang="de">` and the selector shows `Deutsch` pressed. **Step 6: Commit** `Add language selector with persisted, browser-detected default`.

### Task 4: Static HTML, part 1 (harness, start menu and Rider panel)

**Files:**
- Modify: `client/public/index.html`, `client/public/js/i18n/en.js`
- Create: `client/test/i18nHtml.test.js`

**Interfaces:**
- Produces `i18nHtml.test.js`, which parses `index.html` with a small tag/text tokenizer (no DOM library) and fails when: (a) a text chunk with two or more consecutive letters sits in an element lacking `data-i18n`, unless it is in `ALLOWED_TEXT` (`Open`, `Radlr`, `English`, `Deutsch`) or inside a `data-unit` element; (b) an element with `title`, `aria-label`, `placeholder` or `alt` attribute text lacks the matching `data-i18n-attr` pair; (c) a `data-i18n` element has child elements; (d) a used key is missing from `en`; (e) the element's English text (whitespace-collapsed) differs from `en[key]` (keeps HTML and dictionary from drifting); (f) an `en` key is unused by HTML, unless it matches `PENDING_KEY_PREFIXES` (dynamic keys added by later tasks). It skips top-level sections listed in `PENDING_SECTIONS`, initially every id in `grep -n '<section' index.html` except the ones this task converts (`setup` and its children, `unfinished`, `events`, `photos`).

- [ ] **Step 1: Write the test** with the full `PENDING_SECTIONS` list. **Step 2: Run**, expect FAIL listing every unconverted element in `setup`/`unfinished`/`events`/`photos`.
- [ ] **Step 3: Convert** those sections: add `data-i18n` / `data-i18n-attr`, keep the English text in place as the no-JS fallback, restructure mixed content so text sits in its own element (`<label><span data-i18n="rider.weight">Weight</span> (<span data-unit="weight">kg</span>) <input ...></label>`), and add the matching `menu.*`, `rider.*`, `unfinished.*`, `events.*`, `photos.*` keys to `en.js`. Also `<meta name="description">`: `data-i18n-attr="content:app.description"`. The `<option>` labels get `data-i18n` too (`Every 1 km`-style options are rebuilt in JS and belong to Task 6).
- [ ] **Step 4: Run** `make test-client lint-client`, expected PASS. **Step 5: Commit** `Translate the start menu and Rider panel markup`.

### Task 5: Static HTML, part 2 (ride screen)

**Files:** Modify `client/public/index.html`, `en.js`, `client/test/i18nHtml.test.js` (remove `ride` from `PENDING_SECTIONS`).

- [ ] **Step 1: Remove `ride` from `PENDING_SECTIONS`; run, expect FAIL.**
- [ ] **Step 2: Convert** the `#ride` section (HUD, pause, summary, splits, studio panels inside it) with `ride.*` keys. `rideTemplate` is cloned at `main.js:268` and per ride at `main.js:1280`: confirm `relocalise()` translates `rideTemplate` (Task 3) so every fresh clone is already localized, and add a test in `i18nApply.test.js` that `applyTranslations` on a cloned fake subtree translates it.
- [ ] **Step 3: Run** `make test-client lint-client`, expect PASS. **Step 4: Commit** `Translate the ride screen markup`.

### Task 6: Static HTML, part 3 (everything left)

**Files:** Modify `client/public/index.html`, `en.js`, `client/test/i18nHtml.test.js` (`PENDING_SECTIONS` becomes empty and is deleted).

- [ ] **Step 1: Remove the remaining sections (`ftp-prompt` and any not yet converted) from `PENDING_SECTIONS`; run, expect FAIL.**
- [ ] **Step 2: Convert** them with `ftp.*` etc. keys. **Step 3: Run** `make test-client lint-client`, expect PASS. **Step 4: Commit** `Translate the remaining markup`.

### Task 7: Dynamic strings in JS

Three sub-groups, each its own commit. Pure helpers (`serverStatus`, `buildLabel`, `levelLabel`, `ftpProvenance`, `stageStats`, `planSummary`, ...) call `t`/`tn` directly and keep their return shapes, so their existing English tests keep passing unchanged and are the regression net.

**Files:**
- Create: `client/test/i18nSweep.test.js`
- Modify: the JS modules in each group, `en.js`, `main.js`

**Interfaces:**
- Produces `i18nSweep.test.js`: reads each `public/js/**/*.js` source (except `i18n/`) and fails on a string/template literal containing a letters-and-space English phrase that is assigned to `textContent`, `title`, `placeholder`, `aria-label`, or passed to `alert(`/`confirm(`/a `status`-style setter, unless the file is in `PENDING_FILES` (initially every file the sweep flags; each group removes its files) or the line carries `// i18n-ok` (for log lines, ids and CSS names).

- [ ] **Step 1: Write the sweep test**, run it, and record the flagged files into `PENDING_FILES`; run again, expect PASS.
- [ ] **Step 2 (group A: start menu, profile, FTP, events, routes):** `view/startMenu.js`, `profile/level.js`, `view/profileView.js`, `view/panels.js`, `view/menuStage.js`, `view/events.js`, `view/ftp*.js`, `view/mapPreview.js`, plus the matching `main.js` code (`renderUnits` split-mode options, `showLevel`, `refreshFtpFields`, `ftp-prompt-*`, Strava messages, route/stage text, `confirm` texts). Use `tn("menu.riders", players)` for rider counts. Register re-renders (`renderUnits`, `showLevel`, `refreshFtpFields`, route list, server status) with `relocaliseHooks`. Remove these files from `PENDING_FILES`. Add a test per plural/params helper that asserts the `de`-locale output once Task 9 fills `de.js` (written then). Run `make test-client lint-client`; **commit** `Translate start menu, profile and FTP strings`.
- [ ] **Step 3 (group B: ride, HUD, pause, splits, photos, recovery):** `view/hud.js`, `view/splitsView.js`, `view/photos.js`, `ride/*` user-facing messages, `ride/rideAutosave.js`, `view/raceTimelineView.js`, `view/pelotonView.js`, and the matching `main.js` code (including the `alt` text at `main.js:2318` and the `confirm` calls at `main.js:1027`, `1847`, `2249`). Same procedure; **commit** `Translate ride strings`.
- [ ] **Step 4 (group C: workouts, studio, vehicles, paddle, devices):** `view/workoutStudioView.js`, `view/workoutView.js`, `workout/presets.js` and `plan.js` display names and summaries, `studio/classClock.js`, `view/vehicleView.js`, `ride/vehicle.js` messages, `view/paddleView.js`, `ble/*` user-facing messages and `ride/trainingControl.js`, `ride/ftpTestSession.js` messages. Preset/plan names live in `en.js` (`workout.preset.<id>.name`) and are looked up by id. `PENDING_FILES` must now be empty: delete it and its checks. **Commit** `Translate workout, studio and device strings`.
- [ ] **Step 5: Run** `make check`, expect PASS.

### Task 8: Locale-aware number and date formatting

**Files:**
- Modify: `client/public/js/util/format.js`, `client/public/js/view/startMenu.js:51`, `client/public/js/view/photos.js:179,225`, `client/public/js/main.js:321,2318`, `client/public/js/view/ftpProvenance.js`, `client/public/js/view/events.js`
- Test: `client/test/format.test.js` (new) and `client/test/units.test.js` unchanged

**Interfaces:**
- Produces in `format.js`: `formatNumber(value: number, digits: number): string`, built on a cached `Intl.NumberFormat(getLocale(), {minimumFractionDigits: digits, maximumFractionDigits: digits})` (cache keyed by locale and digits; HUD calls it every frame). `formatSpeed`, `formatDistance`, `formatElevation`, `formatWkg` and friends use it. Dates in `photos.js`, `main.js` and `ftpProvenance.js` pass `getLocale()`.

- [ ] **Step 1: Write failing tests**: with `setLocale("de")`, `formatSpeed(10)` is `"36,0"`, `formatDistanceWithUnit(12345)` is `"12,35 km"`, the start-menu community total of 12345000 m reads `"12.345 km"`; with `en` the existing outputs are unchanged (the whole `units.test.js` stays green); `displayToKg(...)`/`kgToDisplay(...)` return numbers that are not localized (assert `typeof === "number"`); the `weight` field's `.value` assignment in `initSetup` still receives a dot-decimal (extract any string conversion to `String(number)`). `afterEach(() => setLocale("en"))`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement**; replace the hard-coded `"en-US"` and the implicit locales. **Step 4: Run** `make test-client lint-client`, expect PASS; confirm no `.toFixed(` result is written to an `<input>` value or the protocol. **Step 5: Commit** `Format numbers and dates in the active language`.

### Task 9: German dictionary

**Files:**
- Modify: `client/public/js/i18n/de.js`, `client/public/js/i18n/en.js` (delete the `test.*` keys), `client/test/i18n.test.js`
- Create: `client/test/i18nParity.test.js`

- [ ] **Step 1: Write the parity test**: `Object.keys(de)` equals `Object.keys(en)` (report missing and extra keys separately), and every key has the same set of `{param}` names in both languages, and both languages define `.one` and `.other` for every plural group. Also add the German assertions deferred from Task 7 (`tn("menu.riders", 1)` gives `"1 Fahrer"`; `serverStatus` in `de`; `afterEach` resets to `en`).
- [ ] **Step 2: Run**, expect FAIL listing every missing key.
- [ ] **Step 3: Translate** every key in `de.js`: informal "du", established cycling terms where German riders use them (FTP, Watt, Kadenz, Puls), no machine-style literal calques; keep strings short (target at most 130 % of the English length for buttons, HUD labels and `<option>`s).
- [ ] **Step 4: Run** `make check`, expect PASS.
- [ ] **Step 5: Layout check**: `make dev`, then take German screenshots of the start menu, Rider panel, HUD in each layout and the summary (recipe in `AGENTS.md`; use `locale: "de-DE"`, widths 390 and 1280). Fix clipped or overflowing text in `styles.css` and shorten the German string if CSS alone is not enough. Share the screenshots in the PR description. **Step 6: Commit** `Add German translation`.

### Task 10: Documentation

**Files:**
- Create: `docs/adr/0017-client-internationalization.md`
- Modify: `CHANGELOG.md`, `AGENTS.md`, `CONTRIBUTING.md`

- [ ] **Step 1: ADR 0017** (context, decision, consequences, in the style of `0016-agpl-licence.md`): hand-rolled module over a library, flat dictionaries, `data-i18n`, client-only scope with server content untranslated, the three guard tests.
- [ ] **Step 2: CHANGELOG** under `[Unreleased]` → `Added`: German translation and a language selector that follows the browser. Add the issue number if one exists (`gh issue list --search i18n`).
- [ ] **Step 3: Contributor note** in `CONTRIBUTING.md` (and a line in `AGENTS.md` key layout): new UI text goes through `t()` / `data-i18n` with keys in both `en.js` and `de.js`; the parity, HTML and sweep tests enforce it.
- [ ] **Step 4: Run** `make check`; expect PASS. **Step 5: Commit** `Document client internationalization`.
- [ ] **Step 6:** push `feat/i18n-german` and open the PR only if asked.
