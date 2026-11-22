# Property-based fuzzing

The client's `test/fuzz.test.js` uses [fast-check](https://fast-check.dev/) to
exercise WebSocket JSON parsing and Bluetooth heart-rate, cycling-power and
FTMS decoding with generated inputs. Properties check rejection of unknown
messages, preservation of recognized JSON payloads, bounded binary decoding,
subarray offsets, both heart-rate encodings, and optional FTMS field layouts.
Malformed raw Bluetooth packets may raise DataView's `RangeError`; valid packets
must preserve their measured values. Other exceptions fail the property.

The regular Node test suite runs 500 cases per property with a fixed seed, so
`make check` and PR CI reproduce the same search. A separate read-only daily
workflow runs 10,000 cases per property and uses its run number as the seed.
Fast-check shrinks a failing input and prints its seed and counterexample path.
No network, hardware, sleeps or production secrets are needed.

## Run and reproduce

```bash
cd client
FUZZ_SEED=42 FUZZ_RUNS=10000 node --test test/fuzz.test.js
```

To replay a specific failure, use the seed and path printed by fast-check and
select the failing test so another property's input does not use its path:

```bash
FUZZ_SEED=42 FUZZ_PATH='0:1:2' node --test --test-name-pattern='FTMS measurements' test/fuzz.test.js
```

Replace the example path with the actual reported path. Keep any discovered
counterexample as a focused regression test before fixing the bug.

This is bounded, property-based fuzzing of client input boundaries. It does not
replace the server's protocol/e2e tests or claim to fuzz Rust, Strava, the whole
application, or long-running memory-safety targets. OpenSSF Scorecard recognizes
fast-check integrations; its result updates after the changes reach the default
branch and the scanner reruns.
