import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLabel, groupVehicles, soloRiders, vehicleAnchor, vehicleMarkers } from "../public/js/ride/vehicle.js";
import { CAMERA_MODES, vehicleSettings } from "../public/js/view3d/chaseCamera.js";
import { layoutOf, placedVehicles, seatCadence } from "../public/js/view3d/vehicleScene.js";
import { vehicleLayout } from "../public/js/view3d/vehicleModel.js";
import { minimapDots } from "../public/js/view/minimapView.js";
import { PELOTON_WINDOW, pelotonItems } from "../public/js/view/pelotonView.js";
import { squareRoute } from "./helpers.js";

const seated = (id, name, seat, { vehicleId = 5, kind = "beer_bike", seats = 5, captain = false, distance = 100, ...rest } = {}) => ({
  id,
  name,
  distance,
  lane: 0,
  power: 100,
  vehicle: { id: vehicleId, kind, seat, seats, captain },
  ...rest,
});
const solo = (id, name, distance = 100) => ({ id, name, distance, lane: 0, power: 100 });

test("the captain is the flagged rider, even outside seat 0", () => {
  const group = groupVehicles([seated(1, "Ben", 0), seated(2, "Anna", 2, { captain: true })]).get(5);
  assert.equal(group.captainSeat.name, "Anna");
  assert.equal(group.seats[2].name, "Anna");
  assert.equal(groupLabel(group), "Anna's beer bike");
});

test("without a flag the captain is seat 0, and with nobody visible there is none", () => {
  assert.equal(groupVehicles([seated(1, "Ben", 0), seated(2, "Cy", 3)]).get(5).captainSeat.name, "Ben");
  const hidden = groupVehicles([seated(2, "Cy", 3)]).get(5);
  assert.equal(hidden.captainSeat, null);
  assert.equal(vehicleAnchor(hidden).name, "Cy");
  assert.equal(groupLabel(hidden), "Beer bike");
});

test("2D markers: one per vehicle at its captain, solo riders left alone", () => {
  const riders = [solo(9, "Zed"), seated(1, "Ben", 0), seated(2, "Anna", 1, { captain: true }), seated(3, "Cy", 0, { vehicleId: 6, kind: "tandem", seats: 2, distance: 50 })];
  assert.deepEqual(soloRiders(riders).map((r) => r.id), [9]);
  const markers = vehicleMarkers(riders, 1);
  assert.deepEqual(
    markers.map((m) => [m.id, m.rider.id, m.label, m.mine]),
    [
      [5, 2, "Anna's beer bike", true],
      [6, 3, "Cy's tandem", false],
    ],
  );
});

test("peloton and minimap show a vehicle once, larger than a bike", () => {
  const route = squareRoute();
  const riders = [solo(9, "Zed", 110), seated(1, "Ben", 0), seated(2, "Anna", 1, { captain: true })];
  const items = pelotonItems(riders[1], riders, route);
  assert.equal(items.length, 2);
  const bike = items.find((i) => i.rider.id === 9);
  const vehicle = items.find((i) => i.big);
  assert.equal(vehicle.label, "Anna's beer bike");
  assert.ok(vehicle.lengthM > bike.lengthM);
  assert.ok(vehicle.mine);
  assert.ok(Math.abs(vehicle.gap) <= PELOTON_WINDOW.ahead);
  const dots = minimapDots(riders, 1);
  assert.equal(dots.length, 2);
  assert.equal(dots.at(-1).label, "Anna's beer bike");
  assert.ok(dots.at(-1).radius > dots[0].radius);
});

test("a vehicle is drawn once, at its captain, with seats by number", () => {
  const placed = [
    { rider: seated(1, "Ben", 1), position: [1, 0, 0], forward: [0, 0, -1] },
    { rider: seated(2, "Anna", 0, { captain: true }), position: [2, 0, 0], forward: [0, 0, -1] },
  ];
  const [only, ...rest] = placedVehicles(placed);
  assert.equal(rest.length, 0);
  assert.equal(only.at.rider.name, "Anna");
  assert.equal(only.seats.length, 5);
  assert.deepEqual(only.seats.map((r) => r?.id ?? null), [2, 1, null, null, null]);
});

test("layouts exist for the real vehicles and are null for impossible ones", () => {
  assert.deepEqual(layoutOf("beer_bike", 7), vehicleLayout("beer_bike", 7));
  assert.equal(layoutOf("beer_bike", 4), null);
  assert.equal(layoutOf("sled", 2), null);
});

test("seat cadence prefers the server's", () => {
  assert.equal(seatCadence({ cadence: 60, power: 0 }), 60);
  assert.equal(seatCadence({ cadence: 0, power: 300 }), 0);
  assert.equal(seatCadence({ power: 300 }), 85);
  assert.equal(seatCadence({ power: 0 }), 0);
});

test("aboard, the chase camera takes the vehicle's distances", () => {
  const layout = vehicleLayout("beer_bike", 9);
  const chase = vehicleSettings(CAMERA_MODES.chase, layout);
  assert.equal(chase.back, layout.cameraBack);
  assert.equal(chase.up, layout.cameraUp);
  assert.ok(vehicleSettings(CAMERA_MODES.close, layout).back > CAMERA_MODES.close.back);
  assert.equal(vehicleSettings(CAMERA_MODES.chase, null), CAMERA_MODES.chase);
  assert.equal(vehicleSettings(CAMERA_MODES.drone, layout), CAMERA_MODES.drone);
  assert.equal(vehicleSettings(CAMERA_MODES.side, layout), CAMERA_MODES.side);
});
