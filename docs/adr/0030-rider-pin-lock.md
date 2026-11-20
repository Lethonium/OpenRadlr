# 30. An optional PIN lock per rider

## Context

Several riders can share one device (ADR 0028), and a rider may not want the others to open
their rides or settings. There is no account, so there is no server to check a password
against, and the data stays in the browser's storage.

## Decision

A rider can set a PIN of four or more digits. The roster (`openradlr.riders`) keeps a
salted PBKDF2 hash per locked rider in `locks`, never the PIN; the key is only present while
some rider has a PIN. The check lives in `profile/pin.js` and `profile/pinLock.js` with
`crypto.subtle` and the random source injected, so tests need no real crypto.

A locked rider is opened only after their PIN was entered in this page session: at startup
(the page is inert and covered meanwhile), after a switch, and before a data export. A
forgotten PIN has no recovery: the only way out is deleting the rider, from the PIN card,
with the usual confirmation. If the locked rider is the only one, a new rider with defaults
takes their place, because the last rider cannot be deleted.

## Consequences

- It is a lock in the UI, not encryption: the data stays readable with the browser's dev
  tools. The interface says so.
- A rider without a PIN behaves as before; existing profiles need no migration.
- Deleting a rider removes their lock with them.