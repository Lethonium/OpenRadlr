/**
 * The workout rider's exercise clips (#77, #90): hand-keyed joint angles for
 * `poseAt`, in the sign convention of `riderPose.js` (a knee bends with −, the
 * spine bends forward with −, `root.pitch = π/2` lies on the back, −π/2 face
 * down). Every rider faces −Z (the road at the gym); a lying or face-down
 * rider is shifted along Z by `root.z` so the body stays centred on its spot.
 *
 * In a clip, `root.y` is not the root's height but how far the lowest point of
 * the body is off the ground: 0, but in the air of a jump. `settle` turns it
 * into the height `bodyTransforms` wants, every frame, so whatever the joints
 * do between two keys the body stands, lies or rests on the ground.
 */
import { buildForearm, buildHead, buildPelvis, buildShin, buildShoe, buildThigh, buildTorso, buildUpperArm, variantLook } from "./riderModel.js";
import { transformPoint } from "./math.js";
import { bodyTransforms, poseAt } from "./riderPose.js";

const look = variantLook(0);
/** The corners of each body part's mesh (the same for every look), to find the lowest point of a pose. */
const SHAPES = new Map(
  Object.entries({
    pelvis: buildPelvis(look),
    torso: buildTorso(look),
    head: buildHead(look),
    upperArmL: buildUpperArm(look, -1),
    upperArmR: buildUpperArm(look, 1),
    forearmL: buildForearm(look, -1),
    forearmR: buildForearm(look, 1),
    thighL: buildThigh(look),
    thighR: buildThigh(look),
    shinL: buildShin(look),
    shinR: buildShin(look),
    footL: buildShoe(),
    footR: buildShoe(),
  }).map(([name, mesh]) => [name, corners(mesh.positions)]),
);

function corners(positions) {
  const seen = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i], positions[i + 1], positions[i + 2]];
    seen.set(p.map((v) => v.toFixed(4)).join(","), p);
  }
  return [...seen.values()];
}

/** Lowest point of the body over the ground and the Z of a body point (`{mesh, at}`), for a pose as `bodyTransforms` takes it. */
function measure(pose, plant) {
  let lowest = Infinity;
  let z = 0;
  for (const { mesh, model: m } of bodyTransforms(pose)) {
    for (const [x, y, w] of SHAPES.get(mesh)) lowest = Math.min(lowest, m[1] * x + m[5] * y + m[9] * w + m[13]);
    if (plant?.mesh === mesh) z = transformPoint(m, plant.at)[2];
  }
  return { lowest, z };
}

/**
 * A clip pose (`root.y` = height off the ground) as a pose for `bodyTransforms`:
 * lifted or lowered so its lowest point is that high, and with a clip's
 * `plant` (a body point that holds still, such as the feet in a squat) moved
 * back along Z to where the clip's first key has it.
 */
export function settle(pose, plant = null) {
  const at = { ...pose, root: { ...pose.root, y: 0 } };
  const { lowest, z } = measure(at, plant);
  const root = { ...pose.root, y: pose.root.y - lowest };
  if (plant) root.z = (pose.root.z ?? 0) + plant.z - z;
  return { ...pose, root };
}

/** `clip` whose `plant` point stays where its first key puts it. */
function planted(clip, mesh, at) {
  const first = { ...poseAt(clip, 0), root: { ...poseAt(clip, 0).root, y: 0 } };
  return { ...clip, plant: Object.freeze({ mesh, at, z: measure(first, { mesh, at }).z }) };
}

/** The ankle, and the tip of the shoe (the toes of a plank). */
const ANKLE = [0, 0, 0];
const TOES = [0, -0.06, -0.2];

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

/** Every exercise's clip, plus `idle` (rest, get-ready, paused). */
export const CLIPS = Object.freeze({
  idle,
  squats: planted(squats, "footR", ANKLE),
  situps: planted(situps, "footR", ANKLE),
  pushups: planted(pushups, "footR", TOES),
  jumping_jacks: jumpingJacks,
  plank: planted(plank, "footR", TOES),
  burpees,
});

/** The clip for an exercise; no or an unknown exercise stands idle. */
export function clipFor(exercise) {
  return Object.hasOwn(CLIPS, exercise ?? "") ? CLIPS[exercise] : CLIPS.idle;
}
