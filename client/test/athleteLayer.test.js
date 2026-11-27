/** Athlete layer: gym riders on the rigged rider, settled on their spot, planted feet, parked bikes, reach, pooling, penguins. */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { PENGUIN_SCALE } from "../public/js/view3d/assets/riders/penguinOutfit.js";
import { CLIPS, clipFor } from "../public/js/view3d/clips.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { poseAt } from "../public/js/view3d/riderPose.js";
import { ATHLETE_REACH, createAthleteLayer } from "../public/js/view3d/scene/athleteLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const make = () => {
  const tracker = createTracker();
  const layer = createAthleteLayer({ settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const camera = new THREE.PerspectiveCamera();
let clock = 0;
const frame = (athletes, dt = 0.1) => {
  clock += dt;
  return { dt, t: clock, camera, focus: [0, 0, 0], athletes };
};
const SOLID_ID = Array.from({ length: 200 }, (_, id) => id + 1).find((id) => lookOf(id).pattern === "solid");
const zero = { root: { y: 0, z: 0, pitch: 0 }, joints: {} };
const entry = (id, position, extra = {}) => ({ id, position, yaw: 0, pose: zero, plantMesh: null, tint: [0.5, 0.5, 0.5], figure: "rider", bike: null, ...extra });
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const worldOf = (layer, id, bone) => {
  layer.object.updateMatrixWorld(true);
  const rig = layer.rigOf(id);
  rig.object.updateMatrixWorld(true);
  return rig.boneWorld(bone).applyMatrix4(rig.object.matrixWorld);
};
/** The lowest world y of the rig's contact points (the rig is only scaled and lifted, never tipped). */
const lowestWorld = (layer, id) => {
  const rig = layer.rigOf(id);
  layer.object.updateMatrixWorld(true);
  const scale = rig.object.getWorldScale(new THREE.Vector3()).y;
  return rig.object.getWorldPosition(new THREE.Vector3()).y + rig.lowestPoint() * scale;
};

test("an athlete stands on its spot, facing its yaw", () => {
  const { layer } = make();
  const yaw = Math.PI / 2;
  layer.update(frame([entry(1, [5, 2, -3], { yaw })]));
  near(lowestWorld(layer, 1), 2, 0.01, "lowest");
  const hips = worldOf(layer, 1, "hips");
  near(hips.x, 5, 0.15, "hips x");
  near(hips.z, -3, 0.15, "hips z");
  // the rig's +x axis in world
  const axis = new THREE.Vector3(1, 0, 0).transformDirection(layer.rigOf(1).object.matrixWorld);
  near(axis.x, -Math.sin(yaw), 0.01, "forward x");
  near(axis.z, -Math.cos(yaw), 0.01, "forward z");
});

test("an athlete with no exercise stands idle", () => {
  const { layer } = make();
  layer.update(frame([entry(1, [0, 1, -10], { pose: poseAt(clipFor(null), 0) })]));
  const head = worldOf(layer, 1, "head");
  assert.ok(head.y - 1 > 1.4, `head ${head.y}`);
});

test("a squat keeps its feet planted", () => {
  const { layer } = make();
  const clip = CLIPS.squats;
  const first = poseAt(clip, 0);
  layer.update(frame([entry(1, [0, 0, -10], { pose: first, plantMesh: "footR" })]));
  const start = worldOf(layer, 1, "foot_R");
  for (let i = 1; i <= 20; i += 1) {
    layer.update(frame([entry(1, [0, 0, -10], { pose: poseAt(clip, (i / 20) * clip.duration), plantMesh: "footR" })]));
    const now = worldOf(layer, 1, "foot_R");
    assert.ok(Math.hypot(now.x - start.x, now.z - start.z) < 0.03, `foot moved at ${i}`);
  }
});

test("the parked bike stands at the rack", () => {
  const { layer } = make();
  layer.update(frame([entry(1, [0, 0, -10], { bike: { position: [8, 2, -3], yaw: 0 } })]));
  layer.object.updateMatrixWorld(true);
  const bike = layer.bikeOf(1);
  assert.ok(bike);
  const front = bike.frontWheel.getWorldPosition(new THREE.Vector3());
  const rear = bike.rearWheel.getWorldPosition(new THREE.Vector3());
  const radius = bike.fit.wheelRadius;
  near(front.y - radius, 2, 0.02, "front wheel bottom");
  near(rear.y - radius, 2, 0.02, "rear wheel bottom");
  const direction = front.sub(rear).normalize();
  assert.ok(direction.distanceTo(new THREE.Vector3(0, 0, -1)) < 0.01, `direction ${direction.toArray()}`);
});

test("athletes past the reach are not drawn and leave no leak", () => {
  const { layer, tracker } = make();
  assert.equal(ATHLETE_REACH, 200);
  layer.update(frame([entry(1, [150, 0, 0]), entry(2, [250, 0, 0])]));
  assert.equal(layer.stats().drawn, 1);
  assert.ok(layer.rigOf(1));
  assert.equal(layer.rigOf(2), null);
  layer.update(frame([entry(7, [10, 0, 0])]));
  const baseline = tracker.live();
  for (let i = 0; i < 10; i += 1) {
    layer.update(frame([]));
    assert.equal(layer.stats().drawn, 0);
    layer.update(frame([entry(7, [10, 0, 0])]));
  }
  assert.equal(tracker.live(), baseline);
});

test("a penguin athlete is dressed and rests on its spot", () => {
  const { layer } = make();
  layer.update(frame([entry(1, [0, 3, -10], { figure: "penguin", pose: poseAt(clipFor(null), 0) })]));
  assert.equal(layer.rigOf(1).mesh.material.visible, false);
  near(lowestWorld(layer, 1), 3, 0.01, "lowest");
  near(layer.rigOf(1).object.scale.y, PENGUIN_SCALE, 1e-6, "scale");
});

test("a changed tint repaints the kit", () => {
  const { layer } = make();
  const pixel = () => {
    const { data, width } = layer.rigOf(SOLID_ID).mesh.material.map.image;
    const at = ((width / 4) * width + width / 4) * 4;
    return [data[at], data[at + 1], data[at + 2]];
  };
  layer.update(frame([entry(SOLID_ID, [5, 0, 0], { tint: [1, 0, 0] })]));
  const before = pixel();
  layer.update(frame([entry(SOLID_ID, [5, 0, 0], { tint: [0, 0, 1] })]));
  const after = pixel();
  assert.notDeepEqual(before, after);
  assert.ok(after[2] > after[0], `blue ${after}`);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make();
  layer.update(frame([entry(1, [5, 0, 0], { bike: { position: [8, 0, 0], yaw: 0 } }), entry(2, [6, 0, 0], { figure: "penguin" })]));
  layer.update(frame([entry(1, [5, 0, 0])]));
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("the body's reach ahead of the spot is 0 for an athlete that is not drawn, and follows a pose for one that is", () => {
  const { layer } = make();
  assert.equal(layer.aheadOf(1), 0);
  layer.update(frame([entry(1, [0, 0, -10], { pose: poseAt(CLIPS.plank, 0), plantMesh: "footR" })]));
  const ahead = layer.aheadOf(1);
  assert.ok(Number.isFinite(ahead) && Math.abs(ahead) > 0.02, `ahead ${ahead}`);
});

test("isolating one athlete hides the others and their bikes until it is lifted", () => {
  const { layer } = make();
  const bike = { position: [3, 0, -10], yaw: 0 };
  layer.update(frame([entry(1, [0, 0, -10], { bike }), entry(2, [2, 0, -10], { bike })]));
  const shown = () => [...new Set(layer.object.children.filter((c) => c.visible).map((c) => c.userData.athlete))].sort();
  assert.deepEqual(shown(), [1, 2]);
  layer.isolate(2);
  assert.deepEqual(shown(), [2]);
  layer.isolate(null);
  assert.deepEqual(shown(), [1, 2]);
});

test("an athlete wears its chosen look, and a new look builds it anew", () => {
  const { layer } = make();
  const look = { ...lookOf(1), bike: "city" };
  layer.update(frame([entry(1, [0, 0, 0], { look, lookKey: "a" })]));
  const first = layer.rigOf(1);
  assert.ok(first);
  layer.update(frame([entry(1, [0, 0, 0], { look: { ...look, height: 1.95 }, lookKey: "b" })]));
  const second = layer.rigOf(1);
  assert.notEqual(second, first);
  assert.equal(second.height, 1.95);
});
