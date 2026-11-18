/**
 * A wood needs a floor and a back (#117): bushes and rocks on the verge, and
 * cheap crowns behind the modelled belt. Without them a wood is a line of
 * trunks on open grass, which is what the first Quaternius screenshots showed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { buildUnderstory } from "../public/js/view3d/world.js";
import { temperate } from "../public/js/view3d/biomes/index.js";

const ROUTE = new RouteGeometry({ id: "wood", name: "Wood", points: [[0, 0], [2000, 0]], lanes: 2, markers: [], zones: {}, closed: false });
const TERRAIN = { height: () => 0, distanceToRoad: (x, z) => Math.abs(z), index: { nearest: () => null }, water: -50 };
const LAND = { forestAt: (x) => (x > 1000 ? 1 : 0), fieldAt: () => 0 };

/** A kit that records the role it was asked to draw. */
function recordingFlora(roles = ["bushes", "rocks"]) {
  const places = [];
  return {
    places,
    has: (role) => roles.includes(role),
    tree: ({ x, y, z, role }) => places.push({ x, y, z, role }),
  };
}

const understory = (options = {}) => buildUnderstory(ROUTE, TERRAIN, { into: new MeshBuilder(), flora: recordingFlora(), land: LAND, water: -50, count: 800, seed: 7, ...options });

test("the understory grows bushes and rocks only inside a wood", () => {
  const flora = recordingFlora();
  const result = understory({ flora });
  assert.ok(result.count > 100, `a wood this size should have a floor, got ${result.count}`);
  assert.ok(flora.places.every((p) => p.x > 1000), "nothing outside the wood");
  assert.ok(flora.places.every((p) => Math.abs(p.z) > 3), "nothing on the asphalt");
  assert.ok(new Set(flora.places.map((p) => p.role)).size > 1, "bushes and rocks, not one kind");
});

test("a kit without bushes or rocks grows no understory", () => {
  const flora = recordingFlora([]);
  assert.equal(understory({ flora }).count, 0);
  assert.deepEqual(flora.places, []);
});

test("the same seed grows the same forest floor", () => {
  const first = recordingFlora();
  const second = recordingFlora();
  understory({ flora: first });
  understory({ flora: second });
  assert.deepEqual(first.places, second.places);
});

test("the forest floor is darker than the open meadow", () => {
  const spot = { x: 100, z: 100, height: 10, steep: 0, seed: 1, water: 0 };
  const open = temperate.terrainColor({ ...spot, forest: 0, field: 0 });
  const wood = temperate.terrainColor({ ...spot, forest: 1, field: 0 });
  const field = temperate.terrainColor({ ...spot, forest: 0, field: 1 });
  const sum = (c) => c[0] + c[1] + c[2];
  assert.ok(sum(wood) < sum(open), `wood ${sum(wood)} vs open ${sum(open)}`);
  assert.ok(sum(field) > sum(wood), `field ${sum(field)} vs wood ${sum(wood)}`);
});

test("without land the ground keeps the colours it always had", () => {
  const spot = { x: 100, z: 100, height: 10, steep: 0, seed: 1, water: 0 };
  assert.deepEqual(temperate.terrainColor(spot), temperate.terrainColor({ ...spot, forest: null, field: null }));
});

test("the meadow is warmer than the old cool green", () => {
  const [r, g] = temperate.terrainColor({ x: 0, z: 0, height: 30, steep: 0, seed: 1, water: 0, forest: 0, field: 0 });
  assert.ok(r / g > 0.75, `meadow r/g ${(r / g).toFixed(2)}`);
});

test("crops read gold rather than green", () => {
  const [r, g] = temperate.terrainColor({ x: 0, z: 0, height: 30, steep: 0, seed: 1, water: 0, forest: 0, field: 1 });
  assert.ok(r > g * 0.85, `crops r ${r.toFixed(2)} vs g ${g.toFixed(2)}`);
});
