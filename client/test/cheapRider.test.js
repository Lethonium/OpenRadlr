import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { CHEAP_BAKES, bakeCheapRiders } from "../public/js/view3d/assets/riders/cheapRider.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const HALF_PI = Math.PI / 2;
const make = () => {
  const tracker = createTracker();
  const owner = createOwner(tracker.track);
  const riders = bakeCheapRiders({ own: owner.own, uniforms: createSharedUniforms() });
  return { riders, owner, tracker };
};
const meshes = (riders, name) => {
  const found = [];
  riders.object.traverse((child) => {
    if (child.isInstancedMesh && child.name === name) found.push(child);
  });
  return found;
};
const total = (list) => list.reduce((sum, mesh) => sum + mesh.count, 0);
const entry = (extra = {}) => ({ matrix: new THREE.Matrix4(), crank: 0, tint: [1, 1, 1], ...extra });

test("every entry is drawn once", () => {
  const { riders } = make();
  const cranks = [0, 0.3, HALF_PI, 2, Math.PI, -HALF_PI, 5.5];
  riders.set(cranks.map((crank) => entry({ crank })));
  assert.equal(total(meshes(riders, "jersey")), 7);
  assert.equal(total(meshes(riders, "rest")), 7);
  assert.equal(riders.count, 7);
});

test("the jersey carries the tint", () => {
  const { riders } = make();
  riders.set([entry({ tint: [1, 0, 0] })]);
  const jersey = meshes(riders, "jersey").find((mesh) => mesh.count === 1);
  const colour = new THREE.Color();
  jersey.getColorAt(0, colour);
  assert.deepEqual([colour.r, colour.g, colour.b], [1, 0, 0]);
});

test("a baked rider stands where its matrix puts it", () => {
  const { riders } = make();
  riders.set([entry({ matrix: new THREE.Matrix4().makeTranslation(10, 2, -5) })]);
  const rest = meshes(riders, "rest").find((mesh) => mesh.count === 1);
  const instance = new THREE.Matrix4();
  rest.getMatrixAt(0, instance);
  rest.geometry.computeBoundingBox();
  const box = rest.geometry.boundingBox.clone().applyMatrix4(instance);
  assert.ok(box.containsPoint(new THREE.Vector3(10, 2.5, -5)), `box ${box.min.toArray()} .. ${box.max.toArray()}`);
  assert.ok(Math.abs(box.min.y - 2) <= 0.03, `bottom ${box.min.y}`);
});

test("draws stay few", () => {
  const { riders } = make();
  let count = 0;
  riders.object.traverse((child) => {
    if (child.isMesh) count += 1;
  });
  assert.ok(count <= CHEAP_BAKES * 2, `${count} meshes`);
});

test("set([]) hides the batch", () => {
  const { riders } = make();
  riders.set([entry(), entry({ crank: 1 })]);
  riders.set([]);
  assert.equal(total(meshes(riders, "jersey")) + total(meshes(riders, "rest")), 0);
  assert.equal(riders.count, 0);
});

test("the baking cyclist is freed and the bakes free with the owner", () => {
  const { owner, tracker } = make();
  assert.ok(tracker.live() > 0);
  owner.disposeAll();
  assert.equal(tracker.live(), 0);
});
