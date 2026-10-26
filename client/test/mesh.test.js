import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { dot, sub } from "../public/js/view3d/math.js";

/** Every face normal must point away from `inside`. */
function assertOutward(mesh, inside) {
  for (let i = 0; i < mesh.vertexCount; i += 3) {
    const centroid = [0, 1, 2].map((axis) => (mesh.positions[i * 3 + axis] + mesh.positions[(i + 1) * 3 + axis] + mesh.positions[(i + 2) * 3 + axis]) / 3);
    const normal = [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]];
    assert.ok(dot(normal, sub(centroid, inside)) > -1e-9, `triangle ${i / 3} faces inwards`);
  }
}

test("boxes have 12 outward-facing triangles", () => {
  const mesh = new MeshBuilder();
  mesh.box([1, 2, 3], [2, 1, 4], [1, 0, 0]);
  const built = mesh.build();
  assert.equal(built.vertexCount, 36);
  assertOutward(built, [1, 2, 3]);
});

test("segments are boxes along the segment, facing outwards", () => {
  const mesh = new MeshBuilder();
  mesh.segment([0, 0, 0], [0, 1, -1], 0.2, 0.1, [1, 1, 1, 1]);
  const built = mesh.build();
  assertOutward(built, [0, 0.5, -0.5]);
  assert.equal(built.colors[3], 1, "alpha carries the tint mask");
});

test("wheels and cones face outwards", () => {
  const wheel = new MeshBuilder();
  wheel.wheel([0, 0.34, 0], 0.34, 0.04, [0, 0, 0]);
  assertOutward(wheel.build(), [0, 0.34, 0]);

  const cone = new MeshBuilder();
  cone.cone([5, 0, 5], 2, 6, [0, 1, 0]);
  assertOutward(cone.build(), [5, 1.5, 5]);
});

test("normals are unit length", () => {
  const mesh = new MeshBuilder();
  mesh.box([0, 0, 0], [1, 2, 3], [1, 1, 1]);
  const { normals } = mesh.build();
  for (let i = 0; i < normals.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(normals[i], normals[i + 1], normals[i + 2]) - 1) < 1e-6);
  }
});

test("ellipsoids face outwards and discs face up", () => {
  const blob = new MeshBuilder();
  blob.ellipsoid([1, 2, 3], [2, 1, 1.5], [0, 1, 0], 4, 8);
  assertOutward(blob.build(), [1, 2, 3]);
  const disc = new MeshBuilder();
  disc.disc([0, 0.1, 0], [1, 2], [0, 0, 0], 12, 0.7);
  const { normals, vertexCount } = disc.build();
  for (let i = 0; i < vertexCount; i += 1) assert.ok(normals[i * 3 + 1] > 0.99);
});
