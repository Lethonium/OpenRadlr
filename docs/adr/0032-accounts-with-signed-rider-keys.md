# 32. Accounts with signed rider keys

Date: 2026-11-24 · Status: accepted · Builds on [ADR 0003](0003-key-based-identity.md)

## Context

ADR 0003 made a rider a P-256 key pair, but the server never checked that the sender of a
`public_key` held its private key, and the private key sat as a JWK in localStorage. Progress lives
on one device (#97), and Strava is the only account-like thing (ADR 0008). Riders switching from
other platforms expect an account that keeps their progress across devices.

## Decision

- **Signed join.** `welcome` carries a per-connection challenge; `join` carries an ECDSA signature
  over `openradlr-join\n<challenge>`. A bad signature is refused; an unsigned join from an older
  client is still accepted, with its key treated as unverified.
- **Non-extractable keys.** The private key is a non-extractable CryptoKey in a per-rider IndexedDB.
  An old JWK is imported once and deleted, keeping the public key.
- **One official account service**, the crate `openradlr-id`, mounted at `/id` by the game server
  with `OPENRADLR_ID=on` on `app.openradlr.com`. Other servers don't run it and behave as before.
- **No passwords.** Sign-in by an emailed code or a passkey (ES256, verified in our own code over
  `p256`, without CBOR, since the client sends the SPKI). Apple, Google and Strava sign-in come later.
- **Rider keys link to an account** by signing `openradlr-link\n<challenge>`; the account then
  stores a backup per rider. The device stays the copy riders work with; the backup is added to and
  never blocks a ride.

## Consequences

- Game servers can trust `public_key` from new clients. That is the basis for a later `verified`
  mode (accounts required, race categories) without servers calling the account service.
- Clearing the browser now also loses a key that can no longer be exported. With an account the
  rider's data survives; a new device gets a new key, linked to the same account.
- Our own WebAuthn verification is small but security-relevant: it is ES256-only and tested with a
  software authenticator. Authenticators offering only RS256 can't register a passkey and use the
  email code.
- Running the account service needs SMTP for codes; without it the codes only go to the log.
