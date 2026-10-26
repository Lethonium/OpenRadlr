/**
 * Ride cameras. All of them are placed relative to the road (not in free
 * space), so they follow corners and climbs without lagging. Only the
 * sideways offset is smoothed, so lane changes glide instead of jump.
 * Switching modes blends between the old and the new pose.
 */
import { add, lerp3, scale } from "./math.js";
import { LANE_WIDTH, roadFrame, roadHalfWidth } from "./world.js";

export const CAMERA_MODES = Object.freeze({
  chase: { label: "Chase", back: 5.5, up: 2.2, lookAhead: 9, lookUp: 1.1 },
  close: { label: "Close", back: 3.0, up: 1.55, lookAhead: 8, lookUp: 1.2 },
  drone: { label: "Drone", back: 15, up: 7.5, lookAhead: 16, lookUp: 0.5 },
  side: { label: "TV side", side: true, ahead: 3, up: 1.7, lookUp: 1.0 },
});

/** Backwards-compatible default (chase). */
export const CAMERA = Object.freeze({ ...CAMERA_MODES.chase, lateralRate: 4 });

/**
 * A mode's settings for a rider aboard a vehicle (`{cameraBack, cameraUp}` from
 * its layout): the chase camera takes the layout's values, the close one the
 * same proportions; drone and TV side keep theirs.
 */
export function vehicleSettings(settings, vehicle) {
  if (!vehicle || settings.side || settings === CAMERA_MODES.drone) return settings;
  const chase = CAMERA_MODES.chase;
  return { ...settings, back: (settings.back * vehicle.cameraBack) / chase.back, up: (settings.up * vehicle.cameraUp) / chase.up };
}

const TRANSITION_S = 0.8;

/**
 * Camera pose for a rider at `distance` with a sideways offset in metres
 * (0 = road centre, positive = right).
 */
export function cameraPose(route, distance, lateral, settings = CAMERA) {
  if (settings.side) {
    const at = roadFrame(route, distance + settings.ahead);
    const rider = roadFrame(route, distance);
    const offset = roadHalfWidth(route.lanes) + 3.5;
    return {
      eye: add(add(at.center, scale(at.right, offset)), [0, settings.up, 0]),
      target: add(add(rider.center, scale(rider.right, lateral)), [0, settings.lookUp, 0]),
    };
  }
  const behind = roadFrame(route, distance - settings.back);
  const ahead = roadFrame(route, distance + settings.lookAhead);
  return {
    eye: add(add(behind.center, scale(behind.right, lateral)), [0, settings.up, 0]),
    target: add(add(ahead.center, scale(ahead.right, lateral)), [0, settings.lookUp, 0]),
  };
}

export class ChaseCamera {
  eye = null;
  target = null;
  mode = "chase";
  #lateral = null;
  #previous = null;
  #blend = 1;

  constructor(route, settings = CAMERA) {
    this.route = route;
    this.lateralRate = settings.lateralRate ?? 4;
  }

  setMode(mode) {
    if (!CAMERA_MODES[mode] || mode === this.mode) return;
    this.#previous = this.mode;
    this.#blend = 0;
    this.mode = mode;
  }

  /** Cycles chase → close → drone → side → chase. Returns the new mode. */
  cycle() {
    const modes = Object.keys(CAMERA_MODES);
    this.setMode(modes[(modes.indexOf(this.mode) + 1) % modes.length]);
    return this.mode;
  }

  /** Follows a rider given by distance and continuous lane; `vehicle` is the layout when aboard one. */
  update(distance, lane, dt, vehicle = null) {
    // Half-way between the rider's lane and the road centre for behind-cameras;
    // the TV camera aims at the rider itself.
    const riderLateral = (lane - (this.route.lanes - 1) / 2) * LANE_WIDTH;
    const wanted = this.mode === "side" ? riderLateral : 0.5 * riderLateral;
    if (this.#lateral === null) this.#lateral = wanted;
    this.#lateral += (wanted - this.#lateral) * (1 - Math.exp(-this.lateralRate * Math.max(0, dt)));

    let pose = cameraPose(this.route, distance, this.#lateral, vehicleSettings(CAMERA_MODES[this.mode], vehicle));
    if (this.#blend < 1 && this.#previous) {
      this.#blend = Math.min(1, this.#blend + Math.max(0, dt) / TRANSITION_S);
      const from = cameraPose(this.route, distance, this.#lateral, vehicleSettings(CAMERA_MODES[this.#previous], vehicle));
      const t = this.#blend * this.#blend * (3 - 2 * this.#blend);
      pose = { eye: lerp3(from.eye, pose.eye, t), target: lerp3(from.target, pose.target, t) };
    }
    this.eye = pose.eye;
    this.target = pose.target;
    return this;
  }
}
