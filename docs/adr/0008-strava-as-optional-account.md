# 8. Strava as an optional account

Date: 2026-10-14 · Status: accepted

## Context

Public servers need some protection against scripted clients, and riders
want their rides on Strava. Building our own account system (ADR 0003's auth
server) is a bigger step.

## Decision

A server can configure a Strava API app. Riders then "Connect with Strava":
the server performs the OAuth code exchange, keeps tokens in memory and sets
an HttpOnly session cookie. `OPENRADLR_REQUIRE_STRAVA=true` makes the
connected account a requirement for joining, with one connection per athlete.
Uploads stay a per-ride choice: the client builds a TCX file, the server
uploads it with the rider's token.

## Consequences

- Real accounts as a bot hurdle without running our own account service.
- Depends on Strava's API terms and rate limits; new API apps start with a
  single-athlete capacity until Strava approves them.
- Sessions were first kept only in memory, so every restart and deploy logged
  riders out of Strava. They are now saved in SQLite in `OPENRADLR_DATA_DIR`
  (a Docker volume): session ids as SHA-256 hashes, refresh tokens encrypted
  with AES-256-GCM under a key derived from `OPENRADLR_SECRET_KEY`, access
  tokens not at all (fetched again with the refresh token). Without the key a
  server falls back to memory and warns. Servers without Strava need neither.
- Local key pairs (ADR 0003) stay for servers without Strava.
