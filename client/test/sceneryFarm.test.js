/**
 * Farmsteads built from a farm kit (#117): the procedural farm's yard, with
 * modelled barns, silos, wells and fences instead of the biome's boxes.
 *
 * The important promises are that the kit does not move the farms, that the
 * near and far copies stand in exactly the same places, and that turning the
 * kit off leaves the procedural farm as it was.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { Occupancy, buildFarms } from "../public/js/view3d/features.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { floraOf } from "../public/js/view3d/scenery/flora.js";
import { RouteGeometry } from "../public/js/route/geometry.js";

const ROUTE = new RouteGeometry({ id: "farms", name: "Farms", points: [[0, 0], [2000, 0]], lanes: 2, markers: [], zones: {}, closed: false });
const TERRAIN = { height: () => 0, distanceToRoad: (x, z) => Math.abs(z), index: { nearest: () => null }, water: -50 };

const SIZES = {
  farmBarns: [8, 6],
  houses: [6, 6],
  farmSilos: [3, 3],
  farmWells: [1, 1],
  farmCoops: [2, 2],
  farmWindmills: [4, 4],
  farmFences: [3, 0.2],
};

/** A kit that answers every farm role with a box of a known footprint. */
function kit() {
  return {
    has: (role) => role in SIZES,
    model: (role) => {
      const [w, d] = SIZES[role] ?? [1, 1];
      return {
        near: { name: role },
        far: { name: `${role}-far` },
        bounds: { min: [-w / 2, 0, -d / 2], max: [w / 2, 4, d / 2] },
      };
    },
  };
}

/** Records what a chunk group would receive, without building a world. */
function group() {
  return { placements: [], instance(mesh, matrix) { this.placements.push({ mesh, matrix }); } };
}

const farms = (options = {}) => buildFarms(ROUTE, TERRAIN, { structures: new MeshBuilder(), occupancy: new Occupancy(), seed: 7, count: 2, lakeLevel: -50, avoid: () => false, ...options });

test("a farm kit puts its buildings in the near and far groups, in the same places", () => {
  const near = group();
  const far = group();
  const structures = new MeshBuilder();
  const sites = farms({ kit: kit(), into: { near, far }, structures });
  assert.equal(sites.length, 2);
  assert.ok(near.placements.length >= 8, `a farm has several buildings, got ${near.placements.length}`);
  const roles = new Set(near.placements.map((p) => p.mesh.name));
  for (const role of ["farmBarns", "houses", "farmSilos", "farmWells"]) assert.ok(roles.has(role), `the farm has a ${role}`);
  assert.equal(far.placements.length, near.placements.length, "every near building has a far twin");
  for (let i = 0; i < near.placements.length; i += 1) assert.deepEqual(Array.from(near.placements[i].matrix), Array.from(far.placements[i].matrix), `placement ${i} matches`);
  assert.ok(structures.vertexCount > 0, "the hay bales and animals are still drawn");
});

test("turning the farm kit on does not move the farms", () => {
  const withKit = farms({ kit: kit(), into: { near: group(), far: group() } });
  const withoutKit = farms();
  assert.deepEqual(withKit, withoutKit);
});

test("without a kit the procedural farm keeps its own barn, house and silo", () => {
  const near = group();
  const structures = new MeshBuilder();
  farms({ structures, into: { near, far: group() } });
  assert.equal(near.placements.length, 0, "no kit, no instanced farm");
  assert.ok(structures.vertexCount > 0, "the procedural farm still draws");
});

test("a kit without farm roles falls back to the procedural farm", () => {
  const near = group();
  const structures = new MeshBuilder();
  farms({ kit: { has: () => false, model: () => null }, into: { near, far: group() }, structures });
  assert.equal(near.placements.length, 0);
  assert.ok(structures.vertexCount > 0);
});

test("the same seed builds the same farmsteads", () => {
  const first = farms({ kit: kit(), into: { near: group(), far: group() } });
  const second = farms({ kit: kit(), into: { near: group(), far: group() } });
  assert.deepEqual(first, second);
});

test("the world only grows a farm group when a kit can build one", () => {
  const routeFile = JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url)));
  const triangle = {
    name: "box",
    triangles: [
      [-2, 0, -2, 0.6, 0.3, 0.2],
      [2, 0, -2, 0.6, 0.3, 0.2],
      [0, 4, 2, 0.6, 0.3, 0.2],
    ],
    bounds: { min: [-2, 0, -2], max: [2, 4, 2] },
  };
  const models = {
    barn: { role: "farmBarns", near: "barn", far: "barn-far" },
    silo: { role: "farmSilos", near: "silo", far: "silo-far" },
    well: { role: "farmWells", near: "well", far: "well-far" },
  };
  const files = { barn: triangle, "barn-far": triangle, silo: triangle, "silo-far": triangle, well: triangle, "well-far": triangle };
  const scenes = {
    nearRange: 150,
    kits: [{ name: "farm", licence: "CC0-1.0", provenance: { pack: "https://example.org", licence: "https://creativecommons.org/publicdomain/zero/1.0/", taken: "2026-11-17" }, models, files }],
  };
  const withFarm = buildWorld(new RouteGeometry(routeFile), { scenery: floraOf(scenes, "temperate") });
  assert.ok(withFarm.chunks.farm?.length > 0, "the farm group exists");
  assert.ok(withFarm.chunks.farmFar?.length > 0, "its far twin exists");
  assert.ok(withFarm.chunks.farm.some((chunk) => (chunk.batches?.length ?? 0) > 0), "a farm chunk holds instanced buildings");
  assert.ok(withFarm.chunks.canopy?.length > 0, "the woods get their cheap crowns");
  const without = buildWorld(new RouteGeometry(routeFile));
  assert.equal(without.chunks.farm, undefined, "no kit, no farm group");
  assert.equal(without.chunks.canopy, undefined, "no kit, no canopy");
});
