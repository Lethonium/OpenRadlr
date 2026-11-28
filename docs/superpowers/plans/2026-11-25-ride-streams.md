# Ride streams implementation plan

Spec: `../specs/2026-11-25-ride-streams-design.md` (decisions settled: heart rate by
consent, 10 MB per account with the oldest streams leaving first). Each step starts with
failing tests (CONTRIBUTING.md) and ends green on `make check`; steps 1–4 are client only,
5–7 the server, the backup and heart rate.

Suggested PRs: 1+2 (stream kept on the device), 3 (ride list), 4 (Your data),
5+6 (account room and streams), 7 (heart rate consent; before streams reach production),
8 (docs and ADR, with the first PR).

## 1. Codec: `client/public/js/ride/rideStream.js`

- [x] `encodeColumns(recording, rideId)` / `decodeColumns(doc)`: the version 1 document,
      pure; tests: round trip per field at its precision, `null` gaps (whole after a
      gap), pauses, road changes, empty and one-sample rides.
- [x] Equivalence: a decoded recorder's FIT file has the same messages and fields, with
      times, power, heart rate and cadence exact and the rest within two FIT units; TCX
      and GPX the same values; `summary()` and `bestEfforts()` equal (a synthetic hour,
      a ride with a pause, sensor dropouts and a road change).
- [x] `encodeStream` / `decodeStream`: gzip via an injected `CompressionStream` /
      `DecompressionStream`; the synthetic hour under 60 KB (42.6 KB); unknown version
      and malformed input refused.

## 2. Keep it on the device

- [x] `rideStores` gains `streams` over `openradlr-streams` (`ride/rideStreamStore.js`,
      `RideStreams`: `save(rideId, recording)`, `get`, `delete`, `ids`, `bytes()`), pinned
      to the rider like the others; `riderDbNames` includes it, so deleting a rider deletes it.
- [x] Finish: after `history.save(record)`, the stream of the same recording is saved; the
      summary doesn't wait for it; a failure is logged once. Workouts have no recorder and
      keep none; an empty recording keeps none.
- [x] Deleting a ride deletes its stream; "Your data" deleting rides (or everything)
      deletes the streams too, so none is left behind before step 4 counts them.
- [x] `navigator.storage.persist()` asked once, after the first stream is saved (injected;
      a refusal changes nothing).
- [x] Checked in Chromium: ride, finish, the stream saved after the record (22 s: 504
      bytes), still there after a reload, gone with its ride.

## 3. Use it in the ride list

- [ ] An opened ride with a stream shows `.fit`, `.tcx`, `.gpx` downloads (the finish
      screen's helpers fed with the decoded recorder); file names as at the finish.
- [ ] Best power bars from the stream at every duration up to the ride's length
      (`bestEfforts` over the decoded samples), else the record's points.
- [ ] Decoding happens only when a ride is opened; screenshots on phone and desktop.

## 4. "Your data"

- [ ] Rides row counts streams and their size; export puts each stream's columns into
      the data file under its ride; "delete rides" and "delete everything" clear streams.
- [ ] Texts in `en.js` and `de.js`.

## 5. Server: streams and room in the account (`server/crates/id`)

- [ ] Store: `ride_streams` table with cascade; `stream`, `stream_ids`; account bytes
      include streams; `accounts.quota_bytes` (migration: added with the default).
- [ ] Room: one locked operation that, for a write that doesn't fit, drops the oldest
      streams (by ride start) until it does: never a record or snapshot, never the stream
      being written or a newer one; refuses with `quota_exceeded` only when nothing is
      left to drop. Tests for a record, a snapshot and a stream on a full account.
- [ ] Service: the ride record must exist for its stream; at most 2 MB; default quota
      10 MB (`ACCOUNT_QUOTA_BYTES`, down from 50 MB), a per-account value wins; `/me` returns room used,
      the limit and the oldest ride with a stream.
- [ ] HTTP: `PUT/GET /v1/riders/{rider}/rides/{ride}/stream` with
      `application/octet-stream`; the same-origin middleware accepts octet-stream on this
      route only (tests: elsewhere still `json_required`; another origin still refused);
      `GET …/rides` answers `{ids, streams}`.

## 6. Backup sends streams

- [ ] `AccountClient`: `putStream(rider, ride, bytes)`, `rideIds` returns `{ids, streams}`.
- [ ] `Backup.run`: after the records, send missing streams one at a time; remember them;
      a 413 skips that stream for good, `offline` stops the run; streams the server
      dropped for room aren't sent again (listed as held-then-dropped by `/me`'s oldest).
- [ ] Account page: room used of the limit; once streams were dropped, since when the
      account holds full detail.

## 7. Heart rate by consent

- [ ] Server: `accounts.heart_rate_consent_s`; `PUT /v1/settings {heart_rate}`; `/me`
      returns it. Withdrawing strips heart rate in one transaction from records
      (`avgHeartRate`), their splits, and streams (gunzip, drop the column, gzip:
      `flate2`); tests that everything else in them is unchanged.
- [ ] Backup: without consent, records and splits go with `avgHeartRate: null` and
      streams without the column; with consent as on the device; after consent is given,
      rides held without heart rate are sent again.
- [ ] Summary prompt: once per account, only for a saved rider whose finished ride has
      heart rate; *Back it up* / *Not now* both remembered. Account page setting with its
      explanation. Texts in `en.js` and `de.js`; screenshots.
- [ ] Until this step ships, the backup already leaves heart rate out (the default is
      no consent): ship that part with step 6 at the latest.

## 8. Docs

- [ ] ADR 0033: ride streams as gzipped columns, on the device and in the account; room
      per account with the oldest streams leaving first; heart rate by consent.
- [ ] `docs/accounts.md`: streams, the 10 MB limit and what happens when it's full,
      heart rate consent; the privacy policy draft gains heart rate (Art. 9, consent,
      withdrawal removes it from the backups).
- [ ] End-to-end check in Chromium and on a phone; size of a real hour-long ride noted
      in the spec.
