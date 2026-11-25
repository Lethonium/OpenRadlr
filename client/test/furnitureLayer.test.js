/** Furniture layer: rails are instances from a to b, sign faces light up at night, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createFurnitureLayer } from "../public/js/view3d/scene/furnitureLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const furniture = {
  rails: [{ a: [0, 1, 0], b: [4, 1, 0] }, { a: [4, 1, 0], b: [8, 2, 1] }, { a: [8, 2, 1], b: [12, 2, 3] }],
  signs: [{ kind: "warning", position: [3, 0, 8], yaw: 0.5 }, { kind: "village", position: [9, 0, 8], yaw: 1 }],
  flammeRouge: { position: [20, 0, 0], yaw: 0.2, halfWidth: 7 },
  barriers: [],
};
const make = (world = { biome: "temperate", furniture }) => {
  const tracker = createTracker();
  const layer = createFurnitureLayer(world, { biome: resolveBiome("temperate"), settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};

test("each rail segment is one instance from a to b", () => {
  const { layer } = make();
  const beams = layer.object.getObjectByName("rails");
  assert.equal(beams.count, 3);
  const matrix = new THREE.Matrix4();
  beams.getMatrixAt(0, matrix);
  const at = (x) => new THREE.Vector3(x, 0, 0).applyMatrix4(matrix);
  assert.ok(at(0).distanceTo(new THREE.Vector3(2, 1, 0)) < 1e-6, "centre at the midpoint");
  assert.ok(at(-0.5).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-3, "one end at a");
  assert.ok(at(0.5).distanceTo(new THREE.Vector3(4, 1, 0)) < 1e-3, "other end at b");
});

test("night lights the sign faces", () => {
  const { layer } = make();
  const face = layer.object.getObjectByName("warning-faces").material;
  layer.setEnvironment({ night: 0 });
  const day = face.emissiveIntensity;
  layer.setEnvironment({ night: 1 });
  assert.ok(face.emissiveIntensity > day, `${face.emissiveIntensity} > ${day}`);
});

test("signs and the flamme rouge are drawn once each", () => {
  const { layer } = make();
  assert.equal(layer.object.getObjectByName("warning-faces").count, 1);
  assert.equal(layer.object.getObjectByName("village-faces").count, 1);
  assert.ok(layer.object.getObjectByName("flamme-rouge"));
  assert.equal(make({ biome: "temperate", furniture: { ...furniture, flammeRouge: null } }).layer.object.getObjectByName("flamme-rouge"), undefined);
});

test("each crowd barrier is a board and a post, coloured by its stripe", () => {
  const barriers = [{ a: [0, 1, 4], b: [3, 1, 4], color: [0.9, 0.1, 0.1] }, { a: [3, 1, 4], b: [6, 1, 4], color: [0.1, 0.1, 0.9] }];
  const { layer } = make({ biome: "temperate", furniture: { ...furniture, barriers } });
  const boards = layer.object.getObjectByName("barriers");
  assert.equal(boards.count, 2);
  assert.equal(layer.object.getObjectByName("barrier-posts").count, 2);
  const colour = new THREE.Color();
  boards.getColorAt(1, colour);
  assert.ok(Math.abs(colour.b - 0.9) < 1e-6);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make();
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
