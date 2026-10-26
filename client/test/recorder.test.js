import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder, rideFileName } from "../public/js/ride/rideRecorder.js";

const T0 = Date.UTC(2026, 9, 14, 13, 30, 0);

function ride(seconds, { power = 200, heartRate = 140, gps = true } = {}) {
  const recorder = new RideRecorder();
  for (let i = 0; i <= seconds; i += 1) {
    const position = gps ? { lat: 39 + i * 0.0001, lon: 2.6 } : {};
    recorder.add({ t: T0 + i * 1000, distance: i * 10, power, cadence: 90, heartRate, speed: 10, elevation: 100 + (i % 2), ...position });
  }
  return recorder;
}

test("records at most one sample per interval", () => {
  const recorder = new RideRecorder();
  assert.equal(recorder.add({ t: T0, distance: 0 }), true);
  assert.equal(recorder.add({ t: T0 + 400, distance: 4 }), false);
  assert.equal(recorder.add({ t: T0 + 1000, distance: 10 }), true);
  assert.equal(recorder.samples.length, 2);
  assert.equal(recorder.samples[0].heartRate, null);
  assert.equal(recorder.samples[0].power, 0);
});

test("summary: duration, distance, averages, climbing and work", () => {
  const summary = ride(60).summary();
  assert.equal(summary.durationS, 60);
  assert.equal(summary.distanceM, 600);
  assert.equal(summary.avgPower, 200);
  assert.equal(summary.maxPower, 200);
  assert.equal(summary.avgHeartRate, 140);
  assert.equal(summary.avgSpeed, 10);
  assert.equal(summary.elevationGainM, 30, "up 1 m every other second");
  assert.equal(summary.kilojoules, 12);
  assert.equal(new RideRecorder().summary().durationS, 0);
});

test("TCX has one trackpoint per sample with power, cadence and heart rate", () => {
  const tcx = ride(3).toTcx({ name: "Rolling Hills <test>" });
  assert.match(tcx, /^<\?xml/);
  assert.match(tcx, /<Activity Sport="Biking"><Id>2026-10-14T13:30:00Z<\/Id>/);
  assert.equal((tcx.match(/<Trackpoint>/g) ?? []).length, 4);
  assert.match(tcx, /<ns3:Watts>200<\/ns3:Watts>/);
  assert.match(tcx, /<Cadence>90<\/Cadence>/);
  assert.match(tcx, /<HeartRateBpm><Value>140<\/Value><\/HeartRateBpm>/);
  assert.match(tcx, /<TotalTimeSeconds>3<\/TotalTimeSeconds><DistanceMeters>30.0<\/DistanceMeters>/);
  assert.match(tcx, /Rolling Hills &lt;test&gt;/, "names are escaped");
  assert.doesNotMatch(ride(3, { heartRate: null }).toTcx(), /HeartRateBpm/);
  assert.throws(() => new RideRecorder().toTcx());
});

test("TCX carries the position of every trackpoint", () => {
  const tcx = ride(2).toTcx();
  assert.equal((tcx.match(/<Position>/g) ?? []).length, 3);
  assert.match(tcx, /<Time>2026-10-14T13:30:01Z<\/Time><Position><LatitudeDegrees>39\.0001000<\/LatitudeDegrees><LongitudeDegrees>2\.6000000<\/LongitudeDegrees><\/Position>/);
  assert.doesNotMatch(ride(2, { gps: false }).toTcx(), /<Position>/, "positions are optional");
});

test("samples keep a position only when both coordinates are numbers", () => {
  const recorder = new RideRecorder();
  recorder.add({ t: T0, distance: 0, lat: 39, lon: Number.NaN });
  assert.equal(recorder.samples[0].lat, null);
  assert.equal(recorder.samples[0].lon, null);
});

test("GPX has a track point per sample with time, elevation, power, cadence and heart rate", () => {
  const gpx = ride(3).toGpx({ name: "Rolling Hills <test>" });
  assert.match(gpx, /^<\?xml/);
  assert.match(gpx, /<gpx version="1\.1" creator="OpenRadlr"/);
  assert.match(gpx, /<metadata><name>Rolling Hills &lt;test&gt;<\/name><time>2026-10-14T13:30:00Z<\/time><\/metadata>/);
  assert.match(gpx, /<trk><name>Rolling Hills &lt;test&gt;<\/name><type>VirtualRide<\/type>/);
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, 4);
  assert.match(gpx, /<trkpt lat="39\.0001000" lon="2\.6000000"><ele>101\.0<\/ele><time>2026-10-14T13:30:01Z<\/time>/);
  assert.match(gpx, /<power>200<\/power>/);
  assert.match(gpx, /<gpxtpx:hr>140<\/gpxtpx:hr><gpxtpx:cad>90<\/gpxtpx:cad>/);
  assert.doesNotMatch(ride(3, { heartRate: null }).toGpx(), /gpxtpx:hr/);
});

test("GPX needs positions", () => {
  assert.throws(() => ride(3, { gps: false }).toGpx(), /position/);
  assert.throws(() => new RideRecorder().toGpx());
});

test("file names carry date, time, route and format", () => {
  const t = new Date(2026, 9, 14, 15, 7).getTime();
  assert.equal(rideFileName(t, "Col de la Forge!"), "openradlr-2026-10-14-1507-col-de-la-forge.tcx");
  assert.equal(rideFileName(t, "rolling-hills", "gpx"), "openradlr-2026-10-14-1507-rolling-hills.gpx");
});

/** 60 s of riding with a pause from 20 s to 50 s and no samples inside it. */
function pausedRide() {
  const recorder = new RideRecorder();
  const add = (i) => recorder.add({ t: T0 + i * 1000, distance: i * 10, power: 200, cadence: 90, heartRate: 140, speed: 10, elevation: 100, lat: 39 + i * 0.0001, lon: 2.6 });
  for (let i = 0; i <= 20; i += 1) add(i);
  recorder.pause(T0 + 20_000);
  recorder.resume(T0 + 50_000);
  for (let i = 50; i <= 60; i += 1) add(i);
  return recorder;
}

test("pause is left out of the duration and the work", () => {
  const recorder = pausedRide();
  assert.deepEqual(recorder.pauses, [{ from: T0 + 20_000, to: T0 + 50_000 }]);
  const summary = recorder.summary();
  assert.equal(summary.durationS, 30);
  assert.equal(summary.avgPower, 200);
  assert.equal(summary.kilojoules, 6);
});

test("pause and resume ignore a second pause or a resume without one", () => {
  const recorder = new RideRecorder();
  recorder.resume(T0);
  recorder.pause(T0 + 1000);
  recorder.pause(T0 + 2000);
  recorder.resume(T0 + 3000);
  assert.deepEqual(recorder.pauses, [{ from: T0 + 1000, to: T0 + 3000 }]);
});

test("segments split at pauses", () => {
  const segments = pausedRide().segments();
  assert.equal(segments.length, 2);
  assert.ok(segments[0].at(-1).t <= T0 + 20_000);
  assert.ok(segments[1][0].t >= T0 + 50_000);
  assert.equal(ride(10).segments().length, 1);
});

test("json round trip keeps samples, pauses and the summary", () => {
  const recorder = pausedRide();
  const copy = RideRecorder.from(JSON.parse(JSON.stringify(recorder)));
  assert.deepEqual(copy.samples, recorder.samples);
  assert.deepEqual(copy.pauses, recorder.pauses);
  assert.deepEqual(copy.summary(), recorder.summary());
  assert.equal(copy.intervalMs, recorder.intervalMs);
});

test("tcx has a track per segment", () => {
  assert.equal(pausedRide().toTcx().match(/<Track>/g).length, 2);
  assert.equal(ride(10).toTcx().match(/<Track>/g).length, 1);
});

test("gpx has a trkseg per segment", () => {
  assert.equal(pausedRide().toGpx().match(/<trkseg>/g).length, 2);
  assert.equal(ride(10).toGpx().match(/<trkseg>/g).length, 1);
});

test("samples keep route and route position, null when missing or not a number", () => {
  const recorder = new RideRecorder();
  recorder.add({ t: T0, distance: 0, route: "rolling-hills", routeM: 120.5 });
  recorder.add({ t: T0 + 1000, distance: 10, route: "rolling-hills", routeM: NaN });
  recorder.add({ t: T0 + 2000, distance: 20 });
  assert.equal(recorder.samples[0].route, "rolling-hills");
  assert.equal(recorder.samples[0].routeM, 120.5);
  assert.equal(recorder.samples[1].route, null);
  assert.equal(recorder.samples[1].routeM, null);
  assert.equal(recorder.samples[2].route, null);
  const again = RideRecorder.from(JSON.parse(JSON.stringify(recorder.toJSON())));
  assert.equal(again.samples[0].routeM, 120.5);
});

test("TCX writes one lap per split with every trackpoint once", () => {
  const recorder = ride(29, { gps: false });
  const s = recorder.samples;
  const mk = (a, b, kind) => ({ kind, startIndex: a, endIndex: b, startT: s[a].t, endT: s[b].t, durationS: (b - a), distanceM: s[b].distance - s[a].distance, avgPower: 200 });
  const splits = [mk(0, 10, "distance"), mk(10, 20, "distance"), mk(20, 29, "free")];
  const tcx = recorder.toTcx({ splits });
  assert.equal((tcx.match(/<Lap /g) ?? []).length, 3);
  assert.equal((tcx.match(/<Trackpoint>/g) ?? []).length, 30);
  assert.deepEqual([...tcx.matchAll(/<TriggerMethod>(\w+)</g)].map((m) => m[1]), ["Distance", "Distance", "Location"]);
  assert.match(tcx, /<Lap StartTime="2026-10-14T13:30:10Z"><TotalTimeSeconds>10</);
  const single = recorder.toTcx();
  assert.equal((single.match(/<Lap /g) ?? []).length, 1);
  assert.match(single, /<TriggerMethod>Manual</);
});
