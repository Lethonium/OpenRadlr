import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { RoadNetwork } from "../public/js/route/network.js";
import { LANE_WIDTH } from "../public/js/view3d/world.js";
import { MAP_VIEW, cachedOffsetNodes, drawRideMap, laneOffset, mapCamera, mapRiderMarks, offsetNodes, roadPointAt } from "../public/js/view/rideMapView.js";
import { tinyLoopFile, tinyNetworkFile } from "./helpers.js";

const COLORS = Object.freeze({
  text: "#e8ecf1",
  muted: "#8a94a3",
  grid: "#3a434f",
  road: "#2b3139",
  terrain: "#24402f",
  terrainEdge: "#5fb47c",
  me: "#ff7a1a",
  human: "#4cc3ff",
  bot: "#8f99a8",
});

const route = (points, loop = false) =>
  new RouteGeometry({ id: "test-road", name: "Test Road", lanes: 4, seed: 1, loop, points: points.map(([x, y]) => [x, y, 0]) });

const east = () => route([[0, 0], [1000, 0]]);
const north = () => route([[0, 0], [0, 1000]]);

const near = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

test("the map puts me at the bottom centre, heading up", () => {
  const road = east();
  const camera = mapCamera(road, { distance: 500, lane: 2 }, 1000, 800);
  const me = camera.toScreen(roadPointAt(road, 500, 2));
  assert.ok(near(me.x, 500), "centred across the road");
  assert.ok(near(me.y, 800 * MAP_VIEW.riderY), "lower than the middle");
  const ahead = camera.toScreen(roadPointAt(road, 520, 2));
  assert.ok(near(ahead.x, me.x), "straight ahead stays in the middle");
  assert.ok(ahead.y < me.y, "ahead is up the screen");
  const behind = camera.toScreen(roadPointAt(road, 480, 2));
  assert.ok(behind.y > me.y, "behind is down the screen");
});

test("a road heading north is drawn the same way up", () => {
  const road = north();
  const camera = mapCamera(road, { distance: 500, lane: 2 }, 1000, 800);
  const ahead = camera.toScreen(roadPointAt(road, 520, 2));
  assert.ok(near(ahead.x, camera.rider.x));
  assert.ok(ahead.y < camera.rider.y);
});

test("the map camera turns screen points back into the world", () => {
  const road = east();
  const camera = mapCamera(road, { distance: 500, lane: 2 }, 1000, 800);
  const center = camera.fromScreen(camera.rider);
  assert.ok(near(center.x, camera.center.x));
  assert.ok(near(center.y, camera.center.y));
  // Heading east, the top of the screen is east of me.
  const ahead = camera.fromScreen({ x: camera.rider.x, y: camera.rider.y - 10 });
  assert.ok(ahead.x > camera.center.x + 1);
  assert.ok(near(ahead.y, camera.center.y));
});

test("lane 0 is left of travel and lane 3 is right", () => {
  const road = east();
  const camera = mapCamera(road, { distance: 500, lane: 2 }, 1000, 800);
  const left = camera.toScreen(roadPointAt(road, 500, 0));
  const right = camera.toScreen(roadPointAt(road, 500, 3));
  assert.ok(left.x < camera.rider.x);
  assert.ok(right.x > camera.rider.x);
  assert.ok(near(right.x - left.x, (laneOffset(3, 4) - laneOffset(0, 4)) * camera.scale), "lanes are LANE_WIDTH apart");
  assert.ok(laneOffset(0, 4) < 0 && laneOffset(3, 4) > 0);
  assert.ok(near(laneOffset(1.5, 4), 0), "the middle of four lanes has no offset");
});

test("lane markings are offset from the centre line", () => {
  const road = east();
  const nodes = offsetNodes(road, LANE_WIDTH);
  assert.equal(nodes.length, 2);
  assert.ok(near(nodes[0].x, 0));
  assert.ok(near(nodes[0].y, -LANE_WIDTH), "a positive offset goes to the right of travel");
  const loop = route([[0, 0], [100, 0], [100, 100], [0, 100]], true);
  const ring = offsetNodes(loop, 0);
  assert.equal(ring.length, loop.nodes.length, "a loop is closed");
  assert.ok(near(ring[0].x, ring.at(-1).x) && near(ring[0].y, ring.at(-1).y));
});

test("a vehicle is marked once, at its captain", () => {
  const riders = [
    { id: 9, name: "Zed", distance: 30, lane: 0, is_bot: false },
    { id: 1, name: "Ben", distance: 30, lane: 1, is_bot: false, vehicle: { id: 5, kind: "beer_bike", seat: 0, seats: 5 } },
    { id: 2, name: "Anna", distance: 30, lane: 1, is_bot: false, vehicle: { id: 5, kind: "beer_bike", seat: 1, seats: 5, captain: true } },
  ];
  const marks = mapRiderMarks(riders, 2);
  assert.equal(marks.length, 2);
  assert.equal(marks.find((mark) => mark.rider.id === 9).label, "Zed");
  const vehicle = marks.find((mark) => mark.big);
  assert.equal(vehicle.label, "Anna's beer bike");
  assert.ok(vehicle.mine);
});

function fakeCanvas(width = 800, height = 600) {
  const calls = { lineTo: 0, fill: 0, fillRect: 0, stroke: 0, arc: 0, fillText: 0 };
  const fills = [];
  const strokes = [];
  const alphas = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === "measureText") return () => ({ width: 20 });
        if (name in calls) return () => (calls[name] += 1);
        return () => {};
      },
      set: (_, name, value) => {
        if (name === "fillStyle") fills.push(value);
        if (name === "strokeStyle") strokes.push(value);
        if (name === "globalAlpha") alphas.push(value);
        return true;
      },
    },
  );
  return { canvas: { clientWidth: width, clientHeight: height, width: 0, height: 0, style: {}, getContext: () => ctx }, calls, fills, strokes, alphas };
}

test("the map draws the coast, every road, the lane lines and the riders", () => {
  const { canvas, calls } = fakeCanvas();
  const road = new RouteGeometry(tinyLoopFile());
  const me = { id: 1, name: "Me", distance: 30, lane: 2, is_bot: false };
  drawRideMap(canvas, { route: road, riders: [me], me, colors: COLORS, network: new RoadNetwork(tinyNetworkFile()) });
  assert.ok(calls.lineTo > 500, "coast, roads and markings");
  assert.ok(calls.fill >= 2, "the land and my arrow");
  assert.equal(calls.fillText, 1, "my name");
});

test("without a network the map still shows the road", () => {
  const { canvas, calls } = fakeCanvas();
  const road = new RouteGeometry(tinyLoopFile());
  drawRideMap(canvas, { route: road, riders: [], me: null, colors: COLORS });
  assert.ok(calls.lineTo > 100, "the road and its markings");
  assert.ok(calls.fillRect >= 1, "the land");
});

test("the map paints its ground and decorations with the selected biome", () => {
  const { canvas, fills, strokes } = fakeCanvas();
  const road = new RouteGeometry(tinyLoopFile());
  drawRideMap(canvas, { route: road, riders: [], me: null, colors: COLORS, network: new RoadNetwork(tinyNetworkFile()), biome: "winter", timeMode: "day" });
  assert.ok(fills.includes("rgb(240, 245, 252)"), "snow covers the land");
  assert.ok(strokes.includes("rgb(115, 122, 138)"), "the winter road is a dark ploughed surface");
  assert.ok(strokes.includes("rgb(219, 173, 71)"), "the lane markings use the biome's paint");
});

test("drafting draws the gap ahead of me as a band in my lane", () => {
  const road = north();
  const me = { id: 1, name: "Me", distance: 500, lane: 2, is_bot: false };
  const leader = { id: 2, name: "Ana", distance: 503, lane: 2, is_bot: false };
  const withoutDraft = fakeCanvas();
  drawRideMap(withoutDraft.canvas, { route: road, riders: [me], me, colors: COLORS });
  const withDraft = fakeCanvas();
  drawRideMap(withDraft.canvas, { route: road, riders: [me, leader], me, draft: { gap: 3, savingPercent: 27, leader }, colors: COLORS });
  assert.ok(withDraft.calls.stroke > withoutDraft.calls.stroke, "one more stroke for the band");
  assert.ok(withDraft.strokes.includes(COLORS.me), "the band takes my colour");
});

test("labels follow the rest of the HUD: bots and riders from other apps", () => {
  const riders = [
    { id: 2, name: "Ana", distance: 30, lane: 1, is_bot: true },
    { id: 3, name: "Ben", distance: 30, lane: 2, is_bot: false, app: "incyclist" },
  ];
  const marks = mapRiderMarks(riders, 1);
  assert.equal(marks.find((mark) => mark.rider.id === 2).label, "Ana (bot)");
  assert.equal(marks.find((mark) => mark.rider.id === 3).label, "Ben · incyclist");
});

test("my best lap's ghost is drawn see-through, dashed and labelled", () => {
  const road = north();
  const me = { id: 1, name: "Me", distance: 500, lane: 2, is_bot: false };
  const ghost = { id: 99, name: "Best lap", distance: 520, lane: 2, ghost: true };
  const { canvas, alphas, calls } = fakeCanvas();
  drawRideMap(canvas, { route: road, riders: [me, ghost], me, colors: COLORS });
  assert.ok(alphas.includes(0.35), "the ghost is see-through");
  assert.ok(calls.fillText >= 2, "the ghost keeps its label");
});

test("the map draws the lemons still on the road and skips collected ones", () => {
  const road = east();
  const me = { id: 1, name: "Me", distance: 500, lane: 2, is_bot: false };
  const { canvas, fills } = fakeCanvas();
  drawRideMap(canvas, {
    route: road,
    riders: [me],
    me,
    colors: COLORS,
    lemons: [
      { id: "a", distance: 505, lane: 2, collected: false },
      { id: "b", distance: 506, lane: 2, collected: true },
      { id: "c", distance: 507, lane: 2, collected: false },
    ],
  });
  assert.equal(fills.filter((fill) => fill === "#ffcc14").length, 2, "two lemons, not the collected one");
});

test("the view reuses a route's offset lines across frames", () => {
  const road = east();
  const cached = cachedOffsetNodes(road, 2);
  assert.equal(cachedOffsetNodes(road, 2), cached, "the same offset comes from the cache");
  assert.notEqual(cachedOffsetNodes(road, 2), offsetNodes(road, 2), "the exported maths stays pure");
  assert.deepEqual(cached, offsetNodes(road, 2), "the cache holds the same points");
});
