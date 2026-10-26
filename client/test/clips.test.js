import assert from "node:assert/strict";
import test from "node:test";
import { invert, transformPoint } from "../public/js/view3d/math.js";
import * as model from "../public/js/view3d/riderModel.js";
import { CLIPS, clipFor, settle } from "../public/js/view3d/clips.js";
import { bodyTransforms, poseAt, validClip } from "../public/js/view3d/riderPose.js";

const look = model.variantLook(0);
const MESHES = {
  pelvis: model.buildPelvis(look),
  torso: model.buildTorso(look),
  head: model.buildHead(look),
  upperArmL: model.buildUpperArm(look, -1),
  upperArmR: model.buildUpperArm(look, 1),
  forearmL: model.buildForearm(look, -1),
  forearmR: model.buildForearm(look, 1),
  thighL: model.buildThigh(look),
  thighR: model.buildThigh(look),
  shinL: model.buildShin(look),
  shinR: model.buildShin(look),
  footL: model.buildShoe(),
  footR: model.buildShoe(),
};
const vertices = (mesh) => {
  const out = [];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
  return out;
};
/** Every body part of `clip` at `t`, posed as the view poses it. */
const posed = (clip, t) => new Map(bodyTransforms(settle(poseAt(clip, t), clip.plant), look).map(({ mesh, model: m }) => [mesh, m]));
const lowest = (parts) => Math.min(...[...parts].flatMap(([mesh, m]) => vertices(MESHES[mesh]).map((p) => transformPoint(m, p)[1])));
/** Clip times every 20 ms through the loop, and the keys. */
const samples = (clip) => [...Array.from({ length: Math.round(clip.loopS / 0.02) }, (_, i) => i * 0.02), ...clip.keys.map((k) => k.t)];
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test("every clip is valid and loops", () => {
  const loops = Object.fromEntries(Object.entries(CLIPS).map(([name, clip]) => [name, validClip(clip) && clip.loopS]));
  assert.deepEqual(loops, { idle: 4, squats: 2.5, situps: 2.5, pushups: 2, jumping_jacks: 1, plank: 4, burpees: 3.5 });
});

test("unknown exercises fall back to idle", () => {
  assert.deepEqual([clipFor(null), clipFor(undefined), clipFor("yoga"), clipFor("toString")], [CLIPS.idle, CLIPS.idle, CLIPS.idle, CLIPS.idle]);
});

test("sit-ups lie on the mat", () => {
  const parts = posed(CLIPS.situps, 0);
  const y = (name) => parts.get(name)[13];
  assert.ok(y("pelvis") < 0.25 && y("head") < 0.5, `pelvis at ${y("pelvis")}, head at ${y("head")}`);
});

test("no clip sinks into the ground", () => {
  const sunk = Object.entries(CLIPS).flatMap(([name, clip]) =>
    samples(clip)
      .map((t) => [name, t, lowest(posed(clip, t))])
      .filter(([, , y]) => y < -0.01),
  );
  assert.deepEqual(sunk, []);
});

test("every key off the ground but a jump's rests on it", () => {
  const floating = Object.entries(CLIPS).flatMap(([name, clip]) =>
    clip.keys
      .filter((k) => k.root.y === 0)
      .map((k) => [name, k.t, lowest(posed(clip, k.t))])
      .filter(([, , y]) => y > 0.01),
  );
  assert.deepEqual(floating, []);
});

test("the limbs stay connected in every key", () => {
  const J = model.BODY_JOINTS;
  const { thigh, shin } = model.RIDER_GEOMETRY;
  const links = [
    ["torso", minus(J.neck, J.spine), "head"],
    ["torso", minus(J.shoulderL, J.spine), "upperArmL"],
    ["torso", minus(J.shoulderR, J.spine), "upperArmR"],
    ["upperArmL", minus(J.elbowL, J.shoulderL), "forearmL"],
    ["upperArmR", minus(J.elbowR, J.shoulderR), "forearmR"],
    ["pelvis", minus(J.hipL, J.pelvis), "thighL"],
    ["pelvis", minus(J.hipR, J.pelvis), "thighR"],
    ["thighL", [0, -thigh, 0], "shinL"],
    ["thighR", [0, -thigh, 0], "shinR"],
    ["shinL", [0, -shin, 0], "footL"],
    ["shinR", [0, -shin, 0], "footR"],
  ];
  const gaps = Object.entries(CLIPS).flatMap(([name, clip]) =>
    clip.keys.flatMap((k) => {
      const parts = posed(clip, k.t);
      const origin = (m) => [m[12], m[13], m[14]];
      return links
        .map(([parent, end, child]) => [name, k.t, child, Math.hypot(...minus(transformPoint(parts.get(parent), end), origin(parts.get(child))))])
        .filter(([, , , gap]) => gap > 0.001);
    }),
  );
  assert.deepEqual(gaps, []);
});

test("jumping jacks keep the soles flat", () => {
  // The shoe's up axis (its model's second column) stays vertical, legs together or apart.
  const tilted = samples(CLIPS.jumping_jacks)
    .flatMap((t) => ["footL", "footR"].map((foot) => [t, foot, posed(CLIPS.jumping_jacks, t).get(foot)]))
    .filter(([, , m]) => Math.abs(m[4]) > 0.02);
  assert.deepEqual(tilted.map(([t, foot]) => [t, foot]), []);
});

test("the arms keep clear of the head", () => {
  // No arm vertex inside the box around the head and helmet, in the head's own frame.
  const head = vertices(MESHES.head);
  const box = [0, 1, 2].map((k) => [Math.min(...head.map((p) => p[k])), Math.max(...head.map((p) => p[k]))]);
  const arms = ["upperArmL", "upperArmR", "forearmL", "forearmR"];
  const through = Object.entries(CLIPS).flatMap(([name, clip]) =>
    samples(clip)
      .map((t) => {
        const parts = posed(clip, t);
        const toHead = invert(parts.get("head"));
        const inside = arms.filter((arm) =>
          vertices(MESHES[arm]).some((p) => {
            const local = transformPoint(toHead, transformPoint(parts.get(arm), p));
            return box.every(([lo, hi], k) => local[k] > lo && local[k] < hi);
          }),
        );
        return [name, t, inside];
      })
      .filter(([, , inside]) => inside.length),
  );
  assert.deepEqual(through, []);
});

test("a planted point holds still through the clip", () => {
  // The squat's feet and the push-up's toes do not slide along the mat.
  const drift = ["squats", "pushups"].map((name) => {
    const clip = CLIPS[name];
    const z = samples(clip).map((t) => transformPoint(posed(clip, t).get(clip.plant.mesh), clip.plant.at)[2]);
    return [name, Math.max(...z) - Math.min(...z) < 0.005];
  });
  assert.deepEqual(drift, [
    ["squats", true],
    ["pushups", true],
  ]);
});
