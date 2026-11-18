/**
 * Regions reach the world builder (#117): only with scenery on and a map that
 * has them. Scenery off is pinned in sceneryOffWorld.test.js.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadNetworkOf } from "../public/js/route/worldMap.js";
import { floraOf } from "../public/js/view3d/scenery/flora.js";
import { temperate } from "../public/js/view3d/biomes/index.js";
import { regionStyle } from "../public/js/view3d/regions/styles.js";
import { buildCanopy, buildScenery, buildWorld } from "../public/js/view3d/world.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const VALLEY = read("../../routes/maps/valley.json");
const ROUTE = read("../../routes/rolling-hills.json");

const TRIANGLE = {
  name: "box",
  triangles: [
    [-4, 0, -4, 0.6, 0.3, 0.2],
    [4, 0, -4, 0.6, 0.3, 0.2],
    [0, 6, 4, 0.6, 0.3, 0.2],
  ],
  bounds: { min: [-4, 0, -4], max: [4, 6, 4] },
};
const SCENES = {
  nearRange: 180,
  kits: [{
    name: "town",
    licence: "CC0-1.0",
    provenance: { pack: "https://example.org", licence: "https://creativecommons.org/publicdomain/zero/1.0/", taken: "2026-11-17" },
    models: {
      house: { role: "houses", near: "house", far: "house" },
      church: { role: "church", near: "church", far: "church" },
      fountain: { role: "fountains", near: "fountain", far: "fountain" },
    },
    files: { house: TRIANGLE, church: TRIANGLE, fountain: TRIANGLE },
  }],
};

test("with scenery on, the world carries the map's regions", () => {
  const network = roadNetworkOf(VALLEY);
  const world = buildWorld(new RouteGeometry(ROUTE), { network, scenery: floraOf(SCENES, "temperate") });
  assert.equal(world.regions.length, 11);
  assert.equal(world.regions, network.regions);
});

// Task 7: ground colour, tree mix and canopy by region.
const GROUND = { x: 40, z: 10, height: 20, steep: 0, seed: 3, water: 0, forest: 0, field: 0 };
const regionOf = (kind, weight = 1) => ({ style: regionStyle(kind, temperate), weight });

test("a null region leaves the terrain colour exactly as it was", () => {
  for (const spot of [GROUND, { ...GROUND, forest: 0.9 }, { ...GROUND, field: 0.9, x: 7 }]) {
    assert.deepEqual(temperate.terrainColor({ ...spot, region: null }), temperate.terrainColor(spot));
  }
});

test("in the lavender region, open ground shows lavender stripes between plain ground", () => {
  const isLavender = ([r, g, b]) => b > r + 0.1 && b > g + 0.2;
  const line = Array.from({ length: 80 }, (_, i) => temperate.terrainColor({ ...GROUND, x: i, z: 0, region: regionOf("lavenderFields") }));
  assert.ok(line.some(isLavender), "some cells are lavender");
  assert.ok(line.some((c) => !isLavender(c)), "some cells are not");
  assert.ok(!temperate.terrainColor({ ...GROUND, region: null }).some((c) => c > 1), "plain ground is unchanged");
});

test("the colour mass stays off the forest floor, the beach and the snow", () => {
  const lavender = regionOf("lavenderFields");
  const isLavender = ([r, g, b]) => b > r + 0.1 && b > g + 0.2;
  for (let x = 0; x < 80; x += 1) {
    assert.ok(!isLavender(temperate.terrainColor({ ...GROUND, x, forest: 1, region: lavender })), "wood floor");
    assert.ok(!isLavender(temperate.terrainColor({ ...GROUND, x, height: 1, region: lavender })), "beach");
  }
});

test("the region's ground colour replaces the land's by its weight", () => {
  const full = temperate.terrainColor({ ...GROUND, region: regionOf("pineCoast", 1) });
  const none = temperate.terrainColor(GROUND);
  const half = temperate.terrainColor({ ...GROUND, region: regionOf("pineCoast", 0.5) });
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(half[i] - (full[i] + none[i]) / 2) < 0.06, `channel ${i}`);
  assert.notDeepEqual(full, none);
});

const FLAT = { height: () => 30, distanceToRoad: () => 1000, index: { nearest: () => null }, water: -50 };
const LINE = new RouteGeometry({ id: "t", name: "T", points: [[0, 0], [500, 0]], lanes: 2, markers: [], zones: {}, closed: false, seed: 5 });
const BOX = { x0: -400, z0: -400, x1: 400, z1: 400 };
const WOOD = { forestAt: () => 0.6, fieldAt: () => 0 };
const lavenderWest = (x) => (x < 0 ? [{ kind: "lavenderFields", weight: 1 }] : []);

function scatter(options = {}) {
  const calls = [];
  const flora = { tree: ({ x, z }) => calls.push([x, z]), tuft() {}, flower() {} };
  const built = buildScenery(LINE, FLAT, BOX, { count: 700, water: -50, flora, land: WOOD, biome: temperate, ...options });
  return { ...built, calls };
}

test("a tree in the lavender region is at most a fifth as likely as outside", () => {
  const { positions } = scatter({ regionsAt: lavenderWest });
  const lavender = positions.filter(([x]) => x < 0).length;
  const outside = positions.filter(([x]) => x > 0).length;
  assert.ok(outside > 50, `${outside} outside`);
  assert.ok(lavender <= 0.2 * outside, `${lavender} lavender vs ${outside} outside`);
});

test("region trees are plants of the region, drawn into the mesh, near and far", () => {
  const regionsAt = () => [{ kind: "oliveTerraces", weight: 1 }];
  const near = scatter({ regionsAt });
  const far = scatter({ regionsAt, far: true });
  assert.equal(near.calls.length, 0, "the kit draws none of them");
  assert.ok(near.mesh.vertexCount > 0);
  assert.deepEqual(near.positions, far.positions, "the far pass puts the plants in the same places");
  assert.ok(far.mesh.vertexCount < near.mesh.vertexCount);
});

test("region plants keep to the open ground: never in blocked spots, short near a town", () => {
  const regionsAt = () => [{ kind: "oliveTerraces", weight: 1 }];
  const blocked = (x, z) => Math.hypot(x, z) < 150;
  const { positions } = scatter({ regionsAt, blocked });
  assert.ok(positions.every(([x, , z]) => !blocked(x, z)));
  const town = scatter({ regionsAt, nearTown: () => 20 });
  assert.ok(town.calls.length > 0, "near a town the kit's short trees stand instead");
});

test("the same region grows the same trees", () => {
  const regionsAt = () => [{ kind: "oliveTerraces", weight: 1 }];
  assert.deepEqual(scatter({ regionsAt }).positions, scatter({ regionsAt }).positions);
});

const CANOPY_TERRAIN = { height: () => 10, distanceToRoad: (x) => Math.abs(x) };
const CANOPY_LAND = { forestAt: (x) => (x > 0 ? 1 : 0), fieldAt: () => 0 };
const canopyBox = { x0: -600, z0: -600, x1: 600, z1: 600 };

function crownColours(regionsAt) {
  const { mesh } = buildCanopy(CANOPY_TERRAIN, canopyBox, { land: CANOPY_LAND, water: 0, biome: temperate, reach: [50, 400], regionsAt });
  const colors = mesh.colors;
  const out = [];
  for (let i = 0; i < colors.length; i += 4) out.push([colors[i], colors[i + 1], colors[i + 2]]);
  return out;
}
const isPink = ([r, g, b]) => r > 0.85 && r > g + 0.12 && b > g;

test("a blossom valley's canopy crowns carry the pink; elsewhere they do not", () => {
  const blossom = crownColours(() => [{ kind: "blossomValley", weight: 1 }]);
  assert.ok(blossom.length > 0 && blossom.every(isPink));
  assert.ok(!crownColours(() => []).some(isPink));
  assert.ok(!crownColours(null).some(isPink));
});

test("a sparse region thins its canopy", () => {
  const count = (regionsAt) => buildCanopy(CANOPY_TERRAIN, canopyBox, { land: CANOPY_LAND, water: 0, biome: temperate, reach: [50, 400], regionsAt }).count;
  assert.ok(count(() => [{ kind: "lavenderFields", weight: 1 }]) < 0.3 * count(null));
});

test("the world's ground carries the lavender stripes, and canopy and trees follow the regions", () => {
  const network = roadNetworkOf(VALLEY);
  const world = buildWorld(new RouteGeometry(ROUTE), { network, scenery: floraOf(SCENES, "temperate") });
  let lavender = 0;
  for (const chunk of world.chunks.terrain) {
    const colors = chunk.mesh.colors;
    for (let i = 0; i < colors.length; i += 4) if (colors[i + 2] > colors[i + 1] + 0.15 && colors[i + 2] > colors[i] + 0.05) lavender += 1;
  }
  assert.ok(lavender > 100, `${lavender} lavender vertices`);
});
