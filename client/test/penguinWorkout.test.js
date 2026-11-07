import assert from "node:assert/strict";
import test from "node:test";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { CLIPS, settle } from "../public/js/view3d/clips.js";
import { invert, transformPoint } from "../public/js/view3d/math.js";
import * as model from "../public/js/view3d/riderModel.js";
import { bodyTransforms, poseAt } from "../public/js/view3d/riderPose.js";

const rig = resolveBiome("winter").workout;
const MESHES = new Map(Object.entries(rig.parts).map(([name, build]) => [name, build()]));
const vertices = (mesh) => {
  const out = [];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
  return out;
};
/** Every body part of `clip` at `t`, posed and settled as the view poses it. */
const posed = (clip, t) => new Map(bodyTransforms(settle(poseAt(clip, t), clip.plant, MESHES)).map(({ mesh, model: m }) => [mesh, m]));
const lowest = (parts) => Math.min(...[...parts].flatMap(([mesh, m]) => vertices(MESHES.get(mesh)).map((p) => transformPoint(m, p)[1])));
/** Clip times every 20 ms through the loop, and the keys. */
const samples = (clip) => [...Array.from({ length: Math.round(clip.loopS / 0.02) }, (_, i) => i * 0.02), ...clip.keys.map((k) => k.t)];
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test("no penguin clip sinks into the ground", () => {
  const sunk = Object.entries(CLIPS).flatMap(([name, clip]) =>
    samples(clip)
      .map((t) => [name, t, lowest(posed(clip, t))])
      .filter(([, , y]) => y < -0.01),
  );
  assert.deepEqual(sunk, []);
});

test("every penguin key off the ground but a jump's rests on it", () => {
  const floating = Object.entries(CLIPS).flatMap(([name, clip]) =>
    clip.keys
      .filter((k) => k.root.y === 0)
      .map((k) => [name, k.t, lowest(posed(clip, k.t))])
      .filter(([, , y]) => y > 0.01),
  );
  assert.deepEqual(floating, []);
});

test("the penguin's limbs stay connected in every key", () => {
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

test("a penguin's planted feet do not slide on the mat", () => {
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

test("the penguin's flippers keep clear of its head", () => {
  // No flipper vertex inside the box round the head, in the head's own frame.
  // The shoulders sit just under the chin, so leave out the box's neck band.
  const head = vertices(MESHES.get("head"));
  const box = [0, 1, 2].map((k) => [Math.min(...head.map((p) => p[k])), Math.max(...head.map((p) => p[k]))]);
  box[1][0] += (box[1][1] - box[1][0]) * 0.2;
  const flippers = ["upperArmL", "upperArmR", "forearmL", "forearmR"];
  const through = Object.entries(CLIPS).flatMap(([name, clip]) =>
    samples(clip)
      .map((t) => {
        const parts = posed(clip, t);
        const toHead = invert(parts.get("head"));
        const inside = flippers.filter((arm) =>
          vertices(MESHES.get(arm)).some((p) => {
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
