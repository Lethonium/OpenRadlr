/**
 * Low-poly cyclist. Local axes: forward = −Z, up = +Y, origin on the ground
 * between the wheels. Parts with alpha = 1 are painted in the rider's colour
 * (jersey and accents), which keeps the colour code readable: me, other
 * humans, bots. Everything else varies per rider: skin, helmet, bike, size.
 * Thighs, shins, feet, cranks and wheels are separate meshes: the cranks turn
 * around the bottom bracket, each foot rides its pedal and the knee follows by
 * two-bone IK (see `legPose`), so the legs actually drive the bike.
 */
import { multiply, placement, rotationXAbout } from "./math.js";
import { MeshBuilder } from "./meshBuilder.js";

const KIT = [1, 1, 1, 1];
const TYRE = [0.06, 0.06, 0.07];
const RIM = [0.58, 0.6, 0.63];
const SPOKE = [0.75, 0.77, 0.8];
const SADDLE = [0.08, 0.08, 0.09];
const VISOR = [0.08, 0.08, 0.1];
const SHOE = [0.95, 0.95, 0.95];
const SOCK = [0.92, 0.92, 0.93];
const PEDAL = [0.12, 0.12, 0.13];
const CRANK = [0.32, 0.33, 0.36];

export const RIDER_GEOMETRY = Object.freeze({
  wheelRadius: 0.34,
  wheelBase: 1.0,
  hip: [0, 1.0, 0.14],
  bottomBracket: [0, 0.3, 0.05],
  crankLength: 0.17,
  thigh: 0.42,
  shin: 0.4,
  /** Pedal spindle in the foot's frame (ankle at the origin, foot level, toes to −Z). */
  ball: [0, -0.075, -0.11],
  headHeight: 1.55,
});

export const WHEEL_HUBS = Object.freeze([
  [0, RIDER_GEOMETRY.wheelRadius, RIDER_GEOMETRY.wheelBase / 2],
  [0, RIDER_GEOMETRY.wheelRadius, -RIDER_GEOMETRY.wheelBase / 2],
]);

const SKINS = [
  [0.95, 0.8, 0.68],
  [0.87, 0.68, 0.52],
  [0.68, 0.48, 0.34],
  [0.45, 0.31, 0.22],
];
const HELMETS = [KIT, [0.95, 0.95, 0.95], [0.1, 0.1, 0.11]];
const FRAMES = [
  [0.16, 0.17, 0.19],
  [0.85, 0.86, 0.88],
  [0.62, 0.12, 0.14],
  [0.12, 0.3, 0.5],
];
const SHORTS = [
  [0.09, 0.09, 0.11],
  [0.13, 0.16, 0.26],
];

/** Number of pre-built body variants. */
export const VARIANT_COUNT = 12;

function hash(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Appearance for variant `index`: skin, helmet, frame and shorts colours. */
export function variantLook(index) {
  const pick = (list, salt) => list[Math.floor(hash(index * 31 + salt) * list.length) % list.length];
  return { skin: pick(SKINS, 1), helmet: pick(HELMETS, 2), frame: pick(FRAMES, 3), shorts: pick(SHORTS, 4) };
}

/** Deterministic look for a rider: same id → same body variant and size on every client. */
export function riderLook(id) {
  return { variant: Math.floor(hash(id + 7) * VARIANT_COUNT) % VARIANT_COUNT, scale: 0.93 + hash(id + 11) * 0.14 };
}

/** Frame and handlebars (no rider), in the bike frame. */
export function buildBike({ frame } = variantLook(0)) {
  const m = new MeshBuilder();
  const [rear] = WHEEL_HUBS;
  const front = WHEEL_HUBS[1];
  const bottomBracket = RIDER_GEOMETRY.bottomBracket;
  const seat = [0, 0.94, 0.2];
  const head = [0, 0.9, -0.36];

  // Frame with a jersey-coloured accent on the main triangle.
  m.segment(rear, bottomBracket, 0.035, 0.04, frame);
  m.segment(rear, seat, 0.03, 0.035, frame);
  m.segment(bottomBracket, seat, 0.045, 0.05, frame);
  m.segment(bottomBracket, head, 0.06, 0.06, KIT);
  m.segment(seat, head, 0.045, 0.045, frame);
  m.segment(head, front, 0.035, 0.04, frame);
  m.box(bottomBracket, [0.12, 0.1, 0.1], frame);
  m.box([0, 0.97, 0.22], [0.12, 0.04, 0.26], SADDLE);
  m.segment([0, 0.9, -0.36], [0, 0.98, -0.42], 0.04, 0.04, frame); // stem
  m.box([0, 0.98, -0.44], [0.44, 0.035, 0.05], SADDLE); // bar tape
  for (const side of [-0.2, 0.2]) m.segment([side, 0.98, -0.44], [side, 0.88, -0.5], 0.035, 0.035, SADDLE);
  return m.build();
}

/**
 * Joint origins of the upper body in the bike frame. Each body part is built
 * with its joint at the origin, in the riding attitude, and placed here.
 */
export const BODY_JOINTS = Object.freeze({
  pelvis: RIDER_GEOMETRY.hip,
  spine: RIDER_GEOMETRY.hip,
  neck: [0, 1.46, -0.36],
  shoulderL: [-0.18, 1.34, -0.28],
  shoulderR: [0.18, 1.34, -0.28],
  elbowL: [-0.18 * 1.08, 1.17, -0.38],
  elbowR: [0.18 * 1.08, 1.17, -0.38],
  handL: [-0.18 * 1.1, 0.99, -0.46],
  handR: [0.18 * 1.1, 0.99, -0.46],
  hipL: [-0.12, RIDER_GEOMETRY.hip[1], RIDER_GEOMETRY.hip[2]],
  hipR: [0.12, RIDER_GEOMETRY.hip[1], RIDER_GEOMETRY.hip[2]],
});

/** Parent of each joint in `BODY_JOINTS` (the pelvis is the root). */
export const BODY_PARENTS = Object.freeze({
  spine: "pelvis",
  neck: "spine",
  shoulderL: "spine",
  shoulderR: "spine",
  elbowL: "shoulderL",
  elbowR: "shoulderR",
  handL: "elbowL",
  handR: "elbowR",
  hipL: "pelvis",
  hipR: "pelvis",
});

/** Forward lean of the riding torso from the vertical (radians): the line from the hip to between the shoulders. */
export const RIDING_LEAN = Math.atan2(RIDER_GEOMETRY.hip[2] - -0.3, 1.36 - RIDER_GEOMETRY.hip[1]);

/** X rotation that turns a limb modelled hanging straight down (−Y) to point from `a` to `b`. */
const hangAngle = (a, b) => Math.atan2(-(b[2] - a[2]), -(b[1] - a[1]));

/**
 * Attitude each part is modelled in, as an X rotation (same sense as
 * `rotationXAbout`) away from its upright standing attitude: the torso leans
 * forward, the arms reach for the hoods; everything else is modelled upright
 * (the legs hang straight down, the foot is level). A standing pose undoes it.
 */
export const BODY_ATTITUDE = Object.freeze({
  pelvis: 0,
  torso: -RIDING_LEAN,
  head: 0,
  upperArmL: hangAngle(BODY_JOINTS.shoulderL, BODY_JOINTS.elbowL),
  upperArmR: hangAngle(BODY_JOINTS.shoulderR, BODY_JOINTS.elbowR),
  forearmL: hangAngle(BODY_JOINTS.elbowL, BODY_JOINTS.handL),
  forearmR: hangAngle(BODY_JOINTS.elbowR, BODY_JOINTS.handR),
  thighL: 0,
  thighR: 0,
  shinL: 0,
  shinR: 0,
  footL: 0,
  footR: 0,
});

/**
 * Joint angles (radians, X rotations about each joint) on top of the riding
 * attitude the parts are modelled in: zero, since the parts already lean
 * forward and reach for the hoods.
 */
export const RIDING_POSE = Object.freeze({ spine: 0, neck: 0, shoulderL: 0, shoulderR: 0, elbowL: 0, elbowR: 0 });

const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Shorts, origin at the pelvis joint. */
export function buildPelvis({ shorts } = variantLook(0)) {
  const m = new MeshBuilder();
  m.box(minus([0, 1.02, 0.16], BODY_JOINTS.pelvis), [0.32, 0.12, 0.2], shorts);
  return m.build();
}

/** Chest, shoulders and neck, origin at the base of the spine. */
export function buildTorso({ skin } = variantLook(0)) {
  const m = new MeshBuilder();
  const at = (p) => minus(p, BODY_JOINTS.spine);
  m.segment(at(RIDER_GEOMETRY.hip), at([0, 1.28, -0.16]), 0.34, 0.22, KIT);
  m.segment(at([0, 1.28, -0.16]), at([0, 1.36, -0.3]), 0.38, 0.22, KIT);
  m.box(at([0, 1.46, -0.36]), [0.12, 0.08, 0.1], skin); // neck
  return m.build();
}

/** Head, helmet and visor, origin at the base of the neck. */
export function buildHead({ skin, helmet } = variantLook(0)) {
  const m = new MeshBuilder();
  const at = (p) => minus(p, BODY_JOINTS.neck);
  m.ellipsoid(at([0, 1.53, -0.4]), [0.1, 0.11, 0.11], skin, 3, 6);
  m.ellipsoid(at([0, 1.6, -0.38]), [0.13, 0.09, 0.17], helmet, 3, 7);
  m.box(at([0, 1.53, -0.5]), [0.18, 0.04, 0.03], VISOR);
  return m.build();
}

/** Upper arm to the elbow, origin at the shoulder; `side` is −1 (left) or 1 (right). */
export function buildUpperArm(_look = variantLook(0), side = 1) {
  const m = new MeshBuilder();
  const joint = side < 0 ? BODY_JOINTS.shoulderL : BODY_JOINTS.shoulderR;
  const elbow = side < 0 ? BODY_JOINTS.elbowL : BODY_JOINTS.elbowR;
  m.segment([0, 0, 0], minus(elbow, joint), 0.1, 0.1, KIT);
  return m.build();
}

/** Forearm and hand, origin at the elbow; `side` is −1 (left) or 1 (right). */
export function buildForearm({ skin } = variantLook(0), side = 1) {
  const m = new MeshBuilder();
  const elbow = side < 0 ? BODY_JOINTS.elbowL : BODY_JOINTS.elbowR;
  const hand = side < 0 ? BODY_JOINTS.handL : BODY_JOINTS.handR;
  m.segment([0, 0, 0], minus(hand, elbow), 0.08, 0.08, skin);
  return m.build();
}

/** Uploads every upper-body part of a look; returns a Map from the names `ridingBodyParts` uses to handles. */
export function uploadBodyParts(renderer, look) {
  return new Map([
    ["pelvis", renderer.upload(buildPelvis(look))],
    ["torso", renderer.upload(buildTorso(look))],
    ["head", renderer.upload(buildHead(look))],
    ["upperArmL", renderer.upload(buildUpperArm(look, -1))],
    ["upperArmR", renderer.upload(buildUpperArm(look, 1))],
    ["forearmL", renderer.upload(buildForearm(look, -1))],
    ["forearmR", renderer.upload(buildForearm(look, 1))],
  ]);
}

/** Upper-body parts in the riding pose: `mesh` names a `build*` part, `model` is its transform in the bike frame. */
export function ridingBodyParts(_look = variantLook(0)) {
  const at = (joint, angle) => multiply(placement(joint), rotationXAbout([0, 0, 0], angle));
  const J = BODY_JOINTS;
  const P = RIDING_POSE;
  return [
    { mesh: "pelvis", model: at(J.pelvis, 0) },
    { mesh: "torso", model: at(J.spine, P.spine) },
    { mesh: "head", model: at(J.neck, P.neck) },
    { mesh: "upperArmL", model: at(J.shoulderL, P.shoulderL) },
    { mesh: "upperArmR", model: at(J.shoulderR, P.shoulderR) },
    { mesh: "forearmL", model: at(J.elbowL, P.elbowL) },
    { mesh: "forearmR", model: at(J.elbowR, P.elbowR) },
  ];
}

/** Rotation of the point (y, z) around the X axis, same sense as `rotationXAbout`. */
function rotateYZ([x, y, z], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, c * y - s * z, s * y + c * z];
}

/**
 * Pose of one leg for a crank phase (radians, grows while pedalling forward;
 * 0 = this leg's pedal at the bottom). Points are in the rider's local YZ plane
 * (x = 0); angles are X rotations for `rotationXAbout`, applied to the meshes
 * from `buildThigh`, `buildShin` and `buildFoot` at the hip, knee and ankle.
 */
export function legPose(phase) {
  const { hip, bottomBracket: bb, crankLength: r, thigh, shin, ball } = RIDER_GEOMETRY;
  // Forward pedalling turns the cranks the same way as the wheels: top → front → bottom → back.
  const crankAngle = -phase;
  const pedal = [0, bb[1] - r * Math.cos(phase), bb[2] + r * Math.sin(phase)];

  // Ankling: toes point down most on the back of the stroke, heel drops over the top.
  const footAngle = -(0.28 + 0.2 * Math.sin(phase));
  const toBall = rotateYZ(ball, footAngle);
  const ankle = [0, pedal[1] - toBall[1], pedal[2] - toBall[2]];

  // Two-bone IK in the YZ plane; the knee bends forward (−Z).
  const dy = ankle[1] - hip[1];
  const dz = ankle[2] - hip[2];
  const reach = Math.hypot(dy, dz);
  const d = Math.min(thigh + shin - 1e-4, Math.max(Math.abs(thigh - shin) + 1e-4, reach));
  const [uy, uz] = [dy / reach, dz / reach];
  const cosHip = (thigh * thigh + d * d - shin * shin) / (2 * thigh * d);
  const sinHip = Math.sqrt(Math.max(0, 1 - cosHip * cosHip));
  const knee = [0, hip[1] + thigh * (cosHip * uy - sinHip * uz), hip[2] + thigh * (cosHip * uz + sinHip * uy)];

  return {
    crankAngle,
    pedal,
    ankle,
    knee,
    thighAngle: hangAngle(hip, knee),
    shinAngle: hangAngle(knee, ankle),
    footAngle,
  };
}

/** Thigh hanging from the hip (origin): shorts, then a bit of bare skin above the knee. */
export function buildThigh({ skin, shorts } = variantLook(0)) {
  const m = new MeshBuilder();
  const length = RIDER_GEOMETRY.thigh;
  m.segment([0, 0.02, 0], [0, -length * 0.78, 0], 0.15, 0.16, shorts);
  m.segment([0, -length * 0.78, 0], [0, -length, 0], 0.12, 0.12, skin);
  return m.build();
}

/** Shin hanging from the knee (origin), with a kneecap that hides the joint and a sock. */
export function buildShin({ skin } = variantLook(0)) {
  const m = new MeshBuilder();
  const length = RIDER_GEOMETRY.shin;
  m.ellipsoid([0, 0, 0], [0.065, 0.07, 0.07], skin, 3, 6);
  m.segment([0, 0, 0], [0, -length * 0.45, 0], 0.11, 0.11, skin); // calf
  m.segment([0, -length * 0.45, 0], [0, -length * 0.8, 0], 0.085, 0.085, skin);
  m.segment([0, -length * 0.8, 0], [0, -length - 0.02, 0], 0.08, 0.08, SOCK);
  return m.build();
}

const shoe = (m) => m.box([0, -0.025, -0.07], [0.09, 0.07, 0.26], SHOE);

/** Shoe with the pedal clipped under the ball of the foot; ankle at the origin, toes to −Z. */
export function buildFoot() {
  const m = new MeshBuilder();
  const [, by, bz] = RIDER_GEOMETRY.ball;
  shoe(m);
  m.box([0, by, bz], [0.1, 0.025, 0.09], PEDAL);
  return m.build();
}

/** The shoe alone, off the bike (sole 6 cm under the ankle); ankle at the origin, toes to −Z. */
export function buildShoe() {
  const m = new MeshBuilder();
  shoe(m);
  return m.build();
}

/** Chainring (right side, +X) and both crank arms around the bottom bracket (origin); right arm points down. */
export function buildCrankset() {
  const m = new MeshBuilder();
  const r = RIDER_GEOMETRY.crankLength;
  m.wheel([0.075, 0, 0], 0.11, 0.012, CRANK, 16);
  m.wheel([0.075, 0, 0], 0.06, 0.016, PEDAL, 8);
  m.segment([0.09, 0.02, 0], [0.09, -r, 0], 0.02, 0.035, CRANK);
  m.segment([-0.09, -0.02, 0], [-0.09, r, 0], 0.02, 0.035, CRANK);
  m.wheel([0, 0, 0], 0.03, 0.2, PEDAL, 8); // axle
  return m.build();
}

/** A spoked wheel centred on the origin, spinning around the X axis. */
export function buildWheel() {
  const m = new MeshBuilder();
  const r = RIDER_GEOMETRY.wheelRadius;
  const origin = [0, 0, 0];
  m.wheel(origin, r, 0.05, TYRE, 16);
  m.wheel(origin, r * 0.88, 0.056, RIM, 16);
  m.wheel(origin, r * 0.8, 0.058, TYRE, 16);
  m.wheel(origin, 0.045, 0.1, RIM, 8);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    m.segment([0, 0, 0], [0, Math.cos(angle) * r * 0.82, Math.sin(angle) * r * 0.82], 0.012, 0.012, SPOKE);
  }
  return m.build();
}

/** Soft contact shadow under the bike (ambient occlusion on the road). */
export function buildRiderShadow() {
  const m = new MeshBuilder();
  m.disc([0, 0.07, 0], [0.32, 0.8], [0.03, 0.04, 0.05], 14);
  return m.build();
}
