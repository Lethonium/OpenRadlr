/**
 * Plays our exercise clips (`riderPose.js` poses) on the rigged rider and settles them on the ground from the rig itself.
 * The rig's bones turn in `rider.js` (`poseJoints`); this module only decides the height and the planted foot, so every
 * clip stands, lies or rests on the ground whatever its joints do between keys.
 */
export { JOINT_BONES } from "./rider.js";

/** Our clip's mesh names (`footR`, `shinL`) as the rig's bone names (`foot_R`, `shin_L`). */
const boneOfMesh = (mesh) => mesh.replace(/([LR])$/, "_$1");

/**
 * `pose` with `root.y` replaced so the rig's lowest point is `pose.root.y` above the ground (a clip's `root.y` is the
 * height off the ground), and, with `plant`, moved back along the rig's x so that bone's origin sits at `plant.x`.
 * Leaves the rig in the pose it returns.
 */
export function settleOnRig(rig, pose, plant = null) {
  const root = { ...pose.root, y: 0 };
  rig.poseJoints({ ...pose, root });
  root.y = (pose.root.y ?? 0) - rig.lowestPoint();
  if (plant) root.z = (root.z ?? 0) + rig.boneWorld(plant.bone).x - plant.x;
  const settled = { ...pose, root };
  rig.poseJoints(settled);
  return settled;
}

/** The clip's planted bone and where its first key puts it, as `settleOnRig` takes it; `null` for a clip without a plant. */
export function plantFor(rig, clip) {
  if (!clip?.plant) return null;
  const bone = boneOfMesh(clip.plant.mesh);
  const first = clip.keys[0];
  settleOnRig(rig, { root: { y: first.root.y ?? 0, z: first.root.z ?? 0, pitch: first.root.pitch ?? 0 }, joints: first.joints ?? {} });
  return { bone, x: rig.boneWorld(bone).x };
}
