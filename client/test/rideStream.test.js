import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";
import { bestEfforts } from "../public/js/ride/powerAnalysis.js";
import { STREAM_VERSION, decodeColumns, decodeStream, encodeColumns, encodeStream } from "../public/js/ride/rideStream.js";
import { fitMessages } from "./helpers.js";

const T0 = Date.UTC(2026, 10, 25, 7, 0, 0);

/** A seeded random source, so every run builds the same ride. */
function random(seed = 7) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/**
 * A ride like the recorder keeps one: whole-watt power from a trainer, cadence with
 * decimals from crank revolutions, a heart rate strap, the server's distance and speed,
 * the route's elevation and position, a road change, and optional gaps and a pause.
 */
function syntheticRide(seconds = 3600, { pause = false, gaps = false } = {}) {
  const next = random();
  const recorder = new RideRecorder();
  let distance = 0;
  let elevation = 120.37;
  let lat = 39.6001234567;
  let lon = 2.9007654321;
  let heartRate = 118;
  for (let i = 0; i < seconds; i += 1) {
    // A little over a second apart, like real ticks: the recorder keeps one sample a second.
    const t = T0 + i * 1010 + Math.floor(next() * 9) + (pause && i >= seconds / 2 ? 90_000 : 0);
    if (pause && i === seconds / 2) recorder.pause(t - 90_000 + 500);
    if (pause && i === seconds / 2) recorder.resume(t - 500);
    const effort = i % 600 < 60 ? 120 : 0;
    const climbing = i > seconds / 2 && i < (seconds * 2) / 3;
    const speed = 8 + (next() - 0.5) * 1.5 - (climbing ? 3 : 0);
    distance += speed;
    elevation += climbing ? 0.1234 : (next() - 0.5) * 0.05;
    heartRate += (effort ? 0.4 : -0.1) + (next() - 0.5) * 0.4;
    lat += speed * 0.0000089 * Math.cos(i / 300);
    lon += speed * 0.0000089 * Math.sin(i / 300);
    const dropout = gaps && i % 900 > 880;
    recorder.add({
      t,
      distance,
      power: Math.max(0, Math.round(200 + effort + (next() - 0.5) * 60)),
      cadence: dropout ? undefined : 85 + (next() - 0.5) * 10,
      heartRate: dropout ? undefined : Math.round(Math.min(190, Math.max(90, heartRate))),
      speed,
      elevation: dropout ? undefined : elevation,
      lat: dropout ? undefined : lat,
      lon: dropout ? undefined : lon,
      route: i < seconds * 0.7 ? "rolling-hills" : "valley-loop",
      routeM: i < seconds * 0.7 ? distance % 7800 : distance - seconds * 0.7 * 8,
    });
  }
  return recorder;
}

const roundTrip = (recorder) => RideRecorder.from(decodeColumns(encodeColumns(recorder, "r1")));
const text = (bytes) => new TextDecoder().decode(bytes);

// FIT record fields (global message 20) a platform reads exactly; the others are kept to the centimetre.
const RECORD = 20;
const EXACT_RECORD_FIELDS = new Set([253, 3, 4, 7]); // timestamp, heart rate, cadence, power

/** Same messages, same fields; record times, power, heart rate and cadence equal, the rest within two FIT units. */
function assertSameFit(actual, expected) {
  const a = fitMessages(actual);
  const b = fitMessages(expected);
  assert.equal(a.length, b.length);
  a.forEach((message, i) => {
    assert.equal(message.global, b[i].global);
    assert.deepEqual(Object.keys(message.values), Object.keys(b[i].values));
    for (const [field, value] of Object.entries(message.values)) {
      const want = b[i].values[field];
      if (message.global === RECORD && EXACT_RECORD_FIELDS.has(Number(field))) assert.equal(value, want, `record ${i} field ${field}`);
      else assert.ok(Math.abs(value - want) <= 2, `message ${message.global} #${i} field ${field}: ${value} vs ${want}`);
    }
  });
}

const all = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]);
const close = (a, b, step) => a.length === b.length && a.every((x, i) => Math.abs(Number(x) - Number(b[i])) <= step * 1.01);

test("a decoded stream makes the same FIT file: times, power, heart rate and cadence exact, the rest to the centimetre", () => {
  const original = syntheticRide(1800);
  assertSameFit(roundTrip(original).toFit(), original.toFit());
});

test("a decoded stream makes the same TCX file", () => {
  const original = syntheticRide(1800);
  const [a, b] = [roundTrip(original).toTcx({ name: "Ride" }), original.toTcx({ name: "Ride" })];
  for (const pattern of [/<Time>([^<]+)/g, /<ns3:Watts>(\d+)/g, /<HeartRateBpm><Value>(\d+)/g, /<Cadence>(\d+)/g]) assert.deepEqual(all(a, pattern), all(b, pattern));
  assert.ok(close(all(a, /<LatitudeDegrees>([^<]+)/g), all(b, /<LatitudeDegrees>([^<]+)/g), 1e-7));
  assert.ok(close(all(a, /<DistanceMeters>([^<]+)/g), all(b, /<DistanceMeters>([^<]+)/g), 0.1));
  assert.ok(close(all(a, /<AltitudeMeters>([^<]+)/g), all(b, /<AltitudeMeters>([^<]+)/g), 0.1));
});

test("a decoded stream makes the same GPX file", () => {
  const original = syntheticRide(1800);
  const [a, b] = [roundTrip(original).toGpx({ name: "Ride" }), original.toGpx({ name: "Ride" })];
  for (const pattern of [/<time>([^<]+)/g, /<power>(\d+)/g, /<gpxtpx:hr>(\d+)/g, /<gpxtpx:cad>(\d+)/g]) assert.deepEqual(all(a, pattern), all(b, pattern));
  assert.ok(close(all(a, /lon="([^"]+)"/g), all(b, /lon="([^"]+)"/g), 1e-7));
});

test("a decoded stream has the same summary and best efforts", () => {
  const original = syntheticRide(3600);
  const decoded = roundTrip(original);
  const [a, b] = [decoded.summary(), original.summary()];
  for (const field of ["durationS", "avgPower", "maxPower", "avgHeartRate", "kilojoules"]) assert.equal(a[field], b[field], field);
  assert.ok(Math.abs(a.distanceM - b.distanceM) <= 0.01);
  assert.ok(Math.abs(a.elevationGainM - b.elevationGainM) <= 1);
  assert.deepEqual(bestEfforts(decoded.samples, decoded.pauses), bestEfforts(original.samples, original.pauses));
});

test("every field comes back at its precision", () => {
  const original = syntheticRide(120);
  const decoded = roundTrip(original);
  decoded.samples.forEach((sample, i) => {
    const before = original.samples[i];
    assert.equal(sample.t, before.t);
    assert.equal(sample.power, before.power);
    assert.equal(sample.heartRate, before.heartRate);
    assert.equal(sample.cadence, Math.round(before.cadence));
    assert.equal(sample.route, before.route);
    for (const [field, step] of [["distance", 0.01], ["speed", 0.001], ["elevation", 0.01], ["routeM", 0.01], ["lat", 1e-7], ["lon", 1e-7]]) {
      assert.ok(Math.abs(sample[field] - before[field]) <= step / 2 + 1e-12, `${field} at ${i}: ${sample[field]} vs ${before[field]}`);
    }
  });
});

test("missing values, the pause and the road changes come back", () => {
  const original = syntheticRide(1800, { pause: true, gaps: true });
  const decoded = roundTrip(original);
  assert.deepEqual(decoded.pauses, original.pauses);
  assert.deepEqual(decoded.samples.map((s) => s.lat === null), original.samples.map((s) => s.lat === null));
  assert.deepEqual(decoded.samples.map((s) => s.heartRate), original.samples.map((s) => s.heartRate));
  assert.deepEqual(decoded.samples.map((s) => s.route), original.samples.map((s) => s.route));
  assertSameFit(roundTrip(original).toFit(), original.toFit());
});

test("power with decimals keeps a tenth of a watt", () => {
  const recorder = new RideRecorder();
  recorder.add({ t: T0, distance: 0, power: 201.34 });
  recorder.add({ t: T0 + 1000, distance: 8, power: 199.96 });
  assert.deepEqual(roundTrip(recorder).samples.map((s) => s.power), [201.3, 200]);
});

test("a value back after a gap is stored whole, not as a difference to before the gap", () => {
  const recorder = new RideRecorder();
  recorder.add({ t: T0, distance: 0, elevation: 100 });
  recorder.add({ t: T0 + 1000, distance: 8 });
  recorder.add({ t: T0 + 2000, distance: 16, elevation: 103.5 });
  const doc = encodeColumns(recorder, "r1");
  assert.deepEqual(doc.columns.elevation, [10000, null, 10350]);
  assert.deepEqual(roundTrip(recorder).samples.map((s) => s.elevation), [100, null, 103.5]);
});

test("an empty or one-sample ride round-trips", () => {
  const empty = new RideRecorder();
  assert.deepEqual(roundTrip(empty).samples, []);
  const one = new RideRecorder();
  one.add({ t: T0, distance: 0, power: 150, route: "rolling-hills", routeM: 12 });
  assert.deepEqual(roundTrip(one).samples, one.samples);
});

test("the document names its version, ride and the road changes", () => {
  const doc = encodeColumns(syntheticRide(1800), "1795540317787");
  assert.equal(doc.version, STREAM_VERSION);
  assert.equal(doc.rideId, "1795540317787");
  assert.equal(doc.intervalMs, 1000);
  assert.deepEqual(doc.routes, [[0, "rolling-hills"], [1260, "valley-loop"]]);
});

test("an hour's stream, compressed, stays under 60 KB", async () => {
  const bytes = await encodeStream(syntheticRide(3600), "r1");
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength < 60 * 1024, `${bytes.byteLength} bytes`);
});

test("a compressed stream decodes to the same ride", async () => {
  const original = syntheticRide(600, { gaps: true });
  const { rideId, recording } = await decodeStream(await encodeStream(original, "r9"));
  assert.equal(rideId, "r9");
  assertSameFit(RideRecorder.from(recording).toFit(), original.toFit());
});

test("the compression is injected", async () => {
  const seen = [];
  const passThrough = class {
    constructor(format) {
      seen.push(format);
      const { readable, writable } = new TransformStream();
      Object.assign(this, { readable, writable });
    }
  };
  const bytes = await encodeStream(syntheticRide(10), "r1", { CompressionStream: passThrough });
  assert.equal(JSON.parse(text(bytes)).rideId, "r1");
  assert.equal((await decodeStream(bytes, { DecompressionStream: passThrough })).rideId, "r1");
  assert.deepEqual(seen, ["gzip", "gzip"]);
});

test("a stream of an unknown version is refused", () => {
  const doc = encodeColumns(syntheticRide(10), "r1");
  assert.throws(() => decodeColumns({ ...doc, version: 2 }), /version/);
});

test("a malformed stream is refused", async () => {
  assert.throws(() => decodeColumns({ version: 1, columns: { t: [1, 2], power: [1] } }), /malformed/);
  await assert.rejects(decodeStream(new Uint8Array([1, 2, 3])));
});
