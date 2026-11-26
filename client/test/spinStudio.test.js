/** The spin studio asset: one storey's room and the glass shell, stacked by a layer; deterministic and leak-free. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { create, createStudioRoom, createStudioShell, meta } from "../public/js/view3d/assets/buildings/spinStudio.js";
import { bikeGeometry } from "../public/js/view3d/assets/riders/bicycle.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { FLOOR_HEIGHT, FOOTPRINT, ROOM, seatPosition } from "../public/js/view3d/studioLayout.js";

const EPS = 0.05;
const room = (options = {}) => createStudioRoom({ own: (resource) => resource, uniforms: createSharedUniforms(), ...options });
const boxOf = (object) => new THREE.Box3().setFromObject(object.updateMatrixWorld(true) || object);

test("room has a trainer under every seat's rear axle", () => {
  const { object } = room();
  const trainers = object.getObjectByName("trainer");
  assert.ok(trainers?.isInstancedMesh);
  assert.equal(trainers.count, 16);
  const rear = Math.abs(bikeGeometry("road").rear.x);
  const at = new THREE.Matrix4();
  for (let i = 0; i < 16; i += 1) {
    trainers.getMatrixAt(i, at);
    const position = new THREE.Vector3().setFromMatrixPosition(at);
    const [x, , z] = seatPosition(i);
    assert.ok(Math.abs(position.x - x) < 0.3 && Math.abs(position.z - (z + rear)) < 0.3, `seat ${i}`);
  }
});

test("room stays inside ROOM", () => {
  const box = boxOf(room().object);
  assert.ok(box.min.x >= -ROOM.halfWidth - EPS && box.max.x <= ROOM.halfWidth + EPS);
  assert.ok(box.min.z >= ROOM.front - EPS && box.max.z <= ROOM.back + EPS);
  assert.ok(box.max.y <= ROOM.height + 0.1);
});

test("room without ceiling has nothing near the top", () => {
  assert.ok(boxOf(room({ ceiling: false }).object).max.y < ROOM.height - 0.2);
  assert.ok(boxOf(room({ ceiling: true }).object).max.y > ROOM.height - 0.1);
});

test("a closed room darkens: no emissive left", () => {
  const closed = room();
  const lit = [];
  closed.object.traverse((child) => child.isMesh && child.material.emissive && child.material.emissive.getHex() !== 0 && lit.push(child.material));
  assert.ok(lit.length >= 3);
  closed.setOpen(false);
  for (const material of lit) assert.equal(material.emissiveIntensity, 0);
  closed.setOpen(true);
  for (const material of lit) assert.ok(material.emissiveIntensity > 0);
});

test("the shell stacks its floors", () => {
  const shell = createStudioShell({ floors: 3, own: (resource) => resource, uniforms: createSharedUniforms() });
  assert.equal(shell.glass.length, 3);
  const box = boxOf(shell.object);
  assert.ok(box.max.y >= 3 * FLOOR_HEIGHT);
  assert.ok(box.min.x >= -FOOTPRINT.halfWidth - 1e-6 && box.max.x <= FOOTPRINT.halfWidth + 1e-6);
  assert.ok(box.min.z >= FOOTPRINT.front - 1e-6 && box.max.z <= FOOTPRINT.back + 1e-6);
});

test("it is deterministic", () => {
  const floor = () => room().object.getObjectByName("room").geometry.attributes;
  const [a, b] = [floor(), floor()];
  assert.deepEqual([...a.position.array], [...b.position.array]);
  assert.deepEqual([...a.color.array], [...b.color.array]);
});

test("it frees everything it made", () => {
  const tracker = createTracker();
  const owner = createOwner(tracker.track);
  createStudioRoom({ own: owner.own, uniforms: createSharedUniforms() });
  createStudioShell({ floors: 2, own: owner.own, uniforms: createSharedUniforms() });
  assert.ok(tracker.live() > 0);
  owner.disposeAll();
  assert.equal(tracker.live(), 0);
});

test("the workbench entry builds and disposes", () => {
  assert.equal(meta.id, "spin-studio");
  const tracker = createTracker();
  const entry = create({ track: tracker.track, uniforms: createSharedUniforms(), storeys: 2, open: false, cutaway: true });
  assert.ok(boxOf(entry.object).max.y >= 2 * FLOOR_HEIGHT);
  entry.dispose();
  assert.equal(tracker.live(), 0);
});
