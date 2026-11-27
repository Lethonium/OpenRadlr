/**
 * The workout rider's exercise clips (#77, #90): hand-keyed joint angles for
 * `poseAt`, in the sign convention of `riderPose.js` (a knee bends with −, the
 * spine bends forward with −, `root.pitch = π/2` lies on the back, −π/2 face
 * down). Every rider faces −Z (the road at the gym); a lying or face-down
 * rider is shifted along Z by `root.z` so the body stays centred on its spot.
 *
 * In a clip, `root.y` is not the root's height but how far the lowest point of
 * the body is off the ground: 0, but in the air of a jump. The rigged rider's
 * `settleOnRig` (assets/riders/retarget.js) turns it into the height the rig
 * wants, every frame, so whatever the joints do between two keys the body
 * stands, lies or rests on the ground.
 */
import { JOINTS } from "./riderPose.js";

const OTHER_SIDE = (joint) => joint.replace(/^(.*)([LR])(z?)$/, (_, base, side, z) => `${base}${side === "L" ? "R" : "L"}${z}`);

/**
 * `pose` seen in a mirror: every left joint takes its right partner's angle and
 * vice versa. The sideways (`…z`) angles count outward on both sides, the spine
 * and neck have no sideways joint, and the root no sideways part, so swapping is
 * all it takes.
 */
export function mirrorPose(pose) {
  return { root: { ...pose.root }, joints: Object.fromEntries(JOINTS.map((joint) => [joint, pose.joints[OTHER_SIDE(joint)]])) };
}

/** A clip's `plant` for the mirrored pose: the other foot (or its mesh's partner); `null` stays `null`. */
export function mirrorPlant(plant) {
  if (!plant) return plant;
  return Object.freeze({ ...plant, mesh: OTHER_SIDE(plant.mesh) });
}

/** `clip` whose `plant` mesh (a foot) holds still; the rig measures where from its first key. */
function planted(clip, mesh) {
  return { ...clip, plant: Object.freeze({ mesh }) };
}

/** Both sides at once: `{ "hip#": 1 }` → `{ hipL: 1, hipR: 1 }`. */
function both(angles) {
  const out = {};
  for (const [name, angle] of Object.entries(angles)) {
    if (name.includes("#")) {
      out[name.replace("#", "L")] = angle;
      out[name.replace("#", "R")] = angle;
    } else out[name] = angle;
  }
  return out;
}

const key = (t, { y = 0, z = 0, pitch = 0 } = {}, joints = {}) => ({ t, root: { y, z, pitch }, joints: both(joints) });

/** Arms a little away from the body, so the hands hang clear of the thighs. */
const STAND = { "shoulder#z": 0.12, "elbow#": 0.12 };
const stand = (t) => key(t, {}, STAND);

const idle = {
  loopS: 4,
  keys: [
    stand(0),
    // Breathing in: chest up and back a touch, shoulders lift.
    key(2, {}, { spine: 0.03, neck: -0.03, "shoulder#z": 0.15, "elbow#": 0.16 }),
    stand(4),
  ],
};

/** Thighs level, hips back over the heels, arms out front for balance. */
const SQUAT_DOWN = key(0, { z: 0.228 }, { "hip#": 1.55, "knee#": -2.05, "ankle#": 0.5, spine: -0.5, neck: 0.3, "shoulder#": 1.75, "shoulder#z": 0.05 });
const squats = {
  loopS: 2.5,
  keys: [stand(0), { ...SQUAT_DOWN, t: 1.1 }, { ...SQUAT_DOWN, t: 1.35 }, stand(2.5)],
};

/** On the back, knees up and feet flat; the body centred on the spot. */
const LYING = { z: -1, pitch: Math.PI / 2 };
const LEGS_UP = { "hip#": 0.7, "knee#": -1.85, "ankle#": -0.42 };
const situps = {
  loopS: 2.5,
  keys: [
    key(0, LYING, { ...LEGS_UP, "shoulder#": -0.2, "shoulder#z": 0.12 }),
    key(1.1, LYING, { ...LEGS_UP, spine: -1, neck: -0.3, "shoulder#": 0.5, "shoulder#z": 0.12 }),
    key(1.4, LYING, { ...LEGS_UP, spine: -1, neck: -0.3, "shoulder#": 0.5, "shoulder#z": 0.12 }),
    key(2.5, LYING, { ...LEGS_UP, "shoulder#": -0.2, "shoulder#z": 0.12 }),
  ],
};

/**
 * Face down on hands and toes: arms straight under the shoulders (up) or bent
 * with the chest near the mat (down); the hands and toes stay put. `z` moves
 * the whole plank, so the burpee can kick back from its squat.
 */
const pushUp = (t, z) => key(t, { z, pitch: -1.21 }, { "ankle#": 0.21, "shoulder#": 1.21, "shoulder#z": 0.1, neck: 0.3 });
const pushDown = (t, z) => key(t, { z: z - 0.034, pitch: -1.45 }, { "ankle#": 0.21, "shoulder#": 0.06, "elbow#": 2, "shoulder#z": 0.1, neck: 0.35 });
/** Centres the push-up and the plank (toes to head) on the spot. */
const PLANK_Z = 0.85;
const pushups = {
  loopS: 2,
  keys: [pushUp(0, PLANK_Z), pushDown(0.9, PLANK_Z), pushDown(1.1, PLANK_Z), pushUp(2, PLANK_Z)],
};

/** Forearm plank: upper arms straight down, forearms flat on the mat; the chest breathes. */
const forearms = (t, spine) =>
  key(t, { z: PLANK_Z, pitch: -1.455 }, { spine, "ankle#": 0.455, "shoulder#": 1.455, "elbow#": Math.PI / 2, "shoulder#z": 0.1, neck: 0.3 });
const plank = { loopS: 4, keys: [forearms(0, 0), forearms(2, -0.03), forearms(4, 0)] };

/** Jumping jacks: arms up wide and legs apart; the feet stay flat (`ankle#z` undoes `hip#z`). */
const jackOpen = (t) => key(t, {}, { "hip#z": 0.3, "ankle#z": -0.3, "shoulder#z": 2.6, "elbow#": 0.2 });
const jackAir = (t) => key(t, { y: 0.07 }, { "hip#z": 0.15, "ankle#z": -0.15, "ankle#": -0.25, "shoulder#z": 1.4, "elbow#": 0.15 });
const jumpingJacks = {
  loopS: 1,
  keys: [stand(0), jackAir(0.25), jackOpen(0.5), jackAir(0.75), stand(1)],
};

/** Burpee: squat with the hands on the mat, kick back to a plank, push-up, back in, jump. */
const BURPEE_SQUAT = { z: 0.239 };
const burpeeSquat = (t) =>
  key(t, BURPEE_SQUAT, { "hip#": 1.75, "knee#": -2.2, "ankle#": 0.45, spine: -1, neck: 0.4, "shoulder#": 1.16, "elbow#": 0.28, "shoulder#z": 0.12 });
/** The burpee's plank: its hands where the squat put them. */
const KICK_Z = 0.962;
/** Half-way through the kick back (and the hop back in): hands on the mat, knees tucked, feet off it. */
const tuck = (t) =>
  key(t, { y: 0.03, z: 0.916, pitch: -1.1 }, { spine: -0.1, neck: 0.4, "shoulder#": 1.2, "shoulder#z": 0.12, "hip#": 1.5, "knee#": -2.4, "ankle#": 0.3 });
const burpees = {
  loopS: 3.5,
  keys: [
    stand(0),
    burpeeSquat(0.5),
    tuck(0.7),
    pushUp(0.9, KICK_Z),
    pushDown(1.35, KICK_Z),
    pushUp(1.8, KICK_Z),
    tuck(2.0),
    burpeeSquat(2.25),
    key(2.75, { y: 0.15 }, { "ankle#": -0.3, "shoulder#z": 2.7, "elbow#": 0.2 }),
    key(3.05, {}, { "hip#": 0.45, "knee#": -0.8, "ankle#": 0.35, spine: -0.15, "shoulder#z": 0.5, "elbow#": 0.3 }),
    stand(3.5),
  ],
};

/*
 * Yoga. Sided poses are keyed on the RIGHT side (the view mirrors a rider on
 * their left). A held pose breathes on a 4 to 6 s loop: at its middle the
 * spine and neck move a few hundredths, like the plank.
 */

/** A held pose: `root` and `joints` at rest, `breath` added to them at the loop's middle. */
function hold(loopS, root, joints, breath) {
  const deep = Object.fromEntries(Object.entries(joints).map(([name, angle]) => [name, angle + (breath[name] ?? 0)]));
  for (const [name, delta] of Object.entries(breath)) deep[name] ??= delta;
  return { loopS, keys: [key(0, root, joints), key(loopS / 2, root, deep), key(loopS, root, joints)] };
}

/** Arms overhead: the upward salute. */
const SALUTE = { "shoulder#": 2.9, "shoulder#z": 0.2, "elbow#": 0.1, spine: 0.08, neck: -0.1 };
/** Standing forward fold: legs straight, the torso hanging, the hands to the mat. */
const FOLD = { spine: -2.1, "shoulder#": 2.1, "shoulder#z": 0.1, "elbow#": 0.1, neck: 0.3 };
/** Half lift: back flat and parallel to the mat, the hands on the shins. */
const HALF_LIFT = { spine: -1.45, "shoulder#": 1.45, "shoulder#z": 0.1, neck: 0.5 };
/** Upward dog: the tops of the feet and the hands on the mat, thighs just off it, chest open, arms straight. */
const UP_DOG_ROOT = { pitch: -1.45 };
const UP_DOG = { spine: 0.85, neck: 0.4, "shoulder#": 0.6, "shoulder#z": 0.1, "ankle#": -1.2 };
/** Downward dog: hips high, heels near the mat, arms by the ears. */
const DOWN_DOG_ROOT = { pitch: -0.7 };
const DOWN_DOG = { spine: -1.3, neck: 0.3, "shoulder#": 2.8, "shoulder#z": 0.15, "ankle#": 0.6 };

/** Sun Salutation A, one breath (4 s) a position: salute, fold, half lift, plank, chaturanga, upward dog, downward dog, half lift, fold, salute. */
const sunSalutation = {
  loopS: 36,
  keys: [
    key(0, {}, SALUTE),
    key(4, {}, FOLD),
    key(8, {}, HALF_LIFT),
    pushUp(12, PLANK_Z),
    pushDown(16, PLANK_Z),
    key(20, UP_DOG_ROOT, UP_DOG),
    key(24, DOWN_DOG_ROOT, DOWN_DOG),
    key(28, {}, HALF_LIFT),
    key(32, {}, FOLD),
    key(36, {}, SALUTE),
  ],
};
const forwardFold = hold(5, {}, FOLD, { spine: -0.06, neck: 0.04 });
const downwardDog = hold(5, DOWN_DOG_ROOT, DOWN_DOG, { spine: -0.04, neck: 0.04 });
/** Cobra: face down, hips and legs on the mat, the chest lifted on bent arms with the hands beside the ribs. */
const cobra = hold(5, { pitch: -1.45 }, { spine: 0.6, neck: 0.3, "shoulder#": 0.15, "elbow#": 1, "shoulder#z": 0.1, "ankle#": -1.4 }, { spine: 0.05, neck: -0.03 });
/** Child's pose: kneeling, hips back on the heels, the chest on the thighs, arms stretched forward on the mat. */
const childPose = hold(6, {}, { "hip#": 1.25, "knee#": -2.82, "ankle#": -1.2, spine: -1.7, neck: 0.3, "shoulder#": 3.1, "shoulder#z": 0.1 }, { spine: 0.04, neck: -0.03 });
/** Low lunge (right foot forward): front shin upright, back knee and the top of the back foot on the mat, arms raised. */
const lowLunge = hold(5, {}, { hipR: 1.6, kneeR: -1.6, hipL: -0.4, kneeL: -1.2, ankleL: -1.2, ...SALUTE }, { spine: 0.04, neck: -0.03 });
/** Pigeon, upright: right thigh forward and turned out with the shin folded in, left leg long behind with the knee and the top of the foot on the mat, hands beside the hips. */
const pigeon = hold(
  6,
  {},
  { hipR: 1.45, hipRz: 0.9, kneeR: -2.7, hipL: -1.3, kneeL: -0.05, ankleL: -1.2, spine: 0.05, neck: -0.05, "shoulder#": 0.25, "shoulder#z": 0.2, "elbow#": 0.25 },
  { spine: 0.04, neck: -0.03 },
);

/** Every exercise's clip, plus `idle` (rest, get-ready, paused). */
export const CLIPS = Object.freeze({
  idle,
  squats: planted(squats, "footR"),
  situps: planted(situps, "footR"),
  pushups: planted(pushups, "footR"),
  jumping_jacks: jumpingJacks,
  plank: planted(plank, "footR"),
  burpees,
  sun_salutation: planted(sunSalutation, "footR"),
  forward_fold: planted(forwardFold, "footR"),
  downward_dog: planted(downwardDog, "footR"),
  cobra: planted(cobra, "footR"),
  child_pose: planted(childPose, "footR"),
  low_lunge: planted(lowLunge, "footR"),
  pigeon: planted(pigeon, "footR"),
});

/** The clip for an exercise; no or an unknown exercise stands idle. */
export function clipFor(exercise) {
  return Object.hasOwn(CLIPS, exercise ?? "") ? CLIPS[exercise] : CLIPS.idle;
}

/**
 * The moment of each exercise a statue freezes, and the plinth it stands or
 * lies on: a squat at its bottom, a push-up down, a sit-up halfway up, a
 * jumping jack open, a burpee at the top of its jump.
 */
export const STATUE_MOMENT = Object.freeze({
  squats: Object.freeze({ t: 1.2, plinth: "upright" }),
  pushups: Object.freeze({ t: 1.0, plinth: "lying" }),
  plank: Object.freeze({ t: 0, plinth: "lying" }),
  situps: Object.freeze({ t: 0.6, plinth: "lying" }),
  jumping_jacks: Object.freeze({ t: 0.5, plinth: "upright" }),
  burpees: Object.freeze({ t: 2.75, plinth: "upright" }),
  sun_salutation: Object.freeze({ t: 0, plinth: "upright" }),
  forward_fold: Object.freeze({ t: 0, plinth: "upright" }),
  downward_dog: Object.freeze({ t: 0, plinth: "lying" }),
  cobra: Object.freeze({ t: 0, plinth: "lying" }),
  child_pose: Object.freeze({ t: 0, plinth: "lying" }),
  low_lunge: Object.freeze({ t: 0, plinth: "lying" }),
  pigeon: Object.freeze({ t: 0, plinth: "lying" }),
});
