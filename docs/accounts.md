# Accounts

Riders can keep their progress in an account: they sign in with an emailed
code or a passkey, and each rider they save is backed up there (profile,
goals, progress, settings, best laps and rides). Why and how:
[ADR 0032](adr/0032-accounts-with-signed-rider-keys.md) and the
[design spec](superpowers/specs/2026-11-24-account-and-backup-design.md).

Accounts are meant for the official server (`app.openradlr.com`). A server
without them behaves as before: riders' progress stays on their devices.

## Trying it locally

```bash
make dev-id
```

starts the server with accounts on http://localhost:8090. Its data and a
generated key stay in `.data/id` (ignored by git), so you stay signed in
across restarts. With the `OPENRADLR_SMTP_*` settings in your `.env`, sign-in
codes are mailed for real; without them they appear in the server's log.
Passkeys work on `localhost` in Chrome, Edge and Safari.

To look at the mails without sending any:

```bash
cd server && cargo run -p openradlr-id --example mail_preview -- /tmp/openradlr-mails
```

## Running it

| Setting | |
| --- | --- |
| `OPENRADLR_ID=on` | Turns accounts on at `/id` |
| `OPENRADLR_PUBLIC_URL` | Required. Passkeys are bound to its host: changing it later makes existing passkeys stop working (codes still work) |
| `OPENRADLR_DATA_DIR` | Required. Accounts and backups go to `id.sqlite` there: back this file up |
| `OPENRADLR_SECRET_KEY` | Required. Keys the sign-in codes; changing it only voids codes sent in the last 10 minutes |
| `OPENRADLR_SMTP_HOST`, `_USERNAME`, `_PASSWORD`, `_FROM` | How codes and notices are mailed |
| `OPENRADLR_SMTP_TLS` | `starttls` (default, port 587) or `tls` (port 465); `OPENRADLR_SMTP_PORT` overrides the port |
| `OPENRADLR_TRUST_PROXY=true` | Behind a reverse proxy, so the rate limits see riders' addresses, not the proxy's |

The reverse proxy must pass `/id/*` to the server like everything else.

With Docker Compose (`make up`, `make update`), put these in `.env`:
`docker-compose.yml` hands them to the server, and the data dir is the `data`
volume. Behind the bundled Caddy also set `OPENRADLR_TRUST_PROXY=true`. After
`make update`, `/api/info` says `"account": true` and the log shows
`accounts enabled at /id`; without SMTP settings it warns that codes only go to
the log.

**Mail delivery.** Send from an address of a domain you control (e.g.
`OpenRadlr <noreply@openradlr.com>`) and set up SPF, DKIM and DMARC for it at
your mail provider; without them codes land in spam or are rejected. Then
sign in once with a Gmail and an Outlook address to check.

**Limits.** A code works for 10 minutes and 5 tries; 5 codes per address and
20 per client address an hour. An account's backups take at most 50 MB (a
ride is a few KB) and a single ride at most 256 KB.

## What the server stores

| | Kept | Deleted |
| --- | --- | --- |
| Email address | while the account exists | with the account |
| Sign-in codes | as an HMAC, 10 minutes | when used, replaced or expired |
| Sessions | as a hash, 180 days | on signing out, expiry or with the account |
| Passkeys | their public key and name | when removed or with the account |
| Saved riders | public key, name, backups (profile, goals, progress, settings, best laps, rides) | with the account |

Rider keys' private halves never leave the device.

## Privacy policy

Your privacy policy has to cover accounts. A starting point to adapt (not
legal advice):

> **Accounts (optional).** If you save your progress in an account, we store
> your email address and, for each rider you save, their profile (name,
> weight, FTP and settings), goals, progress, best laps and rides. We use your
> email address only to send you sign-in codes and notices about your account
> (a new passkey, the account's deletion). Legal basis: performance of the
> contract you enter by creating the account (Art. 6(1)(b) GDPR). Mails are
> sent through [provider], who processes your address on our behalf
> (Art. 28 GDPR). If you add a passkey, we store its public key; your
> fingerprint or face never leave your device. You can delete your account at
> any time under Profile → Account; this deletes everything stored for it.
> Rides on your devices stay there.

> **Konten (optional).** Wenn du deinen Fortschritt in einem Konto sicherst,
> speichern wir deine E-Mail-Adresse und, für jeden gesicherten Fahrer, sein
> Profil (Name, Gewicht, FTP und Einstellungen), Ziele, Fortschritt,
> Bestrunden und Fahrten. Deine E-Mail-Adresse nutzen wir nur für
> Anmeldecodes und Hinweise zu deinem Konto (ein neuer Passkey, die Löschung
> des Kontos). Rechtsgrundlage: die Erfüllung des Vertrags, den du mit dem
> Anlegen des Kontos eingehst (Art. 6 Abs. 1 lit. b DSGVO). Die Mails
> verschickt [Anbieter] in unserem Auftrag (Art. 28 DSGVO). Fügst du einen
> Passkey hinzu, speichern wir seinen öffentlichen Schlüssel; Fingerabdruck
> oder Gesicht verlassen nie dein Gerät. Du kannst dein Konto jederzeit unter
> Profil → Konto löschen; damit wird alles dazu Gespeicherte gelöscht.
> Fahrten auf deinen Geräten bleiben dort.
