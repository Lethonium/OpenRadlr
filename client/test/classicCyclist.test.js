import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { createClassicCyclist, legPose, RIDER_GEOMETRY } from "../public/js/view3d/assets/riders/classicCyclist.js";
import { RIDERS } from "../public/js/view3d/assets/riders/index.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const TAU = Math.PI * 2;
const uniforms = createSharedUniforms();
const build = (id, seed = id) => {
  const tracker = createTracker();
  const owner = createOwner(tracker.track);
  return { cyclist: createClassicCyclist(lookOf(id), { own: owner.own, uniforms, seed }), tracker, owner };
};
/** The size the classic rider is drawn in: the look's height around the reference, within the old 0.93 to 1.07. */
const sizeOf = (id) => Math.min(1.07, Math.max(0.93, lookOf(id).height / 1.78));
const state = (extra) => ({ cadence: 90, speed: 8, grade: 0, t: 0, near: true, ...extra });
const meshes = (object) => {
  const found = [];
  object.traverse((child) => child.isMesh && found.push(child));
  return found;
};
const named = (object, name) => meshes(object).find((mesh) => mesh.name === name);
const lowest = (object) => {
  object.updateMatrixWorld(true);
  let low = Infinity;
  const point = new THREE.Vector3();
  for (const mesh of meshes(object)) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) low = Math.min(low, point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).y);
  }
  return low;
};

test("the classic cyclist has the cyclist's interface", () => {
  const { cyclist } = build(3);
  assert.ok(cyclist.object.isObject3D);
  assert.ok(cyclist.rider.object.isObject3D);
  assert.ok(cyclist.bike.object.isObject3D);
  assert.equal(typeof cyclist.crank, "number");
  assert.equal(typeof cyclist.standing, "number");
  assert.equal(cyclist.lights, 1);
  cyclist.setLights(0.25);
  assert.equal(cyclist.lights, 0.25);
  assert.doesNotThrow(() => cyclist.setKit(new THREE.Texture()));
  assert.equal(typeof cyclist.setPrimary, "function");
});

test("cadence turns the cranks and moves the legs", () => {
  const { cyclist } = build(3);
  const before = cyclist.crank;
  const thigh = named(cyclist.rider.object, "thighR");
  const shin = named(cyclist.rider.object, "shinR");
  const thighBefore = thigh.rotation.x;
  const shinBefore = shin.rotation.x;
  cyclist.ride(0.5, state());
  const turned = (((before - cyclist.crank) % TAU) + TAU) % TAU;
  assert.ok(Math.abs(turned - (((90 / 60) * TAU * 0.5) % TAU)) < 1e-6, `turned ${turned}`);
  assert.notEqual(thigh.rotation.x, thighBefore);
  assert.notEqual(shin.rotation.x, shinBefore);
  assert.equal(named(cyclist.bike.object, "crankset").rotation.x, cyclist.crank);
});

test("a stopped rider holds the pedals level", () => {
  const { cyclist } = build(3);
  for (let i = 0; i < 60; i += 1) cyclist.ride(0.1, state({ cadence: 0, speed: 0 }));
  assert.ok(Math.abs(Math.sin(cyclist.crank)) < 0.05);
});

test("each foot rides its pedal", () => {
  const { cyclist } = build(3);
  cyclist.ride(0.37, state());
  cyclist.object.updateMatrixWorld(true);
  const phase = -cyclist.crank;
  for (const [side, offset] of [["R", 0], ["L", Math.PI]]) {
    const { pedal, ankle } = legPose(phase + offset);
    const foot = named(cyclist.rider.object, `foot${side}`);
    const at = new THREE.Vector3().setFromMatrixPosition(foot.matrixWorld);
    // the ankle in the old frame (forward -Z) is the foot's origin; the classic frame turns forward onto +x
    assert.ok(Math.abs(at.x - -ankle[2] * sizeOf(3)) < 1e-6 && Math.abs(at.y - ankle[1] * sizeOf(3)) < 1e-6, `foot ${side} at ${at.toArray()}`);
    assert.ok(Math.hypot(ankle[1] - pedal[1], ankle[2] - pedal[2]) < 0.2);
  }
});

test("the knee does not stretch the leg", () => {
  for (let phase = 0; phase < TAU; phase += 0.5) {
    const { knee, ankle } = legPose(phase);
    const hip = RIDER_GEOMETRY.hip;
    assert.ok(Math.abs(Math.hypot(knee[1] - hip[1], knee[2] - hip[2]) - RIDER_GEOMETRY.thigh) < 1e-6);
    assert.ok(Math.abs(Math.hypot(ankle[1] - knee[1], ankle[2] - knee[2]) - RIDER_GEOMETRY.shin) < 1e-6);
  }
});

test("the bike faces +x with the wheels on the ground", () => {
  const { cyclist } = build(2);
  assert.ok(Math.abs(lowest(cyclist.object)) < 0.005, `lowest ${lowest(cyclist.object)}`);
  const front = named(cyclist.bike.object, "wheelFront");
  const rear = named(cyclist.bike.object, "wheelRear");
  const at = (mesh) => new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
  assert.ok(at(front).x > at(rear).x + 0.9 * 0.93);
  assert.ok(Math.abs(at(front).y - 0.34 * sizeOf(2)) < 1e-6);
});

test("the wheels turn with the speed", () => {
  const { cyclist } = build(2);
  const wheel = named(cyclist.bike.object, "wheelFront");
  cyclist.ride(1, state({ speed: 5 }));
  assert.ok(Math.abs(Math.abs(wheel.rotation.x) - 5 / 0.34) < 1e-6);
});

test("rider.object holds the body only: hiding it leaves the bike", () => {
  const { cyclist } = build(4);
  const body = new Set(meshes(cyclist.rider.object));
  const bike = new Set(meshes(cyclist.bike.object));
  assert.ok(body.size > 0 && bike.size > 0);
  for (const mesh of bike) assert.ok(!body.has(mesh));
  cyclist.rider.object.visible = false;
  cyclist.object.updateMatrixWorld(true);
  assert.ok(Array.from(bike).every((mesh) => { let on = true; mesh.traverseAncestors((a) => (on &&= a.visible)); return on; }));
  assert.ok(meshes(cyclist.object).length <= 12, `${meshes(cyclist.object).length} meshes`);
});

test("the jersey takes the primary colour", () => {
  const { cyclist } = build(4);
  const torso = named(cyclist.rider.object, "upper").geometry.attributes.color;
  const before = Array.from(torso.array);
  cyclist.setPrimary("#00ff00");
  assert.notDeepEqual(Array.from(torso.array), before);
  assert.ok(torso.array.some((value, i) => i % 3 === 1 && value > 0.9 && torso.array[i - 1] < 0.05));
});

test("disposing frees every resource", () => {
  const { owner, tracker } = build(6);
  assert.ok(tracker.live() > 0);
  owner.disposeAll();
  assert.equal(tracker.live(), 0);
});

test("the same look and seed ride the same", () => {
  const a = build(5).cyclist;
  const b = build(5).cyclist;
  for (let i = 0; i < 20; i += 1) for (const c of [a, b]) c.ride(0.1, state({ t: i * 0.1, grade: 8 }));
  assert.equal(a.crank, b.crank);
  assert.equal(named(a.rider.object, "shinL").rotation.x, named(b.rider.object, "shinL").rotation.x);
});

test("the workbench lists the classic cyclist", () => {
  const entry = RIDERS["classic-cyclist"];
  assert.equal(entry.meta.id, "classic-cyclist");
  const tracker = createTracker();
  const asset = entry.create({ track: tracker.track });
  asset.update(0.1, 0.1);
  assert.ok(asset.object.isObject3D);
  asset.dispose();
  assert.equal(tracker.live(), 0);
});
