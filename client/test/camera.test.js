import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { cameraFromMatrices } from "../public/js/view3d/engine/camera.js";

const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
const projection = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test("the camera takes the view and projection as they are", () => {
  const camera = new THREE.Camera();
  cameraFromMatrices(camera, view, projection);
  assert.deepEqual([...camera.matrixWorldInverse.elements], [...view]);
  assert.deepEqual([...camera.projectionMatrix.elements], [...projection]);
});

test("the camera's world matrix and inverse projection follow", () => {
  const camera = new THREE.Camera();
  cameraFromMatrices(camera, view, projection);
  const product = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, camera.matrixWorld);
  assert.ok(product.equals(new THREE.Matrix4()));
  assert.equal(camera.projectionMatrixInverse.elements[0], 0.5);
});
