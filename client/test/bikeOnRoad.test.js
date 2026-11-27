import { test } from "node:test";
import assert from "node:assert/strict";

import { RouteGeometry } from "../public/js/route/geometry.js";
import { BIKE_CONTACTS, ROAD_LIFT, bikeOnRoad, roadSurfaceAt } from "../public/js/world/roads.js";

/** Flat for 100 m, then a 10 % climb: the change of grade sits at 100 m. */
const route = new RouteGeometry({ id: "kink", name: "kink", lanes: 2, seed: 1, loop: false, points: [[0, 0, 0], [100, 0, 0], [200, 0, 10]] });

/** Height of the line through the bike's origin along `forward`, `along` metres ahead (negative: behind). */
function lineAt(pose, along) {
  const [fx, fy, fz] = pose.forward;
  return pose.position[1] + (fy / Math.hypot(fx, fz)) * along;
}

test("the drawn asphalt is the strip's corners every step, lifted", () => {
  assert.ok(Math.abs(roadSurfaceAt(route, 50) - ROAD_LIFT.ridden) < 1e-9);
  // Halfway along the strip's segment 100–104 m: halfway between its corner heights.
  assert.ok(Math.abs(roadSurfaceAt(route, 102) - (0.2 + ROAD_LIFT.ridden)) < 1e-9);
});

test("on a flat road both tyres stand on the lifted asphalt", () => {
  const pose = bikeOnRoad(route, 50, 0);
  assert.ok(Math.abs(pose.position[1] - ROAD_LIFT.ridden) < 1e-9);
  assert.ok(Math.abs(pose.forward[1]) < 1e-9);
});

test("at a change of grade both contact patches stay on the drawn road", () => {
  const pose = bikeOnRoad(route, 100.2, 0);
  assert.ok(Math.abs(lineAt(pose, -BIKE_CONTACTS.rear) - roadSurfaceAt(route, 100.2 - BIKE_CONTACTS.rear)) < 1e-6);
  assert.ok(Math.abs(lineAt(pose, BIKE_CONTACTS.front) - roadSurfaceAt(route, 100.2 + BIKE_CONTACTS.front)) < 1e-6);
});

test("a longer strip step and another lift move the surface with them", () => {
  // The 8 m segment 96–104 m cuts the corner: at 100 m it is halfway between 0 and 0.4 m.
  assert.ok(Math.abs(roadSurfaceAt(route, 100, { step: 8, lift: 0 }) - 0.2) < 1e-9);
});
