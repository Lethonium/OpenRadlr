# 33. Ride streams

Date: 2026-11-25 · Status: accepted · Builds on [ADR 0032](0032-accounts-with-signed-rider-keys.md)

## Context

The recorder keeps one sample a second while riding, and the ride files are made from
it. Once the rider leaves the summary, the samples are gone: the ride history keeps a
record with totals, splits and the power curve at ten durations. Nothing else can be
worked out later (other curves, zones, charts, a ride's files, uploads to other
platforms), and the account backup holds no more than the records.

## Decision

- Every finished ride keeps its samples as a **ride stream**: one column per field,
  integers at a fixed precision, differences where values change little, gzipped
  (`ride/rideStream.js`). About 43 KB an hour.
- Time, power, heart rate and cadence are kept as the files write them; distance,
  elevation, road position and position to the centimetre. Byte-identical files would
  need every value kept exactly, several hundred KB an hour, for no visible difference.
- A decoded stream is what `RideRecorder.from` takes: files and curves are made by the
  code that makes them at the finish.
- On the device: a fourth database per rider, `openradlr-streams`, deleted with its
  ride and its rider. In the account (later): a stream per ride, 10 MB per account, the
  oldest streams leaving the server first, never a record; heart rate only with the
  rider's consent.

Details: the [design spec](../superpowers/specs/2026-11-25-ride-streams-design.md).

## Consequences

- Rides recorded before this keep their record only.
- Past rides offer their files and a finer curve; charts, zones and curves across rides
  can read the streams without another format change.
- Riders' browsers hold some 4 MB per 100 hours more; the app asks once for persistent
  storage.
