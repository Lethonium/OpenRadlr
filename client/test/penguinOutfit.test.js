import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createRider } from "../public/js/view3d/assets/riders/rider.js";
import { PENGUIN_SCALE, dressAsPenguin } from "../public/js/view3d/assets/riders/penguinOutfit.js";
import { plantFor, settleOnRig } from "../public/js/view3d/assets/riders/retarget.js";
import { CLIPS } from "../public/js/view3d/clips.js";
import { poseAt } from "../public/js/view3d/riderPose.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const uniforms = createSharedUniforms();

function dressed(scarf = "#3366cc") {
  const tracker = createTracker();
  const owner = createOwner(tracker.track);
  const rig = createRider(lookOf(5), { own: owner.own, uniforms });
  dressAsPenguin(rig, { own: owner.own, uniforms, scarf });
  return { rig, tracker, owner };
}

const penguinMeshes = (rig) => {
  const found = [];
  rig.object.traverse((node) => {
    if (node.userData.penguin) found.push(node);
  });
  return found;
};

test("a penguin hides the rider and rides the bones", () => {
  const { rig } = dressed();
  assert.equal(rig.mesh.visible, false);
  assert.equal(rig.object.scale.x, PENGUIN_SCALE);
  const meshes = penguinMeshes(rig);
  assert.ok(meshes.length >= 8);
  for (const mesh of meshes) assert.ok(mesh.parent instanceof THREE.Bone, mesh.name);
  const parents = new Set(meshes.map((mesh) => mesh.parent.name));
  for (const bone of ["hips", "chest", "head", "upperArm_L", "forearm_R", "foot_L"]) assert.ok(parents.has(bone), bone);
});

test("helmet and glasses are hidden with the rider", () => {
  const { rig } = dressed();
  const helmets = [];
  rig.object.traverse((node) => {
    if (node.isMesh && node !== rig.mesh && !node.userData.penguin) helmets.push(node);
  });
  for (const node of helmets) assert.equal(node.visible, false);
});

test("penguins stay on the ground in every clip", () => {
  const { rig } = dressed();
  for (const [name, clip] of Object.entries(CLIPS)) {
    const plant = plantFor(rig, clip);
    for (let i = 0; i < 12; i += 1) {
      const pose = poseAt(clip, (i / 12) * clip.loopS);
      settleOnRig(rig, pose, plant);
      assert.ok(Math.abs(rig.lowestPoint() - pose.root.y) <= 0.01, `${name} ${i}: ${rig.lowestPoint()} vs ${pose.root.y}`);
    }
  }
});

test("the scarf takes the tint", () => {
  const { rig } = dressed("#ff0000");
  const red = penguinMeshes(rig).some((mesh) => mesh.material.color?.getHexString() === "ff0000");
  assert.ok(red);
});

test("dispose frees the penguin", () => {
  const { rig, tracker, owner } = dressed();
  const geometries = penguinMeshes(rig).map((mesh) => mesh.geometry);
  let freed = 0;
  for (const geometry of geometries) geometry.addEventListener("dispose", () => { freed += 1; });
  owner.disposeAll();
  assert.equal(freed, geometries.length);
  assert.equal(tracker.live(), 0);
});

test("the workbench offers the penguin figure", async () => {
  const { create, meta } = await import("../public/js/view3d/assets/riders/rider.js");
  assert.deepEqual([...meta.options.figure.values], ["rider", "penguin"]);
  const tracker = createTracker();
  const bench = create({ track: tracker.track, uniforms, figure: "penguin", pose: "stand" });
  assert.equal(bench.object.scale.x, PENGUIN_SCALE);
  bench.dispose();
  assert.equal(tracker.live(), 0);
});
