# Ride streams: keep every second of a ride

Follows the account backup (ADR 0032, [its spec](2026-11-24-account-and-backup-design.md)).
Groundwork for restoring rides on a new device (accounts phase 2) and for upload
connectors (phase 3).

## Intent

While riding, the recorder keeps one sample a second: time, distance, power, cadence,
heart rate, speed, elevation, position and the road. The ride files (`.fit`, `.tcx`,
`.gpx`) are made from it. Once the rider leaves the summary, the samples are gone: the
ride history keeps a summary record (totals, averages, splits, and the power curve at
ten fixed durations). The account backup holds the same records.

So nothing can be worked out later that the record didn't already hold: no curve at
other durations or across rides, no heart rate curve or time in zones, no chart of an
old ride, no ride file for it, nothing to upload to Strava or intervals.icu afterwards.
Riders coming from other platforms expect all of that from their ride history.

## Goals

- Every finished ride keeps its samples as a **ride stream**: compact (about 43 KB per
  hour), with time, power, heart rate and cadence exactly as the files write them and
  distance and position to the centimetre.
- On the device: a store per rider next to the history. Deleting a ride or a rider
  deletes its stream; "Your data" counts, exports and deletes streams.
- In the account: the backup sends each stream once, after its ride record.
- From a stream: the ride's `.fit`, `.tcx` and `.gpx` downloads in the ride list, and
  its full power curve, with the code that makes them today. Rides from before this
  feature keep their record only: their samples are already gone.
- Heart rate reaches the server only with the rider's consent, asked once when it
  matters; withdrawing it removes heart rate from what the server holds.
- An account holds at most 10 MB; when it is full, the oldest streams leave the server
  first, never a ride record. The limit is per account, so a plan with more room can
  raise it later without a code change.

## Non-goals

- Charts of a ride, heart rate curves, time in zones, curves across rides: they read
  streams, but each is a feature of its own.
- Restoring streams on another device (phase 2); the read endpoint exists for it.
- Uploading to Strava or intervals.icu from a stream (phase 3).
- Streams for rides recorded before this: their samples are gone. Café workouts
  (bodyweight, no samples) have none either.

## Anti-goals

- A slower finish: the summary must not wait for compressing or saving the stream.
- A stream that differs from the ride files the rider downloaded at the finish.
- Heart rate on the server without the rider's say (see Privacy).
- Riders' storage filling up unnoticed: the store must report what it holds.

## Measured size

A synthetic one-hour ride (efforts, a climb, a drifting heart rate, a curved track):

| Form | Size |
| --- | --- |
| The recorder's samples as JSON (what the autosave keeps) | 920 KB |
| Columns, fixed precision, differences | 138 KB |
| The columns gzipped | 43 KB |

## Design

### The stream format (version 1)

A JSON document, gzipped (`CompressionStream`, in every browser this app supports and
in Node for the tests):

```json
{
  "version": 1,
  "rideId": "1795540317787",
  "intervalMs": 1000,
  "pauses": [{ "from": 1795540400000, "to": 1795540460000 }],
  "routes": [[0, "rolling-hills"], [2140, "valley-loop"]],
  "columns": {
    "t": [1795540317787, 1000, 1001, 999],
    "distance": [0, 812, 806],
    "power": [201, 198, 205],
    "cadence": [86, 87, null],
    "heartRate": [131, 131, 132],
    "speed": [8120, 8060, 8090],
    "elevation": [12040, 12, -3],
    "lat": [396000000, 72, 71],
    "lon": [29000000, 4, 5],
    "routeM": [0, 812, 806]
  }
}
```

- One array per field, one entry per sample, `null` where the sample had none.
- Integers at fixed precision: time in ms, power in 0.1 W, cadence and heart rate whole
  (as every file writes them), distance, elevation and road position in cm, speed in
  mm/s, latitude and longitude in 1e-7 degrees (about 1 cm).
- `t`, `distance`, `speed`, `elevation`, `lat`, `lon` and `routeM` store the difference
  to the sample before (the first entry is absolute); after a `null` the next value
  is absolute again.
- `routes` lists where the road changes (sample index, route id) instead of a column.
- `pauses` as the recorder keeps them.

`decode(encode(recorder))` gives a recorder whose `toFit()`, `toTcx()`, `toGpx()`,
`summary()` and `bestEfforts()` match the original's: times, power, heart rate and
cadence exactly; average and maximum power, energy and average heart rate exactly;
position, altitude, distance and speed within a centimetre (two FIT units).

Byte-identical files aren't possible at this size: FIT stores positions in its own unit
(8.4e-8 degrees) and distance in cm, TCX and GPX print seven decimals and tenths of a
metre, so any rounded storage puts some values on a rounding boundary in one of them.
Keeping every value exactly would take several hundred KB an hour; a centimetre is
below what a trainer, a map or a platform can show.

Measured with the format as built (`client/public/js/ride/rideStream.js`): one hour
42.6 KB, two hours 82.2 KB (the recorder's own JSON: 913 KB and 1,823 KB).

### On the device

- `ride/rideStream.js`: `encodeStream(recorder, rideId)` and `decodeStream(bytes)` to
  and from gzipped bytes, with the compression injected (tests run in Node).
- A fourth per-rider IndexedDB, `openradlr-streams`, next to history, ghosts and
  autosave (`rideStores`, `riderDbNames`): key `stream:<rideId>`, value the gzipped
  bytes.
- At the finish the ride record is saved as today; the stream is encoded and saved
  after it, off the summary's path. A failure is logged and leaves the record as it is.
- Deleting a ride deletes its stream; deleting a rider deletes the database.
- "Your data": streams are counted with the rides (count and size), exported in the
  data file (as their columns), and deleted with the rides.
- The app asks for persistent storage (`navigator.storage.persist()`) once a rider has
  streams, so the browser doesn't evict them under pressure.

### In the ride list

- An opened ride with a stream offers its `.fit`, `.tcx` and `.gpx` (the finish
  screen's download code, from the decoded recorder).
- Its best power bars come from the stream at every duration up to the ride's length;
  without a stream, the record's ten points as today.

### In the account

- A table `ride_streams (rider_id, ride_id, body BLOB, stored_s)`, deleted with the
  rider (cascade).
- `PUT /id/v1/riders/{rider}/rides/{ride}/stream` with `application/octet-stream`, at
  most 2 MB (about 45 hours of riding); the ride record must exist. `GET` returns it.
  The same-origin check takes octet-stream on this route only: a cross-site page
  can't send it without a CORS preflight, which the server doesn't answer.
- `GET …/rides` also lists which rides have a stream: `{ "ids": [...], "streams": [...] }`.
- The backup sends missing streams after missing records, one at a time, and
  remembers them like the records. A stream refused as too large is skipped for good.

### Room in the account

A ride takes about 45 KB per hour of riding: some 43 KB of stream and a record of 1–5 KB.

| Rider | Per year | 10 MB of streams lasts |
| --- | --- | --- |
| Occasional (twice a week, 45 min) | ~3.5 MB | ~3 years |
| Regular (four times a week, an hour) | ~9 MB | ~1 year |
| Heavy (daily, 1.5 hours) | ~24 MB | ~5 months |

Records alone take a few KB per ride, so 10 MB keeps every rider's whole history of
summaries; only the per-second detail of older rides leaves the server. Starting small
is cheap to change: raising the limit later costs nothing, lowering it drops riders' data.

- Each account has its own limit, `quota_bytes` (default **10 MB**, down from 50 MB:
  accounts hold only records today, a few KB per ride, so none is affected);
  `ACCOUNT_QUOTA_BYTES` becomes the default for new and existing accounts.
- Records and snapshots always fit: when one would take the account over its limit, the
  server first drops the **oldest streams** (by ride start) until it fits, then stores it.
  Only when no stream is left to drop is it refused with `quota_exceeded`, as today.
- A new stream that doesn't fit drops older streams the same way, but never itself or
  a newer one: a full account keeps the most recent detail.
- Dropped streams stay on the device. `GET …/rides` lists what the account holds, so the
  backup doesn't send them again, and `/me` reports the oldest ride with a stream.
- The account page shows the room used ("6.2 MB of 10 MB") and, once streams were
  dropped, "Full detail of your rides since March 2026 is in your account; older rides
  keep their summary."
- A paid plan later sets `quota_bytes` per account ("full detail for your whole
  history"); nothing in the client or the backup depends on the number.

### Heart rate

Heart rate is health data (GDPR Art. 9): processing it on the server needs the rider's
explicit consent, and withdrawing it must be as easy as giving it. The backup already
sends average heart rate (the record and its splits); per-second streams make it plainly
health data.

- **Off until the rider agrees.** Without consent the backup leaves heart rate out of
  everything it sends: `avgHeartRate: null` in records and splits, no `heartRate` column
  in streams. On the device nothing changes.
- **Asked once, when it matters.** The first time a rider saved in an account finishes a
  ride that has heart rate, the summary asks: *"Back up your heart rate too? It's health
  data: we only keep it with your consent. You can change this any time under Profile →
  Account."* with **Back it up** and **Not now**. Either answer is remembered; riders
  without a heart rate strap are never asked. The account page has the same setting
  (*Back up heart rate*) for later changes.
- **Consent is per account and recorded.** The server stores `heart_rate_consent_s`
  (when it was given, or null); `PUT /id/v1/settings {heart_rate: true|false}` changes
  it and `/me` returns it, so every device of the account follows the same choice.
- **Withdrawing removes it.** Turning it off stops sending heart rate and has the server
  strip it from what it holds, in one transaction: `avgHeartRate` in records and their
  splits set to null, the `heartRate` column taken out of every stream (decoded,
  rewritten, recompressed). The device keeps its heart rate.
- **Turning it on again** sends heart rate with new rides; older rides are sent again
  with heart rate by the next backup, since what the account holds no longer matches.
- `docs/accounts.md` and the privacy policy draft gain heart rate: Art. 9, consent, how
  to withdraw it, and that withdrawing removes it from the backups.

### Decided

1. Heart rate: consent per account, asked once on the summary, off until given, removed
   from the server when withdrawn.
2. Room: 10 MB per account, per-account limit for paid plans later; oldest streams
   leave the server first, never records.
3. Streams only for rides from now on.

## Testing

- Codec: a round trip keeps every field at its precision; `null`s, pauses and road
  changes survive; FIT bytes from the decoded recorder equal the original's; the
  synthetic hour stays under 60 KB; version and malformed input are refused.
- Store and "Your data": save, list, delete with the ride and the rider, counts,
  export, delete everything; a failing store leaves the record.
- Ride list: downloads from a stream; the curve from a stream versus the record's points.
- Server: octet-stream accepted on the stream route and refused elsewhere, the stream
  needs its record, cascade on account deletion; a full account drops its oldest streams
  for a record or a newer stream, never a record or a newer stream, and refuses only when
  nothing is left to drop; a per-account limit overrides the default.
- Heart rate: consent stored and returned; withdrawing strips it from records, splits and
  streams on the server (a stream decoded afterwards has no heart rate, everything else
  unchanged); the summary asks once, only riders with heart rate, only when saved.
- Backup: missing streams sent after records, remembered, a refused one skipped, heart
  rate left out of records, splits and streams until the rider agrees, rides sent again
  with heart rate after agreeing.
- End to end in Chromium: ride, finish, reload, download the old ride's `.fit` from the
  list, see its curve; backup sends the stream.
