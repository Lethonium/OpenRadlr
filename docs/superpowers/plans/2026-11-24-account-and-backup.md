# Account and backup implementation plan (phases 0 and 1)

Spec: `../specs/2026-11-24-account-and-backup-design.md`. ADR: `../../adr/0032-accounts-with-signed-rider-keys.md`.

## Phase 0: signed join

- [x] `openradlr-id::rider_key`: verify WebCrypto P-256 signatures (fixed vector from node's WebCrypto).
- [x] `welcome.challenge` per connection, `join.signature`; `bad_signature` for a bad one; unsigned joins as before.
- [x] Client `profile/riderKey.js`: non-extractable key in `openradlr-keys`, old JWK imported and removed.
- [x] `GameConnection` signs the challenge; `docs/protocol.md` (Signed join).

## Phase 1: account service and backup

- [x] Crate `server/crates/id`: store (SQLite), email codes (HMAC, expiry, attempts, rate limits),
      passkeys (ES256, own verification, software authenticator in tests), rider links, backups, HTTP router.
- [x] Server: `OPENRADLR_ID`, `OPENRADLR_SMTP_*`, mounted at `/id` with the client IP, `/api/info.account`.
- [x] Client: `net/account.js`, `net/passkeys.js`, `profile/backup.js`, `profile/accountFlow.js`,
      `view/accountView.js`, `localData.backupSnapshot`; Account page, start menu line, summary offer; EN/DE.
- [x] Backup after each saved ride and on start for a saved rider.
- [x] `make check`; browser run against a local server: code sign-up, wrong code, backup, passkey add,
      sign out, passkey sign-in, signed join verified by the server.

## Not in these phases

Restore and two-way sync on a new device (phase 2), connectors with Strava per account (phase 3),
Apple/Google sign-in, passkeys in the native app and `verified` servers (phase 4).
