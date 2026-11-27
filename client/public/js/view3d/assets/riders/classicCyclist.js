/**
 * The classic cyclist: the old low-poly rider and bike (the shapes of the retired `riderModel.js`) rebuilt as vertex-coloured
 * Three.js meshes on the new lit, shadowed and fogged material. Same interface as `createCyclist` (`object`, `rider.object`,
 * `bike`, `crank`, `standing`, `ride()`, `lights`, `setLights()`, `setKit()`), so the rider layer treats both alike.
 * The jersey is vertex-coloured: `setKit` does nothing, `setPrimary(hex)` recolours it. The thighs, shins and feet are separate
 * meshes; the crank turns about the bottom bracket, each foot rides its pedal and the knee follows by two-bone IK (`legPose`).
 * The pose is modelled in the old frame (forward -Z, up +Y) inside a group turned to face +x, tyres on y = 0.
 */
import * as THREE from "../../../three.js";
import { box, merge, paint, rod } from "../geom.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";
import { createOwner } from "../owner.js";
import { RIDER_SKINS } from "./look.js";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

export const RIDER_GEOMETRY = Object.freeze({
  wheelRadius: 0.34,
  wheelBase: 1.0,
  hip: Object.freeze([0, 1.0, 0.14]),
  bottomBracket: Object.freeze([0, 0.3, 0.05]),
  crankLength: 0.17,
  thigh: 0.42,
  shin: 0.4,
  /** Pedal spindle in the foot's frame (ankle at the origin, foot level, toes to -Z). */
  ball: Object.freeze([0, -0.075, -0.11]),
});
const { wheelRadius, wheelBase, hip, bottomBracket, crankLength, thigh, shin, ball } = RIDER_GEOMETRY;
const HUBS = Object.freeze({ rear: [0, wheelRadius, wheelBase / 2], front: [0, wheelRadius, -wheelBase / 2] });
/** Side of the body the legs sit on, metres from the middle. */
const LEG_SIDE = 0.11;
/** Below this cadence (rpm) the rider coasts. */
const COAST_CADENCE = 1;
/** How far the bike rocks when the rider is out of the saddle, radians. */
const ROCK = 0.12;
/** The old riders came in sizes 0.93 to 1.07. */
const REFERENCE_HEIGHT = 1.78;
const SIZE_RANGE = Object.freeze([0.93, 1.07]);

const rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const TYRE = rgb(0.06, 0.06, 0.07);
const RIM = rgb(0.58, 0.6, 0.63);
const SPOKE = rgb(0.75, 0.77, 0.8);
const SADDLE = rgb(0.08, 0.08, 0.09);
const VISOR = rgb(0.08, 0.08, 0.1);
const SHOE = rgb(0.95, 0.95, 0.95);
const SOCK = rgb(0.92, 0.92, 0.93);
const PEDAL = rgb(0.12, 0.12, 0.13);
const CRANK = rgb(0.32, 0.33, 0.36);

/** X rotation that turns a limb modelled hanging straight down (-Y) to point from `a` to `b`. */
const hangAngle = (a, b) => Math.atan2(-(b[2] - a[2]), -(b[1] - a[1]));

/** Rotation of the point (y, z) around the X axis. */
function rotateYZ([x, y, z], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, c * y - s * z, s * y + c * z];
}

/**
 * Pose of one leg for a crank phase (radians, grows while pedalling forward; 0 = this leg's pedal at the bottom), in the old
 * frame: points in the YZ plane, angles are X rotations for the thigh, shin and foot meshes at the hip, knee and ankle.
 */
export function legPose(phase) {
  const r = crankLength;
  const pedal = [0, bottomBracket[1] - r * Math.cos(phase), bottomBracket[2] + r * Math.sin(phase)];
  // Ankling: toes point down most on the back of the stroke, heel drops over the top.
  const footAngle = -(0.28 + 0.2 * Math.sin(phase));
  const toBall = rotateYZ(ball, footAngle);
  const ankle = [0, pedal[1] - toBall[1], pedal[2] - toBall[2]];
  // Two-bone IK in the YZ plane; the knee bends forward (-Z).
  const dy = ankle[1] - hip[1];
  const dz = ankle[2] - hip[2];
  const reach = Math.hypot(dy, dz);
  const d = Math.min(thigh + shin - 1e-4, Math.max(Math.abs(thigh - shin) + 1e-4, reach));
  const [uy, uz] = [dy / reach, dz / reach];
  const cosHip = (thigh * thigh + d * d - shin * shin) / (2 * thigh * d);
  const sinHip = Math.sqrt(Math.max(0, 1 - cosHip * cosHip));
  const knee = [0, hip[1] + thigh * (cosHip * uy - sinHip * uz), hip[2] + thigh * (cosHip * uz + sinHip * uy)];
  return { pedal, ankle, knee, thighAngle: hangAngle(hip, knee), shinAngle: hangAngle(knee, ankle), footAngle };
}

// ---------- shapes (old frame)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((value) => value / (Math.hypot(...a) || 1));

/** Box from `start` to `end` (a limb or tube): `width` along X, `thickness` across it in the YZ plane. */
function segment(start, end, width, thickness, color) {
  const axis = sub(end, start);
  const normal = unit(cross([1, 0, 0], axis)).map((value) => value * thickness);
  const centre = start.map((value, i) => (value + end[i]) / 2);
  return paint(new THREE.BoxGeometry(1, 1, 1), color).applyMatrix4(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(width, 0, 0), new THREE.Vector3(...axis), new THREE.Vector3(...normal)).setPosition(...centre),
  );
}

/** A flat-sided ellipsoid. */
const ellipsoid = (centre, radii, color, rings, segments) => paint(new THREE.SphereGeometry(1, segments, rings), color).scale(...radii).translate(...centre);

/** A disc round the X axis (a wheel layer or a chainring), centred on `centre`. */
const disc = (centre, radius, width, color, sides) => paint(new THREE.CylinderGeometry(radius, radius, width, sides), color).rotateZ(Math.PI / 2).translate(...centre);

/**
 * Merges the parts of one mesh; `jersey` marks the parts painted in the rider's jersey colour, whose vertex ranges are kept
 * on `userData.jersey` for `setPrimary`.
 * @param {[THREE.BufferGeometry, boolean?][]} parts
 */
function compose(parts) {
  const ranges = [];
  let at = 0;
  for (const [geometry, jersey] of parts) {
    const count = geometry.attributes.position.count;
    if (jersey) ranges.push([at, count]);
    at += count;
  }
  const geometry = merge(parts.map(([part]) => part));
  geometry.userData.jersey = ranges;
  return geometry;
}

const frameParts = (frame, jersey) => {
  const [rear, front] = [HUBS.rear, HUBS.front];
  const seat = [0, 0.94, 0.2];
  const head = [0, 0.9, -0.36];
  return [
    [segment(rear, bottomBracket, 0.035, 0.04, frame)],
    [segment(rear, seat, 0.03, 0.035, frame)],
    [segment(bottomBracket, seat, 0.045, 0.05, frame)],
    [segment(bottomBracket, head, 0.06, 0.06, jersey), true],
    [segment(seat, head, 0.045, 0.045, frame)],
    [segment(head, front, 0.035, 0.04, frame)],
    [box(0.12, 0.1, 0.1, frame, ...bottomBracket)],
    [box(0.12, 0.04, 0.26, SADDLE, 0, 0.97, 0.22)],
    [segment(head, [0, 0.98, -0.42], 0.04, 0.04, frame)], // stem
    [box(0.44, 0.035, 0.05, SADDLE, 0, 0.98, -0.44)], // bar tape
    ...[-0.2, 0.2].map((side) => [segment([side, 0.98, -0.44], [side, 0.88, -0.5], 0.035, 0.035, SADDLE)]),
  ];
};

/** A spoked wheel at the origin, spinning round X. */
const wheelParts = () => {
  const r = wheelRadius;
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * TAU;
    return [rod([0, 0, 0], [0, Math.cos(angle) * r * 0.82, Math.sin(angle) * r * 0.82], 0.012, SPOKE, 3)];
  });
  return [[disc([0, 0, 0], r, 0.05, TYRE, 16)], [disc([0, 0, 0], r * 0.88, 0.056, RIM, 16)], [disc([0, 0, 0], r * 0.8, 0.058, TYRE, 16)], [disc([0, 0, 0], 0.045, 0.1, RIM, 8)], ...spokes];
};

/** Chainring and both crank arms round the bottom bracket (origin); the right arm points down. */
const crankParts = () => [
  [disc([0.075, 0, 0], 0.11, 0.012, CRANK, 16)],
  [disc([0.075, 0, 0], 0.06, 0.016, PEDAL, 8)],
  [segment([0.09, 0.02, 0], [0.09, -crankLength, 0], 0.02, 0.035, CRANK)],
  [segment([-0.09, -0.02, 0], [-0.09, crankLength, 0], 0.02, 0.035, CRANK)],
  [disc([0, 0, 0], 0.03, 0.2, PEDAL, 8)],
];

/** Pelvis, torso, arms and head in the riding pose, in the bike frame (the old riding pose never moved). */
const upperParts = ({ skin, helmet, shorts }, jersey) => [
  [box(0.32, 0.12, 0.2, shorts, 0, 1.02, 0.16)],
  [segment(hip, [0, 1.28, -0.16], 0.34, 0.22, jersey), true],
  [segment([0, 1.28, -0.16], [0, 1.36, -0.3], 0.38, 0.22, jersey), true],
  [box(0.12, 0.08, 0.1, skin, 0, 1.46, -0.36)], // neck
  [ellipsoid([0, 1.53, -0.4], [0.1, 0.11, 0.11], skin, 3, 6)],
  [ellipsoid([0, 1.6, -0.38], [0.13, 0.09, 0.17], helmet, 3, 7)],
  [box(0.18, 0.04, 0.03, VISOR, 0, 1.53, -0.5)],
  ...[-1, 1].flatMap((side) => [
    [segment([side * 0.18, 1.34, -0.28], [side * 0.18 * 1.08, 1.17, -0.38], 0.1, 0.1, jersey), true],
    [segment([side * 0.18 * 1.08, 1.17, -0.38], [side * 0.18 * 1.1, 0.99, -0.46], 0.08, 0.08, skin)],
  ]),
];

/** Thigh hanging from the hip (origin): shorts, then bare skin above the knee. */
const thighParts = ({ skin, shorts }) => [
  [segment([0, 0.02, 0], [0, -thigh * 0.78, 0], 0.15, 0.16, shorts)],
  [segment([0, -thigh * 0.78, 0], [0, -thigh, 0], 0.12, 0.12, skin)],
];

/** Shin hanging from the knee (origin): kneecap, calf and sock. */
const shinParts = ({ skin }) => [
  [ellipsoid([0, 0, 0], [0.065, 0.07, 0.07], skin, 3, 6)],
  [segment([0, 0, 0], [0, -shin * 0.45, 0], 0.11, 0.11, skin)],
  [segment([0, -shin * 0.45, 0], [0, -shin * 0.8, 0], 0.085, 0.085, skin)],
  [segment([0, -shin * 0.8, 0], [0, -shin - 0.02, 0], 0.08, 0.08, SOCK)],
];

/** Shoe with the pedal clipped under the ball of the foot; ankle at the origin, toes to -Z. */
const footParts = () => [[box(0.09, 0.07, 0.26, SHOE, 0, -0.025, -0.07)], [box(0.1, 0.025, 0.09, PEDAL, ball[0], ball[1], ball[2])]];

/**
 * @typedef {object} ClassicCyclist the members of `createCyclist`'s result, plus `setPrimary`
 * @property {import("../../../three.js").Group} object facing +x, tyres on y = 0
 * @property {{object: import("../../../three.js").Group}} rider the body meshes only
 * @property {{object: import("../../../three.js").Group, lights: number, setLights: (level: number) => void}} bike
 * @property {number} crank radians, decreasing while pedalling forward
 * @property {number} standing 0 seated .. 1 out of the saddle
 * @property {(dt: number, state?: import("./cyclist.js").RideInput) => void} ride
 * @property {number} lights
 * @property {(level: number) => void} setLights
 * @property {(texture: unknown) => void} setKit does nothing: the classic jersey is vertex-coloured
 * @property {(hex: string) => void} setPrimary recolours the jersey
 */

/**
 * Builds the classic cyclist for a look (skin, helmet, shorts, frame and primary colours are used).
 * @param {import("./look.js").RiderLook} look
 * @param {{own?: <T>(resource: T) => T, uniforms?: ReturnType<typeof createSharedUniforms>, seed?: number, texture?: unknown}} [options]
 * @returns {ClassicCyclist}
 */
export function createClassicCyclist(look, { own = (resource) => resource, uniforms = createSharedUniforms() } = {}) {
  const colours = {
    skin: new THREE.Color(RIDER_SKINS[look.skin] ?? look.skin),
    helmet: new THREE.Color(look.helmet),
    shorts: new THREE.Color(look.shorts),
  };
  const frame = new THREE.Color(look.frame);
  const jersey = new THREE.Color(look.primary);
  const material = own(addHook(addHook(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }), cloudShadows(uniforms)), heightFog(uniforms)));
  const geometries = [];
  const mesh = (name, parts, parent) => {
    const geometry = own(compose(parts));
    geometries.push(geometry);
    const result = new THREE.Mesh(geometry, material);
    Object.assign(result, { name, castShadow: true, receiveShadow: true });
    parent.add(result);
    return result;
  };

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.scale.setScalar(clamp(look.height / REFERENCE_HEIGHT, ...SIZE_RANGE));
  const classic = new THREE.Group();
  classic.rotation.y = -Math.PI / 2; // the old forward -Z onto +x
  root.add(tilt);
  tilt.add(classic);
  const bikeObject = new THREE.Group();
  const body = new THREE.Group();
  classic.add(bikeObject, body);

  mesh("frame", frameParts(frame, jersey), bikeObject);
  const wheels = { rear: mesh("wheelRear", wheelParts(), bikeObject), front: mesh("wheelFront", wheelParts(), bikeObject) };
  wheels.rear.position.set(...HUBS.rear);
  wheels.front.position.set(...HUBS.front);
  const crankset = mesh("crankset", crankParts(), bikeObject);
  crankset.position.set(...bottomBracket);

  mesh("upper", upperParts(colours, jersey), body);
  const legs = ["R", "L"].map((name, index) => {
    const side = index === 0 ? 1 : -1;
    const parts = { thigh: mesh(`thigh${name}`, thighParts(colours), body), shin: mesh(`shin${name}`, shinParts(colours), body), foot: mesh(`foot${name}`, footParts(), body) };
    parts.thigh.position.set(side * LEG_SIDE, hip[1], hip[2]);
    for (const part of [parts.shin, parts.foot]) part.position.x = side * LEG_SIDE;
    return { ...parts, offset: index * Math.PI };
  });

  const state = { distance: 0, crank: 0.6, coast: 0, stand: 0 };
  const lightsState = { value: 1 };

  const pose = () => {
    crankset.rotation.x = state.crank;
    for (const { thigh: upper, shin: lower, foot, offset } of legs) {
      const leg = legPose(-state.crank + offset);
      upper.rotation.x = leg.thighAngle;
      lower.position.set(lower.position.x, leg.knee[1], leg.knee[2]);
      lower.rotation.x = leg.shinAngle;
      foot.position.set(foot.position.x, leg.ankle[1], leg.ankle[2]);
      foot.rotation.x = leg.footAngle;
    }
    tilt.rotation.x = state.stand * ROCK * Math.sin(state.crank);
  };

  const bike = {
    object: bikeObject,
    get lights() {
      return lightsState.value;
    },
    setLights(level) {
      lightsState.value = clamp(level, 0, 1);
    },
  };

  const cyclist = {
    object: root,
    rider: { object: body },
    bike,
    get crank() {
      return state.crank;
    },
    get standing() {
      return state.stand;
    },
    ride(dt, { cadence = 0, speed = 0, standing = null } = {}) {
      state.distance += speed * dt;
      for (const wheel of Object.values(wheels)) wheel.rotation.x = -state.distance / wheelRadius;
      if (cadence < COAST_CADENCE) {
        // ease to the nearest level position of the pedals
        const level = Math.round(state.crank / Math.PI) * Math.PI;
        state.crank += (level - state.crank) * Math.min(1, dt * 3);
        state.coast = Math.min(1, state.coast + dt * 2);
      } else {
        state.crank -= (cadence / 60) * TAU * dt;
        state.coast = Math.max(0, state.coast - dt * 2);
      }
      state.stand = lerp(state.stand, standing ? 1 : 0, Math.min(1, dt * 2.5));
      pose();
    },
    get lights() {
      return bike.lights;
    },
    setLights(level) {
      bike.setLights(level);
    },
    setKit() {},
    setPrimary(hex) {
      jersey.set(hex);
      for (const geometry of geometries) {
        const color = geometry.attributes.color;
        for (const [from, count] of geometry.userData.jersey) for (let i = from; i < from + count; i += 1) color.setXYZ(i, jersey.r, jersey.g, jersey.b);
        color.needsUpdate = true;
      }
    },
  };
  pose();
  return cyclist;
}

// ---------- the workbench asset

export const meta = Object.freeze({
  id: "classic-cyclist",
  name: "Classic cyclist (old rider + bike)", // i18n-ok
  category: "Creatures", // i18n-ok
  description: "The old low-poly rider and bike, rebuilt: pedalling legs by two-bone IK. Unlocked by the Old School achievement.", // i18n-ok
  options: Object.freeze({
    frame: Object.freeze({ type: "color", default: "#2f5f9e" }),
    primary: Object.freeze({ type: "color", default: "#e8473f" }),
    speed: Object.freeze({ type: "range", min: 0, max: 50, step: 1, default: 24 }),
    standing: Object.freeze({ type: "bool", default: false }),
  }),
});

/**
 * The workbench's classic cyclist, ridden in place at `speed` km/h.
 * @param {{track?: (resource: any) => any, uniforms?: ReturnType<typeof createSharedUniforms>, frame?: string, primary?: string, speed?: number, standing?: boolean}} [options]
 */
export function create({ track, uniforms, frame = "#2f5f9e", primary = "#e8473f", speed = 24, standing = false } = {}) {
  const owner = createOwner(track);
  const look = { ...BENCH, frame, primary };
  const cyclist = createClassicCyclist(look, { own: owner.own, uniforms });
  const metres = speed / 3.6;
  const cadence = metres < 0.4 ? 0 : clamp(58 + metres * 3.4, 48, 102);
  const update = (dt, t) => cyclist.ride(dt, { cadence, speed: metres, t, standing: !!standing });
  update(0, 0);
  return { object: cyclist.object, update, dispose: () => owner.disposeAll() };
}

const BENCH = Object.freeze({ height: 1.78, skin: "tan", helmet: "#f2f2f2", shorts: "#17181c" });
