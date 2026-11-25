/**
 * The cyclist: the rigged rider (`rider.js`) on a bicycle (`bicycle.js`). The saddle height is fitted to the rider's
 * legs and the frame scaled to the rider's height; each `ride()` spins the wheels, turns the cranks at the given cadence,
 * coasts when the legs stop, stands up on steep climbs (a seeded chance, rocking the bike) and poses the rider's IK onto
 * the pedals and bars. Forward +x, like both parts; the rider layer turns that into the road's frame.
 * Ported from the reference's `creatures/cyclist.js`; its random choices come from `seededRandom(seed)`.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";
import { createSharedUniforms } from "../materials.js";
import { createOwner } from "../owner.js";
import { BIKE_TYPES, bikeGeometry, createBike } from "./bicycle.js";
import { BENCH_LOOK, createRider } from "./rider.js";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/** The frame is scaled with the rider's height around the reference rider, within these bounds. */
const REFERENCE_HEIGHT = 1.78;
const SCALE_RANGE = Object.freeze([0.88, 1.12]);
/** Below this cadence (rpm) the rider coasts: no pedalling, pedals level. */
const COAST_CADENCE = 1;
/** Climbs steeper than this (percent) may bring the rider out of the saddle, and the chance that they do. */
const STAND_GRADE = 6;
const STAND_CHANCE = 0.45;
/** The rider stands only while pedalling uphill steeper than this. */
const STAND_MIN_GRADE = 4;
/** How far the bike rocks side to side when the rider is out of the saddle, radians. */
const ROCK = 0.12;

/**
 * @typedef {object} Cyclist
 * @property {import("../../../three.js").Group} object the whole cyclist, facing +x, tyres on y = 0
 * @property {import("./rider.js").RiderRig} rider
 * @property {import("./bicycle.js").Bike} bike
 * @property {number} crank the crank angle in radians; pedalling forward makes it decrease
 * @property {number} standing 0 seated .. 1 out of the saddle
 * @property {(dt: number, state?: RideInput) => void} ride
 * @property {(texture: import("../../../three.js").Texture) => void} setKit swaps the rider's painted kit
 * @property {number} lights how strongly the bike's lamp and tail light glow, 0..1 (1 by default)
 * @property {(level: number) => void} setLights
 */

/**
 * @typedef {object} RideInput
 * @property {number} [cadence] pedalling rpm; below 1 the rider coasts
 * @property {number} [speed] m/s, spins the wheels
 * @property {number} [grade] road grade in percent
 * @property {number} [t] time in seconds for the small sways
 * @property {boolean} [near] false animates only the wheels and the cranks
 * @property {boolean | null} [standing] forces standing (true) or sitting (false); null leaves it to the seeded chance
 */

/**
 * Builds a cyclist for a look.
 * @param {import("./look.js").RiderLook} look
 * @param {{own?: <T>(resource: T) => T, uniforms?: ReturnType<typeof createSharedUniforms>, seed?: number,
 *   texture?: import("../../../three.js").Texture}} [options] `seed` drives the standing and the glances; `texture` is a shared kit
 * @returns {Cyclist}
 */
export function createCyclist(look, { own = (resource) => resource, uniforms = createSharedUniforms(), seed = 0, texture } = {}) {
  const random = seededRandom(seed);
  const rider = createRider(look, { own, uniforms, texture });
  const scale = clamp(look.height / REFERENCE_HEIGHT, ...SCALE_RANGE);
  const saddleHeight = rider.saddleFor(bikeGeometry(look.bike, { scale }));
  const bike = createBike({ type: look.bike, frame: look.frame, accent: look.frameAccent, scale, saddleHeight, own, uniforms });

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  tilt.add(bike.object, rider.object);

  const state = { distance: 0, crank: 0.6, coast: 0, stand: 0, standWant: 0, standIn: 4, look: 0, lookIn: 5, lookWant: 0 };

  /** Poses the rider (when near) and the bike's moving parts for the current crank. */
  function pose(near, t) {
    const rock = state.stand * ROCK * Math.sin(state.crank);
    tilt.rotation.x = rock;
    bike.setSteer(Math.sin(t * 0.9) * 0.012 - rock * 0.25);
    if (near) {
      const feet = rider.poseRide(bike.fit, { crank: state.crank, standing: state.stand, t, coast: state.coast > 0.5, lookYaw: state.look });
      bike.setCrank(state.crank, feet.pitchL, feet.pitchR);
    } else bike.setCrank(state.crank);
  }

  /** @type {Cyclist} */
  const cyclist = {
    object: root,
    rider,
    bike,
    get crank() {
      return state.crank;
    },
    get standing() {
      return state.stand;
    },
    ride(dt, { cadence = 0, speed = 0, grade = 0, t = 0, near = true, standing = null } = {}) {
      state.distance += speed * dt;
      bike.setWheels(state.distance);
      const coasting = cadence < COAST_CADENCE;
      if (coasting) {
        // ease to the nearest level position of the pedals
        const level = Math.round(state.crank / Math.PI) * Math.PI;
        state.crank += (level - state.crank) * Math.min(1, dt * 3);
        state.coast = Math.min(1, state.coast + dt * 2);
      } else {
        state.crank -= (cadence / 60) * TAU * dt;
        state.coast = Math.max(0, state.coast - dt * 2);
      }
      state.standIn -= dt;
      if (state.standIn < 0) {
        state.standWant = grade > STAND_GRADE && random() < STAND_CHANCE ? 1 : 0;
        state.standIn = 6 + random() * 9;
      }
      const wanted = standing !== null ? Number(standing) : grade > STAND_MIN_GRADE && !coasting ? state.standWant : 0;
      state.stand = lerp(state.stand, wanted, Math.min(1, dt * 2.5));
      state.lookIn -= dt;
      if (state.lookIn < 0) {
        state.lookWant = random() < 0.3 ? (random() - 0.5) * 1.2 : 0;
        state.lookIn = 2 + random() * 5;
      }
      state.look = lerp(state.look, state.lookWant, Math.min(1, dt * 2));
      pose(near, t);
    },
    get lights() {
      return bike.lights;
    },
    setLights(level) {
      bike.setLights(level);
    },
    setKit(next) {
      rider.setTexture(next);
    },
  };
  pose(true, 0);
  return cyclist;
}

// ---------- the workbench asset

const KITS = Object.freeze(["road", "long", "skinsuit", "casual"]);
const PATTERNS = Object.freeze(["solid", "hoops", "band", "sash", "panels", "chevron", "dots", "fade"]);

export const meta = Object.freeze({
  id: "cyclist",
  name: "Cyclist (rider + bike)", // i18n-ok
  category: "Creatures", // i18n-ok
  description: "Rigged rider on a bicycle: pedalling IK at the cadence, coasting, standing on climbs. Rider and bike are separate assets.", // i18n-ok
  options: Object.freeze({
    type: Object.freeze({ type: "select", values: Object.freeze(Object.keys(BIKE_TYPES)), default: "road" }),
    frame: Object.freeze({ type: "color", default: "#2f5f9e" }),
    accent: Object.freeze({ type: "color", default: "#f2efe8" }),
    height: Object.freeze({ type: "range", min: 1.5, max: 2.05, step: 0.01, default: 1.78 }),
    weight: Object.freeze({ type: "range", min: 45, max: 120, step: 1, default: 70 }),
    kit: Object.freeze({ type: "select", values: KITS, default: "road" }),
    pattern: Object.freeze({ type: "select", values: PATTERNS, default: "band" }),
    primary: Object.freeze({ type: "color", default: "#e8473f" }),
    speed: Object.freeze({ type: "range", min: 0, max: 50, step: 1, default: 24 }),
    standing: Object.freeze({ type: "bool", default: false }),
  }),
});

/** The cadence a rider of the workbench picks at `speed` m/s on `grade` percent. */
const benchCadence = (speed, grade) => (speed < 0.4 ? 0 : clamp(58 + speed * 3.4 - Math.max(grade, 0) * 1.4, 48, 102));
/** Grade the workbench rides at when asked to stand, percent. */
const BENCH_CLIMB = 8;

/**
 * The workbench's cyclist: a look from the options, ridden in place at `speed` km/h.
 * @param {{track?: (resource: any) => any, uniforms?: ReturnType<typeof createSharedUniforms>, type?: string, frame?: string,
 *   accent?: string, speed?: number, standing?: boolean} & Partial<import("./look.js").RiderLook>} [options]
 */
export function create({ track, uniforms, type = "road", frame = "#2f5f9e", accent = "#f2efe8", speed = 24, standing = false, ...options } = {}) {
  const owner = createOwner(track);
  const { height, weight, kit, pattern, primary, skin } = options;
  const look = { ...BENCH_LOOK, bike: type, frame, frameAccent: accent, ...Object.fromEntries(Object.entries({ height, weight, kit, pattern, primary, skin }).filter(([, value]) => value !== undefined)) };
  const cyclist = createCyclist(look, { own: owner.own, uniforms, seed: 1 });
  const grade = standing ? BENCH_CLIMB : 0;
  const metres = speed / 3.6;
  const update = (dt, t) => cyclist.ride(dt, { cadence: benchCadence(metres, grade), speed: metres, grade, t, standing: !!standing });
  update(0, 0);
  return { object: cyclist.object, update, dispose: () => owner.disposeAll() };
}
