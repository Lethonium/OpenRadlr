/**
 * The old low-poly body parts (their points; the colours are ignored), kept for the clip and pose tests: they measure
 * a pose against the shapes the rig was modelled from (ground contact, limbs
 * joined, arms clear of the head). Not used at run time.
 */
import { Solids } from "./solids.js";
import { placement } from "../../public/js/view3d/math.js";
import { BODY_ATTITUDE, BODY_JOINTS, BODY_PARENTS, RIDER_GEOMETRY } from "../../public/js/view3d/riderGeometry.js";

export { BODY_ATTITUDE, BODY_JOINTS, BODY_PARENTS, RIDER_GEOMETRY };

const KIT = [1, 1, 1, 1];
const VISOR = [0.08, 0.08, 0.1];
const SHOE = [0.95, 0.95, 0.95];
const SOCK = [0.92, 0.92, 0.93];
const SKINS = [
  [0.95, 0.8, 0.68],
  [0.87, 0.68, 0.52],
  [0.68, 0.48, 0.34],
  [0.45, 0.31, 0.22],
];
const HELMETS = [KIT, [0.95, 0.95, 0.95], [0.1, 0.1, 0.11]];
const SHORTS = [
  [0.09, 0.09, 0.11],
  [0.13, 0.16, 0.26],
];

function hash(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Appearance for variant `index`: skin, helmet, frame and shorts colours. */
export function variantLook(index) {
  const pick = (list, salt) => list[Math.floor(hash(index * 31 + salt) * list.length) % list.length];
  return { skin: pick(SKINS, 1), helmet: pick(HELMETS, 2), shorts: pick(SHORTS, 4) };
}

const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Shorts, origin at the pelvis joint. */
export function buildPelvis({ shorts } = variantLook(0)) {
  const m = new Solids();
  m.box(minus([0, 1.02, 0.16], BODY_JOINTS.pelvis), [0.32, 0.12, 0.2], shorts);
  return m.build();
}

/** Chest, shoulders and neck, origin at the base of the spine. */
export function buildTorso({ skin } = variantLook(0)) {
  const m = new Solids();
  const at = (p) => minus(p, BODY_JOINTS.spine);
  m.segment(at(RIDER_GEOMETRY.hip), at([0, 1.28, -0.16]), 0.34, 0.22, KIT);
  m.segment(at([0, 1.28, -0.16]), at([0, 1.36, -0.3]), 0.38, 0.22, KIT);
  m.box(at([0, 1.46, -0.36]), [0.12, 0.08, 0.1], skin); // neck
  return m.build();
}

/** Head, helmet and visor, origin at the base of the neck. */
export function buildHead({ skin, helmet } = variantLook(0)) {
  const m = new Solids();
  const at = (p) => minus(p, BODY_JOINTS.neck);
  m.ellipsoid(at([0, 1.53, -0.4]), [0.1, 0.11, 0.11], skin, 3, 6);
  m.ellipsoid(at([0, 1.6, -0.38]), [0.13, 0.09, 0.17], helmet, 3, 7);
  m.box(at([0, 1.53, -0.5]), [0.18, 0.04, 0.03], VISOR);
  return m.build();
}

/** Upper arm to the elbow, origin at the shoulder; `side` is −1 (left) or 1 (right). */
export function buildUpperArm(_look = variantLook(0), side = 1) {
  const m = new Solids();
  const joint = side < 0 ? BODY_JOINTS.shoulderL : BODY_JOINTS.shoulderR;
  const elbow = side < 0 ? BODY_JOINTS.elbowL : BODY_JOINTS.elbowR;
  m.segment([0, 0, 0], minus(elbow, joint), 0.1, 0.1, KIT);
  return m.build();
}

/** Forearm and hand, origin at the elbow; `side` is −1 (left) or 1 (right). */
export function buildForearm({ skin } = variantLook(0), side = 1) {
  const m = new Solids();
  const elbow = side < 0 ? BODY_JOINTS.elbowL : BODY_JOINTS.elbowR;
  const hand = side < 0 ? BODY_JOINTS.handL : BODY_JOINTS.handR;
  m.segment([0, 0, 0], minus(hand, elbow), 0.08, 0.08, skin);
  return m.build();
}

/** Thigh hanging from the hip (origin): shorts, then a bit of bare skin above the knee. */
export function buildThigh({ skin, shorts } = variantLook(0)) {
  const m = new Solids();
  const length = RIDER_GEOMETRY.thigh;
  m.segment([0, 0.02, 0], [0, -length * 0.78, 0], 0.15, 0.16, shorts);
  m.segment([0, -length * 0.78, 0], [0, -length, 0], 0.12, 0.12, skin);
  return m.build();
}

/** Shin hanging from the knee (origin), with a kneecap that hides the joint and a sock. */
export function buildShin({ skin } = variantLook(0)) {
  const m = new Solids();
  const length = RIDER_GEOMETRY.shin;
  m.ellipsoid([0, 0, 0], [0.065, 0.07, 0.07], skin, 3, 6);
  m.segment([0, 0, 0], [0, -length * 0.45, 0], 0.11, 0.11, skin); // calf
  m.segment([0, -length * 0.45, 0], [0, -length * 0.8, 0], 0.085, 0.085, skin);
  m.segment([0, -length * 0.8, 0], [0, -length - 0.02, 0], 0.08, 0.08, SOCK);
  return m.build();
}

const shoe = (m) => m.box([0, -0.025, -0.07], [0.09, 0.07, 0.26], SHOE);

/** The shoe alone, off the bike (sole 6 cm under the ankle); ankle at the origin, toes to −Z. */
export function buildShoe() {
  const m = new Solids();
  shoe(m);
  return m.build();
}


/** The upper-body parts in the riding pose (the parts are modelled in it): `mesh` names a `build*` part, `model` places it in the bike frame. */
export function ridingBodyParts() {
  const J = BODY_JOINTS;
  return [
    { mesh: "pelvis", model: placement(J.pelvis) },
    { mesh: "torso", model: placement(J.spine) },
    { mesh: "head", model: placement(J.neck) },
    { mesh: "upperArmL", model: placement(J.shoulderL) },
    { mesh: "upperArmR", model: placement(J.shoulderR) },
    { mesh: "forearmL", model: placement(J.elbowL) },
    { mesh: "forearmR", model: placement(J.elbowR) },
  ];
}
