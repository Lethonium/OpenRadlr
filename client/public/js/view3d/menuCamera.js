/**
 * The start menu's camera: a drone slowly circling high above the island,
 * and on picking a route a glide down to it, then slowly following the road
 * from the start; on the workout card a low circle around the café's outdoor
 * gym. With reduced motion it cuts between still views instead.
 *
 * Works on the scene's plain-data `overview` (centre, size, sea level and a
 * coarse height grid), so it runs on the main thread without the terrain.
 */
import { lerp3 } from "./math.js";
import { roadFrame } from "./world.js";

export const MENU_CAMERA = Object.freeze({
  /** Orbit: radians per second, distance and height relative to the island's radius. */
  orbitRate: 0.025,
  orbitDistance: 1.0,
  orbitHeight: 0.42,
  /** Seconds for a flight between views. */
  flightS: 3.2,
  /** Following a route: speed along it, and where the camera sits (metres). */
  followSpeed: 18,
  back: 260,
  side: 150,
  up: 170,
  lookAhead: 160,
  /** Never closer to the ground than this (but for the gym orbit). */
  clearance: 70,
  /** Circling the outdoor gym: radians per second, distance and height (metres). */
  gymRate: 0.09,
  gymDistance: 38,
  gymHeight: 17,
});

const ease = (t) => t * t * (3 - 2 * t);

/** Ground (or sea) height from the overview's coarse grid, bilinear. */
export function groundAt(overview, x, z) {
  const grid = overview?.grid;
  if (!grid) return overview?.sea ?? 0;
  const u = Math.min(grid.columns - 1.001, Math.max(0, (x - grid.x0) / grid.cell));
  const v = Math.min(grid.rows - 1.001, Math.max(0, (z - grid.z0) / grid.cell));
  const c = Math.floor(u);
  const r = Math.floor(v);
  const fu = u - c;
  const fv = v - r;
  const at = (cc, rr) => grid.heights[rr * grid.columns + cc];
  const top = at(c, r) + (at(c + 1, r) - at(c, r)) * fu;
  const bottom = at(c, r + 1) + (at(c + 1, r + 1) - at(c, r + 1)) * fu;
  return top + (bottom - top) * fv;
}

/** High above the island, looking at its centre from `angle`. */
export function orbitPose(overview, angle, settings = MENU_CAMERA) {
  const [cx, cz] = overview.center;
  const distance = overview.radius * settings.orbitDistance;
  return {
    eye: [cx + Math.cos(angle) * distance, overview.sea + overview.radius * settings.orbitHeight, cz + Math.sin(angle) * distance],
    target: [cx, overview.sea + 40, cz],
  };
}

/** An angled view from behind and beside the road at `distance`, looking along it. */
export function routePose(route, distance, overview, settings = MENU_CAMERA) {
  const behind = roadFrame(route, distance - settings.back);
  const ahead = roadFrame(route, distance + settings.lookAhead);
  const eye = [behind.center[0] + behind.right[0] * settings.side, behind.center[1] + settings.up, behind.center[2] + behind.right[2] * settings.side];
  eye[1] = Math.max(eye[1], groundAt(overview, eye[0], eye[2]) + settings.clearance);
  return { eye, target: ahead.center };
}

/** Low over the outdoor gym, looking at its mat from `angle` (a full turn comes back round). */
export function gymPose(gym, overview, angle, settings = MENU_CAMERA) {
  const [cx, cy, cz] = gym.center;
  const eye = [cx + Math.cos(angle) * settings.gymDistance, cy + settings.gymHeight, cz + Math.sin(angle) * settings.gymDistance];
  // A hill beside the gym lifts the camera, never into it.
  eye[1] = Math.max(eye[1], groundAt(overview, eye[0], eye[2]) + settings.gymHeight * 0.6);
  return { eye, target: [cx, cy + 1.2, cz] };
}

export class MenuCamera {
  eye = null;
  target = null;
  /** "island", "route" or "gym". */
  view = "island";
  #angle;
  #route = null;
  #gym = null;
  #gymAngle = 0;
  #distance = 0;
  #from = null;
  #flight = 1;

  /**
   * @param {{center: number[], radius: number, sea: number}} overview from the built scene
   * @param {{reducedMotion?: boolean, settings?: object, angle?: number}} [options]
   */
  constructor(overview, { reducedMotion = false, settings = MENU_CAMERA, angle = 0.9 } = {}) {
    this.overview = overview;
    this.reducedMotion = reducedMotion;
    this.settings = settings;
    this.#angle = angle;
    const pose = orbitPose(overview, angle, settings);
    this.eye = pose.eye;
    this.target = pose.target;
  }

  /** Circle the whole island. */
  showIsland() {
    if (this.view === "island") return;
    this.#begin();
    this.view = "island";
    this.#route = null;
    this.#gym = null;
  }

  /** Glide down to `route` (a RouteGeometry) and follow it from the start. */
  showRoute(route) {
    if (this.view === "route" && this.#route === route) return;
    this.#begin();
    this.view = "route";
    this.#route = route;
    this.#gym = null;
    this.#distance = 0;
  }

  /** Glide down to the outdoor `gym` (`{center, yaw}`) and circle it, from the road side. */
  showGym(gym) {
    if (this.view === "gym" && this.#gym === gym) return;
    this.#begin();
    this.view = "gym";
    this.#gym = gym;
    this.#route = null;
    // Start between the road and the gym, a little ahead of it.
    this.#gymAngle = Math.atan2(-Math.cos(gym.yaw), -Math.sin(gym.yaw)) - 0.6;
  }

  /** True while flying from one view to another. */
  get flying() {
    return this.#flight < 1;
  }

  #begin() {
    // How low the camera flies from: the floor starts there, not at the usual clearance.
    const height = this.eye[1] - groundAt(this.overview, this.eye[0], this.eye[2]);
    this.#from = { eye: this.eye, target: this.target, clearance: Math.min(this.settings.clearance, height) };
    this.#flight = this.reducedMotion ? 1 : 0;
  }

  update(dt) {
    const step = Math.max(0, Math.min(0.1, dt));
    const s = this.settings;
    const moving = !this.reducedMotion;
    let pose;
    if (this.view === "route" && this.#route) {
      // Only start rolling along the road once the camera is down there.
      if (moving && this.#flight >= 1) this.#distance = (this.#distance + s.followSpeed * step) % this.#route.length;
      pose = routePose(this.#route, this.#distance, this.overview, s);
    } else if (this.view === "gym" && this.#gym) {
      if (moving && this.#flight >= 1) this.#gymAngle = (this.#gymAngle + s.gymRate * step) % (2 * Math.PI);
      pose = gymPose(this.#gym, this.overview, this.#gymAngle, s);
    } else {
      if (moving) this.#angle += s.orbitRate * step;
      pose = orbitPose(this.overview, this.#angle, s);
    }
    if (this.#flight < 1 && this.#from) {
      this.#flight = Math.min(1, this.#flight + step / s.flightS);
      const t = ease(this.#flight);
      // From or to lower than the usual clearance (the gym): the floor moves with the flight.
      const landing = Math.min(s.clearance, pose.eye[1] - groundAt(this.overview, pose.eye[0], pose.eye[2]));
      const clearance = this.#from.clearance + (landing - this.#from.clearance) * t;
      pose = { eye: lerp3(this.#from.eye, pose.eye, t), target: lerp3(this.#from.target, pose.target, t) };
      pose.eye[1] = Math.max(pose.eye[1], groundAt(this.overview, pose.eye[0], pose.eye[2]) + clearance);
    }
    this.eye = pose.eye;
    this.target = pose.target;
    return this;
  }
}
