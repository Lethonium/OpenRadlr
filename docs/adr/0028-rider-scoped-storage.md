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
  `base.<id>` otherwise. The ride stores (`ride/rideStores.js`) are pinned to
  one rider at construction: their operations span awaits (a lap offered with
  a read and a write, a save with its follow-ups), and the active rider can
  change while such an operation is out. Stores built for a rider keep that
  rider's databases for good; the start menu builds them again whenever the
  active rider changes, and post-save callbacks capture their rider (#115).
- **Switching in place.** `switchRider(id)` changes the roster and refreshes the
  start menu without a reload, so Bluetooth and cockpit pairing stay connected.
  It is refused during a ride or with a dialog open. Late async results are
  dropped when the rider generation has changed.
- **Strava stays per device** until #113.

## Consequences

- Reads through the wrapper never throw, but a storage that refuses a write or
  a delete throws to the caller, whose catch it is (#115): save and delete
  flows report the failure instead of pretending success. Without any storage
  at all, writes are still ignored.
- The roster is a module-level variable in `main.js`, set before anything
  reads storage.
- Deleting a rider switches away first, then removes its keys and databases.
  Whatever refuses to go keeps the rider in the roster, so their remains stay
  reachable for a retry (#115).
- No protocol change: each rider already has their own key pair.
