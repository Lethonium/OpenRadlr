# OpenRadlr account: signed riders, sign-in and backup

Phases 0 and 1 of the account concept (#97, #113). Later phases: two-way sync and sign-in on a new
device (2), upload connectors with Strava moved to the account (3), Sign in with Apple/Google,
`verified` servers and friends (4).

## Intent

Today a rider is a key pair in one browser. Changing device, clearing the browser or losing the
phone loses every ride, lemon and achievement. Riders who come from Zwift or Rouvy expect an account
that keeps their progress. Joining must stay as easy as today: ride first, an account is offered when
there is something worth keeping, never as a wall.

## Goals

- **Phase 0, a signed join.** The server sends a random challenge in `welcome`; the client signs it
  with the rider's private key and sends the signature with `join`. A server can then trust that a
  `public_key` belongs to the rider who sent it. The private key becomes a non-extractable WebCrypto
  key in IndexedDB instead of a JWK in localStorage.
- **Phase 1, an account and a backup.**
  - Sign in with an emailed 6-digit code, or with a passkey (in the browser).
  - "Save your progress" on the ride summary and in the profile: create the account, link this
    rider's key to it (proven with a signature) and back up the rider.
  - The backup holds the profile, goals, progress, settings, best laps and every saved ride. After
    each saved ride, and when signing in, the client uploads what the account doesn't have yet.
  - Sign out, delete the account (with everything stored for it).
- Riding never waits for the account: a failed or slow backup is retried later and never blocks a
  ride. Riding itself still needs a game server (ADR 0002).

## Non-goals

- Restoring a backup on another device, and two-way sync (phase 2). The read endpoints exist so
  phase 2 needs no server change, but there is no UI for them yet.
- Strava per account and other upload targets (phase 3), Apple/Google sign-in, passkeys in the
  native app (phase 4; the WebView has no reliable WebAuthn, the app offers the email code).
- Game servers that require an account (`verified` mode). Servers only check the join signature.
- Self-hosted account services. There is one official service on `app.openradlr.com`; other
  servers run without it and behave as today.

## Anti-goals

- A login wall, or an account prompt before the first ride.
- Passwords. Nothing to leak, no reset flow.
- Telling a stranger whether an email has an account (the code request always answers the same).
- A private key that leaves the device: not in the backup, not in the export, not readable by
  page scripts.
- Breaking older clients or servers: everything is additive within protocol version 2.

## Design

### Phase 0: signed join

- `welcome` gains `challenge`: 32 random bytes as hex, one per connection.
- `join` gains `signature`: ECDSA P-256 with SHA-256 over the UTF-8 bytes of
  `openradlr-join\n<challenge>`, in WebCrypto's raw `r‖s` form, base64.
- The server verifies it against `public_key` (base64 SPKI). A bad signature, or a signature without
  a key, is refused with `bad_signature`. A key without a signature (an older client) is accepted as
  before and treated as unverified; nothing uses the key yet, so nothing changes for those riders.
- Client: `profile/riderKey.js` keeps the key pair in a per-rider IndexedDB `openradlr-keys`. An
  existing `privateKeyJwk` is imported as non-extractable and removed from the profile, so the public
  key, and with it the rider's identity, stays the same. Without IndexedDB the rider joins unsigned.

### Phase 1: the ID service

A new crate `server/crates/id` (`openradlr-id`): an axum `Router` and its SQLite store. The game
server mounts it at `/id` when `OPENRADLR_ID=on`, so it shares the origin and the cookie with the
client and needs no CORS. It is a crate of its own so it can move into its own container later.

| Endpoint | What it does |
| --- | --- |
| `POST /id/v1/email/start {email}` | Sends a 6-digit code (valid 10 minutes); always `204` |
| `POST /id/v1/email/verify {email, code}` | Signs in, creating the account on first use |
| `POST /id/v1/passkeys/login/options`, `…/login` | Sign in with a passkey |
| `POST /id/v1/passkeys/register/options`, `…/register` | Add a passkey to the signed-in account |
| `GET /id/v1/me` | The account, its passkeys and riders; `401` when signed out |
| `POST /id/v1/logout` | Ends this session |
| `DELETE /id/v1/account` | Deletes the account and everything stored for it |
| `POST /id/v1/riders/challenge`, `POST /id/v1/riders` | Links a rider key, proven by signing `openradlr-link\n<challenge>` |
| `PUT/GET /id/v1/riders/{rider}/snapshot` | The rider's profile, goals, progress, settings, best laps |
| `GET /id/v1/riders/{rider}/rides`, `PUT/GET …/rides/{ride}` | The ride ids held; one ride |

- **Sessions:** a random id in an HttpOnly cookie `openradlr_id` (Path `/id`, SameSite Lax, Secure
  behind HTTPS), stored as a SHA-256 hash, 180 days. Every state-changing request must be
  `application/json` and come from the server's own origin.
- **Email codes:** stored as an HMAC under `OPENRADLR_SECRET_KEY`, 10 minutes, 5 attempts, a new
  code replaces the old one. Rate limits per address and per client IP. Without SMTP settings the
  code is written to the log (development only, with a warning).
- **Passkeys:** WebAuthn with ES256 only, attestation `none`, user verification required. The
  client sends `getPublicKey()` (SPKI) and `getAuthenticatorData()` from registration, so the server
  needs no CBOR. Checked: type, single-use challenge (5 minutes), origin, RP ID hash, UP and UV
  flags, signature, the sign counter when the authenticator keeps one.
- **Riders:** an account can link several rider keys (one per local rider and device). A rider's id
  is the first 32 hex digits of SHA-256 of its SPKI. A key belongs to one account at a time.
- **Backup:** opaque JSON the client produces (`localData.exportData` without the private key, the
  pairing secrets and the unfinished ride). The snapshot is replaced whole (≤ 2 MB); rides are added
  by id (≤ 256 KB each, a ride is a few KB) and never deleted by the client in this phase. An account's
  backups take at most 50 MB in all (`quota_exceeded`), so nobody can fill the server's disk.
- **Data:** `id.sqlite` in `OPENRADLR_DATA_DIR`. `OPENRADLR_ID=on` needs both the data dir and
  `OPENRADLR_SECRET_KEY`; the server refuses to start otherwise.

### Mails

`openradlr-id::mail` renders every mail from one layout, in English or German (the client sends the
rider's language): HTML (table layout, inline styles, the brand mark as an inline `cid:` image, a dark
variant via `prefers-color-scheme`) and plain text from the same parts, sent as
`multipart/alternative`. Riders' text (passkey names) is escaped.

| Mail | When |
| --- | --- |
| Sign-in code: "Welcome" for a new address, "Sign in" for a known one | `email/start` |
| New passkey added, with a hint to remove it if it wasn't you | a passkey is registered |
| Account deleted | the account is deleted |

A notice that fails is logged and never fails the change. Preview all of them with
`cargo run -p openradlr-id --example mail_preview -- <dir>`. For delivery the sending domain needs
SPF, DKIM and DMARC at the mail provider.

### Client

- `net/account.js`: the HTTP client (fetch injected).
- `profile/backup.js`: what to upload (snapshot, missing rides), with stores and the account
  client injected; runs after a saved ride and after signing in, one at a time.
- `net/passkeys.js`: WebAuthn ceremonies over `navigator.credentials` (injected).
- `view/accountView.js`: the account card in the profile page and the sign-in dialog (email → code,
  or passkey), a "Save your progress" button on the ride summary for signed-out riders.
- Shown only when `/api/info` says `account: true`.

## Testing

- Rust: signature checks with fixed key vectors, the WebAuthn checks with a software authenticator
  built in the test from `p256`, the store on an in-memory SQLite, the router with
  `tower::ServiceExt::oneshot`, the session's join with and without a signature.
- JS: `riderKey` with node's WebCrypto and a fake store, the join handshake with a fake socket,
  `account.js` with a fake fetch, `backup.js` with fake stores.
