import { test } from "node:test";
import assert from "node:assert/strict";
import { GYM_SPOT_GAP, assignSpots, gymOfRoute, nearestGym } from "../public/js/workout/gymSpots.js";
import { squareRoute } from "./helpers.js";

/** A gym at (100, 0, 50) whose spots run along +x, rows stepping +z (away from the road). */
function gym(center = [100, 0, 50]) {
  const spots = [];
  for (const row of [0, 1]) {
    for (let col = 0; col < 4; col += 1) {
      spots.push({ position: [center[0] + (col - 1.5) * GYM_SPOT_GAP, center[1], center[2] + (row - 0.5) * GYM_SPOT_GAP], yaw: Math.PI });
    }
  }
  return { center, yaw: Math.PI, spots };
}

test("spots go by rider id", () => {
  const g = gym();
  const spots = assignSpots([42, 7, 19], g);
  assert.deepEqual([...spots.keys()].sort((a, b) => a - b), [7, 19, 42]);
  assert.deepEqual(spots.get(7), g.spots[0]);
  assert.deepEqual(spots.get(19), g.spots[1]);
  assert.deepEqual(spots.get(42), g.spots[2]);
});

test("the ninth rider stands beside the mat", () => {
  const g = gym();
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const spots = assignSpots(ids, g);
  const ninth = spots.get(9);
  const behindBackRow = g.spots[4].position[2] + GYM_SPOT_GAP;
  assert.ok(Math.abs(ninth.position[2] - behindBackRow) < 1e-9, "a third row behind the mat");
  assert.ok(Math.abs(ninth.position[0] - g.spots[0].position[0]) < 1e-9, "in the first column");
  assert.ok(Math.abs(spots.get(10).position[0] - g.spots[1].position[0]) < 1e-9, "the tenth beside the ninth");
  assert.equal(ninth.yaw, g.spots[0].yaw, "facing the road like the others");
  assert.deepEqual(assignSpots(ids, g), spots, "every client computes the same");
});

test("riders keep their spot when a higher id leaves", () => {
  const g = gym();
  const before = assignSpots([3, 5, 8, 12], g);
  const after = assignSpots([3, 5, 8], g);
  for (const id of [3, 5, 8]) assert.deepEqual(after.get(id), before.get(id));
  assert.equal(after.has(12), false);
});

test("no gym nearby gives null", () => {
  const far = gym([1000, 0, 1000]);
  const close = gym([100, 0, 50]);
  assert.equal(nearestGym([far], [0, 0]), null);
  assert.equal(nearestGym([], [0, 0]), null);
  assert.equal(nearestGym([far, close], [60, 20]), close);
});

test("a route's gym is the one by its start", () => {
  const route = squareRoute();
  const start = route.positionAt(0);
  const atStart = gym([start.x + 30, 0, -start.y + 20]);
  assert.equal(gymOfRoute([gym([5000, 0, 5000]), atStart], route), atStart);
  assert.equal(gymOfRoute(undefined, route), null);
});
