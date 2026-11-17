/**
 * The woods' canopy (#117): beyond the trees along the road, a wood is filled
 * with cheap crowns, so from the saddle or the drone it reads as a wood and
 * not as a scatter. Only in woods, never on the road's own belt of modelled
 * trees, never in the sea, and the same on every client.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildCanopy } from "../public/js/view3d/world.js";
import { temperate } from "../public/js/view3d/biomes/index.js";

/** A wood on the right half of the map, a road along x = 0. */
const LAND = { forestAt: (x) => (x > 0 ? 1 : 0), fieldAt: () => 0 };
const terrain = { height: (x, z) => (z > 300 ? -20 : 10), distanceToRoad: (x) => Math.abs(x) };
const BOX = { x0: -600, z0: -600, x1: 600, z1: 600 };
const canopy = (options = {}) => buildCanopy(terrain, BOX, { land: LAND, water: 0, biome: temperate, reach: [50, 400], ...options });

test("crowns stand only in the woods", () => {
  const { positions } = canopy();
  assert.ok(positions.length > 100, `a wood this size should be full, got ${positions.length}`);
  assert.ok(positions.every(([x]) => x > 0));
});

test("the belt along the road is left to the modelled trees, and the far country to the haze", () => {
  const { positions } = canopy();
  assert.ok(positions.every(([x]) => x >= 50 && x <= 400));
});

test("no crown stands in the sea", () => {
  assert.ok(canopy().positions.every(([, , z]) => z <= 300));
});

test("a crown is cheap", () => {
  const { mesh, count } = canopy();
  assert.ok(mesh.vertexCount / count <= 3 * 20, `${mesh.vertexCount / count} corners a crown`);
});

test("a wood reaches beyond the near verge, not just 170 m", () => {
  // The terrain's `distanceToRoad` only searches the verge. The canopy must
  // use the index's far distance, or it grows a belt and calls it a wood.
  const farTerrain = {
    ...terrain,
    distanceToRoad: (x) => (Math.abs(x) > 170 ? Infinity : Math.abs(x)),
    index: { distance: (x) => Math.abs(x) },
  };
  const { positions } = buildCanopy(farTerrain, BOX, { land: LAND, water: 0, biome: temperate, reach: [50, 400] });
  assert.ok(positions.some(([x]) => x > 250), "a crown 250–400 m from the road");
});

test("the same land grows the same canopy", () => {
  assert.deepEqual(canopy().positions, canopy().positions);
});

test("a season without scenery colours grows no canopy", () => {
  assert.equal(canopy({ biome: { ...temperate, flora: { ...temperate.flora, scenery: null } } }).count, 0);
});
