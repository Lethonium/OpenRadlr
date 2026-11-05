# AFK timeout — design

Date: 2026-11-05 · Issue: – · Status: design

## Goal

A rider who left their ride open but walked away frees their place under the
player cap within about half an hour, while a rider taking a long break
(pause, food, a mechanical) on an hours-long ride is never thrown out without
being asked first.

Today nothing removes them. The only timeout, `idle_timeout` (120 s), fires
when a connection sends **no messages**, but a riding client sends telemetry
about 4 times a second whether anyone pedals or not (`power: 0` without a
trainer or rider). Grafana shows such a rider connected for hours. They hold
one of the `OPENRADLR_MAX_PLAYERS` seats (or a paddle seat), a simulation slot
and a state stream, and they inflate the rider count.

## Decisions

| Question | Decision |
| --- | --- |
| What counts as away | Every `telemetry` since a moment had `power == 0`. Raw telemetry power, so a paused rider counts as away too (they send 0 W on a break) |
| What counts as back | Any `telemetry` with `power > 0`: resets the clock and the warning count, closes an open warning |
| First warning | After 30 min away (`OPENRADLR_AFK_TIMEOUT_S`, default 1800) |
| Answer window | Each warning counts down 2 min; no answer ends the ride |
| Stay | Restarts the clock: the next warning comes after 10 more min away (`OPENRADLR_AFK_REMINDER_S`, default 600) |
| How many | Three warnings with **Stay** and **Leave now**; the fourth is a final one with **Leave now** only, then the ride ends after its countdown |
| Ending | Error `afk_timeout`, connection closed, rider removed as if they sent `leave`: no grace period, no resume |
| Decided by | The server (authoritative, covers old clients) |
| Exempt | Workout riders (`device: workout`): they send no telemetry by design |
| Off switch | `OPENRADLR_AFK_TIMEOUT_S=0` turns the whole thing off |
| Protocol | Additive within version 2: one new server message, one new client message, one new error code. No `PROTOCOL_VERSION` bump |

Timeline for a rider who never pedals and presses Stay every time:

| Away for | |
| --- | --- |
| 30:00 | warning 1 (Stay / Leave now), 2:00 to answer |
| Stay at any point → +10:00 | warning 2 |
| Stay → +10:00 | warning 3 |
| Stay → +10:00 | final warning (Leave now only), ride ends after 2:00 |

So a rider who answers at once is removed after about 62 min at the latest; a
rider who is gone is removed at 32 min.

## Scope

In:

- Server: the away clock, warnings, `stay`, `afk_timeout`, config.
- Client: the warning dialog, sending `stay` and `leave`, the end-of-ride
  notice, no automatic reconnect after `afk_timeout`.
- `docs/protocol.md`, `.env.example`, CHANGELOG, en + de texts.

Out:

- A Grafana metric for AFK removals (can follow; a log line is enough now).
- Any change to `idle_timeout` or the grace period.
- Treating vehicle stokers, event lobbies or the spin studio differently: 30
  min is longer than every lobby (studio `LOBBY_S` is 5 min).

## Protocol

Server → client:

```json
{ "type": "afk_warning", "leave_in_s": 120, "can_stay": true }
```

Sent when a warning starts. `leave_in_s` is the answer window; `can_stay` is
false for the final warning. The client closes the dialog by itself on `stay`,
`leave`, or its own telemetry with power > 0. The server does not send an
"all clear".

Client → server:

| `type` | Fields | When |
| --- | --- | --- |
| `stay` | – | answer to an `afk_warning` with `can_stay`; ignored otherwise (no warning open, or the final one) |

Leave now sends the existing `leave`. A timeout sends
`{ "type": "error", "code": "afk_timeout", ... }` and closes the connection.

## Server

A new pure unit `server/crates/server/src/afk.rs`, `AfkWatch`, owned by
`Session`, with the clock passed in like the other limits:

- `AfkWatch::new(timeout_s, reminder_s, answer_s, warnings, now_s)`;
  `timeout_s == 0` makes it inert.
- `on_power(power, now_s)`: power > 0 resets everything.
- `on_stay(now_s)`: accepted only while a non-final warning is open; restarts
  the clock with `reminder_s` as the next threshold.
- `poll(now_s) -> Option<AfkEvent>` with `Warn { leave_in_s, can_stay }` and
  `Expire`. It returns each `Warn` once.

`Session` feeds it from `telemetry` and `stay`, skips it for workout riders
(it already sees `device` in `join`), and the connection loop's existing
1 s `checks` tick calls it next to `expired()`: `Warn` is sent to the client,
`Expire` sends `afk_timeout`, sets `leaving = true` and breaks. That way the
rider is removed at once, not after the grace period.

`ConnectionLimits` gains `afk_timeout_s` and `afk_reminder_s` from the config.
The 2 min answer window and the 3 warnings are constants.

## Client

- `net/protocol.js`: `stay()` message builder; `afk_warning` reaches the ride
  like other server messages.
- A small dialog (same style as the finish confirmation in the in-game menu):
  "Still riding?", a live countdown, **Stay** (hidden when `can_stay` is
  false) and **Leave now**. It closes on either button, or when the ride's
  own power goes above 0. Keyboard and controller reachable.
- Leave now ends the ride the same way Finish ride does (summary screen).
- On error `afk_timeout`: no `Reconnector`; the ride ends with the summary and
  a notice "You were removed after a long time without pedalling".
- The dialog logic (open, countdown, close on power) is a plain module with an
  injected clock, tested with node like the rest of the client.

## Testing

Server, `afk.rs` unit tests (one reason to fail each):

- no warning before 30 min of zero power; a warning at 30 min;
- power > 0 at any point resets the clock and the warning count;
- unanswered warning expires after 2 min;
- `stay` moves the next warning 10 min out;
- the fourth warning has `can_stay: false`, and `stay` is ignored then;
- `timeout_s == 0` never warns.

Server, session/e2e: workout riders never warn; `afk_timeout` closes the
connection and removes the rider without a grace period; `stay` before any
warning is ignored.

Client: the dialog module's countdown, Stay/Leave sending, closing on power,
no Stay button on the final warning; no reconnect after `afk_timeout`.
