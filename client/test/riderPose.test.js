import assert from "node:assert/strict";
import test from "node:test";
import { transformPoint } from "../public/js/view3d/math.js";
import * as model from "../public/js/view3d/riderModel.js";
import { JOINTS, LYING_ROOT_Y, blend, bodyTransforms, poseAt, validClip } from "../public/js/view3d/riderPose.js";

const { BODY_JOINTS, RIDER_GEOMETRY, ridingBodyParts, variantLook } = model;

const look = variantLook(0);
const clip = {
  loopS: 2,
  keys: [
    { t: 0, root: { y: 0, pitch: 0 }, joints: { kneeL: 0 } },
    { t: 1, root: { y: 0.4, pitch: 0 }, joints: { kneeL: -1 } },
    { t: 2, root: { y: 0, pitch: 0 }, joints: {} },
  ],
};
const zeroPose = () => ({ root: { y: 0, z: 0, pitch: 0 }, joints: Object.fromEntries(JOINTS.map((j) => [j, 0])) });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const origin = (model) => [model[12], model[13], model[14]];
const partsByName = (pose) => new Map(bodyTransforms(pose, look).map(({ mesh, model }) => [mesh, model]));
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test("a pose between keys eases", () => {
  // Smoothstep at a quarter of the way: 0.25² · (3 − 0.5) = 0.15625.
  assert.ok(near(poseAt(clip, 0.25).root.y, 0.4 * 0.15625));
});

test("a clip loops", () => {
  assert.ok(near(poseAt(clip, 2.25).joints.kneeL, poseAt(clip, 0.25).joints.kneeL));
});

test("blend at 0 and 1 gives either pose", () => {
  const a = poseAt(clip, 0.3);
  const b = poseAt(clip, 1.0);
  assert.deepEqual([blend(a, b, 0), blend(a, b, 1)], [a, b]);
});

test("the standing pose puts the head on top", () => {
  const parts = partsByName(zeroPose());
  const headY = origin(parts.get("head"))[1];
  const others = [...parts].filter(([name]) => name !== "head").map(([, m]) => origin(m)[1]);
  assert.ok(headY > Math.max(...others) && headY >= 1.55 && headY <= 1.8, `head at ${headY}`);
});

test("a bent knee moves the foot back", () => {
  const bent = zeroPose();
  bent.joints.kneeL = -1.2;
  assert.ok(origin(partsByName(bent).get("footL"))[2] > origin(partsByName(zeroPose()).get("footL"))[2]);
});

test("validClip refuses unknown joints and open loops", () => {
  const unknown = { ...clip, keys: [clip.keys[0], { ...clip.keys[1], joints: { wiggle: 1 } }, clip.keys[2]] };
  const open = { ...clip, keys: [clip.keys[0], clip.keys[1], { ...clip.keys[2], joints: { kneeL: 0.3 } }] };
  assert.deepEqual([validClip(clip), validClip(unknown), validClip(open)], [true, false, false]);
});

test("every upper-body part of the riding rider is posed off the bike", () => {
  const posed = new Set(bodyTransforms(zeroPose(), look).map(({ mesh }) => mesh));
  assert.deepEqual(ridingBodyParts(look).map(({ mesh }) => mesh).filter((name) => !posed.has(name)), []);
});

test("the parts stay connected in any pose", () => {
  const pose = zeroPose();
  Object.assign(pose.root, { y: 0.3, pitch: 0.7 });
  JOINTS.forEach((joint, i) => (pose.joints[joint] = 0.3 + 0.17 * i * (i % 2 ? -1 : 1)));
  const parts = partsByName(pose);
  const J = BODY_JOINTS;
  const { thigh, shin } = RIDER_GEOMETRY;
  // Child origin = the parent's end point, in the parent mesh's own coordinates.
  const links = [
    ["torso", minus(J.neck, J.spine), "head"],
    ["torso", minus(J.shoulderL, J.spine), "upperArmL"],
    ["upperArmL", minus(J.elbowL, J.shoulderL), "forearmL"],
    ["upperArmR", minus(J.elbowR, J.shoulderR), "forearmR"],
    ["pelvis", minus(J.hipR, J.pelvis), "thighR"],
    ["thighL", [0, -thigh, 0], "shinL"],
    ["shinR", [0, -shin, 0], "footR"],
  ];
  const gaps = links
    .map(([parent, end, child]) => [child, Math.hypot(...minus(transformPoint(parts.get(parent), end).slice(0, 3), origin(parts.get(child))))])
    .filter(([, gap]) => gap > 0.001);
  assert.deepEqual(gaps, []);
});

test("a clip that cannot play gives the standing pose", () => {
  const [first] = clip.keys;
  const broken = [{ loopS: 0, keys: clip.keys }, { loopS: 2, keys: [] }, { loopS: 2, keys: [first] }, null];
  assert.deepEqual(broken.map((c) => poseAt(c, 0.5)), broken.map(zeroPose));
});

test("validClip answers keys without joints or root instead of throwing", () => {
  const noJoints = { loopS: 1, keys: [{ t: 0, root: { y: 0, pitch: 0 } }, { t: 1, root: { y: 0, pitch: 0 } }] };
  const noRoot = { loopS: 1, keys: [{ t: 0, joints: {} }, { t: 1, joints: {} }] };
  assert.deepEqual([validClip(noJoints), validClip(noRoot), validClip(null)], [true, false, false]);
});

test("the standing hands hang by the thighs", () => {
  const parts = partsByName(zeroPose());
  const J = BODY_JOINTS;
  const hands = [
    transformPoint(parts.get("forearmL"), minus(J.handL, J.elbowL))[1],
    transformPoint(parts.get("forearmR"), minus(J.handR, J.elbowR))[1],
  ];
  assert.ok(hands.every((y) => y < 0.85 && y > 0.6), `hands at ${hands}`);
});

const MESHES = {
  pelvis: (look) => model.buildPelvis(look),
  torso: (look) => model.buildTorso(look),
  head: (look) => model.buildHead(look),
  upperArmL: (look) => model.buildUpperArm(look, -1),
  upperArmR: (look) => model.buildUpperArm(look, 1),
  forearmL: (look) => model.buildForearm(look, -1),
  forearmR: (look) => model.buildForearm(look, 1),
  thighL: (look) => model.buildThigh(look),
  thighR: (look) => model.buildThigh(look),
  shinL: (look) => model.buildShin(look),
  shinR: (look) => model.buildShin(look),
  footL: () => model.buildShoe(),
  footR: () => model.buildShoe(),
};

test("lying on the back at LYING_ROOT_Y rests on the ground", () => {
  const lying = zeroPose();
  Object.assign(lying.root, { y: LYING_ROOT_Y, pitch: Math.PI / 2 });
  let lowest = Infinity;
  for (const { mesh, model: m } of bodyTransforms(lying, look)) {
    const { positions } = MESHES[mesh](look);
    for (let i = 0; i < positions.length; i += 3) lowest = Math.min(lowest, transformPoint(m, [positions[i], positions[i + 1], positions[i + 2]])[1]);
  }
  assert.ok(lowest >= -0.001 && lowest < 0.03, `lowest point at ${lowest}`);
});
