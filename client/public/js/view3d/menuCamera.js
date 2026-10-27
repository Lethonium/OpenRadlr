/**
 * The start menu's camera: a drone slowly circling high above the island,
 * and on picking a route a glide down to it, then slowly following the road
 * from the start; on the workout card a low circle around the café's outdoor
 * gym. With reduced motion it cuts between still views instead.
 *
 * Each view is a shot that keeps moving on its own (the orbit turns, the follow
 * rolls along the road). A flight blends the shot it leaves into the next one,
 * both still moving, with an easing whose speed and acceleration start and end
 * at zero: the camera never jolts, also when a flight is interrupted. Following
 * the road goes through a critically damped spring, so hairpins become arcs.
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
  /** The opening: a wider, higher orbit, and a longer descent from it (s). */
  introDistance: 1.6,
  introHeight: 1.05,
  introS: 4.6,
  /** How quickly the road follow catches up with the road (s): larger is smoother but lags in bends. */
  followSmoothS: 0.8,
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

/** Smootherstep: speed and acceleration both start and end at zero. */
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * One step of a critically damped spring from `state` towards `goal` (per
 * component): it follows without overshooting and its velocity never jumps.
 * @param {{value: number[], velocity: number[]}} state changed in place
 */
export function springTo(state, goal, smoothS, dt) {
  const omega = 2 / Math.max(1e-3, smoothS);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  for (let k = 0; k < goal.length; k += 1) {
    const change = state.value[k] - goal[k];
    const temp = (state.velocity[k] + omega * change) * dt;
    state.velocity[k] = (state.velocity[k] - omega * temp) * decay;
    state.value[k] = goal[k] + (change + temp) * decay;
  }
  return state;
}

const spring = (value) => ({ value: value.slice(), velocity: value.map(() => 0) });

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

// --- shots: each view keeps moving by itself ---------------------------------
// `ctx` holds the overview, the settings and whether anything moves (reduced motion).
// advance(step, landed): the follow and the gym orbit only start once the camera is there.

function islandShot(ctx, angle) {
  return {
    view: "island",
    angle,
    advance(step) {
      if (ctx.moving) this.angle += ctx.settings.orbitRate * step;
    },
    pose() {
      return orbitPose(ctx.overview, this.angle, ctx.settings);
    },
  };
}

/** The opening: the island from high and wide, turning slowly, before the first descent. */
function introShot(ctx, angle) {
  const s = ctx.settings;
  const wide = { ...s, orbitDistance: s.introDistance, orbitHeight: s.introHeight };
  return { ...islandShot(ctx, angle), view: "intro", pose() {
    return orbitPose(ctx.overview, this.angle, wide);
  } };
}

function routeShot(ctx, route) {
  const s = ctx.settings;
  const start = routePose(route, 0, ctx.overview, s);
  return {
    view: "route",
    route,
    distance: 0,
    eye: spring(start.eye),
    target: spring(start.target),
    advance(step, landed) {
      if (!ctx.moving) return;
      if (landed) this.distance = (this.distance + s.followSpeed * step) % route.length;
      const raw = routePose(route, this.distance, ctx.overview, s);
      springTo(this.eye, raw.eye, s.followSmoothS, step);
      springTo(this.target, raw.target, s.followSmoothS, step);
    },
    pose() {
      const eye = this.eye.value.slice();
      // Cutting a bend short never takes the camera into a hill.
      eye[1] = Math.max(eye[1], groundAt(ctx.overview, eye[0], eye[2]) + s.clearance);
      return { eye, target: this.target.value.slice() };
    },
  };
}

function gymShot(ctx, gym) {
  return {
    view: "gym",
    gym,
    // Start between the road and the gym, a little ahead of it.
    angle: Math.atan2(-Math.cos(gym.yaw), -Math.sin(gym.yaw)) - 0.6,
    advance(step, landed) {
      if (ctx.moving && landed) this.angle = (this.angle + ctx.settings.gymRate * step) % (2 * Math.PI);
    },
    pose() {
      return gymPose(gym, ctx.overview, this.angle, ctx.settings);
    },
  };
}

/** Holds a pose: the start of a flight that interrupts flights already interrupted. */
function stillShot(pose) {
  return { view: "still", advance() {}, pose: () => ({ eye: pose.eye.slice(), target: pose.target.slice() }) };
}

/**
 * From one moving shot to another. `fromClearance`: how low the camera flies from
 * (the gym orbit is lower than the usual clearance), so the floor moves with the flight.
 */
function flight(ctx, from, to, fromClearance, seconds = ctx.settings.flightS) {
  return {
    view: to.view,
    from,
    to,
    t: 0,
    advance(step) {
      from.advance(step, true);
      to.advance(step, false);
      this.t = Math.min(1, this.t + step / seconds);
    },
    pose() {
      const a = from.pose();
      const b = to.pose();
      const e = ease(this.t);
      const landing = Math.min(ctx.settings.clearance, b.eye[1] - groundAt(ctx.overview, b.eye[0], b.eye[2]));
      const clearance = fromClearance + (landing - fromClearance) * e;
      const eye = lerp3(a.eye, b.eye, e);
      eye[1] = Math.max(eye[1], groundAt(ctx.overview, eye[0], eye[2]) + clearance);
      return { eye, target: lerp3(a.target, b.target, e) };
    },
  };
}

const flightDepth = (shot) => (shot.from ? 1 + flightDepth(shot.from) : 0);

export class MenuCamera {
  eye = null;
  target = null;
  #ctx;
  #shot;
  /** The last island shot: coming back, the orbit goes on from where it was. */
  #island;

  /**
   * @param {{center: number[], radius: number, sea: number}} overview from the built scene
   * @param {{reducedMotion?: boolean, settings?: object, angle?: number, intro?: boolean}} [options]
   *   `intro`: open high and wide; the first view picked is a long descent from there
   */
  constructor(overview, { reducedMotion = false, settings = MENU_CAMERA, angle = 0.9, intro = false } = {}) {
    this.overview = overview;
    this.reducedMotion = reducedMotion;
    this.settings = settings;
    this.#ctx = { overview, settings, moving: !reducedMotion };
    this.#island = islandShot(this.#ctx, angle);
    this.#shot = intro && !reducedMotion ? introShot(this.#ctx, angle) : this.#island;
    ({ eye: this.eye, target: this.target } = this.#shot.pose());
  }

  /** "intro", "island", "route" or "gym": where the camera is, or is flying to. */
  get view() {
    return this.#shot.view;
  }

  /** True while flying from one view to another. */
  get flying() {
    return Boolean(this.#shot.to) && this.#shot.t < 1;
  }

  /** The shot the camera is on or flying to. */
  get #goal() {
    return this.#shot.to ?? this.#shot;
  }

  /** Circle the whole island. */
  showIsland() {
    if (this.#goal.view === "island") return;
    this.#island = islandShot(this.#ctx, this.#island.angle);
    this.#go(this.#island);
  }

  /** Glide down to `route` (a RouteGeometry) and follow it from the start. */
  showRoute(route) {
    if (this.#goal.view === "route" && this.#goal.route === route) return;
    this.#go(routeShot(this.#ctx, route));
  }

  /** Glide down to the outdoor `gym` (`{center, yaw}`) and circle it, from the road side. */
  showGym(gym) {
    if (this.#goal.view === "gym" && this.#goal.gym === gym) return;
    this.#go(gymShot(this.#ctx, gym));
  }

  #go(next) {
    if (this.reducedMotion) {
      this.#shot = next;
      return;
    }
    const height = this.eye[1] - groundAt(this.overview, this.eye[0], this.eye[2]);
    let from = this.#shot;
    // A flight interrupted twice already: start from where the camera is, held still.
    if (flightDepth(from) >= 2) from = stillShot({ eye: this.eye, target: this.target });
    const seconds = from.view === "intro" ? this.settings.introS : this.settings.flightS;
    this.#shot = flight(this.#ctx, from, next, Math.min(this.settings.clearance, height), seconds);
  }

  update(dt) {
    const step = Math.max(0, Math.min(0.1, dt));
    this.#shot.advance(step, true);
    if (this.#shot.to && this.#shot.t >= 1) this.#shot = this.#shot.to;
    ({ eye: this.eye, target: this.target } = this.#shot.pose());
    return this;
  }
}
