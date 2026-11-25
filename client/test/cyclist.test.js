import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { BIKE_TYPES, bikeGeometry, createBike } from "../public/js/view3d/assets/riders/bicycle.js";
import { createCyclist } from "../public/js/view3d/assets/riders/cyclist.js";
import { RIDERS } from "../public/js/view3d/assets/riders/index.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { WORKBENCH_ASSETS } from "../public/js/workbenchState.js";

const TAU = Math.PI * 2;
/** Where the foot's ball is on its bone, as the rig measures contact. */
const BALL = 0.1717;
const uniforms = createSharedUniforms();
const build = (id, seed = id) => {
  const tracker = createTracker();
  const owner = createOwner(tracker.track);
  return { cyclist: createCyclist(lookOf(id), { own: owner.own, uniforms, seed }), tracker, owner };
};
const state = (extra) => ({ cadence: 90, speed: 8, grade: 0, t: 0, near: true, ...extra });
const wrap = (angle) => ((angle % TAU) + TAU + Math.PI) % TAU - Math.PI;
const bone = (cyclist, name) => {
  let found;
  cyclist.rider.object.traverse((child) => {
    if (child.isBone && child.name === name) found = child;
  });
  return found;
};

test("both wheels touch the ground", () => {
  for (const type of Object.keys(BIKE_TYPES)) {
    const fit = bikeGeometry(type, { scale: 1 });
    assert.ok(Math.abs(fit.rear.y - fit.wheelRadius) <= 0.005, `${type} rear`);
    assert.ok(Math.abs(fit.front.y - fit.wheelRadius) <= 0.005, `${type} front`);
  }
});

test("cadence turns the cranks", () => {
  const { cyclist } = build(3);
  const before = cyclist.crank;
  cyclist.ride(0.5, state());
  const turned = ((before - cyclist.crank) % TAU + TAU) % TAU;
  assert.ok(Math.abs(wrap(turned - (90 / 60) * TAU * 0.5)) < 1e-6, `turned ${turned}`);
});

test("a stopped rider holds the pedals level with the feet on them", () => {
  const { cyclist } = build(3);
  for (let i = 0; i < 60; i += 1) cyclist.ride(0.1, state({ cadence: 0, speed: 0 }));
  assert.ok(Math.abs(Math.sin(cyclist.crank)) < 0.05, `crank ${cyclist.crank}`);
  cyclist.object.updateMatrixWorld(true);
  const ball = new THREE.Vector3(0, BALL, 0).applyMatrix4(bone(cyclist, "foot_R").matrixWorld);
  const pedal = cyclist.bike.pedals[1].getWorldPosition(new THREE.Vector3());
  assert.ok(ball.distanceTo(pedal) < 0.04, `foot ${ball.distanceTo(pedal)} from the pedal`);
});

test("on a steep climb or descent the wheels stay on the slope", () => {
  for (const grade of [12, -12]) {
    const { cyclist } = build(5);
    cyclist.ride(0.1, state({ grade }));
    cyclist.object.rotation.z = Math.atan(grade / 100);
    cyclist.object.updateMatrixWorld(true);
    const slope = new THREE.Matrix4().copy(cyclist.object.matrixWorld).invert();
    for (const wheel of [cyclist.bike.rearWheel, cyclist.bike.frontWheel]) {
      let lowest = Infinity;
      wheel.traverse((child) => {
        if (!child.isMesh) return;
        const position = child.geometry.attributes.position;
        const point = new THREE.Vector3();
        for (let i = 0; i < position.count; i += 1) {
          point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).applyMatrix4(slope);
          lowest = Math.min(lowest, point.y);
        }
      });
      assert.ok(Math.abs(lowest) < 0.02, `grade ${grade}: wheel bottom ${lowest} above the slope line`);
    }
    const hips = cyclist.rider.boneWorld("hips");
    cyclist.rider.object.localToWorld(hips);
    const saddle = cyclist.bike.object.localToWorld(cyclist.bike.fit.saddle.clone());
    assert.ok(hips.y > saddle.y, `grade ${grade}: hips ${hips.y} over the saddle ${saddle.y}`);
  }
});

test("standing is the same for the same seed", () => {
  const trace = (seed) => {
    const { cyclist } = build(2, seed);
    const out = [];
    for (let i = 0; i < 400; i += 1) {
      cyclist.ride(0.05, state({ cadence: 70, grade: 9, t: i * 0.05 }));
      out.push(cyclist.standing);
    }
    return out;
  };
  const first = trace(7);
  assert.deepEqual(trace(7), first);
  assert.ok(Math.max(...first) > 0.5, "the seeded rider does stand now and then");
});

test("far riders skip the body", () => {
  const { cyclist } = build(4);
  cyclist.ride(0.1, state());
  const matrices = () => bone(cyclist, "thigh_R").matrix.toArray().concat(bone(cyclist, "hand_L").matrix.toArray());
  const before = matrices();
  const crank = cyclist.crank;
  cyclist.ride(0.1, state({ near: false }));
  assert.deepEqual(matrices(), before);
  assert.notEqual(cyclist.crank, crank);
});

test("the bike exposes the wheels, the steering and the pedals", () => {
  const owner = createOwner();
  const bike = createBike({ type: "city", own: owner.own, uniforms });
  bike.setSteer(0.2);
  bike.setWheels(10);
  bike.setCrank(1, 0.1, 0.2);
  assert.equal(bike.pedals.length, 2);
  assert.ok(Math.abs(bike.crank.rotation.z - 1) < 1e-9);
});

test("everything a cyclist made is freed with its owner", () => {
  const { owner, tracker } = build(6);
  assert.ok(tracker.live() > 0);
  owner.disposeAll();
  assert.equal(tracker.live(), 0);
});

test("the workbench lists the rider and the cyclist", () => {
  for (const id of ["rider", "cyclist"]) {
    assert.equal(WORKBENCH_ASSETS[id], RIDERS[id]);
    assert.equal(WORKBENCH_ASSETS[id].meta.id, id);
  }
});
