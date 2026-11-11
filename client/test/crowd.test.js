import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { CROWD, cheer, crowdShare } from "../public/js/view3d/crowd.js";
import { buildSpectators } from "../public/js/view3d/features.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { RoadIndex, VERGE, roadFrame, roadHalfWidth } from "../public/js/view3d/world.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// --- how many show up -------------------------------------------------------------

test("riding alone brings out part of the crowd, more riders bring out all of it", () => {
  assert.equal(crowdShare(1), CROWD.share.alone);
  assert.ok(crowdShare(3) > crowdShare(1));
  assert.equal(crowdShare(50), 1);
  assert.equal(crowdShare(0), CROWD.share.alone);
});

// --- cheering ---------------------------------------------------------------------

const person = { position: [0, 0, 0], yaw: 0, armsUp: false, motion: "jump", phase: 0 };

test("with nobody near, a spectator stands as placed and sways a little", () => {
  const far = cheer(person, [[200, 0, 0]], 1.3);
  assert.equal(far.excitement, 0);
  assert.equal(far.yaw, person.yaw);
  assert.equal(far.pose, false);
  assert.ok(Math.abs(far.lift) <= 0.02 + 1e-9);
});

test("a rider passing close gets arms up and higher jumps", () => {
  let calm = 0;
  let excited = 0;
  for (let t = 0; t < 2; t += 0.01) {
    calm = Math.max(calm, cheer({ ...person, armsUp: true }, [], t).lift);
    excited = Math.max(excited, cheer({ ...person, armsUp: true }, [[3, 0, 0]], t).lift);
  }
  assert.ok(excited > calm * 1.5, `${excited} vs ${calm}`);
  assert.equal(cheer(person, [[3, 0, 0]], 0.2).pose, true, "arms up for a close rider");
});

test("a spectator turns towards a rider close by, but never turns its back on the road", () => {
  // The person faces −Z (yaw 0); a rider 4 m to the side along +X.
  const turned = cheer(person, [[4, 0, 0]], 0);
  assert.ok(turned.yaw < 0, "turns towards +X");
  assert.ok(Math.abs(turned.yaw) <= CROWD.turnMax + 1e-9);
  const behind = cheer(person, [[0, 0, 4]], 0);
  assert.ok(Math.abs(behind.yaw) <= CROWD.turnMax + 1e-9);
});

test("the nearest rider is the one that counts", () => {
  const a = cheer(person, [[20, 0, 0], [2, 0, 0]], 0);
  const b = cheer(person, [[2, 0, 0]], 0);
  close(a.excitement, b.excitement);
});

test("penguins clap faster when a rider comes by instead of jumping", () => {
  const penguin = { ...person, motion: "clap" };
  const flips = (riders) => {
    let count = 0;
    let last = cheer(penguin, riders, 0).pose;
    for (let t = 0.01; t < 3; t += 0.01) {
      const pose = cheer(penguin, riders, t).pose;
      if (pose !== last) count += 1;
      last = pose;
    }
    return count;
  };
  assert.ok(flips([[2, 0, 0]]) > flips([]) * 1.3);
  for (let t = 0; t < 2; t += 0.05) assert.ok(cheer(penguin, [[2, 0, 0]], t).lift < 0.1, "no big jumps in a winter coat");
});

// --- where they stand ---------------------------------------------------------------

/** A straight 3 km road with a climb over its last kilometre and a sprint, on flat ground. */
function climbRoute() {
  return new RouteGeometry({
    id: "climb",
    name: "Climb",
    lanes: 4,
    seed: 11,
    loop: false,
    points: [
      [0, 0, 100],
      [3000, 0, 100],
    ],
    markers: [
      { type: "start_finish", distance: 0 },
      { type: "sprint", distance: 600, length: 300 },
      { type: "climb", distance: 1800, length: 1000 },
    ],
  });
}

function crowdOf(route, options = {}) {
  const index = new RoadIndex(route);
  const terrain = { height: () => 100, distanceToRoad: (x, z) => index.nearest(x, z)?.distance ?? Infinity };
  return buildSpectators(route, terrain, { structures: new MeshBuilder(), seed: route.seed, ...options });
}

/** Where along the road a spectator stands. */
const alongOf = (p) => p.position[0];

test("spectators line the last stretch of a climb, thicker towards the top", () => {
  const people = crowdOf(climbRoute()).filter((p) => p.rank > 0);
  const top = 2800;
  const lining = people.filter((p) => alongOf(p) > top - CROWD.liningM - 5 && alongOf(p) < top - 20);
  assert.ok(lining.length > 30, `${lining.length} along the climb`);
  const lower = lining.filter((p) => alongOf(p) < top - CROWD.liningM / 2).length;
  const upper = lining.length - lower;
  assert.ok(upper > lower * 1.5, `${upper} near the top vs ${lower} lower down`);
  assert.ok(!people.some((p) => alongOf(p) < top - CROWD.liningM - 30), "none further down the climb");
});

test("the sprint line gets a crowd too", () => {
  const atSprint = crowdOf(climbRoute()).filter((p) => Math.abs(alongOf(p) - 900) < 30);
  assert.ok(atSprint.length >= 16, `${atSprint.length} at the sprint line`);
});

test("lining spectators stand behind the verge on both sides, never on the road", () => {
  const route = climbRoute();
  const half = roadHalfWidth(route.lanes) + VERGE;
  const people = crowdOf(route);
  for (const p of people) assert.ok(Math.abs(p.position[2]) > half, `at ${p.position[2]}`);
  assert.ok(people.some((p) => p.position[2] > 0) && people.some((p) => p.position[2] < 0));
});

test("lining spectators keep out of what the world blocks", () => {
  const route = climbRoute();
  const blocked = (x) => x > 2400 && x < 2600;
  const people = crowdOf(route, { blocked });
  assert.ok(!people.some((p) => blocked(alongOf(p))));
});

test("the finish and summit crowds always show; the lining comes out with more riders", () => {
  const people = crowdOf(climbRoute());
  const top = roadFrame(climbRoute(), 2800).center[0];
  const summit = people.filter((p) => Math.abs(alongOf(p) - top) < 23);
  assert.ok(summit.length > 0 && summit.every((p) => p.rank === 0));
  const lining = people.filter((p) => p.rank > 0);
  assert.ok(lining.every((p) => p.rank < 1));
  const alone = lining.filter((p) => p.rank < crowdShare(1)).length;
  assert.ok(alone > 0 && alone < lining.length, "riding alone shows some of the lining, not all");
});

test("some spectators wave a flag", () => {
  const people = crowdOf(climbRoute());
  const flags = people.filter((p) => p.flag);
  assert.ok(flags.length > people.length * 0.05 && flags.length < people.length * 0.4, `${flags.length} of ${people.length}`);
  for (const p of flags) assert.equal(p.flag.length, 3);
});

test("the crowd is the same every time", () => {
  assert.deepEqual(crowdOf(climbRoute()), crowdOf(climbRoute()));
});
