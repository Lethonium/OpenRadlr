/**
 * Keyframe clip player and forward kinematics for the rider's body off the
 * bike (the café workout). Pure: no GL, no clock; clip time is passed in.
 *
 * Angles are radians. Plain joints rotate about the body's X axis in the sense
 * of `rotationXAbout`: positive swings a hanging limb forward (towards −Z) and
 * tips an upright part backwards. So a hip lifts the thigh with +, a knee bends
 * with −, an elbow bends with +, the spine bends forward with −, and
 * `root.pitch = π/2` lies the body on its back (−π/2: face down). The `…z`
 * joints raise a limb sideways, away from the body (+ on either side); at the
 * ankle they turn the foot the same way, so `ankleLz = −hipLz` keeps the foot
 * of a straight spread leg flat. The root rotates about the ground point between the feet, then
 * moves by `root.y` (up) and the optional `root.z` (back, +Z):
 * lying on the back (`pitch = π/2`) needs `root.y = LYING_ROOT_Y` to keep the
 * helmet out of the ground; face down (`−π/2`) the toes need about 0.08.
 */
import { multiply, placement, rotationXAbout, transformPoint } from "./math.js";
import { BODY_ATTITUDE, BODY_JOINTS, BODY_PARENTS, RIDER_GEOMETRY } from "./riderModel.js";

export const JOINTS = Object.freeze([
  "spine",
  "neck",
  "shoulderL",
  "shoulderLz",
  "elbowL",
  "shoulderR",
  "shoulderRz",
  "elbowR",
  "hipL",
  "hipLz",
  "kneeL",
  "ankleL",
  "ankleLz",
  "hipR",
  "hipRz",
  "kneeR",
  "ankleR",
  "ankleRz",
]);
const KNOWN = new Set(JOINTS);

/** `root.y` that puts a body lying on its back (`root.pitch = π/2`, otherwise the zero pose) on the ground. */
export const LYING_ROOT_Y = 0.22;
/**
 * The arms are modelled short for the riding crouch (about 0.4 m from shoulder
 * to hand); standing, they are stretched along their length to about 0.63 m so
 * the hands hang by the thighs.
 */
const ARM_STRETCH = 1.6;
const STRETCHED = new Set(["upperArmL", "upperArmR", "forearmL", "forearmR"]);

/** Height of the ankle over the ground when the foot stands flat (the sole of `buildFoot`). */
const ANKLE_HEIGHT = 0.06;
/** Pelvis over the ground with straight legs; slightly behind the origin so the feet sit around it. */
const PELVIS = [0, ANKLE_HEIGHT + RIDER_GEOMETRY.thigh + RIDER_GEOMETRY.shin, 0.05];

const rotX = (angle) => rotationXAbout([0, 0, 0], angle);
function rotZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
const stretchY = (k) => new Float32Array([1, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Turns a part's mesh from its modelled attitude to its standing bone frame (arms also stretched). */
const unbake = (part) => (STRETCHED.has(part) ? multiply(stretchY(ARM_STRETCH), rotX(-BODY_ATTITUDE[part])) : rotX(-BODY_ATTITUDE[part]));

/** Mesh that a joint lies in (the part between its parent joint and it). */
const PART_OF_JOINT = { spine: "pelvis", hipL: "pelvis", hipR: "pelvis", neck: "torso", shoulderL: "torso", shoulderR: "torso", elbowL: "upperArmL", elbowR: "upperArmR" };

/**
 * Offset of a joint from its parent joint in the upright standing attitude:
 * the bike-frame offset, with the parent part's modelled attitude undone.
 */
function standingOffset(joint) {
  const riding = minus(BODY_JOINTS[joint], BODY_JOINTS[BODY_PARENTS[joint]]);
  const p = transformPoint(unbake(PART_OF_JOINT[joint]), riding);
  return [p[0], p[1], p[2]];
}
const OFFSETS = Object.fromEntries(Object.keys(PART_OF_JOINT).map((joint) => [joint, standingOffset(joint)]));

const smoothstep = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, w) => a * (1 - w) + b * w;

function fullPose(key) {
  return {
    root: { y: key?.root?.y ?? 0, z: key?.root?.z ?? 0, pitch: key?.root?.pitch ?? 0 },
    joints: Object.fromEntries(JOINTS.map((j) => [j, key?.joints?.[j] ?? 0])),
  };
}

/**
 * Joint angles of `clip` at time `t` (seconds, looping), eased between
 * neighbouring keys. A clip that cannot play (no loop length, fewer than two
 * keys) gives the zero pose: standing straight.
 */
export function poseAt(clip, t) {
  const keys = clip?.keys;
  const loopS = clip?.loopS;
  if (!(loopS > 0) || !Number.isFinite(loopS) || !Array.isArray(keys) || keys.length < 2) return fullPose(null);
  const local = Number.isFinite(t) ? ((t % loopS) + loopS) % loopS : 0;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= local) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const w = span > 0 ? smoothstep(Math.min(1, Math.max(0, (local - a.t) / span))) : 0;
  return blend(fullPose(a), fullPose(b), w);
}

/** Crossfade: `w = 0` gives `a`, `w = 1` gives `b`. */
export function blend(a, b, w) {
  return {
    root: { y: lerp(a.root.y, b.root.y, w), z: lerp(a.root.z ?? 0, b.root.z ?? 0, w), pitch: lerp(a.root.pitch, b.root.pitch, w) },
    joints: Object.fromEntries(JOINTS.map((j) => [j, lerp(a.joints[j] ?? 0, b.joints[j] ?? 0, w)])),
  };
}

/**
 * Every body part for `pose` in the standing frame (origin on the ground
 * between the feet, forward −Z): `mesh` names the part (`ridingBodyParts`
 * names, plus `thighL`/`shinL`/`footL` and the right side for `buildThigh`,
 * `buildShin`, `buildFoot`), `model` places that mesh.
 */
export function bodyTransforms(pose, _look) {
  const q = pose.joints;
  const out = [];
  const add = (mesh, bone) => out.push({ mesh, model: multiply(bone, unbake(mesh)) });
  const child = (parent, offset, ...rotations) => rotations.reduce(multiply, multiply(parent, placement(offset)));

  const root = multiply(placement([0, pose.root.y, pose.root.z ?? 0]), rotX(pose.root.pitch));
  const pelvis = multiply(root, placement(PELVIS));
  add("pelvis", pelvis);
  const torso = child(pelvis, OFFSETS.spine, rotX(q.spine));
  add("torso", torso);
  add("head", child(torso, OFFSETS.neck, rotX(q.neck)));

  for (const [s, side] of [
    ["L", -1],
    ["R", 1],
  ]) {
    const upper = child(torso, OFFSETS[`shoulder${s}`], rotX(q[`shoulder${s}`]), rotZ(side * q[`shoulder${s}z`]));
    add(`upperArm${s}`, upper);
    add(`forearm${s}`, child(upper, OFFSETS[`elbow${s}`], rotX(q[`elbow${s}`])));

    const thigh = child(pelvis, OFFSETS[`hip${s}`], rotX(q[`hip${s}`]), rotZ(side * q[`hip${s}z`]));
    add(`thigh${s}`, thigh);
    const shin = child(thigh, [0, -RIDER_GEOMETRY.thigh, 0], rotX(q[`knee${s}`]));
    add(`shin${s}`, shin);
    add(`foot${s}`, child(shin, [0, -RIDER_GEOMETRY.shin, 0], rotX(q[`ankle${s}`]), rotZ(side * (q[`ankle${s}z`] ?? 0))));
  }
  return out;
}

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const sameKey = (a, b) => {
  const pa = fullPose(a);
  const pb = fullPose(b);
  return pa.root.y === pb.root.y && pa.root.z === pb.root.z && pa.root.pitch === pb.root.pitch && JOINTS.every((j) => pa.joints[j] === pb.joints[j]);
};

/** A clip loops cleanly (first key at 0 equals the last at `loopS`), keys are sorted and name known joints only. */
export function validClip(clip) {
  const keys = clip?.keys;
  if (!finite(clip?.loopS) || clip.loopS <= 0 || !Array.isArray(keys) || keys.length < 2) return false;
  const wellFormed = keys.every(
    (k, i) =>
      finite(k?.t) &&
      (i === 0 || k.t > keys[i - 1].t) &&
      finite(k.root?.y) &&
      finite(k.root?.pitch) &&
      (k.root.z === undefined || finite(k.root.z)) &&
      Object.entries(k.joints ?? {}).every(([name, angle]) => KNOWN.has(name) && finite(angle)),
  );
  return wellFormed && keys[0].t === 0 && keys[keys.length - 1].t === clip.loopS && sameKey(keys[0], keys[keys.length - 1]);
}
