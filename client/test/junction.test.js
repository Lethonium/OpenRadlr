import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RoadNetwork } from "../public/js/route/network.js";
import { JUNCTION_WINDOW_M, OFF_ROUTE_ID, junctionAhead, offRouteRoad, onwardRoads, stepOption, turnSide } from "../public/js/ride/junction.js";
import { RiderSmoother } from "../public/js/ride/smoothing.js";
import { squareRoute } from "./helpers.js";

const valley = new RoadNetwork(JSON.parse(readFileSync(new URL("../../routes/maps/valley.json", import.meta.url), "utf8")));
const eastFork = (offset, next = { edge: "hill-road", dir: 1 }) => ({ edge: "valley-east", dir: 1, offset, next });

test("the roads on from a junction leave it, without turning back", () => {
  assert.deepEqual(onwardRoads(valley, "valley-east", 1).sort(), [["hill-road", 1], ["river-east", 1]]);
  // Back towards the café the main road runs on west.
  assert.deepEqual(onwardRoads(valley, "valley-east", -1), [["valley-west", -1]]);
});

test("a junction shows within reach, its roads from left to right", () => {
  assert.equal(junctionAhead(valley, eastFork(100)), null, "880 m out: not yet");
  const junction = junctionAhead(valley, eastFork(979 - 200), { routeId: "col-de-la-forge" });
  assert.ok(junction.toGo <= JUNCTION_WINDOW_M);
  assert.equal(junction.place.id, "east-fork");
  const [left, right] = junction.options;
  assert.deepEqual([left.edge, left.side, left.route.id, left.planned], ["hill-road", "straight", "col-de-la-forge", true]);
  assert.deepEqual([right.edge, right.side, right.route.id, right.planned], ["river-east", "right", "riverside-flats", false]);
  assert.equal(left.towards, "Hilltop Café");
  // Rolling Hills rides the hill road that way too: my route wins the label.
  assert.equal(junctionAhead(valley, eastFork(900), { routeId: "rolling-hills" }).options[0].route.id, "rolling-hills");
  // One way on is no junction.
  assert.equal(junctionAhead(valley, { edge: "valley-east", dir: -1, offset: 900 }), null);
});

test("stepping through the options stops at either end", () => {
  const junction = junctionAhead(valley, eastFork(900));
  assert.equal(stepOption(junction, +1).edge, "river-east");
  assert.equal(stepOption(junction, -1).edge, "hill-road");
  assert.equal(turnSide(0.1), "straight");
});

test("a road no route rides that way is offered as off route", () => {
  // Down the orchard lane's climb towards the hill café, then the north road.
  const junction = junctionAhead(valley, { edge: "hill-road", dir: 1, offset: 2300, next: null });
  const north = junction.options.find((o) => o.edge === "hill-north");
  const orchard = junction.options.find((o) => o.edge === "orchard-lane");
  assert.equal(north.route.id, "col-de-la-forge");
  assert.equal(orchard.route.id, "rolling-hills");
  const back = junctionAhead(valley, { edge: "orchard-lane", dir: -1, offset: 3500, next: null });
  assert.ok(back.options.some((o) => o.edge === "hill-north" && o.route?.id === "col-de-la-forge"));
  const offRoute = junctionAhead(valley, { edge: "hill-north", dir: -1, offset: 690, next: null });
  assert.ok(offRoute.options.every((o) => o.route === null || o.route.walk), "options carry a route or none");
  assert.ok(offRoute.options.some((o) => o.route === null), "the hill road back down is no route's way");
});

test("my own road follows the roads, rounded where one turns onto the next", () => {
  const steps = [["hill-road", 1], ["orchard-lane", 1], ["river-east", -1]];
  const { geometry, bases } = offRouteRoad(valley, steps);
  assert.equal(geometry.id, OFF_ROUTE_ID);
  assert.equal(geometry.loop, false);
  assert.equal(bases[0], 0);
  // Away from the corners a rider at `base + offset` is exactly on that road.
  for (const [i, [edge, dir]] of steps.entries()) {
    const road = valley.edges.get(edge);
    for (const offset of [60, road.length / 2, road.length - 60]) {
      const mine = geometry.positionAt(bases[i] + offset);
      const real = road.positionAt(dir > 0 ? offset : road.length - offset);
      assert.ok(Math.hypot(mine.x - real.x, mine.y - real.y) < 0.5, `${edge} at ${offset.toFixed(0)}: ${Math.hypot(mine.x - real.x, mine.y - real.y)}`);
    }
  }
  // Through each joint the heading turns a little at a time, not in one corner.
  const heading = (d) => {
    const a = geometry.positionAt(d);
    const b = geometry.positionAt(d + 1);
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  for (const base of bases.slice(1)) {
    for (let d = base - 30; d < base + 30; d += 1) {
      const turn = heading(d + 1) - heading(d);
      assert.ok(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) < 0.35, `sharp at ${d}`);
    }
  }
  // The markers of each road that way: the hill road's climb, the orchard lane's sprint.
  assert.deepEqual(geometry.markers.map((m) => m.type), ["climb", "sprint"]);
});

test("smoother starts afresh on another route and moves riders off every route along their road", () => {
  const smoother = new RiderSmoother(squareRoute(), { correctionRate: 1 });
  smoother.update([{ id: 1, route: "a", distance: 100, lane: 0, speed: 0 }], 0);
  smoother.sample(0);
  smoother.update([{ id: 1, route: "b", distance: 30, lane: 0, speed: 0 }], 0.1);
  assert.equal(smoother.sample(0.1)[0].distance, 30, "no blending across routes");

  const off = new RiderSmoother(squareRoute(), { correctionRate: 1000 });
  off.update([{ id: 2, route: null, distance: 990, lane: 1, speed: 10, road: { edge: "x", dir: -1, offset: 40 } }], 0);
  off.sample(0);
  const [rider] = off.sample(0.5);
  assert.ok(Math.abs(rider.distance - 995) < 1e-6, "no wrap at a loop's length");
  assert.ok(Math.abs(rider.road.offset - 45) < 1e-6);
});
