import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { RoadNetwork } from "../public/js/route/network.js";
import { frameAt, roadDecorations } from "../public/js/view/rideMapDecor.js";
import { tinyNetworkFile } from "./helpers.js";

const decorated = () =>
  new RouteGeometry({
    id: "decorated",
    name: "Decorated",
    lanes: 4,
    seed: 7,
    loop: false,
    points: [[0, 0, 0], [1200, 0, 0]],
    markers: [],
    zones: [
      { type: "village", from: 100, to: 400 },
      { type: "forest", from: 600, to: 1000 },
    ],
  });

test("the road frame points north with the right to its east", () => {
  const east = frameAt(decorated(), 100);
  assert.ok(Math.abs(east.forward.x - 1) < 1e-9);
  assert.ok(Math.abs(east.forward.y) < 1e-9);
  assert.ok(Math.abs(east.right.x) < 1e-9);
  assert.ok(Math.abs(east.right.y + 1) < 1e-9);

  const north = frameAt(
    new RouteGeometry({ id: "north", name: "North", lanes: 4, seed: 7, loop: false, points: [[0, 0, 0], [0, 1200, 0]] }),
    100,
  );
  assert.ok(Math.abs(north.forward.x) < 1e-9);
  assert.ok(Math.abs(north.forward.y - 1) < 1e-9);
  assert.ok(Math.abs(north.right.x - 1) < 1e-9);
  assert.ok(Math.abs(north.right.y) < 1e-9);
});

test("a village gets outline buildings and the café, all off the road", () => {
  const route = decorated();
  const { buildings } = roadDecorations(route);
  assert.ok(buildings.some((b) => b.kind === "cafe"), "the route starts at a café");
  const houses = buildings.filter((b) => b.kind === "house");
  assert.ok(houses.length > 4, "houses on both sides of the village");
  assert.ok(houses.some((b) => b.y > 10) && houses.some((b) => b.y < -10), "both sides");
  for (const b of buildings) {
    assert.ok(Math.abs(b.y) > 8, "a building is set back from the road");
    assert.ok(b.w >= 6 && b.d >= 5, "a building has a footprint");
  }
});

test("trees are small dots, off the road, and in the forest", () => {
  const route = decorated();
  const { trees } = roadDecorations(route);
  assert.ok(trees.length > 20, "a forest and a roadside scatter");
  assert.ok(trees.length > 80, "the forest is denser than the roadside");
  for (const tree of trees) {
    assert.ok(Math.abs(tree.y) > 7, "no tree on the road");
    assert.ok(tree.r >= 2 && tree.r <= 4.5, "a tree is a dot, not a canopy");
  }
});

test("decorations are deterministic per route", () => {
  const a = roadDecorations(decorated());
  const b = roadDecorations(decorated());
  assert.deepEqual(a, b);
});

test("a network places its café and does not decorate the sea", () => {
  const route = new RouteGeometry({
    id: "tiny-loop",
    name: "Tiny Loop",
    lanes: 4,
    seed: 3,
    loop: true,
    points: [[0, 0, 30], [400, 0, 30], [400, 300, 30], [0, 300, 30]],
    markers: [],
    zones: [],
  });
  const network = new RoadNetwork(tinyNetworkFile());
  const { buildings, trees } = roadDecorations(route, network);
  assert.ok(buildings.length > 0, "the network café");
  for (const building of buildings) {
    assert.ok(network.heightAt(building.x, building.y) >= 2.5, "no building in the sea or on the beach");
  }
  for (const tree of trees) {
    assert.ok(network.heightAt(tree.x, tree.y) >= 2.5, "no tree in the sea or on the beach");
  }
});
