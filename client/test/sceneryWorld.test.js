/**
 * Scenery from a kit inside the world build (#117).
 *
 * The point of these tests is that turning scenery on changes only the
 * scenery: roads, terrain, buildings and everything else keep their vertices,
 * so a rider who does not ask for it gets exactly the world they had.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { floraOf } from "../public/js/view3d/scenery/flora.js";
import { buildScenery } from "../public/js/view3d/world.js";

/** One triangle, the least a kit can hold. */
const MODEL_FILE = {
  name: "pine",
  triangles: [
    [-1, 0, 0, 0.2, 0.4, 0.2],
    [1, 0, 0, 0.2, 0.4, 0.2],
    [0, 4, 0, 0.2, 0.4, 0.2],
  ],
  bounds: { min: [-1, 0, 0], max: [1, 4, 0] },
  vertices: 3,
};

/** A flat patch of ground with a road down the middle, for placement rules. */
function terrainFixture() {
  return {
    height: () => 0,
    distanceToRoad: () => 1000,
    index: { nearest: () => null },
    water: -50,
  };
}

const BOUNDS = { x0: -400, z0: -400, x1: 400, z1: 400 };

/** A flora that records where it was asked to draw. */
function recordingFlora() {
  const places = [];
  return {
    places,
    tree({ x, y, z }) {
      places.push([x, y, z]);
    },
  };
}

test("a flora passed to the scenery builder is what draws the trees", () => {
  const route = new RouteGeometry({ id: "t", name: "T", points: [[0, 0], [500, 0]], lanes: 2, markers: [], zones: {}, closed: false });
  const flora = recordingFlora();
  const result = buildScenery(route, terrainFixture(), BOUNDS, { count: 40, water: -50, flora });
  assert.equal(flora.places.length, result.count);
  assert.ok(flora.places.length > 0, "the fixture route should take some trees");
});

test("the same seeded route places the same trees every time", () => {
  const route = new RouteGeometry({ id: "t", name: "T", points: [[0, 0], [500, 0]], lanes: 2, markers: [], zones: {}, closed: false });
  const first = recordingFlora();
  const second = recordingFlora();
  buildScenery(route, terrainFixture(), BOUNDS, { count: 40, water: -50, flora: first });
  buildScenery(route, terrainFixture(), BOUNDS, { count: 40, water: -50, flora: second });
  assert.deepEqual(first.places, second.places);
});

test("without a flora the biome still draws the trees, as before", () => {
  const route = new RouteGeometry({ id: "t", name: "T", points: [[0, 0], [500, 0]], lanes: 2, markers: [], zones: {}, closed: false });
  const result = buildScenery(route, terrainFixture(), BOUNDS, { count: 40, water: -50 });
  assert.ok(result.count > 0);
  assert.ok(result.mesh.positions.length > 0, "the biome drew something");
});

test("the worker turns posted kit data into a flora, since functions do not travel", () => {
  const scenes = {
    nearRange: 150,
    kits: [
      {
        name: "nature",
        licence: "CC0-1.0",
        provenance: { pack: "https://example.org", licence: "https://creativecommons.org/publicdomain/zero/1.0/", taken: "2026-11-16" },
        models: { pine: { role: "firs", near: "pine" } },
        files: { pine: MODEL_FILE },
      },
    ],
  };
  const flora = floraOf(scenes);
  assert.deepEqual(flora.roles, ["firs"]);
  const mesh = new MeshBuilder();
  flora.tree({ mesh, x: 0, y: 0, z: 0, kind: 0.5, random: () => 0.5 });
  assert.equal(mesh.vertexCount, 3);
});

test("no kit posted means no flora, so the biome draws as it always did", () => {
  assert.equal(floraOf(null), null);
  assert.equal(floraOf({ kits: [] }), null);
});

test("a posted kit that is not CC0 is refused", () => {
  const scenes = { kits: [{ name: "x", licence: "nope", models: { a: { near: "a" } }, files: { a: MODEL_FILE } }] };
  assert.throws(() => floraOf(scenes), /x.*licence/is);
});
