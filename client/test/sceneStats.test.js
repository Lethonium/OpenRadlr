import assert from "node:assert/strict";
import test from "node:test";
import { meshByteLength, sceneStats } from "../public/js/view3d/sceneStats.js";

const triangle = {
  positions: new Float32Array(9),
  normals: new Float32Array(9),
  colors: new Float32Array(12),
  vertexCount: 3,
};
const empty = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  vertexCount: 0,
};

test("a flat mesh's upload is its position, normal and colour buffers", () => {
  assert.equal(meshByteLength(triangle), 120);
  assert.equal(meshByteLength(empty), 0);
});

test("scene stats count every drawable mesh once", () => {
  const stats = sceneStats({
    chunks: { road: [{ mesh: triangle }, { mesh: triangle }], detail: [] },
    meshes: { horizon: triangle },
    clouds: triangle,
    water: empty,
    rivers: triangle,
    spectatorMeshes: [triangle, empty],
    weather: { data: new Float32Array(12) },
  });

  assert.deepEqual(stats.groups.road, { meshes: 2, vertices: 6, triangles: 2, bytes: 240 });
  assert.deepEqual(stats.groups.detail, { meshes: 0, vertices: 0, triangles: 0, bytes: 0 });
  assert.deepEqual(stats.groups.horizon, { meshes: 1, vertices: 3, triangles: 1, bytes: 120 });
  assert.deepEqual(stats.groups.spectatorMeshes, { meshes: 2, vertices: 3, triangles: 1, bytes: 120 });
  assert.deepEqual(stats.total, { meshes: 8, vertices: 18, triangles: 6, bytes: 720 });
  assert.deepEqual(stats.weather, { vertices: 2, bytes: 48 });
  assert.equal(stats.uploadBytes, 768, "mesh and weather uploads");
  assert.deepEqual(stats.instances, { models: 0, placements: 0, vertices: 0, bytes: 0, transformBytes: 0 });
});

test("instance stats keep expanded geometry separate from the actual upload", () => {
  const stats = sceneStats({
    chunks: { scenery: [{ mesh: empty, batches: [{ model: 0, matrices: new Float32Array(32) }] }] },
    instanceModels: [{ mesh: triangle }],
  });

  assert.deepEqual(stats.groups.scenery, { meshes: 1, vertices: 6, triangles: 2, bytes: 240 });
  assert.deepEqual(stats.instances, { models: 1, placements: 2, vertices: 3, bytes: 120, transformBytes: 128 });
  assert.equal(stats.uploadBytes, 248, "128 matrix bytes + 120 shared-model bytes; no second model copy");
});

test("an empty scene reports zeroes rather than inventing groups", () => {
  const stats = sceneStats({ chunks: {}, meshes: {} });
  assert.deepEqual(stats.groups, {});
  assert.deepEqual(stats.total, { meshes: 0, vertices: 0, triangles: 0, bytes: 0 });
  assert.deepEqual(stats.weather, { vertices: 0, bytes: 0 });
});
