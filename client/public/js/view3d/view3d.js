/**
 * 3D view of the ride: low-poly world, all riders, chase camera behind me and
 * floating name labels. Same inputs as the 2D views (smoothed riders), so it
 * needs no protocol changes.
 */
import { CAMERA_MODES, ChaseCamera } from "./chaseCamera.js";
import { clipFor, settle } from "./clips.js";
import { chunkNear, chunkVisible } from "./chunks.js";
import { TIME_MODES, TIME_PRESETS, resolvePreset, sunShadowMatrix } from "./lighting.js";
import { invert, lerp3, lookAt, multiply, normalize, perspective, placement, rotationXAbout, scale, scaling, sub, transformPoint, yawFor } from "./math.js";
import { Renderer, createContext } from "./renderer.js";
import {
  RIDER_GEOMETRY,
  VARIANT_COUNT,
  WHEEL_HUBS,
  buildBike,
  buildCrankset,
  buildFoot,
  buildRiderShadow,
  buildShin,
  buildShoe,
  buildThigh,
  buildWheel,
  legPose,
  ridingBodyParts,
  riderLook,
  uploadBodyParts,
  variantLook,
} from "./riderModel.js";
import { blend, bodyTransforms, poseAt } from "./riderPose.js";
import { buildRotor, buildSpectator } from "./structures.js";
import { assignSpots, nearestGym } from "../workout/gymSpots.js";
import { seatCadence, layoutOf, placedVehicles } from "./vehicleScene.js";
import { VEHICLE_KINDS } from "../ride/vehicle.js";
import { buildBeerBike, buildSeatedBody, buildTandemFrame } from "./vehicleModel.js";
import { buildWorld, riderPosition } from "./world.js";
import { sceneOf } from "./worldScene.js";

export { CAMERA_MODES, TIME_MODES, TIME_PRESETS };

const SCENE = Object.freeze({
  fovY: (58 * Math.PI) / 180,
  shadowRange: 65,
  /** How far each chunk group is drawn (metres); fog hides the cut. */
  drawDistance: { terrain: Infinity, road: Infinity, structures: 2600, scenery: 2000, bright: 1200, detail: 220 },
  rotorDistance: 4000,
  spectatorDistance: 260,
  shadowMapSize: 2048,
  labelDistance: 80,
  nearCameraHide: 4,
});

export function hexToRgb(hex) {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return [0.6, 0.6, 0.6];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Projects a world point to CSS pixels. Returns null when it is behind the camera.
 * @returns {{x: number, y: number, depth: number} | null}
 */
export function projectToScreen(viewProjection, point, width, height) {
  const [x, y, z, w] = transformPoint(viewProjection, point);
  if (w <= 0 || z < -1 || z > 1) return null;
  return { x: (x * 0.5 + 0.5) * width, y: (1 - (y * 0.5 + 0.5)) * height, depth: w };
}

/**
 * Chooses which name labels to show: the nearest riders first, skipping
 * labels that would overlap one already placed. My own rider gets no label
 * (it is always right in front of the camera and would cover the others).
 * @param {{rider: object, distance: number, screen: {x: number, y: number}}[]} candidates
 */
export function visibleLabels(candidates, myId, { charWidth = 7, padding = 22, height = 20 } = {}) {
  const ordered = candidates.filter((c) => c.rider.id !== myId).sort((a, b) => a.distance - b.distance);
  const placed = [];
  const shown = [];
  for (const candidate of ordered) {
    const badge = candidate.rider.is_bot ? 4 : candidate.rider.device === "paddle" ? 3 : 0;
    const width = (candidate.rider.name.length + badge) * charWidth + padding;
    const box = { left: candidate.screen.x - width / 2, right: candidate.screen.x + width / 2, top: candidate.screen.y - height, bottom: candidate.screen.y };
    const overlaps = placed.some((o) => box.left < o.right && o.left < box.right && box.top < o.bottom && o.top < box.bottom);
    if (overlaps) continue;
    placed.push(box);
    shown.push(candidate);
  }
  return shown;
}

/** True if WebGL 2 is available in this browser. */
export function isWebGl2Available(doc = globalThis.document) {
  try {
    return Boolean(doc.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

/**
 * The ride's lens; the menu's drone view sees further (`haze` stretches fog
 * and draw distances). Depth precision far away grows with `near`, so it is
 * as large as the cameras allow: the closest ride camera sits 3 m behind the
 * rider, the drone at least 70 m above the ground.
 */
export const RIDE_LENS = Object.freeze({ near: 1, far: 9000, haze: 1, shadows: true });
export const DRONE_LENS = Object.freeze({ near: 20, far: 16000, haze: 2.6, shadows: false });

/**
 * The menu's gym orbit drops far below the drone (about 17 m up over the mat,
 * not 70), so `DRONE_LENS.near` would clip the ground in the foreground. This
 * lens keeps the haze and draw reach of the drone but pulls `near` in to the
 * closest the orbit gets to anything.
 */
export const GYM_LENS = Object.freeze({ ...DRONE_LENS, near: 2 });

/**
 * The drone's lens for an island of `overview.radius` metres: the haze grows
 * with the island, so the far coast stays clear from the orbit (the fixed
 * DRONE_LENS was made for a 2.5 km island and fogged a 6 km one over).
 */
export function droneLens(overview) {
  const radius = overview?.radius ?? 0;
  const haze = Math.max(DRONE_LENS.haze, radius / 1500);
  // Small things reach as far as before (`reach`): the clearer air must not cost frames.
  return Object.freeze({ ...DRONE_LENS, haze, reach: Math.sqrt(DRONE_LENS.haze), far: Math.max(DRONE_LENS.far, radius * 3.4) });
}

/**
 * The gym orbit's lens for an island of `overview.radius` metres: the drone
 * lens (same haze and draw reach) with a `near` plane the low orbit clears.
 * The orbit is `MENU_CAMERA.gymHeight` metres up at `gymDistance` out, so the
 * terrain in the foreground is never nearer than the height; 2 m leaves room
 * for the mat slipping below the eye.
 */
export function gymLens(overview) {
  return Object.freeze({ ...droneLens(overview), near: GYM_LENS.near });
}

/**
 * Smallest depth difference (metres) a `bits` depth buffer resolves at
 * `distance` with a `near`/`far` perspective lens. Surfaces closer than this
 * flicker against each other.
 */
export function depthStep({ near, far }, distance, bits = 24) {
  // Window depth is (1/near - 1/z) / (1/near - 1/far); one step of it in z.
  return (distance * distance * (1 / near - 1 / far)) / 2 ** bits;
}

/** The gym camera (#77): metres from the mat centre towards the road, height, and the swing from the chase camera (seconds). */
export const GYM_CAMERA = Object.freeze({ back: 7, up: 2.2, swingS: 1.5 });
/**
 * Where a gym's workout riders leave their bikes: by the mat's road edge
 * (`back` metres from its centre towards the road), in two rows from `aside`
 * metres left and right of the centre outwards, `gap` apart, so they stand
 * clear of the gym camera's view of the mat; the gravel there lies `lift`
 * below the mat's top.
 */
export const BIKE_RACK = Object.freeze({ back: 3, aside: 4.6, gap: 0.7, lift: 0.06 });
/** Crossfade between two clips when a rider's exercise changes (seconds). */
const CLIP_FADE_S = 0.3;

/** Towards the road from a gym (its riders face that way). */
const towardsRoad = (gym) => [-Math.sin(gym.yaw), 0, -Math.cos(gym.yaw)];

/** The gym camera's pose: on the mat's road side, a little above it, looking at its centre. */
export function gymCameraPose(gym, settings = GYM_CAMERA) {
  const [cx, cy, cz] = gym.center;
  const [dx, , dz] = towardsRoad(gym);
  return { eye: [cx + dx * settings.back, cy + settings.up, cz + dz * settings.back], target: [cx, cy, cz] };
}

/** A fixed camera on the gym mat; swings over from where the last camera was (`from`), unless that is null. */
export class GymCamera {
  mode = "gym";
  #pose;
  #from;
  #blend;

  constructor(gym, from = null, settings = GYM_CAMERA) {
    this.#pose = gymCameraPose(gym, settings);
    this.#from = from?.eye && from?.target ? { eye: [...from.eye], target: [...from.target] } : null;
    this.#blend = this.#from ? 0 : 1;
    this.swingS = settings.swingS;
    this.update(0, 0, 0);
  }

  setMode() {}

  cycle() {
    return this.mode;
  }

  /** Same signature as the chase camera's; only the time step matters. */
  update(_distance, _lane, dt) {
    this.#blend = Math.min(1, this.#blend + Math.max(0, dt) / this.swingS);
    const t = this.#blend * this.#blend * (3 - 2 * this.#blend);
    const from = this.#from ?? this.#pose;
    this.eye = lerp3(from.eye, this.#pose.eye, t);
    this.target = lerp3(from.target, this.#pose.target, t);
    return this;
  }
}

export class View3D {
  #labels = new Map();
  #highlights = [];
  #pedalPhase = new Map();
  #wheelPhase = new Map();
  /** Per workout rider: the exercise shown, the pose it fades from and when it changed. */
  #clips = new Map();
  #lastTime = null;
  timeMode = "day";
  quality = "high";
  lens = RIDE_LENS;
  /** Shifts the picture on screen (normalised device units), e.g. to frame a window in the menu. */
  viewOffset = [0, 0];

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} labelLayer absolutely positioned element over the canvas
   * @param {import("../route/geometry.js").RouteGeometry} route
   * @param {object} [world] the scene from `buildScene` (built here if missing)
   * @param {{renderer?: object}} [options] `renderer` replaces the WebGL one (tests)
   */
  constructor(canvas, labelLayer, route, world = sceneOf(buildWorld(route)), { renderer = null } = {}) {
    const gl = renderer ? null : createContext(canvas);
    if (!renderer && !gl) throw new Error("WebGL 2 is not available");
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.route = route;
    /** The map's other routes by id (RouteGeometry), where their riders ride (#14). */
    this.routes = null;
    /** The map's road network (RoadNetwork): riders off every route ride its roads (#15). */
    this.network = null;
    this.renderer = renderer ?? new Renderer(gl);
    /** Anything with `eye` and `target`; the chase camera updates itself from my rider. */
    this.camera = new ChaseCamera(route);
    this.overview = world.overview ?? null;
    /** The outdoor gyms (#77): where workout riders train. */
    this.gyms = world.gyms ?? [];

    this.shadowsEnabled = this.renderer.createShadowMap(SCENE.shadowMapSize);

    this.meshes = Object.fromEntries(Object.entries(world.meshes).map(([name, mesh]) => [name, this.renderer.upload(mesh)]));
    this.chunks = Object.fromEntries(
      Object.entries(world.chunks).map(([name, list]) => [name, list.map((chunk) => ({ ...chunk, handle: this.renderer.upload(chunk.mesh), mesh: null }))]),
    );
    this.clouds = this.renderer.upload(world.clouds);
    this.water = this.renderer.upload(world.water);
    this.rivers = this.renderer.upload(world.rivers);
    this.rotors = world.rotors;
    this.rotor = this.renderer.upload(buildRotor());
    this.spectators = world.spectators;
    this.spectatorMeshes = [this.renderer.upload(buildSpectator(false)), this.renderer.upload(buildSpectator(true))];
    this.bodies = [];
    this.bodyParts = [];
    this.thighs = [];
    this.shins = [];
    for (let i = 0; i < VARIANT_COUNT; i += 1) {
      const look = variantLook(i);
      this.bodies.push(this.renderer.upload(buildBike(look)));
      this.bodyParts.push(uploadBodyParts(this.renderer, look));
      this.thighs.push(this.renderer.upload(buildThigh(look)));
      this.shins.push(this.renderer.upload(buildShin(look)));
    }
    // Shared vehicles (#55): frames once per kind and seat count, bodies for the seats.
    this.seatedBodies = Array.from({ length: VARIANT_COUNT }, (_, i) => this.renderer.upload(buildSeatedBody(variantLook(i))));
    this.vehicleFrames = new Map([["tandem:2", this.renderer.upload(buildTandemFrame())]]);
    for (const seats of VEHICLE_KINDS.find((k) => k.kind === "beer_bike").seats) {
      this.vehicleFrames.set(`beer_bike:${seats}`, this.renderer.upload(buildBeerBike(seats)));
    }
    this.foot = this.renderer.upload(buildFoot());
    this.shoe = this.renderer.upload(buildShoe());
    this.crankset = this.renderer.upload(buildCrankset());
    this.wheel = this.renderer.upload(buildWheel());
    this.riderShadow = this.renderer.upload(buildRiderShadow());
    this.identity = placement([0, 0, 0]);
  }

  /** "auto" (by local clock), "day", "golden" or "dusk". */
  setTimeMode(mode) {
    if (TIME_MODES.includes(mode)) this.timeMode = mode;
  }

  /** "high": shadow map, grass, sharp on high-DPI screens. "low": none of those, for weaker GPUs. */
  setQuality(quality) {
    if (quality === "high" || quality === "low") this.quality = quality;
  }

  /**
   * Glowing bands drawn on top of the world (the menu's picked route).
   * @param {{mesh: object, glow?: number}[]} bands meshes from `buildHighlight`
   */
  setHighlights(bands) {
    for (const band of this.#highlights) this.renderer.dispose(band.handle);
    this.#highlights = bands.map(({ mesh, glow = 1 }) => ({ handle: this.renderer.upload(mesh), glow }));
  }

  /** Back to riding after the menu: chase camera, ride lens, nothing highlighted. */
  /** Follows my rider onto another route or road (#15); the world stays as built. */
  setRoute(route) {
    this.route = route;
    if (this.camera instanceof ChaseCamera) this.camera.route = route;
  }

  rideMode() {
    this.camera = new ChaseCamera(this.route);
    this.lens = RIDE_LENS;
    this.viewOffset = [0, 0];
    this.setHighlights([]);
  }

  /**
   * The workout's fixed camera on `gym`'s mat: it swings over from the chase
   * camera, or is there at once with reduced motion.
   */
  workoutMode(gym, { reducedMotion = false } = {}) {
    this.camera = new GymCamera(gym, reducedMotion ? null : this.camera);
  }

  setCameraMode(mode) {
    this.camera.setMode(mode);
  }

  /** Switches to the next camera and returns its mode name. */
  cycleCamera() {
    return this.camera.cycle();
  }

  /** Model matrices for one rider: body, cranks, two pedalling legs (thigh, shin, foot), two wheels. */
  /** A rider on a route: mine, or another route of the map. */
  #onRoute(rider) {
    const route = !rider.route || rider.route === this.route.id ? this.route : this.routes?.get(rider.route);
    return route ? { rider, ...riderPosition(route, rider.distance, rider.lane) } : null;
  }

  /** A rider off every route, on a road of the network in either direction. */
  #onRoad(rider) {
    const road = rider.road && this.network?.edges.get(rider.road.edge);
    if (!road) return null;
    const back = rider.road.dir < 0;
    const offset = Math.min(road.length, Math.max(0, rider.road.offset));
    // Lanes count from the left in riding direction.
    const lane = back ? road.lanes - 1 - rider.lane : rider.lane;
    const at = riderPosition(road, back ? road.length - offset : offset, lane);
    return { rider, ...at, forward: back ? scale(at.forward, -1) : at.forward };
  }

  /** Advances a pedal phase (radians) by `cadence` rpm over `dt` seconds. */
  #pedal(id, cadence, dt) {
    const phase = ((this.#pedalPhase.get(id) ?? id) + (cadence / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
    this.#pedalPhase.set(id, phase);
    return phase;
  }

  /**
   * Crankset and both pedalling legs of one rider, hanging off `model` (the
   * solo rider's frame: forward −Z, `hip` and `bottomBracket` as in the solo
   * geometry). A seat in a vehicle supplies a `model` that puts that frame's
   * hip on the seat.
   */
  #legs(model, look, phase, hip = RIDER_GEOMETRY.hip, bottomBracket = RIDER_GEOMETRY.bottomBracket) {
    const joint = (at, angle) => multiply(model, multiply(placement(at), rotationXAbout([0, 0, 0], angle)));
    const [, hy, hz] = hip;
    const limbs = [];
    // Right leg (+X, chainring side) on the crank arm that `buildCrankset` points down at phase 0.
    for (const [side, offset] of [
      [0.12, 0],
      [-0.12, Math.PI],
    ]) {
      const pose = legPose(phase + offset);
      if (offset === 0) limbs.push({ mesh: this.crankset, model: joint(bottomBracket, pose.crankAngle) });
      limbs.push(
        { mesh: this.thighs[look.variant], model: joint([side, hy, hz], pose.thighAngle) },
        { mesh: this.shins[look.variant], model: joint([side, pose.knee[1], pose.knee[2]], pose.shinAngle) },
        { mesh: this.foot, model: joint([side, pose.ankle[1], pose.ankle[2]], pose.footAngle) },
      );
    }
    return limbs;
  }

  /** Upper-body parts of a rider in the riding pose, hung off `model` (the bike frame). */
  #torso(model, look) {
    return ridingBodyParts(look).map(({ mesh, model: local }) => ({ mesh: this.bodyParts[look.variant].get(mesh), model: multiply(model, local) }));
  }

  /**
   * A workout rider at their gym spot: the body posed by their exercise's clip
   * (faded over from the last one), the bike parked at the gym's rack.
   */
  #workoutParts(rider, { gym, spot, slot }, timeS) {
    const look = riderLook(rider.id);
    const exercise = rider.exercise ?? null;
    let state = this.#clips.get(rider.id);
    if (!state || state.exercise !== exercise) {
      state = { exercise, from: state?.last ?? null, changedAt: timeS, last: null };
      this.#clips.set(rider.id, state);
    }
    const clip = clipFor(exercise);
    const since = Number.isFinite(rider.exerciseSince) ? rider.exerciseSince : state.changedAt;
    const current = poseAt(clip, timeS - since);
    const w = Math.min(1, (timeS - state.changedAt) / CLIP_FADE_S);
    const pose = state.from && w < 1 ? blend(state.from, current, w) : current;
    state.last = pose;

    const body = multiply(placement(spot.position, spot.yaw), scaling(look.scale));
    const parts = this.bodyParts[look.variant];
    const meshOf = (name) => parts.get(name) ?? (name.startsWith("thigh") ? this.thighs[look.variant] : name.startsWith("shin") ? this.shins[look.variant] : this.shoe);
    const torso = bodyTransforms(settle(pose, clip.plant), look).map(({ mesh, model }) => ({ mesh: meshOf(mesh), model: multiply(body, model) }));

    // Bikes side by side at the rack, in the order of the mat's spots: right, left, right…
    const across = [Math.cos(gym.yaw), 0, -Math.sin(gym.yaw)];
    const aside = (slot % 2 ? -1 : 1) * (BIKE_RACK.aside + Math.floor(slot / 2) * BIKE_RACK.gap);
    const rack = gym.center.map((v, k) => v + towardsRoad(gym)[k] * BIKE_RACK.back + across[k] * aside);
    rack[1] = gym.center[1] - BIKE_RACK.lift;
    const model = multiply(placement(rack, gym.yaw), scaling(look.scale));
    const limbs = [{ mesh: this.crankset, model: multiply(model, placement(RIDER_GEOMETRY.bottomBracket)) }];
    const wheels = WHEEL_HUBS.map((hub) => multiply(model, placement(hub)));
    return { model, limbs, torso, wheels, variant: look.variant };
  }

  /** Workout riders by id at the gym nearest them: the spot each takes, its slot in the bike rack. */
  #gymSpots(placed) {
    const byGym = new Map();
    for (const p of placed) {
      if (p.rider.device !== "workout") continue;
      const gym = nearestGym(this.gyms, [p.position[0], p.position[2]]);
      if (!gym) continue;
      if (!byGym.has(gym)) byGym.set(gym, []);
      byGym.get(gym).push(p.rider.id);
    }
    const spots = new Map();
    for (const [gym, ids] of byGym) {
      const sorted = [...ids].sort((a, b) => a - b);
      for (const [id, spot] of assignSpots(ids, gym)) spots.set(id, { gym, spot, slot: sorted.indexOf(id) });
    }
    return spots;
  }

  #riderParts(rider, position, forward, cadence, dt) {
    const look = riderLook(rider.id);
    const pitch = Math.asin(Math.max(-1, Math.min(1, forward[1])));
    const model = multiply(placement(position, yawFor(forward), pitch), scaling(look.scale));

    const limbs = this.#legs(model, look, this.#pedal(rider.id, cadence, dt));

    // Rolling forward (−Z) turns the wheel backwards around X.
    const spin = (this.#wheelPhase.get(rider.id) ?? 0) - ((rider.speed ?? 0) * dt) / (RIDER_GEOMETRY.wheelRadius * look.scale);
    this.#wheelPhase.set(rider.id, spin % (Math.PI * 2));
    const wheels = WHEEL_HUBS.map((hub) => multiply(model, multiply(placement(hub), rotationXAbout([0, 0, 0], spin))));
    return { model, limbs, torso: this.#torso(model, look), wheels, variant: look.variant };
  }

  /**
   * One shared vehicle: its frame, wheels (the tandem's; a beer bike's are in
   * its mesh) and every occupied seat as a seated body with pedalling legs.
   * An empty seat is just the stool in the frame mesh. Also gives the world
   * point above each seated rider's head, for the name labels.
   */
  #vehicleParts(vehicle, dt, tints, myId) {
    const { at, kind, seats } = vehicle;
    const layout = layoutOf(kind, seats.length);
    if (!layout) return null;
    const pitch = Math.asin(Math.max(-1, Math.min(1, at.forward[1])));
    const base = placement(at.position, yawFor(at.forward), pitch);
    const [, hy, hz] = RIDER_GEOMETRY.hip;

    const bodies = [];
    const limbs = [];
    const heads = new Map();
    layout.seats.forEach((seat, index) => {
      const rider = seats[index];
      if (!rider) return;
      const look = riderLook(rider.id);
      const seatModel = multiply(base, placement(seat.hip, seat.yaw));
      // The hip stays put when the rider is scaled: scale about it, then bring the solo hip to the origin.
      const legsModel = multiply(seatModel, multiply(scaling(look.scale), placement([0, -hy, -hz])));
      const tint = rider.id === myId ? tints.me : rider.is_bot ? tints.bot : tints.human;
      bodies.push({ variant: look.variant, model: multiply(seatModel, scaling(look.scale)), tint });
      limbs.push(...this.#legs(legsModel, look, this.#pedal(rider.id, seatCadence(rider), dt)));
      heads.set(rider.id, transformPoint(seatModel, [0, 0.62 * look.scale + 0.55, 0]).slice(0, 3));
    });

    let wheels = [];
    if (kind === "tandem") {
      const key = `vehicle:${vehicle.id}`;
      const spin = (this.#wheelPhase.get(key) ?? 0) - ((at.rider.speed ?? 0) * dt) / layout.wheelRadius;
      this.#wheelPhase.set(key, spin % (Math.PI * 2));
      wheels = layout.wheels.map((hub) => multiply(base, multiply(placement(hub), rotationXAbout([0, 0, 0], spin))));
    }
    return { frame: this.vehicleFrames.get(`${kind}:${seats.length}`), base, bodies, limbs, wheels, heads, position: at.position, layout };
  }

  /**
   * Draws one frame.
   * @param {{riders: object[], myId: number, myCadence?: number, timeS: number, colors: {me: string, human: string, bot: string}}} frame
   */
  render({ riders, myId, myCadence, timeS, colors }) {
    const dt = this.#lastTime === null ? 0 : Math.min(0.1, timeS - this.#lastTime);
    this.#lastTime = timeS;

    const high = this.quality === "high";
    const ratio = Math.min(globalThis.devicePixelRatio || 1, high ? 2 : 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    this.renderer.resize(Math.round(width * ratio), Math.round(height * ratio));

    // Riders of the map's other routes ride their own route (#14); unknown ones are skipped.
    const onRoads = riders.map((rider) => (rider.route === null ? this.#onRoad(rider) : this.#onRoute(rider))).filter(Boolean);
    // Workout riders train at the gym by their road position (#77), not on the road.
    const gymSpots = this.#gymSpots(onRoads);
    const placed = onRoads.map((p) => {
      const at = gymSpots.get(p.rider.id);
      if (!at) return p;
      const facing = [-Math.sin(at.spot.yaw), 0, -Math.cos(at.spot.yaw)];
      return { ...p, position: at.spot.position, forward: facing, gym: at };
    });
    const me = placed.find((p) => p.rider.id === myId);
    const myVehicle = me?.rider.vehicle ? layoutOf(me.rider.vehicle.kind, me.rider.vehicle.seats) : null;
    if (me) this.camera.update(me.rider.distance, me.rider.lane, dt, myVehicle);
    if (!this.camera.eye) return;

    const lens = this.lens;
    const preset = resolvePreset(this.timeMode);
    const light = { ...preset, fog: preset.fog.map((f) => f * lens.haze) };
    const [ox, oy] = this.viewOffset;
    const lensProjection = perspective(SCENE.fovY, width / height, lens.near, lens.far);
    const projection = ox || oy ? multiply(placement([ox, oy, 0]), lensProjection) : lensProjection;
    const viewProjection = multiply(projection, lookAt(this.camera.eye, this.camera.target));
    const inverseViewProjection = invert(viewProjection);

    const tints = { me: hexToRgb(colors.me), human: hexToRgb(colors.human), bot: hexToRgb(colors.bot) };
    const visible = [];
    for (const { rider, position, forward, gym } of placed.filter((p) => !p.rider.vehicle)) {
      const fromCamera = Math.hypot(position[0] - this.camera.eye[0], position[2] - this.camera.eye[2]);
      // Far riders are invisible anyway; riders right at the camera would block the view.
      if (fromCamera > 600 || (fromCamera < SCENE.nearCameraHide && rider.id !== myId)) continue;
      const cadence = rider.id === myId ? (myCadence ?? 0) : rider.power > 0 ? 85 : 0;
      const tint = rider.id === myId ? tints.me : rider.is_bot ? tints.bot : tints.human;
      const parts = gym ? this.#workoutParts(rider, gym, timeS) : this.#riderParts(rider, position, forward, cadence, dt);
      visible.push({ rider, position, forward, fromCamera, tint, ...parts });
    }

    // Seated riders are drawn through their vehicle, once per vehicle.
    const vehicles = [];
    const seatHeads = new Map();
    for (const vehicle of placedVehicles(placed)) {
      const { position } = vehicle.at;
      const fromCamera = Math.hypot(position[0] - this.camera.eye[0], position[2] - this.camera.eye[2]);
      const mine = vehicle.seats.some((r) => r?.id === myId);
      if (fromCamera > 600 || (fromCamera < SCENE.nearCameraHide && !mine)) continue;
      const parts = this.#vehicleParts(vehicle, dt, tints, myId);
      if (!parts) continue;
      vehicles.push({ ...parts, fromCamera });
      for (const [id, head] of parts.heads) seatHeads.set(id, head);
    }

    const eye = this.camera.eye;
    const forward = normalize(sub(this.camera.target, eye));
    const rotorMatrices = this.rotors
      .filter((r) => Math.hypot(r.hub[0] - eye[0], r.hub[2] - eye[2]) < SCENE.rotorDistance)
      .map((r) => ({ hub: r.hub, model: multiply(placement(r.hub, r.yaw), rotationXAbout([0, 0, 0], r.phase + timeS * r.speed)) }));
    const crowd = this.spectators
      .filter((p) => {
        const d = Math.hypot(p.position[0] - eye[0], p.position[2] - eye[2]);
        return d < SCENE.spectatorDistance && d > SCENE.nearCameraHide;
      })
      .map((p) => {
        const hop = p.armsUp ? Math.max(0, Math.sin(timeS * 6 + p.phase)) * 0.14 : Math.sin(timeS * 3 + p.phase) * 0.02;
        const position = [p.position[0], p.position[1] + hop, p.position[2]];
        return { ...p, model: multiply(placement(position, p.yaw), scaling(p.scale)) };
      });

    // Pass 0: shadow map around my rider (or the camera target), nearby chunks only.
    if (this.shadowsEnabled && high && lens.shadows) {
      const focus = me ? me.position : this.camera.target;
      const lightMatrix = sunShadowMatrix(light.sun, focus, { halfSize: SCENE.shadowRange, mapSize: SCENE.shadowMapSize });
      this.renderer.beginShadows(lightMatrix);
      for (const group of ["scenery", "structures"]) {
        for (const chunk of this.chunks[group]) {
          if (chunkNear(chunk, focus, SCENE.shadowRange * 1.6)) this.renderer.drawShadowCaster(chunk.handle, this.identity);
        }
      }
      this.renderer.drawShadowCaster(this.meshes.arches, this.identity);
      for (const part of visible) {
        if (Math.hypot(part.position[0] - focus[0], part.position[2] - focus[2]) > SCENE.shadowRange * 1.2) continue;
        this.renderer.drawShadowCaster(this.bodies[part.variant], part.model);
        for (const piece of part.torso) this.renderer.drawShadowCaster(piece.mesh, piece.model);
        for (const limb of part.limbs) this.renderer.drawShadowCaster(limb.mesh, limb.model);
        for (const wheel of part.wheels) this.renderer.drawShadowCaster(this.wheel, wheel);
      }
      for (const v of vehicles) {
        if (Math.hypot(v.position[0] - focus[0], v.position[2] - focus[2]) > SCENE.shadowRange * 1.2) continue;
        this.renderer.drawShadowCaster(v.frame, v.base);
        for (const body of v.bodies) this.renderer.drawShadowCaster(this.seatedBodies[body.variant], body.model);
        for (const limb of v.limbs) this.renderer.drawShadowCaster(limb.mesh, limb.model);
        for (const wheel of v.wheels) this.renderer.drawShadowCaster(this.wheel, wheel);
      }
      for (const p of crowd) {
        if (Math.hypot(p.position[0] - focus[0], p.position[2] - focus[2]) < SCENE.shadowRange * 1.2) {
          this.renderer.drawShadowCaster(this.spectatorMeshes[p.armsUp ? 1 : 0], p.model);
        }
      }
      this.renderer.endShadows();
    }

    // Passes 1 and 2: sky and the lit world.
    this.renderer.begin({ viewProjection, inverseViewProjection, camera: eye, ...light, shadowStrength: high ? light.shadowStrength : 0 });
    this.renderer.draw(this.meshes.horizon, this.identity);
    this.renderer.draw(this.meshes.islands, this.identity);
    for (const [group, chunks] of Object.entries(this.chunks)) {
      if (group === "detail" && !high) continue;
      // Seen from the drone, small things reach a little further, not as far as the haze.
      const range = Math.min((SCENE.drawDistance[group] ?? Infinity) * (lens.reach ?? Math.sqrt(lens.haze)), light.fog[1] + 200);
      for (const chunk of chunks) {
        if (!chunkVisible(chunk, eye, forward, range)) continue;
        if (group === "bright") this.renderer.drawBright(chunk.handle, this.identity, light.key === "dusk" ? 0.95 : 0.55);
        else this.renderer.draw(chunk.handle, this.identity);
      }
    }
    this.renderer.drawBright(this.meshes.arches, this.identity);
    for (const band of this.#highlights) this.renderer.drawBright(band.handle, this.identity, band.glow);
    this.renderer.drawCloudLayer(this.clouds, this.identity, light.cloudTint);
    for (const rotor of rotorMatrices) this.renderer.draw(this.rotor, rotor.model);
    for (const p of crowd) this.renderer.draw(this.spectatorMeshes[p.armsUp ? 1 : 0], p.model, p.shirt);
    for (const part of visible) {
      this.renderer.draw(this.bodies[part.variant], part.model, part.tint);
      for (const piece of part.torso) this.renderer.draw(piece.mesh, piece.model, part.tint);
      for (const limb of part.limbs) this.renderer.draw(limb.mesh, limb.model);
      for (const wheel of part.wheels) this.renderer.draw(this.wheel, wheel);
    }
    for (const v of vehicles) {
      this.renderer.draw(v.frame, v.base);
      for (const body of v.bodies) this.renderer.draw(this.seatedBodies[body.variant], body.model, body.tint);
      for (const limb of v.limbs) this.renderer.draw(limb.mesh, limb.model);
      for (const wheel of v.wheels) this.renderer.draw(this.wheel, wheel);
    }

    // Pass 3: blended — sea and soft contact shadows under the bikes.
    this.renderer.drawTransparent(this.water, this.identity, { alpha: 0.82 });
    this.renderer.drawTransparent(this.rivers, this.identity, { alpha: 0.85 });
    for (const part of visible) {
      if (part.fromCamera > 150) continue;
      this.renderer.drawTransparent(this.riderShadow, placement(part.position, yawFor(part.forward), 0), { alpha: 0.22, unlit: 1 });
    }

    this.#updateLabels(placed, myId, viewProjection, width, height, seatHeads);
    const vehicleIds = new Set(riders.filter((r) => r.vehicle).map((r) => `vehicle:${r.vehicle.id}`));
    for (const id of this.#clips.keys()) if (!gymSpots.has(id)) this.#clips.delete(id);
    for (const phases of [this.#pedalPhase, this.#wheelPhase]) {
      for (const id of phases.keys()) if (!riders.some((r) => r.id === id) && !vehicleIds.has(id)) phases.delete(id);
    }
  }

  /** `seatHeads`: the point over each seated rider's head (riders in vehicles are labelled over their seat). */
  #updateLabels(placed, myId, viewProjection, width, height, seatHeads = new Map()) {
    const candidates = [];
    for (const { rider, position } of placed) {
      const distance = Math.hypot(...position.map((v, i) => v - this.camera.eye[i]));
      if (distance > SCENE.labelDistance) continue;
      const head = seatHeads.get(rider.id) ?? [position[0], position[1] + RIDER_GEOMETRY.headHeight + 0.55, position[2]];
      const screen = projectToScreen(viewProjection, head, width, height);
      if (screen) candidates.push({ rider, distance, screen });
    }
    const shown = visibleLabels(candidates, myId);
    for (const { rider, distance, screen } of shown) {
      const label = this.#label(rider, myId);
      label.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -100%)`;
      label.style.opacity = String(Math.max(0.45, 1 - distance / SCENE.labelDistance));
      label.style.zIndex = String(1000 - Math.round(distance));
    }
    const shownIds = new Set(shown.map((c) => c.rider.id));
    for (const [id, element] of this.#labels) {
      element.hidden = !shownIds.has(id);
      if (!placed.some((p) => p.rider.id === id)) {
        element.remove();
        this.#labels.delete(id);
      }
    }
  }

  #label(rider, myId) {
    let element = this.#labels.get(rider.id);
    if (!element) {
      element = document.createElement("div");
      element.className = rider.id === myId ? "label3d me" : "label3d";
      const name = document.createElement("span");
      name.textContent = rider.name;
      element.append(name);
      if (rider.is_bot) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "bot";
        element.append(badge);
      }
      this.labelLayer.append(element);
      this.#labels.set(rider.id, element);
    }
    // A paddler's device can arrive a snapshot after the rider.
    if (rider.device === "paddle" && !element.querySelector(".badge-paddle")) {
      const badge = document.createElement("span");
      badge.className = "badge badge-paddle";
      badge.textContent = "📱";
      element.append(badge);
    }
    return element;
  }

  dispose() {
    const chunkHandles = Object.values(this.chunks).flatMap((list) => list.map((chunk) => chunk.handle));
    const handles = [...Object.values(this.meshes), ...chunkHandles, this.clouds, this.water, this.rivers, this.rotor, ...this.spectatorMeshes, ...this.#highlights.map((band) => band.handle)];
    this.#highlights = [];
    for (const handle of [...handles, ...this.bodies, ...this.bodyParts.flatMap((p) => [...p.values()]), ...this.thighs, ...this.shins, this.foot, this.shoe, this.crankset, this.wheel, this.riderShadow, ...this.seatedBodies, ...this.vehicleFrames.values()]) {
      this.renderer.dispose(handle);
    }
    this.#labels.forEach((element) => element.remove());
    this.#labels.clear();
  }
}
