/**
 * Where the animals are and how their limbs move, as pure functions of the plan entry and the scene's time `t`.
 * Positions are in the plan's world metres (heights are the layer's business); `y` is an offset: above the ground
 * for walkers and butterflies, above the water for dolphins, above the flock's altitude for birds.
 * Yaw turns about y (forward is +z), pitch about x (positive tips the nose down).
 */

/** Radians of the walk cycle per metre per second of speed, and the wing beats per second (radians) of bird and butterfly. */
const STRIDE = 4;
const BIRD_FLAP = 14;
const BUTTERFLY_FLAP = 30;
/** Share of the herd radius an animal wanders on each axis (the diagonal stays inside the radius). */
const WANDER = 0.7;
/** Dolphins: seconds per breach cycle, the share of it spent above water, the jump's height, the loop they swim. */
const DOLPHIN = Object.freeze({ period: 9, above: 0.3, height: 2.4, depth: -1.5, loop: 18, speed: 4 });

/** A repeatable pseudo-random number in [0, 1) for `seed` and a slot. */
const unit = (seed, slot) => {
  const s = Math.sin(seed * 127.1 + slot * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const TAU = Math.PI * 2;

/**
 * A walker wandering and grazing inside its radius.
 * @param {{x: number, z: number, radius: number, seed: number, speed?: number}} animal
 * @param {number} t
 */
export function grazePose(animal, t) {
  const { x, z, radius, seed, speed = 0.6 } = animal;
  const w1 = (0.55 * speed) / Math.max(1, radius) * (0.8 + unit(seed, 1) * 0.4);
  const w2 = (0.55 * speed) / Math.max(1, radius) * (0.8 + unit(seed, 2) * 0.4);
  const p1 = unit(seed, 3) * TAU;
  const p2 = unit(seed, 4) * TAU;
  const r = radius * WANDER;
  const vx = r * w1 * Math.cos(w1 * t + p1);
  const vz = r * w2 * Math.cos(w2 * t + p2);
  const head = Math.max(0, Math.sin(t * 0.5 + unit(seed, 5) * TAU)) * 0.9;
  return {
    x: x + r * Math.sin(w1 * t + p1),
    y: 0,
    z: z + r * Math.sin(w2 * t + p2),
    yaw: Math.atan2(vx, vz),
    pitch: 0,
    roll: 0,
    gait: t * speed * STRIDE,
    legs: head > 0.3 ? 0.25 : 1,
    head,
    tail: Math.sin(t * 3 + seed),
    flap: 0,
  };
}

/**
 * Bird `index` of a flock circling its centre.
 * @param {{x: number, z: number, radius: number, seed: number}} flock
 * @param {number} index
 * @param {number} t
 * @param {number} speed flight speed, metres per second
 */
export function flockPose(flock, index, t, speed) {
  const seed = flock.seed + index * 17;
  const r = flock.radius * (0.55 + unit(seed, 1) * 0.45);
  const w = speed / r;
  const a = unit(flock.seed, 2) * TAU + w * t + index * 0.35;
  return {
    x: flock.x + r * Math.cos(a),
    y: Math.sin(a * 2 + index) * 3,
    z: flock.z + r * Math.sin(a),
    yaw: Math.atan2(-Math.sin(a), Math.cos(a)),
    pitch: 0,
    roll: 0.3,
    gait: 0,
    legs: 0,
    head: 0,
    tail: 0,
    flap: t * BIRD_FLAP + index * 1.3,
  };
}

/**
 * A dolphin swimming a wide loop, surfacing and jumping once a cycle.
 * @param {{x: number, z: number, seed: number}} dolphin
 * @param {number} t
 */
export function dolphinPose(dolphin, t) {
  const { x, z, seed } = dolphin;
  const loop = DOLPHIN.loop;
  const w = DOLPHIN.speed / loop;
  const a = unit(seed, 1) * TAU + w * t;
  const u = ((t / (DOLPHIN.period * (0.9 + unit(seed, 2) * 0.3)) + unit(seed, 3)) % 1 + 1) % 1;
  const jump = u < DOLPHIN.above;
  const arc = jump ? Math.sin((u / DOLPHIN.above) * Math.PI) : 0;
  const slope = jump ? (Math.cos((u / DOLPHIN.above) * Math.PI) * Math.PI) / DOLPHIN.above : 0;
  return {
    x: x + loop * Math.cos(a),
    y: jump ? arc * DOLPHIN.height + DOLPHIN.depth * (1 - arc) * 0.2 : DOLPHIN.depth,
    z: z + loop * Math.sin(a),
    yaw: Math.atan2(-Math.sin(a), Math.cos(a)),
    pitch: jump ? -Math.atan(slope * 0.4) : 0,
    roll: 0,
    gait: 0,
    legs: 0,
    head: 0,
    tail: Math.sin(t * 5 + seed),
    flap: 0,
  };
}

/**
 * A butterfly fluttering near its spot.
 * @param {{x: number, z: number, seed: number}} butterfly
 * @param {number} t
 */
export function butterflyPose(butterfly, t) {
  const { x, z, seed } = butterfly;
  const a = t * 0.6 + unit(seed, 1) * TAU;
  const b = t * 0.9 + unit(seed, 2) * TAU;
  return {
    x: x + 2 * Math.sin(a),
    y: 0.9 + 0.4 * Math.sin(b * 1.7),
    z: z + 2 * Math.cos(b),
    yaw: Math.atan2(2 * 0.6 * Math.cos(a), -2 * 0.9 * Math.sin(b)),
    pitch: 0,
    roll: 0,
    gait: 0,
    legs: 0,
    head: 0,
    tail: 0,
    flap: t * BUTTERFLY_FLAP + seed,
  };
}

/**
 * The angle (radians) a limb turns by in `pose`: legs about x by the gait, head and tail about x, wings about z.
 * @param {{swing: string, phase: number, pivot: number[]}} limb
 * @param {ReturnType<typeof grazePose>} pose
 */
export function limbAngle(limb, pose) {
  if (limb.swing === "leg") return Math.sin(pose.gait + Math.PI * limb.phase) * 0.5 * pose.legs;
  if (limb.swing === "head") return pose.head;
  if (limb.swing === "tail") return pose.tail * 0.25;
  return Math.sin(pose.flap) * 0.7 * Math.sign(limb.pivot[0] || 1);
}
