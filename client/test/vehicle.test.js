import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_KINDS,
  SeatEnergy,
  aboardLine,
  boardingRoute,
  vehicleErrorLine,
  elsewhereRoute,
  groupVehicles,
  isCaptain,
  kindName,
  normaliseCode,
  vehicleLabel,
} from "../public/js/ride/vehicle.js";

const seat = (rider_id, name, power, share, is_bot = false) => ({ rider_id, name, is_bot, power, share });

test("lists the vehicle kinds", () => {
  assert.deepEqual(VEHICLE_KINDS, [
    { kind: "tandem", seats: [2] },
    { kind: "beer_bike", seats: [5, 7, 9] },
  ]);
  assert.equal(kindName("tandem"), "Tandem");
  assert.equal(kindName("beer_bike"), "Beer bike");
});

test("normalises codes", () => {
  assert.deepEqual(normaliseCode(" abc 23k "), { code: "ABC23K", error: null });
  assert.equal(normaliseCode("abc23").error, "Codes have 6 characters");
  assert.equal(normaliseCode("").error, "Codes have 6 characters");
  assert.equal(normaliseCode("ABO234").error, "Codes don't use 0, O, 1 or I");
  assert.equal(normaliseCode("O1").error, "Codes don't use 0, O, 1 or I");
  assert.equal(normaliseCode("ABC23-").error, "Codes only use letters and digits 2–9");
  assert.equal(normaliseCode("ABC23K").code, "ABC23K");
  assert.equal(normaliseCode("ABO234").code, null);
});

test("groups riders by vehicle, ordered by seat", () => {
  const riders = [
    { id: 1, name: "Solo" },
    { id: 2, name: "Ben", vehicle: { id: 9, kind: "tandem", seat: 1, seats: 2 } },
    { id: 3, name: "Anna", vehicle: { id: 9, kind: "tandem", seat: 0, seats: 2 } },
  ];
  const groups = groupVehicles(riders);
  assert.equal(groups.size, 1);
  const g = groups.get(9);
  assert.equal(g.kind, "tandem");
  assert.deepEqual(g.seats.map((r) => r.name), ["Anna", "Ben"]);
  assert.equal(g.captainSeat.name, "Anna");
});

test("labels vehicles", () => {
  assert.equal(vehicleLabel("beer_bike", "Anna"), "Anna's beer bike");
  assert.equal(vehicleLabel("tandem", "Anna"), "Anna's tandem");
});

test("aboard line and captain", () => {
  const v = { captain: 1, seats: [seat(1, "A", 200, 0.2), seat(2, "B", 300, 0.31), null, seat(3, "C", 480, 0.49, true)] };
  assert.equal(aboardLine(v, 1), "Vehicle 980 W · you 20 %");
  assert.equal(aboardLine(v, 9), null);
  assert.equal(aboardLine(null, 1), null);
  assert.equal(isCaptain(v, 1), true);
  assert.equal(isCaptain(v, 2), false);
  assert.equal(isCaptain(null, 1), false);
});

test("seat energy and summary", () => {
  const e = new SeatEnergy();
  const v = { seats: [seat(1, "Anna", 300, 0.5), seat(2, "Bot", 100, 0.2, true), seat(3, "Ben", 200, 0.3)] };
  e.add(v, 10);
  assert.deepEqual(e.perSeat(), [
    { name: "Anna", isBot: false, kj: 3 },
    { name: "Bot", isBot: true, kj: 1 },
    { name: "Ben", isBot: false, kj: 2 },
  ]);
  const later = { seats: [seat(1, "Anna", 300, 0.5), null, seat(4, "Chris", 0, 0)] };
  e.add(later, 10);
  assert.equal(e.summaryLine("beer_bike"), "Beer bike with Anna, Ben, Chris");
  assert.equal(new SeatEnergy().summaryLine("tandem"), "Tandem");
});

test("parses the elsewhere route", () => {
  assert.equal(elsewhereRoute("route:coast"), "coast");
  assert.equal(elsewhereRoute("nope"), null);
  assert.equal(elsewhereRoute(undefined), null);
});

test("grouped seats are indexed by seat number", () => {
  const at = (id, seatNo) => ({ id, name: `R${id}`, vehicle: { id: 5, kind: "beer_bike", seat: seatNo, seats: 5 } });
  const g = groupVehicles([at(1, 3), at(2, 0)]).get(5);
  assert.equal(g.seats.length, 5);
  assert.equal(g.seats[3].id, 1);
  assert.deepEqual(g.seats.map((r) => r?.id ?? null), [2, null, null, 1, null]);
  const noCaptain = groupVehicles([at(1, 3)]).get(5);
  assert.equal(noCaptain.captainSeat, null);
});

test("the captain can sit in any seat", () => {
  const at = (id, seatNo, captain) => ({ id, name: `R${id}`, vehicle: { id: 5, kind: "beer_bike", seat: seatNo, seats: 5, captain } });
  const g = groupVehicles([at(1, 0, false), at(2, 2, true)]).get(5);
  assert.equal(g.captainSeat.id, 2);
  assert.equal(g.seats[0].id, 1);
});

test("seat energy ignores non-finite or negative input", () => {
  const e = new SeatEnergy();
  e.add({ seats: [seat(1, "A", NaN, 1)] }, 1);
  e.add({ seats: [seat(1, "A", 100, 1)] }, NaN);
  e.add({ seats: [seat(1, "A", -5, 1)] }, 1);
  e.add({ seats: [seat(1, "A", 100, 1)] }, 10);
  assert.equal(e.perSeat()[0].kj, 1);
});

test("the start menu boards on the selected route, or the first map for the studio", () => {
  const routes = [{ id: "a" }, { id: "b" }, { id: "studio", kind: "studio" }];
  assert.equal(boardingRoute(routes, "b"), "b");
  assert.equal(boardingRoute(routes, "studio"), "a");
  assert.equal(boardingRoute([...routes, { id: "workout", kind: "workout" }], "workout"), "a");
  assert.equal(boardingRoute(routes, "gone"), "a");
  assert.equal(boardingRoute([{ id: "studio", kind: "studio" }], "studio"), null);
});

test("joining an event while seated has a friendly line", () => {
  assert.equal(vehicleErrorLine("in_vehicle"), "Leave the vehicle first");
});
