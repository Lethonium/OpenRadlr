import { test } from "node:test";
import assert from "node:assert/strict";

import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createRider } from "../public/js/view3d/assets/riders/rider.js";
import { JOINT_BONES, plantFor, settleOnRig } from "../public/js/view3d/assets/riders/retarget.js";
import { CLIPS, mirrorPose } from "../public/js/view3d/clips.js";
import { JOINTS, poseAt } from "../public/js/view3d/riderPose.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const uniforms = createSharedUniforms();
const tracker = createTracker();
const owner = createOwner(tracker.track);
const rig = createRider(lookOf(3), { own: owner.own, uniforms });
const zero = { root: { y: 0, z: 0, pitch: 0 }, joints: {} };
const at = (name) => rig.boneWorld(name);
const settled = (pose, plant = null) => {
  const result = settleOnRig(rig, pose, plant);
  rig.poseJoints(result);
  return result;
};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("every joint drives at least one bone, and only real ones", () => {
  assert.deepEqual(Object.keys(JOINT_BONES).sort(), [...JOINTS].sort());
  for (const bones of Object.values(JOINT_BONES)) for (const bone of bones) assert.ok(rig.boneWorld(bone), bone);
});

test("the zero pose stands upright", () => {
  settled(zero);
  near(rig.lowestPoint(), 0, 0.01, "lowest");
  const expected = rig.height * 0.875;
  assert.ok(Math.abs(rig.headPos().y - expected) < expected * 0.04, `head ${rig.headPos().y}`);
});

test("a knee bend shows as the shin's angle to the thigh", () => {
  const kneeAngle = () => at("shin_R").sub(at("thigh_R")).normalize().angleTo(at("foot_R").sub(at("shin_R")).normalize());
  settled(zero);
  const bind = kneeAngle(); // the bind pose's knee is a hair off straight
  settled({ ...zero, joints: { kneeR: -1.2 } });
  near(kneeAngle() - bind, 1.2, 0.02, "knee angle");
  assert.ok(at("foot_R").x < at("shin_R").x - 0.2, "the lower leg swings back");
});

test("a hip lift swings the thigh forward", () => {
  settled({ ...zero, joints: { hipL: 1.0 } });
  assert.ok(at("shin_L").x - at("thigh_L").x > 0.25);
});

test("sideways joints raise a limb away from the body", () => {
  settled({ ...zero, joints: { shoulderRz: 1.2 } });
  assert.ok(at("hand_R").z > at("upperArm_R").z + 0.3);
  settled({ ...zero, joints: { shoulderLz: 1.2 } });
  assert.ok(at("hand_L").z < at("upperArm_L").z - 0.3);
});

test("every clip stays on the ground", () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    const plant = plantFor(rig, clip);
    for (let i = 0; i < 12; i += 1) {
      const pose = poseAt(clip, (i / 12) * clip.loopS);
      settled(pose, plant);
      near(rig.lowestPoint(), pose.root.y, 0.01, `${name} ${i}`);
    }
  }
});

test("lying on the back keeps the body flat", () => {
  for (const name of ["situps", "plank"]) {
    const clip = CLIPS[name];
    settled(poseAt(clip, 0), plantFor(rig, clip));
    near(rig.lowestPoint(), 0, 0.01, `${name} lowest`);
    assert.ok(Math.abs(rig.headPos().y - at("foot_R").y) < 0.35, `${name} head ${rig.headPos().y} foot ${at("foot_R").y}`);
  }
});

test("a planted foot holds still", () => {
  const clip = CLIPS.squats;
  const plant = plantFor(rig, clip);
  const xs = [];
  for (let i = 0; i < 12; i += 1) {
    settled(poseAt(clip, (i / 12) * clip.loopS), plant);
    xs.push(at(plant.bone).x);
  }
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.03);
});

test("a mirrored pose mirrors the body", () => {
  const pose = poseAt(CLIPS.low_lunge, 0);
  const straight = {};
  settled(pose);
  for (const name of ["hand_R", "foot_R", "shin_R", "forearm_R", "head"]) straight[name] = at(name);
  settled(mirrorPose(pose));
  for (const name of ["hand", "foot", "shin", "forearm"]) {
    const mirrored = at(`${name}_L`);
    const original = straight[`${name}_R`];
    near(mirrored.x, original.x, 0.01, `${name} x`);
    near(mirrored.y, original.y, 0.01, `${name} y`);
    near(mirrored.z, -original.z, 0.01, `${name} z`);
  }
});

test.after(() => owner.disposeAll());
