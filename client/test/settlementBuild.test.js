/**
 * The settlement builder turns the layout into a town (#117): streets,
 * pavements, junction pads, a square, houses and lamps. It must be
 * deterministic and must not depend on the renderer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { SETTLEMENT_KIND, layoutSettlement } from "../public/js/land/settlement.js";
import { buildSettlement } from "../public/js/view3d/settlement.js";
import { temperate } from "../public/js/view3d/biomes/index.js";

const TERRAIN = { height: () => 10, distanceToRoad: () => 1000 };
const ROAD = new RouteGeometry({ id: "road", name: "Road", points: [[-1000, 0], [1000, 0]], lanes: 4, markers: [], zones: [], closed: false });
const LAYOUT = layoutSettlement({ id: "hilltop", kind: SETTLEMENT_KIND.city, center: [0, 0], radius: 400, seed: 2026, terrain: TERRAIN, roads: [ROAD] });

/** A house and a church mesh, so the builder has something to instance. */
function meshBox(w, h, d) {
  const builder = new MeshBuilder();
  builder.box([0, h / 2, 0], [w, h, d], [0.8, 0.7, 0.6]);
  return builder.build();
}
const HOUSE = meshBox(7, 5, 6);
const CHURCH = meshBox(9, 9, 15);
const KIT = {
  has: (role) => ["houses", "church", "fountains", "stalls", "benches", "windmills"].includes(role),
  model: (role) => {
    if (role === "houses") return { near: HOUSE, far: HOUSE, bounds: { min: [-3.5, 0, -3], max: [3.5, 5, 3] } };
    if (role === "church") return { near: CHURCH, far: CHURCH, bounds: { min: [-4.5, 0, -7.5], max: [4.5, 9, 7.5] } };
    return { near: HOUSE, far: null, bounds: { min: [-1, 0, -1], max: [1, 1, 1] } };
  },
};
const FLORA = {
  tree: ({ mesh, x, y, z }) => mesh.box([x, y + 1, z], [1, 2, 1], [0.2, 0.5, 0.2]),
};

const build = (layout = LAYOUT) => {
  const structures = new MeshBuilder();
  const bright = new MeshBuilder();
  const near = new MeshBuilder();
  const far = new MeshBuilder();
  const trees = new MeshBuilder();
  const result = buildSettlement(layout, {
    terrain: TERRAIN,
    structures,
    bright,
    into: { near, far, trees },
    biome: temperate,
    kit: KIT,
    flora: FLORA,
  });
  return { ...result, structures, bright, near, far, trees };
};

test("the builder makes streets, houses, props and lamps", () => {
  const built = build();
  assert.ok(built.structures.vertexCount > 1000, `streets and paving ${built.structures.vertexCount}`);
  assert.ok(built.near.vertexCount > 1000, `houses ${built.near.vertexCount}`);
  assert.ok(built.houses >= 20, `houses ${built.houses}`);
  assert.ok(built.props >= 3, `props ${built.props}`);
  assert.ok(built.lamps >= 10, `lamps ${built.lamps}`);
  assert.ok(built.bright.vertexCount > 0, "lamp heads are bright");
});

test("the same layout builds the same town", () => {
  const a = build();
  const b = build();
  assert.equal(a.houses, b.houses);
  assert.equal(a.near.vertexCount, b.near.vertexCount);
  assert.equal(a.structures.vertexCount, b.structures.vertexCount);
  assert.deepEqual([...a.near.positions.data.slice(0, a.near.positions.length)], [...b.near.positions.data.slice(0, b.near.positions.length)]);
});

test("a kit without houses falls back to the biome's own house", () => {
  const structures = new MeshBuilder();
  const near = new MeshBuilder();
  const result = buildSettlement(LAYOUT, {
    terrain: TERRAIN,
    structures,
    bright: new MeshBuilder(),
    into: { near },
    biome: temperate,
    kit: null,
    flora: null,
  });
  assert.ok(result.houses >= 20);
  assert.ok(structures.vertexCount > 1000, "the procedural houses are in the structures group");
  assert.equal(near.vertexCount, 0);
});

test("a village builds fewer houses than the city", () => {
  const village = layoutSettlement({ id: "southwest", kind: SETTLEMENT_KIND.village, center: [0, 0], radius: 220, seed: 2026, terrain: TERRAIN, roads: [ROAD] });
  assert.ok(build(village).houses < build().houses);
});
