# Internationalization (German) — design

Date: 2026-10-29 · Status: agreed in discussion, awaiting spec review

## Goal

The browser app is available in German as well as English. The language
follows the browser on the first visit, can be changed with a selector, and the
choice is remembered. Adding a third language later means adding one
dictionary file.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | All client UI text: static HTML and strings built in JS. Server-provided content (route names, event titles, bot names) stays as is |
| Approach | A small hand-rolled i18n module, no dependency, no build step |
| Languages | `en` (source, fallback) and `de` |
| Detection | Saved choice, then the first `navigator.languages` entry whose base language is supported (`de-AT`, `de-CH` → `de`), then `en` |
| Storage | Its own `localStorage` key: a UI preference, not a rider profile field, so it works before a profile exists |
| Selector | `English` / `Deutsch` control in the start menu header and next to the unit switch in the Rider panel |
| Switching | Live where cheap, otherwise reload the page; decided at implementation time by whichever is less fragile |
| Formatting | The active language drives `Intl` number and date formatting and `<html lang>`. Units stay a separate metric/imperial choice |
| Delivery | One PR, ordered commits |

## Scope

In:

- `client/public/js/i18n/`: `i18n.js` (`t`, locale detection, `setLocale`,
  `applyTranslations`), `en.js`, `de.js`.
- `data-i18n="key"` on static HTML text, `data-i18n-attr="title:key,aria-label:key"`
  for attributes; every dynamic string in `main.js` and `view/*` becomes `t(...)`.
- The language selector and persistence.
- Locale-aware number/date formatting (replaces the hard-coded `"en-US"` in
  `startMenu.js` and the `[]`/`undefined` locales in `photos.js` and `main.js`).
- Service worker precache of the dictionaries so German works offline.
- Docs: ADR, CHANGELOG entry.

Out:

- Server-provided content and server error text (a protocol change, later).
- Right-to-left languages.
- Translating the privacy page, the landing site and the docs.
- A translation-management service or file format beyond JS modules.

## Design

### Module

```
t(key, params?)          // "Every {n} km" → interpolated; missing key → en, then the key itself
tn(key, count, params?)  // plural: picks key.one / key.other via Intl.PluralRules
getLocale() / setLocale(code)
detectLocale({ saved, languages })   // pure, takes its inputs
applyTranslations(root = document)   // fills data-i18n / data-i18n-attr
```

Dictionaries are flat `key → string` objects (dotted keys grouped by screen,
e.g. `menu.routes.title`). Interpolation uses `{name}`. Like `util/format.js`,
the current locale is module state, set once from `main.js` (the composition
root) via `setLocale`; detection and storage take the browser's
`navigator`/`localStorage` as arguments so tests inject fakes.

A missing `de` key falls back to `en`; a missing `en` key renders the key
itself, which is visible and greppable.

### Selector and switching

The two selector controls share one handler and stay in sync. Choosing a
language stores it, calls `setLocale`, sets `<html lang>`, and re-applies the
static translations. Dynamic text that is rendered from state is re-rendered
by the existing refresh paths; anything that is not safely re-renderable
(in-flight status messages, canvases) is covered by reloading instead. The
implementation decides per screen; the rule is that no stale-language text may
remain visible after a switch.

### Formatting

`Intl.NumberFormat` / `toLocaleDateString` receive `getLocale()` instead of a
hard-coded or implicit locale. German therefore gets `1.234 m` / `1,5` style
output without any per-language code. `util/format.js` keeps owning units.

### Service worker

`/js/i18n/*.js` joins the `SHELL` precache list and the cache name is bumped,
so a rider who installed the app can open it offline in either language.

## Testing

All plain node, no browser (per `CONTRIBUTING.md`):

- `detectLocale`: saved wins; `de-AT` → `de`; unsupported (`fr`) → `en`;
  empty list → `en`; first supported entry wins over a later one.
- `t` / `tn`: interpolation, `en` fallback for a missing `de` key, key
  fallback, German and English plural categories.
- **Parity:** `de` has exactly the keys of `en`, and the same `{param}` names
  per key, so a missing or mistyped translation fails CI.
- **HTML coverage:** every `data-i18n` / `data-i18n-attr` key in `index.html`
  exists in `en`; no unreferenced `en` keys.
- `applyTranslations` against a minimal fake DOM.
- Existing tests that assert English text keep passing with the default locale
  `en`.

Manual: a Playwright screenshot of the start menu and Rider panel in German,
with a long-German-text check for layout overflow (German is typically 20–30 %
longer than English).

## Commit order (one PR)

1. i18n core + tests (detection, `t`, `tn`, interpolation).
2. Selector, persistence, `<html lang>`, service worker.
3. Static HTML → `data-i18n` + English dictionary + coverage test.
4. Dynamic JS strings → `t(...)` + locale-aware formatting.
5. German dictionary + parity test + layout fixes.
6. ADR 0017, CHANGELOG.

## Risks

- **Volume:** ~170 HTML elements and ~56+ JS assignments in a 3,300-line
  `main.js`. Mitigated by the commit order and by the coverage test catching
  strings that were missed in HTML.
- **Missed JS strings** have no automatic detector; review by grep for
  `textContent =`, template literals and `alert`/status calls at step 4.
- **German length** can break tight layouts (HUD, buttons); handled in step 5.
