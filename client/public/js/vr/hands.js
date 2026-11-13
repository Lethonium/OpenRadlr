/**
 * Your hands in VR: the Quest's tracked hands (25 joints each, in seat space),
 * pulled onto the bike's grips when they are close, plus a resting pose for
 * the preview. Pure maths; `view3d` draws one box per bone.
 */
import { BODY_JOINTS, RIDER_GEOMETRY } from "../view3d/riderModel.js";
import { cross, normalize } from "../view3d/math.js";
import { positionOf } from "./xrFrame.js";

/** WebXR's joint order: wrist, then the thumb (4 joints), then index, middle, ring and little finger (5 each, metacarpal first). */
export const JOINT_COUNT = 25;
export const PALM_JOINT = 10; // the middle finger's metacarpal

const chain = (...joints) => joints.slice(1).map((joint, i) => [joints[i], joint]);
/** The 24 parent→child joint pairs. */
export const HAND_BONES = Object.freeze([
  ...chain(0, 1, 2, 3, 4),
  ...chain(0, 5, 6, 7, 8, 9),
  ...chain(0, 10, 11, 12, 13, 14),
  ...chain(0, 15, 16, 17, 18, 19),
  ...chain(0, 20, 21, 22, 23, 24),
]);

/** Where the bike's grips are in seat space (the seat is the bike frame, headHeight higher). */
export function gripPoints() {
  const toSeat = ([x, y, z]) => [x, y - RIDER_GEOMETRY.headHeight, z];
  return { left: toSeat(BODY_JOINTS.handL), right: toSeat(BODY_JOINTS.handR) };
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/** The hand moved as a whole (never turned) onto `grip`: fully within `full` metres of it, not at all beyond `reach`, blended between. */
export function snapHand(hand, grip, { reach = 0.1, full = 0.04 } = {}) {
  const palm = positionOf(hand.joints[PALM_JOINT]);
  const gap = [grip[0] - palm[0], grip[1] - palm[1], grip[2] - palm[2]];
  const d = Math.hypot(...gap);
  const s = d <= full ? 1 : d >= reach ? 0 : smoothstep((reach - d) / (reach - full));
  if (s === 0) return hand;
  const joints = hand.joints.map((m) => {
    const moved = new Float32Array(m);
    for (let k = 0; k < 3; k += 1) moved[12 + k] += s * gap[k];
    return moved;
  });
  return { ...hand, joints };
}

/** A hand curled round the grip, the middle finger's knuckle on it. Seat space, fingers pointing forward (−Z). */
export function restingHand(handedness, grip) {
  const side = handedness === "right" ? 1 : -1;
  // Offsets from the palm: [right, up, forward], metres.
  const finger = (x, reach) => [
    [x, 0, 0.0],
    [x, 0.005, -0.04 * reach],
    [x, -0.005, -0.065 * reach],
    [x, -0.03, -0.075 * reach],
    [x, -0.045, -0.06 * reach],
  ];
  const offsets = [
    [0.0, 0.01, 0.09], // wrist
    [-0.03 * side, 0.0, 0.04], // thumb
    [-0.04 * side, 0.01, 0.0],
    [-0.045 * side, 0.015, -0.03],
    [-0.045 * side, 0.015, -0.055],
    ...finger(-0.025 * side, 1), // index
    ...finger(0, 1.05), // middle
    ...finger(0.022 * side, 0.95), // ring
    ...finger(0.042 * side, 0.8), // little
  ];
  const joints = offsets.map(([x, y, forward]) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, grip[0] + x, grip[1] + y, grip[2] - forward, 1]));
  return { handedness, joints, radii: offsets.map(() => 0.011) };
}

/**
 * The model matrix of each bone's box (a unit cube centred on the origin): its
 * centre between the two joints, long along −Z-to-joint, `2 × radius` thick.
 * @returns {Float32Array[]} one per `HAND_BONES` entry, in the hand's space
 */
export function boneModels(hand) {
  return HAND_BONES.map(([from, to]) => {
    const a = positionOf(hand.joints[from]);
    const b = positionOf(hand.joints[to]);
    const along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const length = Math.max(Math.hypot(...along), 1e-4);
    const z = normalize(along);
    const x = normalize(Math.abs(z[1]) > 0.99 ? cross([0, 0, 1], z) : cross([0, 1, 0], z));
    const y = cross(z, x);
    const thick = 2 * hand.radii[to];
    return new Float32Array([x[0] * thick, x[1] * thick, x[2] * thick, 0, y[0] * thick, y[1] * thick, y[2] * thick, 0, z[0] * length, z[1] * length, z[2] * length, 0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1]);
  });
}
