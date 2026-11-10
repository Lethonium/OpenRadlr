import { test } from "node:test";
import assert from "node:assert/strict";
import { EVEREST_M, MilestoneWatch, distanceSteps, lifetimeTotals } from "../public/js/ride/milestones.js";
import { RouteGeometry } from "../public/js/route/geometry.js";

const KM = 1000;
const MI = 1609.344;

test("lifetime totals add up the kept rides, skipping what a record lacks", () => {
  const totals = lifetimeTotals([{ distanceM: 30_000, elevationGainM: 400 }, { distanceM: 12_500 }, { elevationGainM: 100 }, {}]);
  assert.deepEqual(totals, { distanceM: 42_500, climbedM: 500 });
});

test("distance milestones are round numbers in the rider's unit, then every 10,000", () => {
  assert.deepEqual(distanceSteps(25_000).slice(0, 8), [100, 250, 500, 1000, 2500, 5000, 10_000, 20_000]);
});

/** A 10 km loop with a climb topping out at 6 km. */
function loop() {
  return new RouteGeometry({
    id: "hills",
    name: "Hills",
    lanes: 4,
    seed: 1,
    points: [
      [0, 0, 100],
      [4990, 0, 100],
      [4990, 10, 300],
      [0, 10, 300],
    ],
    markers: [
      { type: "start_finish", distance: 0 },
      { type: "climb", distance: 4000, length: 2000 },
    ],
  });
}

const watch = (options = {}) => new MilestoneWatch({ totals: { distanceM: 0, climbedM: 0 }, unitM: KM, summits: new Set(), ...options });

test("passing 100 km in all on this ride is a milestone, once", () => {
  const w = watch({ totals: { distanceM: 99.5 * KM, climbedM: 0 } });
  assert.deepEqual(w.update({ rideDistanceM: 400, rideClimbedM: 0 }), []);
  assert.deepEqual(w.update({ rideDistanceM: 600, rideClimbedM: 0 }), [{ kind: "distance", value: 100 }]);
  assert.deepEqual(w.update({ rideDistanceM: 700, rideClimbedM: 0 }), []);
});

test("imperial riders get round miles", () => {
  const w = watch({ unitM: MI, totals: { distanceM: 99.9 * MI, climbedM: 0 } });
  assert.deepEqual(w.update({ rideDistanceM: 0.2 * MI, rideClimbedM: 0 }), [{ kind: "distance", value: 100 }]);
});

test("a jump over several steps shows only the biggest", () => {
  const w = watch({ totals: { distanceM: 90 * KM, climbedM: 0 } });
  assert.deepEqual(w.update({ rideDistanceM: 200 * KM, rideClimbedM: 0 }), [{ kind: "distance", value: 250 }]);
});

test("every Everest climbed in all is a milestone", () => {
  const w = watch({ totals: { distanceM: 0, climbedM: EVEREST_M - 50 } });
  assert.deepEqual(w.update({ rideDistanceM: 0, rideClimbedM: 60 }), [{ kind: "everest", value: 1 }]);
  const again = watch({ totals: { distanceM: 0, climbedM: 2 * EVEREST_M - 10 } });
  assert.deepEqual(again.update({ rideDistanceM: 0, rideClimbedM: 20 }), [{ kind: "everest", value: 2 }]);
});

test("without the totals yet (history still loading) only summits count", () => {
  const w = watch({ totals: null });
  assert.deepEqual(w.update({ rideDistanceM: 500 * KM, rideClimbedM: 20_000 }), []);
});

test("the first time over a climb's top is a milestone; the second is not", () => {
  const route = loop();
  const summits = new Set();
  const w = watch({ summits });
  w.update({ route, routeM: 5990, rideDistanceM: 0, rideClimbedM: 0 });
  assert.deepEqual(w.update({ route, routeM: 6010, rideDistanceM: 0, rideClimbedM: 0 }), [{ kind: "summit", route: "Hills", key: "hills:6000" }]);
  assert.ok(summits.has("hills:6000"));
  w.update({ route, routeM: 5990, rideDistanceM: 0, rideClimbedM: 0 });
  assert.deepEqual(w.update({ route, routeM: 6010, rideDistanceM: 0, rideClimbedM: 0 }), []);
});

test("a summit known from an earlier ride is no milestone", () => {
  const route = loop();
  const w = watch({ summits: new Set(["hills:6000"]) });
  w.update({ route, routeM: 5990, rideDistanceM: 0, rideClimbedM: 0 });
  assert.deepEqual(w.update({ route, routeM: 6010, rideDistanceM: 0, rideClimbedM: 0 }), []);
});

test("jumping past a top (rejoin, another route) is no summit", () => {
  const route = loop();
  const w = watch();
  w.update({ route, routeM: 5000, rideDistanceM: 0, rideClimbedM: 0 });
  assert.deepEqual(w.update({ route, routeM: 6500, rideDistanceM: 0, rideClimbedM: 0 }), []);
  const other = watch();
  other.update({ route: { ...route, id: "else" }, routeM: 5990, rideDistanceM: 0, rideClimbedM: 0 });
  assert.deepEqual(other.update({ route, routeM: 6010, rideDistanceM: 0, rideClimbedM: 0 }), []);
});
