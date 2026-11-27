/** Lemon layer: one instance per lemon at its position and turn, extra ones cut, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";

import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createLemonLayer } from "../public/js/view3d/scene/lemonLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const make = () => {
  const tracker = createTracker();
  const layer = createLemonLayer({ settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker, mesh: layer.object };
};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("each lemon is an instance at its position and turn", () => {
  const { layer, mesh } = make();
  layer.update({ lemons: [{ position: [1, 2, 3], yaw: 0.2 }, { position: [10, 2.5, -7], yaw: 1.1 }] });
  assert.equal(mesh.count, 2);
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  mesh.getMatrixAt(1, matrix);
  matrix.decompose(at, turn, new THREE.Vector3());
  [10, 2.5, -7].forEach((v, i) => near(at.getComponent(i), v, 1e-6, `position ${i}`));
  near(new THREE.Euler().setFromQuaternion(turn, "YXZ").y, 1.1, 1e-6, "yaw");
});

test("more lemons than the capacity are cut, not thrown", () => {
  const { layer, mesh } = make();
  layer.update({ lemons: Array.from({ length: 70 }, (_, i) => ({ position: [i, 0, 0], yaw: 0 })) });
  assert.equal(mesh.count, 64);
  assert.equal(layer.stats().drawn, 64);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make();
  layer.update({ lemons: [{ position: [0, 0, 0], yaw: 0 }] });
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
