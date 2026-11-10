/**
 * How the roadside crowd behaves (placement is in features.js): how much of
 * it is out for the riders online, and how each spectator cheers a rider
 * coming by. Pure functions of positions and time.
 * See docs/superpowers/specs/2026-11-10-crowds-design.md.
 */
import { yawFor } from "./math.js";

export const CROWD = Object.freeze({
  /** Share of the lining crowd out for one rider, and what each further human rider adds. */
  share: { alone: 0.35, perRider: 0.15 },
  /** Spectators line this many metres before a climb's top. */
  liningM: 600,
  /** A rider closer than this gets cheered, more the closer. */
  reachM: 28,
  /** How far (radians) a spectator turns from facing the road to follow a rider. */
  turnMax: 1.1,
  /** Share of spectators with a flag. */
  flags: 0.18,
});

/** The share (0–1) of the lining crowd out for `humans` human riders on the server. */
export function crowdShare(humans) {
  return Math.min(1, CROWD.share.alone + CROWD.share.perRider * Math.max(0, humans - 1));
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smoothstep = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * One spectator's pose this frame: which way it faces, how high it hops, arms
 * up or down (penguins: the clap's two poses) and how excited it is (0–1).
 * @param {{position: number[], yaw: number, armsUp: boolean, motion: string, phase: number}} person
 * @param {number[][]} riders positions of riders nearby
 */
export function cheer(person, riders, timeS) {
  let nearest = null;
  let best = CROWD.reachM;
  for (const at of riders) {
    const d = Math.hypot(at[0] - person.position[0], at[2] - person.position[2]);
    if (d < best) {
      best = d;
      nearest = at;
    }
  }
  const excitement = nearest ? 1 - best / CROWD.reachM : 0;

  let yaw = person.yaw;
  if (nearest && best > 0.01) {
    const towards = yawFor([nearest[0] - person.position[0], 0, nearest[2] - person.position[2]]);
    const turn = Math.max(-CROWD.turnMax, Math.min(CROWD.turnMax, wrapAngle(towards - person.yaw)));
    yaw = person.yaw + turn * smoothstep(excitement * 2);
  }

  // People jump with their arms up; penguins clap by alternating the two
  // poses, with a tiny bob so the motion still reads at a distance.
  if (person.motion === "clap") {
    const tick = timeS * (7.5 + 6 * excitement) + person.phase;
    return { yaw, lift: Math.abs(Math.sin(tick)) * (0.02 + 0.05 * excitement), pose: Math.sin(tick) > 0, excitement };
  }
  const pose = person.armsUp || excitement > 0.25;
  const tick = timeS * (6 + 4 * excitement) + person.phase;
  const lift = pose ? Math.max(0, Math.sin(tick)) * (0.14 + 0.22 * excitement) : Math.sin(timeS * 3 + person.phase) * 0.02;
  return { yaw, lift, pose, excitement };
}
