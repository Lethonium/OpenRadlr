# Ride recovery: autosave, continue and reconnect — design

Date: 2026-10-17 · Issue: #73 · Status: agreed in discussion, awaiting spec review

## Goal

A ride is never lost. If the tab crashes, the phone kills the page or the
network drops, the rider keeps their ride file. If the drop is short, they keep
their place in the world, including their race or event entry and their
vehicle seat. A longer outage ends with "Finish and save", never with lost data.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Pieces 1 (autosave, continue) and 2 (reconnect, grace period) of #73. Piece 3 (offline physics) is deferred |
| What a short drop keeps | Everything: same rider id, position, speed, lane, race/event entry, vehicle seat |
| Continue after the grace period | Rejoin at the saved spot as a free rider (`resume` on `join`) |
| How the server holds a rider | Detach and reattach in the game core, found again by a random resume token |
| Identity for reattach | A per-join `resume_token`, not the public key (the key is optional, public and unsigned) |
| Where the autosave lives | IndexedDB, browser only, one slot |

## Scope

In:

- Server: detach instead of leave, grace period, `resume_token`, reattach,
  `resume` position on `join`, explicit `leave` message.
- Client: autosave to IndexedDB, Continue / Save / Discard on start,
  reconnect with backoff, pauses in the recorder and the FIT/TCX/GPX files.
- Docs: `docs/protocol.md`, `docs/architecture.md`, CHANGELOG.

Out:

- Piece 3: advancing the rider locally while offline (needs an ADR on ADR 0002).
- Keeping riders across a server restart (#57).
- Uploading the autosave anywhere: it stays in the browser.

## Server

### Detach instead of leave

`connection.rs` sends `Command::Leave` today whenever its loop ends. It will:

- send `Command::Leave` if the client sent the new `leave` message;
- otherwise (socket closed, read error, idle timeout, writer gone) send
  `Command::Detach { rider_id }`.

`Game` gets `fn detach(&mut self, rider_id)` with a default that calls `leave`,
and `fn reattach(&mut self, token, sink) -> Option<RiderId>` with a default of
`None`. `GameCore` and the studio implement both.

### In `GameCore`

- `Client` gains `resume_token: ResumeToken` and `detached_at: Option<f64>`.
- `join` makes a random 128-bit token (32 hex chars), stores it on the client
  and in `Worlds`' shared `ResumeTokens` map (token → world id), and sends it
  in `joined`.
- `detach`: the sink becomes a `NullSink`, telemetry is set to 0 W (the rider
  coasts to a stop on the road physics), `detached_at` is set. Race and event
  entries and the vehicle seat stay. A detached captain's vehicle slows down
  with them; captaincy only passes on at the real `leave`.
- The broadcast loops that `leave` on a failed delivery (state, events, chat)
  detach instead.
- Each tick, clients detached for longer than `grace_s` go through the
  existing `leave`. All "rider is gone" handling (events, vehicles, departed
  names) stays in that one path.
- `leave` removes the token from `ResumeTokens`.
- `reattach(token, sink)`: finds the detached client by token, swaps in the
  sink, clears `detached_at`, sends `joined` (same `rider_id`, same token) and a
  fresh `state`. A token of a client that is still attached (a second tab) is
  also taken over: the old sink is dropped. Unknown token: `None`.
- Telemetry and input are accepted from attached clients only.

### Finding the world

`Worlds` gets `ResumeTokens`, an `Arc<Mutex<HashMap<ResumeToken, String>>>`
built like `VehicleCodes`. On a `join` with `resume_token`, the connection looks
up the world, sends `Command::Reattach { token, sink, reply }` and, on `None`,
carries on with a normal join (using `resume` if given).

### Player cap

A detached rider holds no seat permit. A reattach acquires one like any join;
a full server answers `server_full`.

### Resume position

`join` accepts `resume: {route_id, distance_m}`, applied only to a free join:
not with `vehicle_code`, not in the studio (ignored there). `route_id` must be
a route of the chosen world, else `unknown_route`. `distance_m` is clamped to
`[0, route length]`; the rider starts there in the default lane at 0 m/s. A
resume never enters a race, event or vehicle. The client enforces the 12 h age
limit; the server has no memory across restarts.

### Config

`grace_s` in `ConnectionLimits` next to `idle_timeout_s` (120 s), default 60 s,
from `OPENRADLR_GRACE_S`. `0` restores today's behaviour (detach = leave).

## Protocol (additive)

| Message | Change |
| --- | --- |
| `welcome` | `grace_s` |
| `joined` | `resume_token` |
| `join` | `resume_token`?, `resume`? `{route_id, distance_m}` |
| `leave` (new, client → server, no fields) | Leaves now; the server closes the connection |

A `joined` with the same `rider_id` as before means a full resume; a different
one means a fresh join. Old clients ignore the new fields; an old client that
never sends `leave` lingers for `grace_s` as a coasting rider.

## Client

### `ride/rideAutosave.js` (new)

A store over IndexedDB (database injected; tests use an in-memory fake). One
slot, key `"current"`:

`{version, savedAt, serverUrl, routeId, studio, trainerKind, rideStartedAt,
distance, resumeToken, graceS, recorder: {samples, pauses}}`

Photos are separate records keyed by name, written once when taken, removed
with the slot. Saved every 10 s while riding and on `pagehide` and
`visibilitychange` to hidden; nothing is saved before the first sample.
Cleared after a download, a Strava upload, Discard, or a confirmed leave
without saving. Storage errors (private mode, quota) are logged once and the
ride goes on.

### Pauses in `RideRecorder`

- `pause(t)` and `resume(t)`; `pauses: [{from, to}]`; `toJSON()` and
  `RideRecorder.from(json)` for the autosave.
- `summary().durationS` excludes pauses; average power and speed use it.
- FIT: timer stop and start events around each pause; `timer` excludes pauses,
  `elapsed` does not.
- TCX: one `<Track>` per segment inside the lap.
- GPX: one `<trkseg>` per segment.

A crash gap (last autosave to Continue) is a pause. A network drop is not: the
trainer keeps feeding power, heart rate and cadence with speed 0 and the
distance held, so the file has no hole.

### `net/reconnector.js` (new)

Retries with backoff 1, 2, 4, 8 s, then every 15 s; gives up after 3 minutes.
Clock, timers and the connect function are injected for tests. `stop()`
cancels it.

### Reconnecting during a ride

- On `close`, the ride session keeps running (no `session.stop()`); a small
  "Reconnecting…" pill replaces the full `#disconnected` banner.
- Each attempt opens a new `GameConnection` and joins with `resume_token` and
  `resume: {route_id, distance_m}` of the current road.
- Same `rider_id` back: swap `app.connection`, re-wire, hide the pill.
- New `rider_id`: reset rider id, smoother, event, race and vehicle state;
  notify "Back on the road as a free rider" (plus "your race/seat ended" if
  there was one).
- Gave up: banner with **Finish and save** (the existing ride summary) and
  **Keep trying** (restarts the reconnector).
- The old `reconnect()` (end the ride and rejoin from the menu) goes.

### Continue on start

If an autosave exists, the start menu shows a card: "Unfinished ride · Rolling
Hills · 23.4 km · 41 min ago" with:

- **Continue** (autosave under 12 h old, same server): restore the recorder and
  album, mark the pause, join with the token and `resume`. The studio ignores
  the position and simply rejoins.
- **Save**: the ride summary with the restored recorder (download, Strava).
- **Discard**: clear it.

### Leaving on purpose

`endRide()` sends `leave` before closing the socket.

## Edge cases

- Reattach while the rider's event finished meanwhile: they get the results as
  `state` shows them; no special case.
- Two tabs with one autosave: the second reattach takes the rider over; the
  first tab's socket gets no more messages and its reconnector gives up into
  "Finish and save".
- Server restart during a drop: the token is unknown, the `resume` position
  rejoins as a free rider.
- The trainer drops at the same time as the network: Bluetooth reconnects on
  its own (#43); samples carry 0 W until it is back.
- A ride saved and then crashed: the autosave was cleared on save, so nothing
  is offered.

## Testing

- Server (`game.rs`, `connection`-level where needed): detach coasts the rider
  and keeps the event entry and seat; reattach returns the same id and a fresh
  state; grace expiry runs `leave` (event and vehicle cleanup happen); unknown
  token falls back to a normal join; explicit `leave` is immediate; a failed
  delivery detaches; `resume` clamps the distance, is ignored with a
  `vehicle_code`, refuses an unknown route; `grace_s = 0` keeps today's
  behaviour. Protocol round-trips for the new fields.
- Client (node:22 container): autosave round trip with photos on the fake DB;
  cleared after save and discard; recorder pauses in summary, FIT, TCX and
  GPX; `toJSON`/`from` round trip; reconnector backoff and give-up timing.
- Manual: Playwright with a sim trainer. Drop the server for 10 s mid-ride and
  check the rider comes back at the right place; reload the tab and check the
  Continue card and the saved file. Screenshots on an Artifact page.

## Delivery

One PR on `feat/ride-recovery`, as ordered commits:

1. Server: protocol fields, `leave` message, `grace_s` config.
2. Server: detach, grace expiry, resume tokens, reattach, `resume` position.
3. Client: recorder pauses in summary, FIT, TCX, GPX.
4. Client: `rideAutosave.js` and the Continue / Save / Discard card.
5. Client: `reconnector.js`, reconnect during a ride, `leave` on exit.
6. Docs: `protocol.md`, `architecture.md`, CHANGELOG.
