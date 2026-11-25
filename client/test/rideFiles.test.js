import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder, rideFileName } from "../public/js/ride/rideRecorder.js";
import { rideFile, rideFileFormats } from "../public/js/view/rideFiles.js";

const T0 = Date.UTC(2026, 10, 25, 7, 0, 0);
const routes = [{ id: "rolling-hills", name: "Rolling Hills" }];

function recording() {
  const recorder = new RideRecorder();
  for (let i = 0; i < 60; i += 1) recorder.add({ t: T0 + i * 1000, distance: i * 8, power: 200, heartRate: 130, speed: 8, lat: 39.6 + i * 1e-5, lon: 2.9, elevation: 100 });
  return recorder;
}

const record = (extra = {}) => ({ id: String(T0), startedAt: T0, routeId: "rolling-hills", device: "trainer", splits: [], ...extra });
const text = (file) => new TextDecoder().decode(file.bytes);

test("a ride on the road offers all three files", () => {
  assert.deepEqual(rideFileFormats(record()), ["fit", "tcx", "gpx"]);
  assert.deepEqual(rideFileFormats(record({ device: "sim" })), ["fit", "tcx", "gpx"]);
});

test("a studio ride has no positions, so no GPX", () => {
  assert.deepEqual(rideFileFormats(record({ routeId: null })), ["fit", "tcx"]);
});

test("a phone paddle ride and a workout offer no files, as at the finish", () => {
  assert.deepEqual(rideFileFormats(record({ device: "paddle" })), []);
  assert.deepEqual(rideFileFormats({ id: "w", kind: "workout", startedAt: T0 }), []);
});

test("the FIT file is the recorder's, with the ride's splits, named as at the finish", () => {
  const ride = recording();
  const splits = [{ index: 0, kind: "free", startIndex: 0, endIndex: 59, startT: T0, endT: T0 + 59000, durationS: 59, distanceM: 472, avgSpeed: 8, avgPower: 200, maxPower: 200, avgHeartRate: 130, elevationGainM: 0, partial: false }];
  const file = rideFile("fit", record({ splits }), ride.toJSON(), routes);
  assert.deepEqual(file.bytes, ride.toFit({ indoor: false, splits }));
  assert.equal(file.type, "application/vnd.ant.fit");
  assert.equal(file.name, rideFileName(T0, "rolling-hills", "fit"));
});

test("a studio ride's FIT file says indoor", () => {
  const ride = recording();
  const file = rideFile("fit", record({ routeId: null }), ride.toJSON(), routes);
  assert.deepEqual(file.bytes, ride.toFit({ indoor: true, splits: [] }));
  assert.equal(file.name, rideFileName(T0, "spin-studio", "fit"));
});

test("TCX and GPX carry the ride's name and route", () => {
  const ride = recording();
  const tcx = rideFile("tcx", record(), ride.toJSON(), routes);
  assert.equal(text(tcx), ride.toTcx({ name: "OpenRadlr · Rolling Hills", splits: [] }));
  assert.equal(tcx.name, rideFileName(T0, "rolling-hills"));
  const gpx = rideFile("gpx", record(), ride.toJSON(), routes);
  assert.equal(text(gpx), ride.toGpx({ name: "OpenRadlr · Rolling Hills" }));
  assert.equal(gpx.type, "application/gpx+xml");
});

test("a format the ride doesn't offer is refused", () => {
  assert.throws(() => rideFile("gpx", record({ routeId: null }), recording().toJSON(), routes), /gpx/);
});
