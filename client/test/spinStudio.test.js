/** The spin studio asset: one storey's room and the glass shell, stacked by a layer; deterministic and leak-free. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { create, createStudioRoom, createStudioShell, meta } from "../public/js/view3d/assets/buildings/spinStudio.js";
import { bikeGeometry } from "../public/js/view3d/assets/riders/bicycle.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { FLOOR_HEIGHT, FOOTPRINT, ROOM, SLAB, seatPosition } from "../public/js/view3d/studioLayout.js";

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

const named = (object, name) => {
  const found = [];
  object.traverse((child) => child.name === name && found.push(child));
  return found;
};

test("the roof sign carries its text and faces the glass front, with a mirror for the back", () => {
  const shell = createStudioShell({ floors: 1, own: (resource) => resource, uniforms: createSharedUniforms() });
  const [front] = named(shell.object, "sign");
  assert.ok(front.material.map?.isTexture, "text texture set");
  const normal = (mesh) => new THREE.Vector3(0, 0, 1).transformDirection(mesh.updateMatrixWorld(true) || mesh.matrixWorld);
  assert.ok(normal(front).z < -0.99, "front text faces -z");
  const [back] = named(shell.object, "sign-back");
  assert.ok(back.material.map?.isTexture, "the back reads too");
  assert.ok(normal(back).z > 0.99, "back text faces +z");
});

test("cutaway takes off the roof, the ceilings and the glass of every storey", () => {
  const cut = create({ track: (resource) => resource, uniforms: createSharedUniforms(), storeys: 3, open: true, cutaway: true });
  assert.equal(named(cut.object, "glass").length, 0);
  assert.equal(named(cut.object, "lit-panel").length, 0, "no ceiling light panels");
  assert.equal(named(cut.object, "sign").length, 0, "no sign floating over the open top");
  const whole = create({ track: (resource) => resource, uniforms: createSharedUniforms(), storeys: 3, open: true, cutaway: false });
  assert.equal(named(whole.object, "glass").length, 3);
  assert.equal(named(whole.object, "lit-panel").length, 3);
});

test("the glass is light and clear", () => {
  const shell = createStudioShell({ floors: 1, own: (resource) => resource, uniforms: createSharedUniforms() });
  const { material } = shell.glass[0];
  assert.ok(material.opacity <= 0.18, `opacity ${material.opacity}`);
  assert.ok(material.color.getHSL({}).l >= 0.6);
});

test("the workbench turns the glass front to the bench camera", () => {
  const entry = create({ track: (resource) => resource, uniforms: createSharedUniforms() });
  assert.equal(entry.object.rotation.y, Math.PI);
});

test("a shell without glass has no front frames either", () => {
  const front = (shell) => {
    let n = 0;
    shell.object.updateMatrixWorld(true);
    shell.object.traverse((child) => {
      if (!child.isMesh || !child.geometry.attributes.position) return;
      const p = child.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 1) if (Math.abs(p.getZ(i) - (FOOTPRINT.front + 0.12)) < 0.12 && p.getY(i) > SLAB + 0.5 && p.getY(i) < FLOOR_HEIGHT - 0.5 && Math.abs(p.getX(i)) < 6) n += 1;
    });
    return n;
  };
  assert.ok(front(createStudioShell({ floors: 1 })) > 0);
  assert.equal(front(createStudioShell({ floors: 1, glass: false })), 0);
});

test("the room owns its trainers' instanced mesh, so disposal frees its instance buffer", () => {
  const owned = new Set();
  const { object } = createStudioRoom({ own: (resource) => (owned.add(resource), resource), uniforms: createSharedUniforms() });
  assert.ok(owned.has(object.getObjectByName("trainer")));
});
