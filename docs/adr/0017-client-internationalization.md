# 17. Client internationalization with a small in-house module

Date: 2026-10-29 · Status: accepted

## Context

Many OpenRadlr riders are in Germany, and the client was English only. The
client is plain ES modules with no build step and no runtime dependencies, and
a trainer-side page is rebuilt every frame in places, so whatever translates it
must be cheap to call.

## Decision

- **Own module, no library.** `client/public/js/i18n/` has `t(key, params)`,
  `tn(key, count, params)` (plural via `Intl.PluralRules`), locale detection
  and a persisted choice (`openradlr.locale`). Detection order: saved choice,
  then the first `navigator.languages` entry whose base language is supported,
  then English.
- **Flat dotted-key dictionaries** `en.js` (source and fallback) and `de.js`,
  with `{name}` interpolation done by a function replacer so values are never
  read as markup or replacement patterns.
- **Static markup** is translated by `data-i18n` (text) and `data-i18n-attr`
  (`title`, `aria-label`, ...) through `applyTranslations`, which only writes
  `textContent` and `setAttribute`. The English text stays in the HTML as the
  fallback. JS-built text calls `t`/`tn` directly.
- **Scope is client UI text.** Server-provided content (route names and
  descriptions, event names, bot names, server messages) is shown as received.
  Data, protocol and exported files stay English and dot-decimal; only
  displayed numbers and dates follow the language (`formatNumber`).
- **Switching** re-applies the page and runs `relocaliseHooks`; if a ride is on
  screen the page reloads instead, because the ride screen is cloned per ride.
- **Three guard tests** keep it honest: `i18nHtml` (every visible text and
  attribute in `index.html` is keyed and matches `en.js`), `i18nSweep` (no
  English prose literals left in the JS) and `i18nParity` (`de.js` has the same
  keys and `{params}` as `en.js`).

## Consequences

- Adding a language is a new dictionary plus an entry in `SUPPORTED_LOCALES`
  and the selector.
- New UI text needs keys in both dictionaries; the tests fail otherwise.
- The sweep is a heuristic: log lines, file contents and CSS-like literals are
  skipped or marked `// i18n-ok`.
- Text that JS writes into an element that also carries `data-i18n` must be
  re-rendered from a `relocaliseHooks` entry, or a language switch resets it.
