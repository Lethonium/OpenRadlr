/**
 * Landmarks (#117): hand-placed in the map, built once into the village groups
 * with an apron reserved before anything scatters. Scenery off builds none.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { roadNetworkOf } from "../public/js/route/worldMap.js";
import { floraOf } from "../public/js/view3d/scenery/flora.js";
import { ChunkedMesh } from "../public/js/view3d/chunks.js";
import { Occupancy } from "../public/js/view3d/features.js";
import { LANDMARKS, buildLandmarks } from "../public/js/view3d/landmarks.js";
import { seededRandom } from "../public/js/view3d/noise.js";
import { buildWorld } from "../public/js/view3d/world.js";

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

const FLAT = { height: () => 10 };
const triangles = (mesh) => mesh.vertexCount / 3;
const colorsOf = (mesh) => Array.from({ length: mesh.vertexCount }, (_, v) => Array.from(mesh.colors.slice(v * 4, v * 4 + 3)));
const heights = (mesh) => Array.from({ length: mesh.vertexCount }, (_, v) => mesh.positions[v * 3 + 1]);

test("a lighthouse builds a near and a cheap far mesh in white and red", () => {
  const built = LANDMARKS.lighthouse.build({ terrain: FLAT, center: [100, 200], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(built.near.vertexCount > built.far.vertexCount, "the near mesh is the richer one");
  assert.ok(triangles(built.far) > 0 && triangles(built.far) <= 60, `far has ${triangles(built.far)} triangles`);
  for (const mesh of [built.near, built.far]) {
    const colors = colorsOf(mesh);
    assert.ok(colors.some(([r, g, b]) => r > 0.85 && g > 0.85 && b > 0.8), "white band");
    assert.ok(colors.some(([r, g, b]) => r > 0.6 && g < 0.3 && b < 0.3), "red band");
  }
  assert.deepEqual(built.at, [100, 10, 200], "it stands on the ground at its spot");
});

test("the lighthouse lamp is in the bright group, up in the lantern", () => {
  const built = LANDMARKS.lighthouse.build({ terrain: FLAT, center: [0, 0], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(built.bright.vertexCount > 0, "a lit lamp");
  const top = Math.max(...heights(built.near));
  assert.ok(Math.min(...heights(built.bright)) > top * 0.6, "the lamp sits in the top of the tower");
});

test("a lighthouse on a slope sinks its foot below the ground instead of floating", () => {
  const slope = { height: (x) => 10 + x * 0.1 };
  const built = LANDMARKS.lighthouse.build({ terrain: slope, center: [0, 0], yaw: 0, water: 0, random: seededRandom(1) });
  assert.ok(Math.min(...heights(built.near)) < -0.5, "the foundation reaches below the stand point");
  assert.ok(built.at[1] >= 10, "and the stand point is the high side of the footprint");
});

test("buildLandmarks places each landmark, reserves its apron and returns the movers", () => {
  const near = new ChunkedMesh();
  const far = new ChunkedMesh();
  const bright = new ChunkedMesh();
  const occupancy = new Occupancy();
  const list = [{ id: "a", kind: "lighthouse", center: [300, -400], yaw: 0, apron: 25 }];
  const result = buildLandmarks(list, { terrain: FLAT, near, far, bright, occupancy, water: 0 });
  assert.deepEqual(result.movers, []);
  assert.ok(near.vertexCount > 0 && far.vertexCount > 0 && bright.vertexCount > 0);
  assert.ok(occupancy.blocked(300, -400), "the apron is reserved");
  assert.ok(occupancy.blocked(320, -400), "out to the apron's edge");
  assert.ok(!occupancy.blocked(340, -400), "and no further");
});

test("an unknown landmark kind is skipped, not fatal", () => {
  const near = new ChunkedMesh();
  const result = buildLandmarks([{ id: "x", kind: "nothing", center: [0, 0], apron: 10 }], { terrain: FLAT, near, far: null, bright: null, occupancy: new Occupancy(), water: 0 });
  assert.deepEqual(result.movers, []);
  assert.equal(near.vertexCount, 0);
});

// The real map.
const network = roadNetworkOf(VALLEY);
const on = buildWorld(new RouteGeometry(ROUTE), { network, scenery: floraOf(SCENES, "temperate") });
const lighthouse = network.landmarks.find((l) => l.kind === "lighthouse");

test("the map has a lighthouse on the cape", () => {
  assert.ok(lighthouse, "a lighthouse is in the map");
  assert.deepEqual(lighthouse.center, [4850, 3900], "map y is north-up, world z is −y");
});

test("every landmark stands on dry ground clear of the roads", () => {
  for (const l of network.landmarks.filter((m) => m.kind !== "seaArch")) {
    const height = on.terrain.height(l.center[0], l.center[1]);
    assert.ok(height > on.waterLevel + 2, `${l.id} is ${height.toFixed(1)} m, water is ${on.waterLevel}`);
    assert.ok(on.terrain.distanceToRoad(l.center[0], l.center[1]) >= l.apron, `${l.id} is clear of the roads`);
  }
});

test("the lighthouse is in the village groups and its lamp in the bright group", () => {
  const near = (chunks) => (chunks ?? []).some((c) => Math.hypot(c.center[0] - lighthouse.center[0], c.center[2] - lighthouse.center[1]) < 60 && c.mesh.vertexCount > 0);
  assert.ok(near(on.chunks.village), "near twin");
  assert.ok(near(on.chunks.villageFar), "far twin");
  assert.ok(near(on.chunks.bright), "lamp");
  assert.deepEqual(on.movers, []);
});

test("no tree, cover or prop stands within the lighthouse's apron", () => {
  const [cx, cz] = lighthouse.center;
  for (const group of ["scenery", "sceneryFar", "cover", "detail"]) {
    for (const chunk of on.chunks[group] ?? []) {
      for (const batch of chunk.batches ?? []) {
        for (let i = 0; i < batch.matrices.length; i += 16) {
          const d = Math.hypot(batch.matrices[i + 12] - cx, batch.matrices[i + 14] - cz);
          assert.ok(d >= lighthouse.apron, `${group} instance ${d.toFixed(1)} m from the lighthouse`);
        }
      }
    }
  }
});

test("scenery off builds no landmarks and no movers", () => {
  const off = buildWorld(new RouteGeometry(ROUTE), { network });
  assert.equal(off.movers, undefined);
  assert.equal(off.chunks.village, undefined);
});
