# 28. Rider-scoped storage

Date: 2026-11-16 · Status: accepted

## Context

A device held one rider: their profile, rides and settings in `openradlr.*` /
`openride.*` keys and three IndexedDB databases. A shared tablet needs several
riders (#112), each with their own data, and switching must keep the trainer,
heart rate strap and second screens connected.

## Decision

- **A scoped storage wrapper.** `riderStorage(raw, riderOf)` gives a
  Storage-like view. `riderOf()` is called on every access, so switching changes
  what the wrapper points at and moves no data. Modules still take storage as
  an argument.
- **Device keys pass through.** An explicit list (`DEVICE_KEYS`,
  `DEVICE_PREFIXES`) holds paired devices, second screens, graphics quality,
  Strava receipts and the roster. Every other key is a rider key.
  `test/storageKeys.test.js` sweeps all `openradlr.*` / `openride.*` literals,
  so a new key needs a conscious decision.
- **Rider `"main"` keeps the old keys**, unprefixed, so existing data is its
  data. Other riders use `openradlr.rider.<id>.<key>`. The roster lives in
  `openradlr.riders` as `{ active, ids }`; without one, `"main"` is the only rider.
- **IndexedDB per rider.** `riderDbName(base, id)` gives `base` for `"main"` and
  `base.<id>` otherwise. `indexedDbStore` resolves the name on every call.
- **Switching in place.** `switchRider(id)` changes the roster and refreshes the
  start menu without a reload, so Bluetooth and cockpit pairing stay connected.
  It is refused during a ride or with a dialog open. Late async results are
  dropped when the rider generation has changed.
- **Strava stays per device** until #113.

## Consequences

- The wrapper never throws, so a wrong reference inside `riderOf` fails silently
  with defaults. The roster is therefore a module-level variable in `main.js`,
  set before anything reads storage.
- Deleting a rider switches away first, then removes its keys and databases.
- No protocol change: each rider already has their own key pair.
