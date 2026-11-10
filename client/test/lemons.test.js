import { test } from "node:test";
import assert from "node:assert/strict";
import { LEMONS, LemonHunt, lemonDay, lemonsFor } from "../public/js/ride/lemons.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { squareRoute } from "./helpers.js";

const DAY_MS = 86_400_000;

/** A straight 12 km out-and-back loop with 4 lanes, long enough for several lemons. */
function longRoute(seed = 5) {
  return new RouteGeometry({
    id: "long",
    name: "Long",
    lanes: 4,
    seed,
    points: [
      [0, 0, 0],
      [6000, 0, 0],
      [6000, 10, 0],
      [0, 10, 0],
    ],
  });
}

// --- placement ----------------------------------------------------------------

test("the lemon day is the UTC calendar day", () => {
  assert.equal(lemonDay(0), 0);
  assert.equal(lemonDay(DAY_MS - 1), 0);
  assert.equal(lemonDay(DAY_MS), 1);
});

test("every rider gets the same lemons on a route on the same day", () => {
  assert.deepEqual(lemonsFor(longRoute(), 20_000), lemonsFor(longRoute(), 20_000));
});

test("the lemons move to new places the next day", () => {
  const today = lemonsFor(longRoute(), 20_000).map((l) => [l.distance, l.lane]);
  const tomorrow = lemonsFor(longRoute(), 20_001).map((l) => [l.distance, l.lane]);
  assert.notDeepEqual(today, tomorrow);
});

test("a route gets about one lemon per spacing, within the bounds", () => {
  const route = longRoute();
  assert.equal(lemonsFor(route, 1).length, Math.round(route.length / LEMONS.spacingM));
  assert.equal(lemonsFor(squareRoute(), 1).length, LEMONS.min);
});

test("lemons lie on whole lanes of the road, clear of the start line, in riding order", () => {
  const route = longRoute();
  const lemons = lemonsFor(route, 7);
  for (const lemon of lemons) {
    assert.ok(Number.isInteger(lemon.lane) && lemon.lane >= 0 && lemon.lane < route.lanes, `lane ${lemon.lane}`);
    assert.ok(lemon.distance >= LEMONS.clearM && lemon.distance <= route.length - LEMONS.clearM, `at ${lemon.distance}`);
  }
  const distances = lemons.map((l) => l.distance);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
});

test("lemons are not all in one lane", () => {
  const lanes = new Set(lemonsFor(longRoute(), 3).map((l) => l.lane));
  assert.ok(lanes.size > 1);
});

// --- collecting ---------------------------------------------------------------

/** A hunt on a route with a single lemon, for clear pickups. */
function huntWith(lemon, { total = 0 } = {}) {
  const route = longRoute();
  return { route, hunt: new LemonHunt({ route, lemons: [{ id: "a", ...lemon }], total }) };
}

test("riding through a lemon in its lane collects it", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  assert.deepEqual(hunt.update({ routeId: route.id, distance: 495, lane: 2 }), []);
  const picked = hunt.update({ routeId: route.id, distance: 505, lane: 2 });
  assert.deepEqual(picked.map((l) => l.id), ["a"]);
  assert.equal(hunt.collected, 1);
  assert.equal(hunt.total, 1);
  assert.equal(hunt.lemons[0].collected, true);
});

test("passing a lemon in another lane leaves it", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  hunt.update({ routeId: route.id, distance: 495, lane: 0 });
  assert.deepEqual(hunt.update({ routeId: route.id, distance: 505, lane: 0 }), []);
  assert.equal(hunt.lemons[0].collected, false);
});

test("halfway through a lane change still catches the lemon", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  hunt.update({ routeId: route.id, distance: 495, lane: 1.6 });
  assert.equal(hunt.update({ routeId: route.id, distance: 505, lane: 1.6 }).length, 1);
});

test("a lemon is collected once", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  hunt.update({ routeId: route.id, distance: 495, lane: 2 });
  hunt.update({ routeId: route.id, distance: 505, lane: 2 });
  hunt.update({ routeId: route.id, distance: 490, lane: 2 });
  assert.deepEqual(hunt.update({ routeId: route.id, distance: 510, lane: 2 }), []);
  assert.equal(hunt.collected, 1);
});

test("the first position only sets where the rider is", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  assert.deepEqual(hunt.update({ routeId: route.id, distance: 505, lane: 2 }), []);
});

test("a jump (rejoin, teleport) collects nothing on the way", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  hunt.update({ routeId: route.id, distance: 100, lane: 2 });
  assert.deepEqual(hunt.update({ routeId: route.id, distance: 900, lane: 2 }), []);
});

test("off the route (another road) nothing is collected, and the next position starts afresh", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  hunt.update({ routeId: route.id, distance: 495, lane: 2 });
  assert.deepEqual(hunt.update({ routeId: "other", distance: 505, lane: 2 }), []);
  assert.deepEqual(hunt.update({ routeId: route.id, distance: 505, lane: 2 }), []);
});

test("a lemon just past the line is caught when the rider crosses the line", () => {
  const route = longRoute();
  const hunt = new LemonHunt({ route, lemons: [{ id: "a", distance: 3, lane: 1 }] });
  hunt.update({ routeId: route.id, distance: route.length - 4, lane: 1 });
  assert.equal(hunt.update({ routeId: route.id, distance: 6, lane: 1 }).length, 1);
});

test("the lemons grow back for the next lap", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 });
  hunt.update({ routeId: route.id, distance: 495, lane: 2 });
  hunt.update({ routeId: route.id, distance: 505, lane: 2 });
  hunt.update({ routeId: route.id, distance: route.length - 5, lane: 2 });
  hunt.update({ routeId: route.id, distance: 5, lane: 2 });
  assert.equal(hunt.lemons[0].collected, false, "back after the line");
  hunt.update({ routeId: route.id, distance: 495, lane: 2 });
  hunt.update({ routeId: route.id, distance: 505, lane: 2 });
  assert.equal(hunt.collected, 2);
});

test("the all-time total carries on from what was kept", () => {
  const { route, hunt } = huntWith({ distance: 500, lane: 2 }, { total: 41 });
  hunt.update({ routeId: route.id, distance: 495, lane: 2 });
  hunt.update({ routeId: route.id, distance: 505, lane: 2 });
  assert.equal(hunt.total, 42);
});
