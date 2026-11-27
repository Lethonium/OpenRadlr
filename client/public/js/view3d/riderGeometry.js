/**
 * The geometry of the rider's body in the bike frame: forward = −Z, up = +Y,
 * origin on the ground between the wheels. The rig (`assets/riders/`) and the
 * pose code (`riderPose.js`, `clips.js`) share these measures and joints.
 */

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
const RIDING_LEAN = Math.atan2(RIDER_GEOMETRY.hip[2] - -0.3, 1.36 - RIDER_GEOMETRY.hip[1]);

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
