/**
 * The rigged rider: one SkinnedMesh on a real skeleton
 *   hips > spine > chest > neck > head, chest > clavicle > upperArm > forearm > hand (L/R), hips > thigh > shin > foot (L/R)
 * Height and weight drive proportions and girth; the kit is painted into one texture (`kitPainter.js`), the helmet and
 * glasses ride on the head bone. Forward +x, up +y, the rider's right +z, feet on y = 0 (the reference's frame; the
 * cyclist turns it into the road's).
 * Posing works in the model's own space: `setBone` places any bone, `solveTwoBone` solves the two-bone chains, and
 * `poseRide` / `poseStand` build complete poses (the cyclist calls `poseRide` every frame with its bike's contact points).
 * Ported from the reference's `creatures/rider.js` without its exercise poses (part 2 retargets our own clips).
 */
import * as THREE from "../../../three.js";
import { colour, merge } from "../geom.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";
import { createOwner } from "../owner.js";
import { bikeGeometry } from "./bicycle.js";
import { KIT_ATLAS, kitTexture } from "./kitPainter.js";
import { dressAsPenguin } from "./penguinOutfit.js";

/** The 19 bones, parents before children. */
export const RIG_BONES = Object.freeze([
  "hips", "spine", "chest", "neck", "head",
  "clavicle_L", "upperArm_L", "forearm_L", "hand_L",
  "clavicle_R", "upperArm_R", "forearm_R", "hand_R",
  "thigh_L", "shin_L", "foot_L",
  "thigh_R", "shin_R", "foot_R",
]); // i18n-ok

/**
 * Which bones each joint of our clips (`riderPose.js` `JOINTS`) turns; a joint on several bones shares its angle equally.
 * Plain joints rotate about the rig's side axis (z), the `…z` joints about its forward axis (x).
 */
export const JOINT_BONES = Object.freeze({
  spine: ["spine", "chest"], neck: ["neck"],
  shoulderL: ["upperArm_L"], shoulderLz: ["upperArm_L"], elbowL: ["forearm_L"],
  shoulderR: ["upperArm_R"], shoulderRz: ["upperArm_R"], elbowR: ["forearm_R"],
  hipL: ["thigh_L"], hipLz: ["thigh_L"], kneeL: ["shin_L"], ankleL: ["foot_L"], ankleLz: ["foot_L"],
  hipR: ["thigh_R"], hipRz: ["thigh_R"], kneeR: ["shin_R"], ankleR: ["foot_R"], ankleRz: ["foot_R"],
}); // i18n-ok

const BONE_PARENT = Object.freeze({
  spine: "hips", chest: "spine", neck: "chest", head: "neck",
  clavicle_L: "chest", upperArm_L: "clavicle_L", forearm_L: "upperArm_L", hand_L: "forearm_L",
  clavicle_R: "chest", upperArm_R: "clavicle_R", forearm_R: "upperArm_R", hand_R: "forearm_R",
  thigh_L: "hips", shin_L: "thigh_L", foot_L: "shin_L",
  thigh_R: "hips", shin_R: "thigh_R", foot_R: "shin_R",
}); // i18n-ok

const BONE_INDEX = Object.freeze(Object.fromEntries(RIG_BONES.map((name, index) => [name, index])));

/**
 * What a bike gives the rider (the reference's `geometryFor` result, in the bike's frame: x forward, y up, z to the
 * rider's right, the bottom bracket at `bb`).
 * @typedef {object} RiderFit
 * @property {{grip?: string}} T the bike type; `grip` is its default hand position
 * @property {import("../../../three.js").Vector3} bb bottom bracket
 * @property {import("../../../three.js").Vector3} sd seat tube direction (unit)
 * @property {import("../../../three.js").Vector3} saddle saddle top
 * @property {Record<string, import("../../../three.js").Vector3[]>} grips `[left, right]` points by hand position
 *   (`hoods`, `drops`, `tops`, `flat`, `aero`; `pads` carries the aero forearm rests)
 * @property {number} crankLen crank length in metres
 * @property {number} q half the distance between the pedals
 */

/**
 * @typedef {object} RideState
 * @property {number} [crank] crank angle in radians (the right pedal's, 0 = forward)
 * @property {string} [grip] hand position, one of the fit's `grips`
 * @property {number} [standing] 0 seated .. 1 out of the saddle
 * @property {boolean} [coast] feet level, no pedalling
 * @property {number} [lookYaw] head turn in radians
 * @property {number} [t] time in seconds for the small sways
 */

/**
 * @typedef {object} RiderRig
 * @property {import("../../../three.js").Group} object
 * @property {import("../../../three.js").SkinnedMesh} mesh
 * @property {number} height
 * @property {number} eyeHeight
 * @property {(fit: RiderFit, state?: RideState) => {pitchL: number, pitchR: number}} poseRide pedal pitch is for the shoes' cleats
 * @property {(t?: number, options?: {wave?: boolean}) => void} poseStand
 * @property {(pose: {root: {y?: number, z?: number, pitch?: number}, joints: Record<string, number>}) => void} poseJoints
 *   poses the whole body from one of our clip poses (`riderPose.js` shape; missing joints count as 0)
 * @property {{bone: string, local: import("../../../three.js").Vector3}[]} contactPoints skin extremes per bone, in the bone's bind frame
 * @property {() => number} lowestPoint lowest contact point's height in the model's frame, in the current pose
 * @property {(fit: RiderFit) => number} saddleFor metres along the seat tube that give about a 30 degree knee bend at the stroke's bottom
 * @property {(out?: import("../../../three.js").Vector3) => import("../../../three.js").Vector3} headPos head joint in the model's frame
 * @property {(name: string, out?: import("../../../three.js").Vector3) => import("../../../three.js").Vector3} boneWorld
 *   joint of a bone in the model's frame (the rider's `object` frame, not the scene's)
 * @property {(texture: import("../../../three.js").Texture) => void} setTexture swaps the kit texture (the caller owns it)
 */

const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Standing joint positions in units of body height (arms hanging). */
const BIND_UNITS = Object.freeze({
  hips: [0, 0.53, 0], spine: [-0.004, 0.61, 0], chest: [-0.006, 0.7, 0], neck: [-0.004, 0.835, 0], head: [0.004, 0.875, 0], headEnd: [0.008, 1, 0],
});
/** The per-side joints: x, y and the lateral offset (times the side's sign). */
const BIND_SIDE_UNITS = Object.freeze({
  clav: [0, 0.805, 0.02], shoulder: [-0.006, 0.812, 0.118], elbow: [-0.02, 0.625, 0.135], wrist: [0, 0.485, 0.142], handEnd: [0.012, 0.392, 0.142],
  hip: [0, 0.515, 0.053], knee: [0.006, 0.288, 0.056], ankle: [-0.006, 0.044, 0.058], ball: [0.085, 0.012, 0.062],
});
const SIDES = Object.freeze([[-1, "L"], [1, "R"]]);

/** Bind-pose joints of a rider of height `height`. */
function bindJoints(height) {
  const joints = {};
  for (const [name, [x, y, z]] of Object.entries(BIND_UNITS)) joints[name] = vec(x, y, z).multiplyScalar(height);
  for (const [sign, side] of SIDES) {
    for (const [name, [x, y, z]] of Object.entries(BIND_SIDE_UNITS)) joints[`${name}_${side}`] = vec(x, y, sign * z).multiplyScalar(height);
  }
  return joints;
}

const axisX = vec();
const axisY = vec();
const axisZ = vec();
const scratchScale = vec();
const scratchInverse = new THREE.Matrix4();

/** An orthonormal bone frame: y along the bone, x as close as possible to `xHint`. */
function boneFrame(yDir, xHint, out = new THREE.Matrix4()) {
  axisY.copy(yDir).normalize();
  axisX.copy(xHint).addScaledVector(axisY, -xHint.dot(axisY));
  if (axisX.lengthSq() < 1e-8) axisX.set(axisY.y, -axisY.x, 0);
  axisX.normalize();
  axisZ.crossVectors(axisX, axisY);
  return out.makeBasis(axisX, axisY, axisZ);
}

// ---------- skinned mesh: lofted rings with per-ring bone weights and atlas UVs

const createAccumulator = () => ({ position: [], uv: [], skinIndex: [], skinWeight: [], index: [], seams: [] });

/** Pushes four (bone, weight) pairs, normalised, for one vertex. */
function pushWeights(acc, weights) {
  const four = weights.slice(0, 4);
  while (four.length < 4) four.push([0, 0]);
  const total = four.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  acc.skinIndex.push(...four.map(([bone]) => BONE_INDEX[bone] ?? 0));
  acc.skinWeight.push(...four.map(([, weight]) => weight / total));
}

/** UVs stay this far inside their atlas region, so filtering never reaches the neighbouring part (no seam lines). */
const UV_INSET = 1.5 / 256;
const inset = ([u0, u1, v0, v1]) => [u0 + UV_INSET, u1 - UV_INSET, v0 + UV_INSET, v1 - UV_INSET];

/**
 * A tube through `rings` (each `{c: centre, t: tangent, a: first axis, rx, ry, w: [bone, weight][], v, u?}`) with `segments`
 * around, UVs into `region`, optionally capped.
 */
function loft(acc, rings, segments, region, { capStart = false, capEnd = false } = {}) {
  const base = acc.position.length / 3;
  const side = vec();
  const point = vec();
  const [u0, u1, v0, v1] = inset(region);
  for (const ring of rings) {
    side.crossVectors(ring.t, ring.a);
    for (let j = 0; j <= segments; j += 1) {
      const angle = (j / segments) * Math.PI * 2;
      point.copy(ring.c).addScaledVector(ring.a, Math.cos(angle) * ring.rx).addScaledVector(side, Math.sin(angle) * ring.ry);
      acc.position.push(point.x, point.y, point.z);
      acc.uv.push(u0 + (u1 - u0) * (ring.u ?? j / segments), v0 + (v1 - v0) * ring.v);
      pushWeights(acc, ring.w);
    }
  }
  const stride = segments + 1;
  for (let k = 0; k < rings.length - 1; k += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = base + k * stride + j;
      const c = a + stride;
      acc.index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  for (let k = 0; k < rings.length; k += 1) acc.seams.push([base + k * stride, base + k * stride + segments]);
  const cap = (k, direction) => {
    const ring = rings[k];
    const centre = acc.position.length / 3;
    const middle = ring.c.clone().addScaledVector(ring.t, direction * Math.min(ring.rx, ring.ry) * 0.5);
    acc.position.push(middle.x, middle.y, middle.z);
    acc.uv.push(u0 + (u1 - u0) * 0.5, v0 + (v1 - v0) * ring.v);
    pushWeights(acc, ring.w);
    for (let j = 0; j < segments; j += 1) {
      const a = base + k * stride + j;
      if (direction > 0) acc.index.push(a, centre, a + 1);
      else acc.index.push(a, a + 1, centre);
    }
  };
  if (capStart) cap(0, -1);
  if (capEnd) cap(rings.length - 1, 1);
}

const perpendicular = (tangent, hint) => hint.clone().addScaledVector(tangent, -hint.dot(tangent)).normalize();

/**
 * Rings along a polyline of joints. A profile entry `{p, r | rx, ry, w, off?}` sits at parameter `p` (segment `k`, fraction
 * `f` as `k.f`); `vOf` maps `p` to the texture's v.
 */
function chainRings(points, profile, hint, vOf) {
  return profile.map((entry) => {
    const k = Math.min(Math.floor(entry.p), points.length - 2);
    const fraction = entry.p - k;
    const centre = points[k].clone().lerp(points[k + 1], fraction);
    const tangent = points[k + 1].clone().sub(points[k]).normalize();
    if (entry.off) centre.add(entry.off);
    return { c: centre, t: tangent, a: perpendicular(tangent, hint), rx: entry.rx ?? entry.r, ry: entry.ry ?? entry.r, w: entry.w, v: vOf(entry.p) };
  });
}

/** Torso rings: `[y, half width, half depth, forward offset]` in body heights, the neck stub on top. */
const TORSO_RINGS = Object.freeze([
  [0.452, 0.045, 0.04, 0], [0.47, 0.082, 0.07, 0], [0.5, 0.1, 0.082, -0.004], [0.535, 0.104, 0.085, -0.006], [0.575, 0.094, 0.074, 0],
  [0.62, 0.084, 0.068, 0], [0.665, 0.09, 0.074, 0], [0.71, 0.1, 0.08, 0.004], [0.755, 0.106, 0.082, 0.004], [0.79, 0.108, 0.074, 0],
  [0.815, 0.088, 0.06, -0.004], [0.832, 0.042, 0.04, -0.004], [0.846, 0.031, 0.031, -0.003],
]);
/** Bone weights of a torso ring at height `y` (in body heights). */
function torsoWeights(y) {
  if (y < 0.555) return [["hips", 1]];
  if (y < 0.63) return [["hips", 1 - (y - 0.555) / 0.075], ["spine", (y - 0.555) / 0.075]];
  if (y < 0.665) return [["spine", 1]];
  if (y < 0.72) return [["spine", 1 - (y - 0.665) / 0.055], ["chest", (y - 0.665) / 0.055]];
  if (y < 0.8) return [["chest", 1]];
  if (y < 0.84) return [["chest", 1 - (y - 0.8) / 0.04], ["neck", (y - 0.8) / 0.04]];
  return [["neck", 1]];
}

/** How much of a heavier rider's extra torso depth goes to the front, by ring height: belly and chest, not a hump; the pelvis stays between the thighs. */
const frontShare = (y) => (y < 0.52 ? 0.15 : y < 0.72 ? 0.7 : y < 0.8 ? 0.45 : 0.2);

function addTorso(acc, h, widthScale, depthScale, belly) {
  const rings = TORSO_RINGS.map(([y, width, depth, forward]) => {
    // the belly swells the waist rings (0.62 and 0.665)
    const swell = y === 0.62 ? [belly, belly * 0.6] : y === 0.665 ? [belly * 0.6, belly * 0.3] : [0, 0];
    const halfDepth = (depth + swell[0]) * h * depthScale;
    const grown = Math.max(0, halfDepth - depth * h) * frontShare(y);
    return {
      c: vec((forward + swell[1] - 0.004) * h + grown, y * h, 0), t: vec(0, 1, 0), a: vec(0, 0, 1),
      rx: width * h * widthScale, ry: halfDepth, w: torsoWeights(y), v: (y - 0.452) / 0.394,
    };
  });
  loft(acc, rings, 20, KIT_ATLAS.torso, { capStart: true });
}

function addHead(acc, h, girth) {
  const round = Math.sqrt(girth);
  const rings = [0.838, 0.852, 0.866].map((y) => ({
    c: vec(-0.002 * h, y * h, 0), t: vec(0, 1, 0), a: vec(0, 0, 1), rx: 0.029 * h * round, ry: 0.031 * h * round,
    w: y < 0.86 ? [["neck", 1]] : [["neck", 0.5], ["head", 0.5]], v: ((y - 0.838) / 0.03) * 0.15,
  }));
  for (let i = 0; i <= 11; i += 1) {
    const y = 0.872 + (i / 11) * 0.127;
    const f = Math.sqrt(Math.max(0.02, 1 - ((y - 0.936) / 0.067) ** 2));
    const jaw = y < 0.92 ? 0.86 : 1;
    rings.push({
      c: vec((0.009 + (y < 0.9 ? 0.006 : 0)) * h, y * h, 0), t: vec(0, 1, 0), a: vec(0, 0, 1), rx: 0.05 * h * f * jaw, ry: 0.059 * h * f,
      w: [["head", 1]], v: 0.15 + 0.85 * (i / 11),
    });
  }
  loft(acc, rings, 18, KIT_ATLAS.head, { capEnd: true });
  // nose
  const down = vec(1, -0.3, 0).normalize();
  loft(acc, [
    { c: vec(0.063 * h, 0.93 * h, 0), t: down, a: vec(0, 0, 1), rx: 0.0075 * h, ry: 0.009 * h, w: [["head", 1]], v: 0.55, u: 0.25 },
    { c: vec(0.074 * h, 0.922 * h, 0), t: down, a: vec(0, 0, 1), rx: 0.004 * h, ry: 0.005 * h, w: [["head", 1]], v: 0.55, u: 0.25 },
  ], 6, KIT_ATLAS.head, { capEnd: true });
  // ears
  for (const sign of [-1, 1]) {
    loft(acc, [
      { c: vec(0.004 * h, 0.932 * h, sign * 0.048 * h), t: vec(0, 0, sign), a: vec(0, 1, 0), rx: 0.013 * h, ry: 0.008 * h, w: [["head", 1]], v: 0.55, u: 0.05 },
      { c: vec(0.002 * h, 0.932 * h, sign * 0.055 * h), t: vec(0, 0, sign), a: vec(0, 1, 0), rx: 0.011 * h, ry: 0.006 * h, w: [["head", 1]], v: 0.55, u: 0.05 },
    ], 6, KIT_ATLAS.head, { capEnd: true });
  }
}

function addArm(acc, joints, h, sign, side, girth) {
  const upper = `upperArm_${side}`;
  const fore = `forearm_${side}`;
  const clav = `clavicle_${side}`;
  const hand = `hand_${side}`;
  const shoulder = joints[`shoulder_${side}`];
  const points = [shoulder.clone().add(vec(0, 0.006 * h, -sign * 0.028 * h)), shoulder, joints[`elbow_${side}`], joints[`wrist_${side}`]];
  const arm = (p, r, w) => ({ p, r: r * h, w });
  loft(acc, chainRings(points, [
    arm(0, 0.027 * girth, [[clav, 0.5], ["chest", 0.2], [upper, 0.3]]), arm(1.1, 0.029 * girth, [[upper, 0.85], [clav, 0.15]]),
    arm(1.35, 0.029 * girth, [[upper, 1]]), arm(1.65, 0.026 * girth, [[upper, 1]]),
    arm(1.9, 0.0215 * girth, [[upper, 0.8], [fore, 0.2]]), arm(2, 0.0205 * girth, [[upper, 0.5], [fore, 0.5]]),
    arm(2.1, 0.0215 * girth, [[fore, 0.85], [upper, 0.15]]), arm(2.35, 0.0225 * girth, [[fore, 1]]),
    arm(2.7, 0.018 * girth, [[fore, 1]]), arm(2.95, 0.0148, [[fore, 0.7], [hand, 0.3]]), arm(3, 0.0142, [[fore, 0.5], [hand, 0.5]]),
  ], vec(1, 0, 0), (p) => Math.max(0, p - 1) / 2), 14, KIT_ATLAS.arm, { capStart: true });
  // hand (a mitten) and thumb
  const palm = (p, rx, ry, w) => ({ p, rx: rx * h, ry: ry * h, w });
  loft(acc, chainRings([joints[`wrist_${side}`], joints[`handEnd_${side}`]], [
    palm(0, 0.02, 0.012, [[hand, 0.7], [fore, 0.3]]), palm(0.3, 0.026, 0.0135, [[hand, 1]]), palm(0.6, 0.026, 0.012, [[hand, 1]]),
    palm(0.85, 0.022, 0.0105, [[hand, 1]]), palm(1, 0.016, 0.008, [[hand, 1]]),
  ], vec(1, 0, 0), (p) => p), 10, KIT_ATLAS.hand, { capEnd: true });
  const wrist = joints[`wrist_${side}`];
  const thumb = [wrist.clone().add(vec(0.014 * h, -0.02 * h, -sign * 0.004 * h)), wrist.clone().add(vec(0.03 * h, -0.058 * h, -sign * 0.008 * h))];
  loft(acc, chainRings(thumb, [{ p: 0, r: 0.0075 * h, w: [[hand, 1]] }, { p: 1, r: 0.0055 * h, w: [[hand, 1]] }], vec(0, 0, 1), () => 0.62), 6, KIT_ATLAS.hand, { capEnd: true });
}

function addLeg(acc, joints, h, sign, side, girth) {
  const thigh = `thigh_${side}`;
  const shin = `shin_${side}`;
  const foot = `foot_${side}`;
  const hip = joints[`hip_${side}`];
  const points = [hip.clone().add(vec(-0.004 * h, 0.012 * h, -sign * 0.008 * h)), hip, joints[`knee_${side}`], joints[`ankle_${side}`]];
  const leg = (p, r, w, off) => ({ p, r: r * h, w, off });
  loft(acc, chainRings(points, [
    leg(0, 0.036 * girth, [["hips", 1]]), leg(1, 0.05 * girth, [["hips", 0.55], [thigh, 0.45]]), leg(1.12, 0.052 * girth, [["hips", 0.2], [thigh, 0.8]]),
    leg(1.25, 0.052 * girth, [[thigh, 1]]), leg(1.55, 0.045 * girth, [[thigh, 1]]), leg(1.85, 0.035 * girth, [[thigh, 0.85], [shin, 0.15]]),
    leg(2, 0.031 * girth, [[thigh, 0.5], [shin, 0.5]]), leg(2.1, 0.031 * girth, [[shin, 0.85], [thigh, 0.15]]),
    leg(2.3, 0.034 * girth, [[shin, 1]], vec(-0.007 * h, 0, 0)), leg(2.55, 0.029 * girth, [[shin, 1]], vec(-0.004 * h, 0, 0)),
    leg(2.85, 0.02, [[shin, 1]]), leg(2.97, 0.018, [[shin, 0.7], [foot, 0.3]]),
  ], vec(0, 0, 1), (p) => Math.max(0, p - 1) / 2), 14, KIT_ATLAS.leg, { capStart: true });
  // shoe: heel to toe
  const ankle = joints[`ankle_${side}`];
  const SHOE_X = [-0.03, -0.015, 0, 0.025, 0.05, 0.075, 0.1, 0.12];
  const SHOE_Y = [0.016, 0.017, 0.02, 0.017, 0.0135, 0.011, 0.009, 0.0075];
  const SHOE_HEIGHT = [0.015, 0.017, 0.019, 0.016, 0.0125, 0.01, 0.0075, 0.004];
  const SHOE_WIDTH = [0.0135, 0.015, 0.0158, 0.0168, 0.0174, 0.0168, 0.0146, 0.007];
  loft(acc, SHOE_X.map((x, i) => ({
    c: vec(ankle.x + x * h, SHOE_Y[i] * h, ankle.z + sign * 0.004 * h * (i / 7)), t: vec(1, 0, 0), a: vec(0, 0, 1),
    rx: SHOE_WIDTH[i] * h, ry: SHOE_HEIGHT[i] * h, w: i < 3 ? [[foot, 0.7], [shin, 0.3]] : [[foot, 1]], v: i / 7,
  })), 12, KIT_ATLAS.foot, { capStart: true, capEnd: true });
}

/** The skinned body geometry for joints `joints` of a rider `h` tall; `girth` fattens it, `belly` swells the waist. */
function buildGeometry(joints, h, girth, belly) {
  const acc = createAccumulator();
  addTorso(acc, h, 0.55 + 0.45 * girth, girth, belly);
  addHead(acc, h, girth);
  for (const [sign, side] of SIDES) {
    addArm(acc, joints, h, sign, side, girth);
    addLeg(acc, joints, h, sign, side, girth);
  }
  for (let i = 0; i < acc.index.length; i += 3) [acc.index[i + 1], acc.index[i + 2]] = [acc.index[i + 2], acc.index[i + 1]]; // outward-facing winding
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(acc.position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(acc.skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(acc.skinWeight, 4));
  geometry.setIndex(acc.index);
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  for (const [a, b] of acc.seams) {
    const x = normal.getX(a) + normal.getX(b);
    const y = normal.getY(a) + normal.getY(b);
    const z = normal.getZ(a) + normal.getZ(b);
    const length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(a, x / length, y / length, z / length);
    normal.setXYZ(b, x / length, y / length, z / length);
  }
  return geometry;
}

// ---------- helmet and glasses

const VENT = colour("#24262a");

/** A vertex-coloured helmet shell on the head joint (in the bind pose's model space). */
function helmetGeometry(joints, h, shell, trim) {
  const geometry = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.56).toNonIndexed();
  geometry.deleteAttribute("uv");
  const position = geometry.attributes.position;
  const colours = new Float32Array(position.count * 3);
  const shellColour = colour(shell);
  const trimColour = colour(trim);
  for (let i = 0; i < position.count; i += 1) {
    let x = position.getX(i);
    let y = position.getY(i);
    const z = position.getZ(i);
    const back = Math.max(0, -x);
    y -= back * back * 0.35; // the tail sweeps down at the back
    x *= 1 + back * 0.25;
    const azimuth = Math.atan2(z, x);
    const polar = Math.acos(Math.max(-1, Math.min(1, position.getY(i))));
    let paint = shellColour;
    if (polar > 0.3 && polar < 1.25 && Math.abs(Math.sin(azimuth * 5)) > 0.8 && Math.abs(azimuth) < 2.6) paint = VENT;
    if (Math.abs(z) < 0.07 && y > 0.6) paint = trimColour;
    if (polar > 1.6) paint = trimColour;
    colours.set([paint.r, paint.g, paint.b], i * 3);
    position.setXYZ(i, x * 0.08 * h, y * 0.066 * h, z * 0.062 * h);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry.translate(joints.head.x - 0.004 * h, 0.957 * h, 0);
}

/** A thin rod from `from` to `to` (bind-pose model space). */
function rod(from, to, radius) {
  const direction = to.clone().sub(from);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 5);
  geometry.deleteAttribute("uv");
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(vec(0, 1, 0), direction.normalize()));
  return geometry.translate(...from.clone().add(to).multiplyScalar(0.5).toArray());
}

/** Chin straps: from under the helmet in front of each ear, down the jaw to a buckle under the chin. */
function strapGeometries(h) {
  const buckle = vec(0.036 * h, 0.871 * h, 0);
  return [-1, 1].flatMap((sign) => {
    const top = vec(0.008 * h, 0.946 * h, sign * 0.053 * h);
    const jaw = vec(0.014 * h, 0.893 * h, sign * 0.038 * h);
    return [rod(top, jaw, 0.0022 * h), rod(jaw, buckle, 0.0022 * h)];
  });
}

/** Wraparound sunglasses: a lens band across the eyes and thin arms back to the ears. */
const LENS_ARC = 0.85;
function glassesGeometries(h) {
  const lens = new THREE.CylinderGeometry(0.06 * h, 0.058 * h, 0.019 * h, 20, 1, true, Math.PI / 2 - LENS_ARC, 2 * LENS_ARC);
  lens.deleteAttribute("uv");
  lens.scale(1, 1, 0.9).translate(0.01 * h, 0.934 * h, 0);
  const end = (sign) => vec(0.01 * h + Math.cos(LENS_ARC) * 0.06 * h, 0.938 * h, sign * Math.sin(LENS_ARC) * 0.054 * h);
  return [lens, ...[-1, 1].map((sign) => rod(end(sign), vec(-0.004 * h, 0.936 * h, sign * 0.0515 * h), 0.0016 * h))];
}

// ---------- IK and poses

const rotationZ = (angle) => new THREE.Matrix4().makeRotationZ(angle);
const rotationX = (angle) => new THREE.Matrix4().makeRotationX(angle);
const rotationY = (angle) => new THREE.Matrix4().makeRotationY(angle);
const transformed = (matrix, point) => point.clone().applyMatrix4(matrix);

/**
 * Two-bone IK in model space: from `root` through a joint to a tip reaching `target`, the joint pushed toward `pole`.
 * @returns {{joint: THREE.Vector3, tip: THREE.Vector3, normal: THREE.Vector3}} the joint, where the tip lands, and the bend plane's normal
 */
function solveTwoBone(root, upperLength, lowerLength, target, pole) {
  const toTarget = target.clone().sub(root);
  const distance = clamp(toTarget.length(), Math.abs(upperLength - lowerLength) + 1e-3, upperLength + lowerLength - 1e-3);
  const direction = toTarget.normalize();
  const tip = root.clone().addScaledVector(direction, distance);
  const cosine = clamp((upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * upperLength * distance), -1, 1);
  const sine = Math.sqrt(1 - cosine * cosine);
  const toPole = pole.clone().sub(root);
  const bend = toPole.addScaledVector(direction, -toPole.dot(direction)).normalize();
  const joint = root.clone().addScaledVector(direction, upperLength * cosine).addScaledVector(bend, upperLength * sine);
  return { joint, tip, normal: vec().crossVectors(direction, bend).normalize() };
}

/** The hands' offset from the grip point to the wrist, and the way the hand points, per hand position. */
const WRIST_OFFSET = Object.freeze({ hoods: [-0.07, 0.03], drops: [-0.075, 0.025], tops: [-0.045, 0.035], flat: [-0.06, 0.035], aero: [-0.07, 0.02] });
const HAND_DIRECTION = Object.freeze({ hoods: [1, -0.6], drops: [1, -0.15], tops: [0.3, -1], flat: [1, -0.5], aero: [1, 0.1] });
/** Hip joint above the saddle top, in body heights. */
const HIP_ABOVE_SADDLE = 0.072;
/** Knee bend wanted at the bottom of the stroke: leg length share. */
const LEG_EXTENSION = 0.955;
/** Saddle heights the bisection searches, in metres along the seat tube. */
const SADDLE_RANGE = Object.freeze([0.45, 1.05]);
const SADDLE_ITERATIONS = 30;
const LEAN_ITERATIONS = 22;

/**
 * A few points on the skin per bone, taken once from the bind pose: of the vertices a bone owns (weight 0.6 or more),
 * the extremes along the bone's three axes, in the bone's own frame.
 */
function skinExtremes(geometry, bind) {
  const position = geometry.getAttribute("position");
  const index = geometry.getAttribute("skinIndex");
  const weight = geometry.getAttribute("skinWeight");
  const owned = RIG_BONES.map(() => []);
  for (let i = 0; i < position.count; i += 1) {
    for (let k = 0; k < 4; k += 1) if (weight.getComponent(i, k) >= 0.6) owned[index.getComponent(i, k)].push(i);
  }
  const points = [];
  const inverse = new THREE.Matrix4();
  const at = vec();
  RIG_BONES.forEach((bone, boneIndex) => {
    inverse.copy(bind[bone]).invert();
    const best = [];
    for (const vertex of owned[boneIndex]) {
      at.fromBufferAttribute(position, vertex).applyMatrix4(inverse);
      const values = [at.x, at.y, at.z];
      for (let axis = 0; axis < 3; axis += 1) {
        if (!best[axis * 2] || values[axis] < best[axis * 2].value) best[axis * 2] = { value: values[axis], vertex, at: at.clone() };
        if (!best[axis * 2 + 1] || values[axis] > best[axis * 2 + 1].value) best[axis * 2 + 1] = { value: values[axis], vertex, at: at.clone() };
      }
    }
    const chosen = new Map();
    for (const entry of best) if (entry && !chosen.has(entry.vertex)) chosen.set(entry.vertex, entry.at);
    for (const local of chosen.values()) points.push({ bone, local });
  });
  return points;
}

/**
 * Builds a rider.
 * @param {import("./look.js").RiderLook} look
 * @param {{own?: <T>(resource: T) => T, uniforms?: ReturnType<typeof createSharedUniforms>, texture?: import("../../../three.js").Texture}} [options]
 *   `texture` replaces the painted kit (shared kits; the caller owns it)
 * @returns {RiderRig}
 */
export function createRider(look, { own = (resource) => resource, uniforms = createSharedUniforms(), texture } = {}) {
  const h = look.height;
  const bmi = look.weight / (h * h);
  const girth = clamp(Math.sqrt(bmi / 22), 0.82, 1.45);
  const belly = Math.max(0, bmi - 24) * 0.0035;
  const joints = bindJoints(h);
  const lit = (material) => addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms));

  const group = new THREE.Group();
  const material = own(lit(new THREE.MeshStandardMaterial({ map: texture ?? kitTexture(look, own), roughness: 0.62 })));
  const mesh = new THREE.SkinnedMesh(own(buildGeometry(joints, h, girth, belly)), material);
  Object.assign(mesh, { castShadow: true, receiveShadow: true, frustumCulled: false });
  group.add(mesh);

  const bones = {};
  for (const name of RIG_BONES) bones[name] = Object.assign(new THREE.Bone(), { name });
  for (const name of RIG_BONES) (BONE_PARENT[name] ? bones[BONE_PARENT[name]] : mesh).add(bones[name]);

  /** Model-space matrix of every bone in the current pose. */
  const model = {};
  const scratch = new THREE.Matrix4();
  function setBone(name, position, yDir, xHint) {
    boneFrame(yDir, xHint, scratch).setPosition(position);
    (model[name] ||= new THREE.Matrix4()).copy(scratch);
    const local = BONE_PARENT[name] ? scratchInverse.copy(model[BONE_PARENT[name]]).invert().multiply(scratch) : scratch;
    local.decompose(bones[name].position, bones[name].quaternion, scratchScale);
  }

  /** Bind pose: every bone points at its child joint; limb x axes follow the bend-plane rule `solveTwoBone` uses. */
  function bindPose() {
    const right = vec(0, 0, 1);
    const to = (from, target) => joints[target].clone().sub(joints[from]);
    setBone("hips", joints.hips, to("hips", "spine"), right);
    setBone("spine", joints.spine, to("spine", "chest"), right);
    setBone("chest", joints.chest, to("chest", "neck"), right);
    setBone("neck", joints.neck, to("neck", "head"), right);
    setBone("head", joints.head, to("head", "headEnd"), right);
    const bendNormal = (from, target, pole) => vec().crossVectors(to(from, target).normalize(), pole).normalize();
    for (const [sign, side] of SIDES) {
      setBone(`clavicle_${side}`, joints[`clav_${side}`], to(`clav_${side}`, `shoulder_${side}`), vec(1, 0, 0));
      const arm = bendNormal(`shoulder_${side}`, `wrist_${side}`, vec(-1, 0, sign * 0.4));
      setBone(`upperArm_${side}`, joints[`shoulder_${side}`], to(`shoulder_${side}`, `elbow_${side}`), arm);
      setBone(`forearm_${side}`, joints[`elbow_${side}`], to(`elbow_${side}`, `wrist_${side}`), arm);
      setBone(`hand_${side}`, joints[`wrist_${side}`], to(`wrist_${side}`, `handEnd_${side}`), arm);
      const leg = bendNormal(`hip_${side}`, `ankle_${side}`, vec(1, 0, sign * 0.15));
      setBone(`thigh_${side}`, joints[`hip_${side}`], to(`hip_${side}`, `knee_${side}`), leg);
      setBone(`shin_${side}`, joints[`knee_${side}`], to(`knee_${side}`, `ankle_${side}`), leg);
      setBone(`foot_${side}`, joints[`ankle_${side}`], to(`ankle_${side}`, `ball_${side}`), right);
    }
  }
  bindPose();
  const bind = Object.fromEntries(RIG_BONES.map((name) => [name, model[name].clone()]));
  mesh.updateMatrixWorld(true);
  const skeleton = own(new THREE.Skeleton(RIG_BONES.map((name) => bones[name])));
  mesh.bind(skeleton);

  // rigid extras on the head bone
  const headInverse = model.head.clone().invert();
  const helmet = new THREE.Mesh(
    own(helmetGeometry(joints, h, look.helmet, look.accent).applyMatrix4(headInverse)),
    own(lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 }))),
  );
  helmet.castShadow = true;
  bones.head.add(helmet);
  helmet.name = "helmet";
  const strapMaterial = own(lit(new THREE.MeshStandardMaterial({ color: "#1d1f24", roughness: 0.8 })));
  const onHead = (geometries) => merge(geometries.map((geometry) => geometry.applyMatrix4(headInverse)));
  bones.head.add(Object.assign(new THREE.Mesh(own(onHead(strapGeometries(h))), strapMaterial), { name: "strap" }));
  if (look.glasses) {
    const lensMaterial = new THREE.MeshStandardMaterial({ color: "#1b2430", roughness: 0.12, metalness: 0.85, side: THREE.DoubleSide });
    bones.head.add(Object.assign(new THREE.Mesh(own(onHead(glassesGeometries(h))), own(lit(lensMaterial))), { name: "glasses" }));
  }

  const length = (a, b) => joints[a].distanceTo(joints[b]);
  const upperArm = length("shoulder_R", "elbow_R");
  const foreArm = length("elbow_R", "wrist_R");
  const thighLength = length("hip_R", "knee_R");
  const shinLength = length("knee_R", "ankle_R");
  const footVector = joints.ball_R.clone().sub(joints.ankle_R);
  const footLength = Math.hypot(footVector.x, footVector.y);
  const footAngle = Math.atan2(-footVector.y, footVector.x);
  const hipAboveSaddle = HIP_ABOVE_SADDLE * h;

  /** Torso chain from a hips position: cumulative forward bends, roll and yaw; returns joints and rotations. */
  function torso(hipsAt, lean, roll = 0, yaw = 0, headPitch = 0.1, headYaw = 0, spread = [0.5, 0.8, 1, 0.55]) {
    const base = new THREE.Matrix4().multiplyMatrices(rotationY(yaw), rotationX(roll));
    const bend = (share) => base.clone().multiply(rotationZ(-lean * share));
    const [r0, r1, r2, rn] = spread.map(bend);
    const spine = hipsAt.clone().add(transformed(r0, joints.spine.clone().sub(joints.hips)));
    const chest = spine.clone().add(transformed(r1, joints.chest.clone().sub(joints.spine)));
    const neck = chest.clone().add(transformed(r2, joints.neck.clone().sub(joints.chest)));
    const rh = new THREE.Matrix4().multiplyMatrices(rotationY(yaw + headYaw), rotationZ(-headPitch));
    const head = neck.clone().add(transformed(rn, joints.head.clone().sub(joints.neck)));
    const headEnd = head.clone().add(transformed(rh, joints.headEnd.clone().sub(joints.head)));
    const out = { r0, r1, r2, rh, spine, chest, neck, head, headEnd };
    for (const [, side] of SIDES) {
      out[`clav_${side}`] = chest.clone().add(transformed(r2, joints[`clav_${side}`].clone().sub(joints.chest)));
      out[`shoulder_${side}`] = chest.clone().add(transformed(r2, joints[`shoulder_${side}`].clone().sub(joints.chest)));
      out[`hip_${side}`] = hipsAt.clone().add(transformed(r0, joints[`hip_${side}`].clone().sub(joints.hips)));
    }
    return out;
  }

  function applyTorso(hipsAt, pose) {
    const zOf = (matrix) => vec(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(matrix));
    setBone("hips", hipsAt, pose.spine.clone().sub(hipsAt), zOf(pose.r0));
    setBone("spine", pose.spine, pose.chest.clone().sub(pose.spine), zOf(pose.r1));
    setBone("chest", pose.chest, pose.neck.clone().sub(pose.chest), zOf(pose.r2));
    setBone("neck", pose.neck, pose.head.clone().sub(pose.neck), zOf(pose.r2));
    setBone("head", pose.head, pose.headEnd.clone().sub(pose.head), zOf(pose.rh));
  }

  function arm(side, pose, wrist, pole, handDirection) {
    const shoulder0 = pose[`shoulder_${side}`];
    const clavicle = pose[`clav_${side}`];
    const shoulder = shoulder0.clone().addScaledVector(wrist.clone().sub(shoulder0).normalize(), 0.018 * h); // protraction toward the target
    setBone(`clavicle_${side}`, clavicle, shoulder.clone().sub(clavicle), vec(1, 0, 0).applyMatrix4(new THREE.Matrix4().extractRotation(pose.r2)));
    const { joint, tip, normal } = solveTwoBone(shoulder, upperArm, foreArm, wrist, pole);
    setBone(`upperArm_${side}`, shoulder, joint.clone().sub(shoulder), normal);
    setBone(`forearm_${side}`, joint, tip.clone().sub(joint), normal);
    setBone(`hand_${side}`, tip, handDirection, normal);
  }

  function leg(side, hipAt, ankle, ball, pole) {
    const { joint, tip, normal } = solveTwoBone(hipAt, thighLength, shinLength, ankle, pole);
    setBone(`thigh_${side}`, hipAt, joint.clone().sub(hipAt), normal);
    setBone(`shin_${side}`, joint, tip.clone().sub(joint), normal);
    setBone(`foot_${side}`, tip, ball.clone().sub(tip), vec(0, 0, 1));
  }

  /** Where the ankle is for a foot whose ball is at `ball`, the sole pitched `pitch` radians. */
  const ankleFor = (ball, pitch, sign) => {
    const angle = pitch + footAngle;
    return ball.clone().sub(vec(Math.cos(angle) * footLength, -Math.sin(angle) * footLength, sign * 0.004 * h));
  };

  function saddleFor(fit) {
    let [low, high] = SADDLE_RANGE;
    const wanted = (thighLength + shinLength) * LEG_EXTENSION;
    const ball = vec(fit.bb.x, fit.bb.y - fit.crankLen + 0.014, 0);
    const ankle = ankleFor(ball, 0.5, 1);
    for (let i = 0; i < SADDLE_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      const hip = fit.bb.clone().addScaledVector(fit.sd, mid).add(vec(-0.02, hipAboveSaddle, 0));
      if (hip.distanceTo(ankle) > wanted) high = mid;
      else low = mid;
    }
    return (low + high) / 2;
  }

  function poseRide(fit, state = {}) {
    const crank = state.crank ?? 0;
    const standing = state.standing ?? 0;
    const t = state.t ?? 0;
    const grip = (fit.grips[state.grip] ? state.grip : null) || fit.T.grip || Object.keys(fit.grips)[0];
    const pitchOf = (angle) => (state.coast ? 0.22 : 0.3 - 0.2 * Math.sin(angle) - 0.05 * Math.cos(angle));
    // hips: on the saddle, or up over the bottom bracket when standing; a little rock with the pedal stroke
    const seat = fit.saddle.clone().add(vec(-0.02, hipAboveSaddle, 0));
    const up = fit.bb.clone().add(vec(0.13, (thighLength + shinLength) * 0.9 + 0.06, 0));
    const hipsAt = seat.lerp(up, standing);
    hipsAt.z += Math.sin(crank) * (0.006 + standing * 0.03);
    hipsAt.y += Math.abs(Math.cos(crank)) * standing * 0.025;
    const roll = Math.sin(crank) * (0.025 + standing * 0.06);
    // lean: bisect until the arms reach the grips with a soft elbow
    const handOffset = vec(...(WRIST_OFFSET[grip] ?? WRIST_OFFSET.hoods));
    const wrists = [0, 1].map((i) => fit.grips[grip][i].clone().add(handOffset));
    const aero = grip === "aero" && fit.grips.pads;
    const reach = aero ? upperArm * 0.98 : (upperArm + foreArm) * (grip === "flat" ? 0.86 : 0.8) + 0.018 * h;
    const targets = aero ? fit.grips.pads.map((pad) => pad.clone().add(vec(0, 0.035, 0))) : wrists;
    let low = -0.1;
    let high = 1.5;
    for (let i = 0; i < LEAN_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      const trial = torso(hipsAt, mid, roll, 0);
      const distance = (trial.shoulder_L.distanceTo(targets[0]) + trial.shoulder_R.distanceTo(targets[1])) / 2;
      if (distance > reach) low = mid;
      else high = mid;
    }
    const lean = (low + high) / 2 + Math.sin(t * 1.7) * 0.01;
    const pose = torso(hipsAt, lean, roll, 0, Math.max(0.05, lean - 0.95) * 0.5 + 0.08 + Math.sin(crank * 2) * 0.01, state.lookYaw || 0);
    applyTorso(hipsAt, pose);
    SIDES.forEach(([sign, side], i) => {
      if (aero) {
        // forearms rest on the pads, hands on the extensions
        const shoulder = pose[`shoulder_${side}`];
        const elbow = shoulder.clone().addScaledVector(targets[i].clone().sub(shoulder).normalize(), upperArm);
        const wrist = elbow.clone().addScaledVector(wrists[i].clone().sub(elbow).normalize(), foreArm);
        setBone(`clavicle_${side}`, pose[`clav_${side}`], shoulder.clone().sub(pose[`clav_${side}`]), vec(1, 0, 0));
        const normal = vec().crossVectors(wrist.clone().sub(shoulder).normalize(), vec(0, -1, sign * 0.3)).normalize();
        setBone(`upperArm_${side}`, shoulder, elbow.clone().sub(shoulder), normal);
        setBone(`forearm_${side}`, elbow, wrist.clone().sub(elbow), normal);
        setBone(`hand_${side}`, wrist, vec(...HAND_DIRECTION.aero), normal);
        return;
      }
      const pole = pose[`shoulder_${side}`].clone().add(vec(-0.25, -0.35, sign * 0.55));
      arm(side, pose, wrists[i], pole, vec(...(HAND_DIRECTION[grip] ?? HAND_DIRECTION.hoods)));
    });
    const pitch = {};
    for (const [sign, side] of SIDES) {
      const angle = sign > 0 ? crank : crank + Math.PI;
      const ball = vec(fit.bb.x + Math.cos(angle) * fit.crankLen, fit.bb.y + Math.sin(angle) * fit.crankLen + 0.014, sign * fit.q);
      pitch[side] = pitchOf(angle);
      leg(side, pose[`hip_${side}`], ankleFor(ball, pitch[side], sign), ball, pose[`hip_${side}`].clone().add(vec(1, 0.4, sign * 0.12)));
    }
    return { pitchL: -pitch.L, pitchR: -pitch.R };
  }

  function poseStand(t = 0, { wave = false } = {}) {
    const breath = Math.sin(t * 1.6) * 0.004 * h;
    const hipsAt = joints.hips.clone().add(vec(0, breath * 0.3, 0));
    const pose = torso(hipsAt, 0.03 + Math.sin(t * 0.8) * 0.01, Math.sin(t * 0.5) * 0.01, 0, -0.02, Math.sin(t * 0.37) * 0.25);
    applyTorso(hipsAt, pose);
    for (const [sign, side] of SIDES) {
      const shoulder = pose[`shoulder_${side}`];
      if (wave && sign > 0) {
        const wrist = shoulder.clone().add(vec(0.05 * h, 0.22 * h, sign * (0.12 + Math.sin(t * 6) * 0.06) * h));
        arm(side, pose, wrist, shoulder.clone().add(vec(-0.1, -0.2, sign * 0.6)), vec(Math.sin(t * 6) * 0.3, 1, 0.1));
        continue;
      }
      const wrist = shoulder.clone().add(vec(0.03 * h, -0.32 * h, sign * 0.035 * h));
      arm(side, pose, wrist, shoulder.clone().add(vec(-0.5, -0.2, sign * 0.3)), vec(0.15, -1, 0));
      leg(side, pose[`hip_${side}`], joints[`ankle_${side}`], joints[`ball_${side}`], pose[`hip_${side}`].clone().add(vec(1, 0, sign * 0.15)));
    }
  }
  poseStand(0);

  // ---------- our clip poses and the skin's contact points

  const contactPoints = skinExtremes(mesh.geometry, bind);
  const deltas = {};
  const pivot = vec();
  const toPivot = new THREE.Matrix4();
  const fromPivot = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const turnSide = new THREE.Matrix4();

  /** Each bone turns about its bind joint in its parent's moved frame: `delta = parent delta * T(joint) * R * T(-joint)`. */
  function poseJoints(pose) {
    const angles = pose.joints ?? {};
    const sideways = {};
    const forward = {};
    for (const [joint, bonesOf] of Object.entries(JOINT_BONES)) {
      const angle = angles[joint] ?? 0;
      if (!angle) continue;
      const target = joint.endsWith("z") ? sideways : forward;
      for (const bone of bonesOf) target[bone] = (target[bone] ?? 0) + angle / bonesOf.length;
    }
    for (const name of RIG_BONES) {
      const delta = (deltas[name] ||= new THREE.Matrix4());
      const parent = BONE_PARENT[name];
      if (!parent) {
        // the hips: up, back (rig -x) and the whole body tipped about the ground point between the feet
        delta.makeTranslation(-(pose.root?.z ?? 0), pose.root?.y ?? 0, 0).multiply(turn.makeRotationZ(pose.root?.pitch ?? 0));
      } else {
        const sign = name.endsWith("_R") ? 1 : -1;
        turn.makeRotationZ(forward[name] ?? 0);
        turnSide.makeRotationX(-sign * (sideways[name] ?? 0));
        pivot.setFromMatrixPosition(bind[name]);
        toPivot.makeTranslation(pivot.x, pivot.y, pivot.z);
        fromPivot.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
        delta.copy(deltas[parent]).multiply(toPivot).multiply(turn).multiply(turnSide).multiply(fromPivot);
      }
      (model[name] ||= new THREE.Matrix4()).multiplyMatrices(delta, bind[name]);
      const local = parent ? scratchInverse.copy(model[parent]).invert().multiply(model[name]) : scratch.copy(model[name]);
      local.decompose(bones[name].position, bones[name].quaternion, scratchScale);
    }
  }

  const contactScratch = vec();
  function lowestPoint() {
    let lowest = Infinity;
    for (const { bone, local } of contactPoints) lowest = Math.min(lowest, contactScratch.copy(local).applyMatrix4(model[bone]).y);
    return lowest;
  }

  return {
    object: group,
    mesh,
    height: h,
    eyeHeight: 0.93 * h,
    poseRide,
    poseStand,
    poseJoints,
    contactPoints,
    lowestPoint,
    saddleFor,
    headPos: (out = vec()) => out.setFromMatrixPosition(model.head),
    boneWorld: (name, out = vec()) => out.setFromMatrixPosition(model[name]),
    setTexture(next) {
      material.map = next;
      material.needsUpdate = true;
    },
  };
}

// ---------- the workbench pair

/** The default workbench rider: the plan's 1.78 m, 70 kg rider in a red banded jersey. */
export const BENCH_LOOK = Object.freeze({
  height: 1.78, weight: 70, skin: "fair", hair: "#4a3426", kit: "road", pattern: "band", primary: "#e8473f", secondary: "#f4f1ea", accent: "#1d2a44",
  shorts: "#1d1f24", socks: "#f4f1ea", shoes: "#f4f1ea", helmet: "#f4f1ea", glasses: true, gloves: true, gloveColor: "#1d1f24",
  bike: "road", frame: "#c8382e", frameAccent: "#f2efe8",
});

const BENCH_POSES = Object.freeze(["ride", "stand", "wave"]);
/** Crank speed of the previewer's riding pose, radians per second (0.725 turns). */
const BENCH_CRANK_SPEED = 1.45 * Math.PI;

export const meta = Object.freeze({
  id: "rider",
  name: "Rider (rigged)", // i18n-ok
  category: "Creatures", // i18n-ok
  description: "Skinned, fully rigged cyclist: height, weight, kit and pattern; poses for standing, waving and riding (IK).", // i18n-ok
  options: Object.freeze({
    pose: Object.freeze({ type: "select", values: BENCH_POSES, default: "ride" }),
    figure: Object.freeze({ type: "select", values: Object.freeze(["rider", "penguin"]), default: "rider" }),
    height: Object.freeze({ type: "range", min: 1.5, max: 2.05, step: 0.01, default: 1.78 }),
    weight: Object.freeze({ type: "range", min: 45, max: 120, step: 1, default: 70 }),
    kit: Object.freeze({ type: "select", values: Object.freeze(["road", "long", "skinsuit", "casual"]), default: "road" }),
    pattern: Object.freeze({ type: "select", values: Object.freeze(["solid", "hoops", "band", "sash", "panels", "chevron", "dots", "fade"]), default: "band" }),
    skin: Object.freeze({ type: "select", values: Object.freeze(["light", "fair", "tan", "olive", "brown", "dark"]), default: "fair" }),
    primary: Object.freeze({ type: "color", default: "#e8473f" }),
    secondary: Object.freeze({ type: "color", default: "#f4f1ea" }),
    accent: Object.freeze({ type: "color", default: "#1d2a44" }),
    shorts: Object.freeze({ type: "color", default: "#1d1f24" }),
    helmet: Object.freeze({ type: "color", default: "#f4f1ea" }),
    glasses: Object.freeze({ type: "bool", default: true }),
  }),
});

/**
 * The workbench's rider: one rigged rider posed and animated in place.
 * @param {{track?: (resource: any) => any, pose?: string, figure?: "rider" | "penguin"} & Partial<import("./look.js").RiderLook>} [options]
 */
export function create({ track, pose = "ride", figure = "rider", uniforms, ...options } = {}) {
  const owner = createOwner(track);
  const look = { ...BENCH_LOOK, ...options };
  const rig = createRider(look, { own: owner.own, uniforms });
  if (figure === "penguin") dressAsPenguin(rig, { own: owner.own, uniforms, scarf: look.primary });
  const fit = bikeGeometry("road", { saddleHeight: rig.saddleFor(bikeGeometry("road")) });
  let crank = 0.6;
  const update = (dt, t) => {
    if (pose === "ride") {
      crank -= dt * BENCH_CRANK_SPEED;
      rig.poseRide(fit, { crank, t });
    } else rig.poseStand(t, { wave: pose === "wave" });
  };
  update(0, 0);
  return { object: rig.object, update, dispose: () => owner.disposeAll() };
}
