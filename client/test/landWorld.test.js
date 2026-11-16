/**
 * The land shapes the trees, and the village has a square (#117 follow-up).
 *
 * `land/land.js` decides where an island's woods and fields are; these tests
 * check that the world builds them into the wood — dense where the land is
 * wooded, mown where it is farmed — and that the whole thing stays a pure
 * function of the map, so every client (and the server) sees the same island.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { villageLots, villageShape } from "../public/js/land/land.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { buildScenery, landOf, terrainModel } from "../public/js/view3d/world.js";

/** A garden-sized loop of road, flat ground and plenty of room. */
function loop(length = 1200) {
  const points = [];
  for (let d = 0; d < length; d += 25) {
    const angle = (d / length) * Math.PI * 2;
    points.push([Math.cos(angle) * 400, Math.sin(angle) * 260, 40]);
  }
  return new RouteGeometry({ id: "loop", name: "Loop", lanes: 2, seed: 77, points });
}

const BOUNDS = { x0: -700, z0: -700, x1: 700, z1: 700 };
const FLAT = { height: () => 40, distanceToRoad: () => 1000, index: { nearest: () => null } };

/** Every tree the builder drew, as the point a flora was asked about. */
function trees(route, seed, options) {
  const places = [];
  const flora = { tree: ({ x, z }) => places.push([x, z]), tuft() {}, flower() {} };
  buildScenery(route, FLAT, BOUNDS, { count: 1500, flora, land: landOf(seed), ...options });
  return places;
}

test("the same map seed grows the same wood, tree for tree", () => {
  // The server copies these rules; two builds must agree exactly.
  const route = loop();
  assert.deepEqual(trees(route, 2026), trees(route, 2026));
});

test("the wood thickens where the land is a wood and thins where it is a field", () => {
  const route = loop();
  const { forestAt, fieldAt } = landOf(2026);
  const places = trees(route, 2026);
  assert.ok(places.length > 200, `${places.length} trees drawn`);
  const share = (test) => places.filter(([x, z]) => test(forestAt(x, z), fieldAt(x, z))).length / places.length;
  const inWood = share((forest) => forest > 0.8);
  const inField = share((forest, field) => field > 0.8);
  // A wood holds most of the trees; a field, mown, hardly any: this is what
  // stops the island from being trees scattered evenly on grass.
  assert.ok(inWood > 0.4, `only ${(inWood * 100).toFixed(0)}% of the trees stand in a wood`);
  assert.ok(inField < 0.1, `${(inField * 100).toFixed(0)}% of the trees stand in a field`);
});

test("a wood is dense: its trees stand close enough to hide the country", () => {
  const route = loop();
  const { forestAt } = landOf(2026);
  const places = trees(route, 2026).filter(([x, z]) => forestAt(x, z) > 0.9);
  assert.ok(places.length > 50, `${places.length} trees in the heart of a wood`);
  // Mean distance from a tree to its nearest neighbour in the wood, in metres.
  let nearest = 0;
  for (const [x, z] of places.slice(0, 60)) {
    let best = Infinity;
    for (const [ox, oz] of places) {
      const distance = Math.hypot(ox - x, oz - z);
      if (distance > 0.01 && distance < best) best = distance;
    }
    nearest += best;
  }
  const mean = nearest / Math.min(60, places.length);
  assert.ok(mean < 30, `trees stand ${mean.toFixed(0)} m apart in a wood`);
});

test("a kit's far wood is the same wood, tree for tree", () => {
  // The distance copy draws each model's cheap twin; it must not move a tree.
  const route = loop();
  const near = trees(route, 2026);
  const far = [];
  const flora = {
    tree: ({ x, z }) => far.push([x, z]),
    tuft() {},
    flower() {},
  };
  buildScenery(route, FLAT, BOUNDS, { count: 1500, flora, land: landOf(2026) });
  assert.deepEqual(far, near);
});

test("without the land the wood is scattered as it always was", () => {
  // A world built before the land module (or by a caller that passes no land)
  // keeps the old scatter, so nothing that does not ask changes.
  const route = loop();
  const places = trees(route, 2026, { land: null });
  assert.ok(places.length > 100);
  assert.deepEqual(places, trees(route, 2026, { land: null }));
});

test("the land of a map is its terrain's seed, so a season changes the look, not the layout", () => {
  const route = loop();
  const first = landOf(terrainModel(route).seed);
  const second = landOf(terrainModel(route).seed);
  assert.equal(first.forestAt(12, -30), second.forestAt(12, -30));
});

test("a village's green is clear of houses, and its neighbours stand in rows", () => {
  const stretch = { from: 0, to: 360 };
  const { center } = villageShape(stretch);
  const lots = villageLots(stretch);
  const street = lots.filter((lot) => lot.row === 0 && !lot.square);
  // Two rows of houses front the street, on either side of it.
  assert.ok(street.some((lot) => lot.side > 0) && street.some((lot) => lot.side < 0));
  // The green is marked in the middle, on both sides, and is the only stretch
  // of the street that has no houses on it.
  const green = lots.filter((lot) => lot.square);
  assert.ok(green.length >= 6, `${green.length} lots on the green`);
  assert.ok(green.every((lot) => Math.abs(lot.position - center) < 30), "the green sits in the middle");
  const housesOnGreen = lots.filter((lot) => !lot.square && lot.row < 2 && Math.abs(lot.position - center) < 15);
  assert.equal(housesOnGreen.length, 0, "no house on the green");
  // Every house lot is a place a house can stand: beside the street, not on it.
  assert.ok(lots.every((lot) => Math.abs(lot.side) >= 9), "houses stand off the road");
});
