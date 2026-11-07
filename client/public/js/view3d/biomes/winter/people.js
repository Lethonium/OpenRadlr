/**
 * Winter's crowd: penguins instead of people, clapping their flippers.
 *
 * The two poses are the two frames the view alternates between. Everything
 * but the scarf is opaque, so the per-person shirt tint colours only the
 * scarf; the body keeps its black-and-white plumage.
 */
import { MeshBuilder } from "../../meshBuilder.js";
import { rotationXAbout } from "../../math.js";
import { BODY_ATTITUDE, BODY_JOINTS, RIDER_GEOMETRY } from "../../riderModel.js";

const COAT = [0.1, 0.12, 0.16];
const COAT_LIGHT = [0.18, 0.21, 0.27];
const BELLY = [0.96, 0.97, 1.0];
const BEAK = [0.96, 0.56, 0.12];
const EYE = [0.03, 0.03, 0.04];
const SCARF = [1, 1, 1, 1]; // tinted per penguin by the view

/** A penguin facing −Z. `clapping` puts both flippers together in front. */
export function buildPenguin(clapping) {
  const m = new MeshBuilder();

  // Webbed feet and a short tail behind the body.
  for (const side of [-1, 1]) m.box([side * 0.16, 0.045, -0.08], [0.22, 0.09, 0.34], BEAK);
  m.box([0, 0.18, 0.33], [0.28, 0.12, 0.24], COAT_LIGHT);

  // Black back and the white belly standing proud of it.
  m.ellipsoid([0, 0.66, 0.02], [0.38, 0.62, 0.31], COAT, 3, 7);
  m.ellipsoid([0, 0.62, -0.18], [0.28, 0.45, 0.16], BELLY, 3, 6);

  // Head with a white face patch, eyes and an orange beak.
  m.ellipsoid([0, 1.26, -0.02], [0.27, 0.26, 0.26], COAT, 3, 7);
  m.ellipsoid([0, 1.24, -0.2], [0.19, 0.18, 0.09], BELLY, 2, 6);
  for (const side of [-1, 1]) m.box([side * 0.085, 1.28, -0.285], [0.06, 0.07, 0.04], EYE);
  m.segment([0, 1.19, -0.24], [0, 1.14, -0.45], 0.14, 0.1, BEAK);

  // A knitted scarf around the neck, and its loose end on the white chest.
  m.box([0, 1.05, 0], [0.52, 0.11, 0.42], SCARF);
  m.box([0.18, 0.92, -0.31], [0.1, 0.26, 0.06], SCARF);

  // Flippers: spread out for the open beat, meeting in front for the clap.
  for (const side of [-1, 1]) {
    const shoulder = [side * 0.3, 0.96, -0.02];
    const tip = clapping ? [side * 0.06, 0.72, -0.32] : [side * 0.46, 0.78, -0.12];
    m.segment(shoulder, tip, 0.12, 0.16, COAT_LIGHT);
  }

  return m.build();
}

// --- the workout rig ---------------------------------------------------------
//
// The exercise clips drive the same skeleton as the human rider (`bodyTransforms`
// in `riderPose.js`): each part is built with its joint at the origin and the
// same part name, so `settle`, `poseAt` and the clips animate a penguin too.
// Parts are modelled in the attitude `bodyTransforms` unbakes, so a standing
// penguin stands upright; the flippers follow the rider's shoulder→elbow→hand
// vectors (the rig stretches arms by `ARM_STRETCH`), and the feet keep the
// shoe's sole and toe geometry so the planted clips do not slide.

const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rotX = (angle) => rotationXAbout([0, 0, 0], angle);

/** Builds a part in the standing frame, then stores it in the attitude `unbake` expects. */
function inAttitude(angle, build) {
  const standing = new MeshBuilder();
  build(standing);
  const m = new MeshBuilder();
  m.append(standing.build(), rotX(angle));
  return m.build();
}

/** Hips and tail, origin at the pelvis joint. */
export function buildPenguinPelvis() {
  const m = new MeshBuilder();
  m.ellipsoid([0, 0, 0.02], [0.26, 0.16, 0.2], COAT, 3, 7);
  // A short, broad tail behind the body.
  m.segment([0, 0.02, 0.12], [0, -0.04, 0.38], 0.22, 0.1, COAT_LIGHT);
  return m.build();
}

/** The body, white belly and scarf, origin at the base of the spine. */
export function buildPenguinTorso() {
  return inAttitude(BODY_ATTITUDE.torso, (m) => {
    // A big egg: broad through the hips, tapering to the shoulders.
    m.ellipsoid([0, 0.26, 0.02], [0.3, 0.44, 0.27], COAT, 4, 8);
    // The white front stands proud of the black back.
    m.ellipsoid([0, 0.24, -0.17], [0.24, 0.35, 0.11], BELLY, 3, 7);
    // Two wraps of scarf and a loose end with a fringe; the tint colours them all.
    m.box([0, 0.65, 0], [0.44, 0.09, 0.36], SCARF);
    m.box([0, 0.58, 0], [0.42, 0.07, 0.34], SCARF);
    m.box([0.16, 0.47, -0.24], [0.1, 0.26, 0.05], SCARF);
    m.box([0.16, 0.32, -0.24], [0.12, 0.06, 0.06], SCARF);
  });
}

/** Head, face patch, orange cheeks, eyes and beak, origin at the base of the neck. */
export function buildPenguinHead() {
  const m = new MeshBuilder();
  m.ellipsoid([0, 0.15, -0.02], [0.21, 0.21, 0.21], COAT, 3, 7);
  m.ellipsoid([0, 0.13, -0.16], [0.16, 0.15, 0.08], BELLY, 2, 6);
  // Emperor-penguin cheek patches.
  for (const side of [-1, 1]) m.ellipsoid([side * 0.14, 0.12, -0.06], [0.045, 0.09, 0.09], BEAK, 2, 5);
  for (const side of [-1, 1]) m.box([side * 0.07, 0.19, -0.21], [0.055, 0.055, 0.03], EYE);
  m.segment([0, 0.11, -0.19], [0, 0.06, -0.36], 0.11, 0.09, BEAK);
  return m.build();
}

/** Upper flipper, origin at the shoulder; `side` is −1 (left) or 1 (right). */
function buildPenguinUpperArm(side) {
  const joint = side < 0 ? BODY_JOINTS.shoulderL : BODY_JOINTS.shoulderR;
  const elbow = side < 0 ? BODY_JOINTS.elbowL : BODY_JOINTS.elbowR;
  const m = new MeshBuilder();
  // A rounded shoulder hides the joint and widens into a paddle.
  m.ellipsoid([0, 0, 0], [0.07, 0.09, 0.11], COAT_LIGHT, 2, 5);
  m.segment([0, 0, 0], minus(elbow, joint), 0.06, 0.16, COAT_LIGHT);
  return m.build();
}

/** Forearm and flipper tip, origin at the elbow; `side` is −1 (left) or 1 (right). */
function buildPenguinForearm(side) {
  const elbow = side < 0 ? BODY_JOINTS.elbowL : BODY_JOINTS.elbowR;
  const hand = side < 0 ? BODY_JOINTS.handL : BODY_JOINTS.handR;
  const m = new MeshBuilder();
  m.segment([0, 0, 0], minus(hand, elbow), 0.05, 0.14, COAT_LIGHT);
  return m.build();
}

/** Black thigh, origin at the hip; chunky at the top and tapering to the knee. */
export function buildPenguinThigh() {
  const m = new MeshBuilder();
  const length = RIDER_GEOMETRY.thigh;
  m.segment([0, 0.02, 0], [0, -length * 0.55, 0], 0.19, 0.19, COAT);
  m.segment([0, -length * 0.55, 0], [0, -length, 0], 0.14, 0.14, COAT);
  return m.build();
}

/** Black shin with an orange ankle, origin at the knee. */
export function buildPenguinShin() {
  const m = new MeshBuilder();
  const length = RIDER_GEOMETRY.shin;
  m.segment([0, 0, 0], [0, -length * 0.5, 0], 0.11, 0.11, COAT);
  m.segment([0, -length * 0.5, 0], [0, -length, 0], 0.085, 0.085, COAT);
  m.ellipsoid([0, -length, 0], [0.07, 0.05, 0.08], BEAK, 2, 6);
  return m.build();
}

/** Webbed foot, ankle at the origin: sole 6 cm under it, toes to −Z like the shoe. */
export function buildPenguinFoot() {
  const m = new MeshBuilder();
  m.box([0, -0.03, -0.07], [0.16, 0.06, 0.28], BEAK);
  for (const x of [-0.055, 0, 0.055]) m.box([x, -0.04, -0.17], [0.045, 0.04, 0.08], BEAK);
  return m.build();
}

/** The 13 part builders the exercise clips need, named as `bodyTransforms` names them. */
export const penguinWorkoutParts = Object.freeze({
  pelvis: buildPenguinPelvis,
  torso: buildPenguinTorso,
  head: buildPenguinHead,
  upperArmL: () => buildPenguinUpperArm(-1),
  upperArmR: () => buildPenguinUpperArm(1),
  forearmL: () => buildPenguinForearm(-1),
  forearmR: () => buildPenguinForearm(1),
  thighL: buildPenguinThigh,
  thighR: buildPenguinThigh,
  shinL: buildPenguinShin,
  shinR: buildPenguinShin,
  footL: buildPenguinFoot,
  footR: buildPenguinFoot,
});
