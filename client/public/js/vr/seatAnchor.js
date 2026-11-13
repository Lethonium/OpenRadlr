/**
 * Where the rider's head is in the world, the frame the headset's pose is
 * added to: on the saddle, facing the way the road goes (in the studio: my
 * seat, facing the stage). Never anything that moves on its own: no bob.
 */
import { placement, yawFor } from "../view3d/math.js";
import { RIDER_GEOMETRY } from "../view3d/riderModel.js";

/** The yaw that faces along `direction` with its height dropped; straight up or down keeps yaw 0. */
function flatYaw([x, , z]) {
  return Math.hypot(x, z) < 1e-6 ? 0 : yawFor([x, 0, z]);
}

/**
 * The world-from-seat matrix (−Z forward, +Y up).
 * @param {{position: number[], forward: number[]}} placed my rider on the road
 * @param {{studioPov?: {eye: number[], target: number[]} | null}} options the studio's own eye and target
 */
export function seatAnchor(placed, { studioPov = null } = {}) {
  if (studioPov) {
    const { eye, target } = studioPov;
    return placement(eye, flatYaw([target[0] - eye[0], 0, target[2] - eye[2]]));
  }
  const [x, y, z] = placed.position;
  return placement([x, y + RIDER_GEOMETRY.headHeight, z], flatYaw(placed.forward));
}
