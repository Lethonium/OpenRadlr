/**
 * The city is a place in the map, not a route zone (#117): it is built once
 * from the network and looks the same whichever route is ridden. Scenery off
 * keeps the old world, so the city only appears with a kit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadNetworkOf } from "../public/js/route/worldMap.js";
import { floraOf } from "../public/js/view3d/scenery/flora.js";
import { buildWorld } from "../public/js/view3d/world.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const NETWORK = read("../../routes/maps/valley.json");
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

test("the city is built from the map, whichever route is ridden", () => {
  const world = buildWorld(new RouteGeometry(ROUTE), {
    network: roadNetworkOf(NETWORK),
    scenery: floraOf(SCENES, "temperate"),
  });
  const chunks = world.chunks.village ?? [];
  assert.ok(chunks.length > 0, "the city has building chunks");
  assert.ok(
    chunks.some((chunk) => Math.hypot(chunk.center[0] - 2400, chunk.center[2] + 950) < 500),
    "the city stands at the Hilltop Café",
  );
  assert.ok(world.chunks.structures.some((chunk) => chunk.mesh.vertexCount > 0), "streets and paving exist");
  assert.ok(world.chunks.glow?.some((chunk) => chunk.mesh.vertexCount > 0), "the town's pools are in the glow group");
  assert.ok(world.lights?.length > 0, "the lamps and market lights are point lights");
});

test("scenery off keeps the old world without a settlement", () => {
  const world = buildWorld(new RouteGeometry(ROUTE), { network: roadNetworkOf(NETWORK) });
  assert.equal(world.chunks.village, undefined, "no kit, no city group");
  assert.equal(world.chunks.glow, undefined, "no kit, no town glow");
  assert.equal(world.lights, undefined, "no kit, no town lights");
  assert.ok(world.chunks.structures.length > 0, "the procedural village is still in the structures");
});
