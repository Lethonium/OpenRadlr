/**
 * Bicycles: road, gravel, city, mountain and time-trial bikes built from real frame geometry (stack, reach, head and
 * seat angles, chainstay, bottom-bracket drop, rake). Forward is +x, up +y, the drive side (the rider's right) is +z and
 * the tyres touch the ground at y = 0. `bikeGeometry` gives the contact points a rider needs without building a mesh;
 * `createBike` builds the bike with its moving parts: rear wheel, steering assembly (fork, front wheel, bars),
 * crankset and pedals. Ported from the reference's `props/bicycle.js`, one vertex-coloured mesh per material and part.
 */
import * as THREE from "../../../three.js";
import { mergeGeometries } from "../../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { box, colour, cylinder, merge, paint, rod as rodArrays } from "../geom.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";

const DEG = Math.PI / 180;
const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** Colours geometry with a hex, CSS colour or `Color`. */
const painted = (geometry, value) => paint(geometry, colour(value));

/**
 * The bike types. `R` wheel radius with tyre, `tyre` tyre width, `sta`/`hta` seat and head angle in degrees, `st` seat
 * tube, `bar` handlebar style, `grip` the hand position a rider takes by default.
 */
export const BIKE_TYPES = Object.freeze({
  road: { R: 0.336, tyre: 0.027, cs: 0.41, bbDrop: 0.07, sta: 73.5, hta: 73, stack: 0.565, reach: 0.385, ht: 0.15, st: 0.52, rake: 0.045, bar: "drop", barW: 0.42, stem: 0.1, stemA: -0.1, spacer: 0.03, disc: true, rim: 0.045, spokes: 24, pedal: "clip", rings: [50, 34], saddle: "race", bottles: 2, tubes: [0.016, 0.021, 0.015, 0.02, 0.01, 0.008], grip: "hoods" },
  gravel: { R: 0.352, tyre: 0.042, cs: 0.43, bbDrop: 0.075, sta: 73.5, hta: 71.5, stack: 0.59, reach: 0.38, ht: 0.17, st: 0.5, rake: 0.05, bar: "flare", barW: 0.44, stem: 0.09, stemA: -0.05, spacer: 0.04, disc: true, rim: 0.025, spokes: 28, pedal: "clip", rings: [40], knobs: 1, tan: true, saddle: "race", bottles: 2, bags: true, tubes: [0.016, 0.022, 0.015, 0.021, 0.011, 0.009], grip: "hoods" },
  city: { R: 0.35, tyre: 0.04, cs: 0.46, bbDrop: 0.07, sta: 70, hta: 69, stack: 0.66, reach: 0.34, ht: 0.22, st: 0.5, step: true, rake: 0.055, bar: "swept", barW: 0.6, stem: 0.07, stemA: 0.6, spacer: 0.09, disc: false, rim: 0.02, spokes: 32, pedal: "flat", rings: [38], fenders: true, rack: true, guard: true, basket: true, lights: true, saddle: "comfort", kickstand: true, tubes: [0.017, 0.022, 0.017, 0.02, 0.011, 0.009], grip: "flat" },
  mtb: { R: 0.372, tyre: 0.058, cs: 0.435, bbDrop: 0.05, sta: 75, hta: 66, stack: 0.625, reach: 0.45, ht: 0.11, st: 0.44, rake: 0.044, bar: "flat", barW: 0.76, stem: 0.05, stemA: 0.05, spacer: 0.02, disc: true, rim: 0.025, spokes: 28, pedal: "flat", rings: [32], knobs: 2, susp: true, saddle: "race", bottles: 1, tubes: [0.019, 0.025, 0.017, 0.023, 0.012, 0.01], grip: "flat" },
  tt: { R: 0.336, tyre: 0.024, cs: 0.405, bbDrop: 0.07, sta: 78, hta: 73, stack: 0.51, reach: 0.42, ht: 0.11, st: 0.52, rake: 0.045, bar: "aero", barW: 0.4, stem: 0.1, stemA: -0.17, spacer: 0.0, disc: true, rim: 0.08, rearDisc: true, spokes: 18, pedal: "clip", rings: [54, 42], saddle: "race", bottles: 0, tubes: [0.017, 0.026, 0.02, 0.022, 0.011, 0.009], grip: "aero" },
});

/** Frame-tube radii are the reference's tube table times this. */
const TUBE_SCALE = 1.4;
/** Default saddle height along the seat tube, metres per scale, and its offset. */
const SADDLE_PER_SCALE = 0.71;
const SADDLE_OFFSET = 0.03;
/** Crank length at scale 1 and the half distance between the pedals. */
const CRANK_LENGTH = 0.1725;
const PEDAL_HALF_GAP = 0.105;
const CHAINRING_TOOTH = 0.00202;
const SPOKE_COLOUR = "#b9bec4";
const KINDS = Object.freeze(["paint", "metal", "rubber", "glow"]);
/** Per kind: roughness, metalness and how strongly the colour glows; read per vertex by the one bike material. */
const SURFACE = Object.freeze({ paint: [0.32, 0.25, 0], metal: [0.42, 0.55, 0], rubber: [0.88, 0, 0], glow: [0.4, 0, 0.6] });

/**
 * What a bike gives a rider: its contact points and wheel positions in the bike's frame, `createRider`'s `RiderFit`
 * and more.
 * @typedef {object} BikeFit
 * @property {object} T the type's table entry (`grip` is the default hand position)
 * @property {string} type
 * @property {number} scale frame scale
 * @property {import("../../../three.js").Vector3} bb bottom bracket
 * @property {import("../../../three.js").Vector3} sd seat tube direction (unit, pointing up and back)
 * @property {import("../../../three.js").Vector3} saddle saddle top
 * @property {number} saddleH saddle height along the seat tube
 * @property {Record<string, import("../../../three.js").Vector3[]>} grips `[left, right]` points per hand position
 * @property {number} crankLen
 * @property {number} q half the distance between the pedals
 * @property {import("../../../three.js").Vector3} rear rear hub
 * @property {import("../../../three.js").Vector3} front front hub
 * @property {number} wheelRadius
 * @property {import("../../../three.js").Vector3} headTop head tube top
 * @property {import("../../../three.js").Vector3} headBot head tube bottom
 * @property {import("../../../three.js").Vector3} ax steering axis, pointing down and forward (unit)
 * @property {import("../../../three.js").Vector3} up steering axis upwards (unit)
 * @property {import("../../../three.js").Vector3} fwd forward along the fork's rake (unit)
 * @property {import("../../../three.js").Vector3} seatTop top of the seat tube
 * @property {import("../../../three.js").Vector3} steererTop top of the steerer
 * @property {import("../../../three.js").Vector3} clamp the stem's bar clamp
 */

/**
 * The contact points of a bike, without building any mesh.
 * @param {string} [type] a `BIKE_TYPES` key
 * @param {{scale?: number, saddleHeight?: number | null}} [options] `saddleHeight` along the seat tube
 * @returns {BikeFit}
 */
export function bikeGeometry(type = "road", { scale = 1, saddleHeight = null } = {}) {
  const T = BIKE_TYPES[type] ?? BIKE_TYPES.road;
  const R = T.R;
  const bb = vec(0, R - T.bbDrop);
  const sd = vec(-Math.cos(T.sta * DEG), Math.sin(T.sta * DEG));
  const headTop = vec(T.reach * scale, bb.y + T.stack * scale);
  const ax = vec(Math.cos(T.hta * DEG), -Math.sin(T.hta * DEG));
  const up = ax.clone().negate();
  const fwd = vec(Math.sin(T.hta * DEG), Math.cos(T.hta * DEG));
  const headBot = headTop.clone().addScaledVector(ax, T.ht * scale);
  const onAxis = headBot.clone().addScaledVector(ax, (R - headBot.y) / ax.y);
  const front = onAxis.clone().addScaledVector(fwd, T.rake);
  front.y = R;
  const rear = vec(-T.cs, R);
  const seatTop = bb.clone().addScaledVector(sd, T.st * scale);
  const saddleH = saddleHeight ?? SADDLE_PER_SCALE * scale + SADDLE_OFFSET;
  const saddle = bb.clone().addScaledVector(sd, saddleH);
  const steererTop = headTop.clone().addScaledVector(up, T.spacer + 0.025);
  const clampPoint = steererTop.clone().addScaledVector(vec(1, 0).applyAxisAngle(vec(0, 0, 1), T.stemA), T.stem * Math.max(0.85, scale));
  const half = T.barW / 2;
  const pair = (x, y, z) => [clampPoint.clone().add(vec(x, y, -z)), clampPoint.clone().add(vec(x, y, z))];
  const grips = {};
  if (T.bar === "drop" || T.bar === "flare") {
    const flare = T.bar === "flare" ? 0.035 : 0;
    grips.tops = pair(0, 0, 0.12);
    grips.hoods = pair(0.075, 0.025, half);
    grips.drops = pair(0.01, -0.115, half + flare + 0.005);
  }
  if (T.bar === "flat") grips.flat = pair(0, 0.015, half - 0.06);
  if (T.bar === "swept") grips.flat = pair(-0.16, 0.05, half - 0.07);
  if (T.bar === "aero") {
    grips.aero = pair(0.31, 0.075, 0.055);
    grips.hoods = pair(0.03, -0.005, 0.2);
    grips.pads = pair(0.03, 0.085, 0.1);
  }
  return {
    type, T, scale, bb, sd, saddle, saddleH, grips, crankLen: CRANK_LENGTH * clamp(scale, 0.95, 1.02), q: PEDAL_HALF_GAP,
    rear, front, wheelRadius: R, headTop, headBot, ax, up, fwd, seatTop, steererTop, clamp: clampPoint,
  };
}

// ---------- mesh helpers

const bucket = () => ({ paint: [], metal: [], rubber: [], glow: [] });
/** A rod between two vectors. */
const rodBetween = (a, b, radius, value, segments = 10) => rodArrays(a.toArray(), b.toArray(), radius, colour(value), segments);
const rodTo = (parts, kind, a, b, radius, value, segments = 10) => parts[kind].push(rodBetween(a, b, radius, value, segments));
const tubeTo = (parts, kind, points, radius, value, steps = 24, segments = 8) =>
  parts[kind].push(painted(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), steps, radius, segments, false), value));

/** Reads roughness, metalness and glow from the per-vertex `surface` attribute, so one material serves every part. */
const surfaceHook = Object.assign(
  (shader) => {
    shader.vertexShader = `attribute vec3 surface;\nvarying vec3 vSurface;\n${shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vSurface = surface;")}`; // i18n-ok
    shader.fragmentShader = `varying vec3 vSurface;\n${shader.fragmentShader
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = vSurface.x;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n metalnessFactor = vSurface.y;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vSurface.z;")}`; // i18n-ok
  },
  { key: "surface" },
);

/**
 * The one bike material, on the scene's shared hooks (the surface hook gives each vertex its own finish).
 * @param {(resource: any) => any} own
 * @param {ReturnType<typeof createSharedUniforms>} uniforms
 */
function bikeMaterial(own, uniforms) {
  return own(addHook(addHook(addHook(new THREE.MeshStandardMaterial({ vertexColors: true }), surfaceHook), cloudShadows(uniforms)), heightFog(uniforms)));
}

/**
 * Merges every bucket of a rigid part into one mesh on the bike material and adds it to `group`; each vertex carries
 * its kind's finish. `shift` moves the origin.
 */
function flush(parts, group, kit, shift = null) {
  const pieces = [];
  for (const kind of KINDS) {
    if (!parts[kind].length) continue;
    const geometry = merge(parts[kind]);
    const finish = SURFACE[kind];
    const count = geometry.attributes.position.count;
    const surface = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) surface.set(finish, i * 3);
    geometry.setAttribute("surface", new THREE.BufferAttribute(surface, 3));
    pieces.push(geometry);
  }
  if (!pieces.length) return;
  const geometry = pieces.length > 1 ? mergeGeometries(pieces) : pieces[0];
  if (shift) geometry.translate(-shift.x, -shift.y, -shift.z);
  const mesh = new THREE.Mesh(kit.own(geometry), kit.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** A tyre, rim, spokes, hub, brake rotor and (rear) cassette, wheel axis along z, hub at the origin. */
function buildWheel(fit, { rear, rimColour, wall }, kit) {
  const T = fit.T;
  const parts = bucket();
  const R = T.R;
  const tyreWidth = T.tyre * 1.22;
  const rimRadius = R - tyreWidth * 0.85;
  const group = new THREE.Group();
  // tyre: black tread, sidewalls black or tan (told apart by their normals)
  const tyre = painted(new THREE.TorusGeometry(R - tyreWidth / 2, tyreWidth / 2, 10, 72), "#ffffff");
  const normal = tyre.attributes.normal;
  const shade = tyre.attributes.color;
  const tread = colour("#1c1c1e");
  const side = colour(wall === "tan" ? "#b58a55" : "#232325");
  for (let i = 0; i < shade.count; i += 1) {
    const c = Math.abs(normal.getZ(i)) > 0.55 ? side : tread;
    shade.setXYZ(i, c.r, c.g, c.b);
  }
  parts.rubber.push(tyre);
  if (T.knobs) {
    const count = T.knobs === 2 ? 64 : 90;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      for (const lane of T.knobs === 2 ? [-0.6, 0, 0.6] : [-0.45, 0.45]) {
        if (T.knobs === 2 && lane === 0 && i % 2) continue;
        const knob = box(T.knobs === 2 ? 0.014 : 0.008, 0.007, T.knobs === 2 ? 0.012 : 0.009, tread);
        knob.translate(0, R + 0.0015, lane * tyreWidth * 0.42);
        knob.rotateZ(angle);
        parts.rubber.push(knob);
      }
    }
  }
  // rim: outer wall, inner wall and both side faces; a disc wheel at the back of the time-trial bike
  const rim = colour(rimColour);
  const depth = rear && T.rearDisc ? rimRadius - 0.03 : T.rim;
  if (rear && T.rearDisc) {
    parts.paint.push(cylinder(rimRadius, rimRadius, 0.026, 48, rim).rotateX(Math.PI / 2));
    parts.paint.push(cylinder(rimRadius * 0.55, rimRadius * 0.55, 0.03, 32, colour("#e9e6df")).rotateX(Math.PI / 2));
  } else {
    for (const radius of [rimRadius, rimRadius - depth]) parts.metal.push(cylinder(radius, radius, 0.026, 48, rim, 0, 0, 0, true).rotateX(Math.PI / 2));
    for (const z of [-0.013, 0.013]) {
      const ring = painted(new THREE.RingGeometry(rimRadius - depth, rimRadius, 48), rim);
      ring.translate(0, 0, z);
      if (z < 0) ring.rotateY(Math.PI);
      parts.metal.push(ring);
    }
    for (let k = 0; k < T.spokes; k += 1) {
      const angle = (k / T.spokes) * Math.PI * 2;
      const flange = k % 2 ? 1 : -1;
      const hubAngle = angle + flange * 0.35;
      parts.metal.push(rodBetween(vec(Math.cos(hubAngle) * 0.024, Math.sin(hubAngle) * 0.024, flange * 0.03), vec(Math.cos(angle) * (rimRadius - depth), Math.sin(angle) * (rimRadius - depth), flange * 0.004), 0.0017, SPOKE_COLOUR, 3));
    }
  }
  parts.metal.push(cylinder(0.026, 0.026, 0.1, 12, colour("#2a2c2e")).rotateX(Math.PI / 2));
  if (T.disc) {
    parts.metal.push(cylinder(0.08, 0.08, 0.002, 28, colour("#c9cdd2")).rotateX(Math.PI / 2).translate(0, 0, -0.058));
    parts.metal.push(cylinder(0.035, 0.035, 0.004, 10, colour("#2a2c2e")).rotateX(Math.PI / 2).translate(0, 0, -0.058));
  }
  if (rear) {
    const sprockets = T.rings.length > 1 ? 11 : 12;
    for (let k = 0; k < sprockets; k += 1) {
      const radius = 0.052 - k * 0.0028;
      parts.metal.push(cylinder(radius, radius, 0.0018, 24, colour(k % 2 ? "#b9bec4" : "#8d949b")).rotateX(Math.PI / 2).translate(0, 0, 0.022 + k * 0.0036));
    }
  }
  flush(parts, group, kit);
  return group;
}

/** A chainring with its teeth pressed in, on the drive side at depth `z`. */
function chainring(teeth, z, value) {
  const radius = teeth * CHAINRING_TOOTH;
  const geometry = painted(new THREE.CylinderGeometry(radius, radius, 0.006, teeth * 2, 1), "#ffffff");
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const zz = p.getZ(i);
    const length = Math.hypot(x, zz);
    if (length < 1e-6) continue;
    const step = Math.round((Math.atan2(zz, x) / (Math.PI * 2)) * teeth * 2);
    if (step % 2) {
      p.setX(i, (x / length) * (radius - 0.004));
      p.setZ(i, (zz / length) * (radius - 0.004));
    }
  }
  geometry.computeVertexNormals();
  const c = colour(value);
  const shade = geometry.attributes.color;
  for (let i = 0; i < shade.count; i += 1) shade.setXYZ(i, c.r, c.g, c.b);
  return geometry.rotateX(Math.PI / 2).translate(0, 0, z);
}

/** The saddle's geometries (shell and rails), the top at y = 0. */
function saddleGeometries(kind, value) {
  const shellColour = colour(value);
  const out = [];
  if (kind === "comfort") {
    const shell = painted(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), shellColour);
    shell.scale(0.14, 0.05, 0.11);
    shell.translate(-0.02, -0.035, 0);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      p.setZ(i, p.getZ(i) * (x > 0 ? 1 - (x / 0.14) * 0.6 : 1));
    }
    shell.computeVertexNormals();
    out.push(shell);
    for (const z of [-0.06, 0.06]) out.push(cylinder(0.012, 0.012, 0.05, 8, colour("#8d949b")).translate(-0.08, -0.06, z));
    return out;
  }
  const shell = painted(new THREE.BoxGeometry(0.27, 0.03, 0.14, 12, 1, 6), shellColour);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const t = clamp((x + 0.135) / 0.27, 0, 1);
    const width = t < 0.35 ? 1 : 1 - ((t - 0.35) / 0.65) * 0.78;
    const z = p.getZ(i) * width;
    const crown = 1 - Math.pow(Math.abs(z) / 0.07, 2) * 0.5;
    p.setZ(i, z);
    p.setY(i, (y > 0 ? y * crown + 0.004 * crown : y) - (t < 0.12 ? (0.12 - t) * 0.08 : 0) - (t > 0.85 ? (t - 0.85) * 0.05 : 0));
  }
  shell.computeVertexNormals();
  shell.translate(-0.015, -0.015, 0);
  out.push(shell);
  for (const z of [-0.035, 0.035]) out.push(rodBetween(vec(-0.1, -0.04, z), vec(0.08, -0.035, z), 0.0035, "#8d949b", 4));
  return out;
}

/**
 * @typedef {object} Bike
 * @property {import("../../../three.js").Group} object the whole bike, tyres on y = 0, forward +x
 * @property {BikeFit} fit
 * @property {import("../../../three.js").Group} rearWheel
 * @property {import("../../../three.js").Group} frontWheel
 * @property {import("../../../three.js").Group} steer the fork, front wheel and bars, pivoting on the steering axis
 * @property {import("../../../three.js").Group} crank the crankset, turning about the bottom bracket
 * @property {import("../../../three.js").Group[]} pedals `[left, right]`
 * @property {(distanceM: number) => void} setWheels roll both wheels to `distanceM` travelled
 * @property {(angle: number, pitchL?: number, pitchR?: number) => void} setCrank
 * @property {(angle: number) => void} setSteer
 * @property {(side: number, angle: number, out?: import("../../../three.js").Vector3) => import("../../../three.js").Vector3} pedalPos
 *   where the pedal of `side` (-1 left, 1 right) is for crank angle `angle`, in the bike's frame
 */

/**
 * Builds a bike. The crank angle is the right arm's, pointing along (cos, sin) in the xy plane; pedalling forward makes it decrease.
 * @param {object} [options]
 * @param {string} [options.type] a `BIKE_TYPES` key
 * @param {string} [options.frame] frame colour
 * @param {string} [options.accent] trim colour
 * @param {string} [options.tape] bar tape colour
 * @param {string | null} [options.tyreWall] `black` or `tan`; the type's own when null
 * @param {string} [options.rimColor]
 * @param {string} [options.bottle]
 * @param {string} [options.saddleColor]
 * @param {number} [options.scale] frame scale
 * @param {number | null} [options.saddleHeight] along the seat tube
 * @param {boolean | null} [options.basket]
 * @param {boolean | null} [options.bags]
 * @param {<T>(resource: T) => T} [options.own]
 * @param {ReturnType<typeof createSharedUniforms>} [options.uniforms]
 * @returns {Bike}
 */
export function createBike({
  type = "road", frame = "#c8382e", accent = "#f2efe8", tape = "#1d1f24", tyreWall = null, rimColor = "#1d1f24", bottle = "#f2efe8",
  saddleColor = "#1d1f24", scale = 1, saddleHeight = null, basket = null, bags = null, own = (resource) => resource, uniforms = createSharedUniforms(),
} = {}) {
  const fit = bikeGeometry(type, { scale, saddleHeight });
  const T = fit.T;
  const kit = { own, material: bikeMaterial(own, uniforms) };
  const root = new THREE.Group();
  const parts = bucket();
  const frameColour = colour(frame);
  const accentColour = colour(accent);
  const black = colour("#1d1f24");
  const dark = colour("#2a2c2e");
  const s = fit.scale;
  const [topTube, downTube, seatTube, headTube, chainStay, seatStay] = T.tubes.map((radius) => radius * TUBE_SCALE);
  const { bb, sd, headTop, headBot, ax, up, fwd, front, rear, seatTop, saddle } = fit;
  const wall = tyreWall ?? (T.tan ? "tan" : "black");

  // ---- frame
  rodTo(parts, "paint", headTop.clone().addScaledVector(up, 0.012), headBot.clone().addScaledVector(ax, 0.012), headTube, T.bar === "aero" ? frameColour : accentColour, 14);
  if (T.step) {
    tubeTo(parts, "paint", [headTop.clone().addScaledVector(ax, 0.03), headBot.clone().add(vec(-0.07, -0.13)), bb.clone().add(vec(0.2, 0.03)), bb.clone().add(vec(0.02, 0.005))], downTube, frameColour, 28, 10);
    tubeTo(parts, "paint", [headTop.clone().addScaledVector(ax, 0.035), headBot.clone().add(vec(-0.12, 0)), bb.clone().addScaledVector(sd, T.st * s * 0.62).add(vec(0.12, 0)), bb.clone().addScaledVector(sd, T.st * s * 0.5)], topTube * 0.85, frameColour, 24, 8);
  } else {
    rodTo(parts, "paint", seatTop.clone().addScaledVector(sd, -0.02), headTop.clone().addScaledVector(ax, T.bar === "flat" ? 0.05 : 0.025), topTube, frameColour, 12);
    rodTo(parts, "paint", bb, headBot.clone().addScaledVector(up, 0.03), downTube, frameColour, 12);
    rodTo(parts, "paint", bb.clone().lerp(headBot, 0.32), bb.clone().lerp(headBot, 0.62), downTube + 0.0015, accentColour, 12); // down-tube decal band
  }
  rodTo(parts, "paint", bb.clone().addScaledVector(sd, -0.01), seatTop.clone().addScaledVector(sd, 0.025), seatTube, frameColour, 12);
  rodTo(parts, "paint", seatTop.clone().addScaledVector(sd, -0.01), seatTop.clone().addScaledVector(sd, 0.025), seatTube + 0.003, accentColour, 12); // seat clamp collar
  for (const side of [-1, 1]) {
    rodTo(parts, "paint", bb.clone().add(vec(-0.02, 0, side * 0.03)), rear.clone().add(vec(0.01, 0.005, side * 0.066)), chainStay, frameColour, 8);
    rodTo(parts, "paint", seatTop.clone().addScaledVector(sd, -0.035).add(vec(0, 0, side * 0.018)), rear.clone().add(vec(0.012, 0.012, side * 0.066)), seatStay, frameColour, 8);
    parts.paint.push(box(0.035, 0.03, 0.006, frameColour, rear.x + 0.005, rear.y, side * 0.067));
  }
  parts.paint.push(cylinder(0.024, 0.024, 0.075, 14, dark).rotateX(Math.PI / 2).translate(bb.x, bb.y, 0)); // BB shell

  // ---- seatpost and saddle
  const postTop = saddle.clone().addScaledVector(sd, -0.04);
  rodTo(parts, "metal", seatTop.clone().addScaledVector(sd, -0.05), postTop, T.susp ? 0.02 : 0.0175, T.susp ? dark : black, 10);
  if (T.susp) rodTo(parts, "metal", postTop.clone().addScaledVector(sd, -0.1), postTop, 0.0145, "#c9a44a", 10);
  for (const geometry of saddleGeometries(T.saddle, saddleColor)) parts.rubber.push(geometry.translate(saddle.x + (T.saddle === "race" ? -0.005 : -0.03), saddle.y, 0));

  // ---- bottles, bags, rack, fenders, guard, stand
  const bottleAt = (a, b, along, offset) => {
    const point = a.clone().lerp(b, along);
    const direction = b.clone().sub(a).normalize();
    const shift = vec(-direction.y, direction.x).multiplyScalar(offset);
    const from = point.clone().add(shift).addScaledVector(direction, -0.1);
    const to = point.clone().add(shift).addScaledVector(direction, 0.1);
    rodTo(parts, "rubber", from, to, 0.036, bottle, 14);
    rodTo(parts, "rubber", to, to.clone().addScaledVector(direction, 0.025), 0.016, dark, 8);
  };
  if (T.bottles > 0 && !T.step) bottleAt(bb, headBot, 0.4, downTube + 0.04);
  if (T.bottles > 1 && !T.step) bottleAt(bb, seatTop, 0.42, -(seatTube + 0.04));
  if (bags ?? T.bags) {
    const bagGreen = "#2f3a2f";
    rodTo(parts, "rubber", seatTop.clone().lerp(headTop, 0.62).add(vec(0, 0.035)), seatTop.clone().lerp(headTop, 0.92).add(vec(0, 0.035)), 0.035, bagGreen, 10);
    const bag = saddle.clone().add(vec(-0.13, -0.055));
    parts.rubber.push(painted(new THREE.ConeGeometry(0.048, 0.2, 10), bagGreen).rotateZ(Math.PI / 2 + 0.2).translate(bag.x - 0.03, bag.y, 0));
  }
  if (T.rack) {
    const top = rear.y + T.R + 0.06;
    for (const z of [-0.075, 0.075]) {
      rodTo(parts, "metal", rear.clone().add(vec(0, 0, z)), vec(rear.x + 0.02, top, z), 0.005, black, 6);
      rodTo(parts, "metal", vec(rear.x - 0.18, top, z), vec(rear.x + 0.2, top, z), 0.005, black, 6);
      rodTo(parts, "metal", vec(rear.x + 0.2, top, z), seatTop.clone().addScaledVector(sd, -0.04).add(vec(0, 0, z * 0.4)), 0.004, black, 6);
    }
    for (let x = -0.16; x <= 0.18; x += 0.085) rodTo(parts, "metal", vec(rear.x + x, top, -0.075), vec(rear.x + x, top, 0.075), 0.004, black, 6);
    parts.paint.push(box(0.03, 0.02, 0.06, colour("#d93a2f"), rear.x - 0.19, top - 0.03, 0));
  }
  if (T.fenders) parts.paint.push(painted(new THREE.TorusGeometry(T.R + 0.028, 0.012, 5, 36, Math.PI * 0.95), frameColour).scale(1, 1, 2.4).rotateZ(Math.PI * 0.12).translate(rear.x, rear.y, 0));
  if (T.guard) parts.paint.push(box(-rear.x + 0.12, 0.05, 0.012, frameColour, (rear.x + 0.06) / 2, bb.y + 0.06, 0.07));
  if (T.kickstand) rodTo(parts, "metal", bb.clone().add(vec(-0.08, -0.02, -0.06)), rear.clone().add(vec(0.12, -0.12, -0.07)), 0.007, black, 6);

  // ---- drivetrain: chain runs, derailleurs, calipers
  const ringRadius = T.rings[0] * CHAINRING_TOOTH;
  const cogRadius = 0.032;
  const chain = "#6b7075";
  rodTo(parts, "metal", vec(bb.x, bb.y + ringRadius, 0.046), vec(rear.x, rear.y + cogRadius, 0.046), 0.005, chain, 4);
  rodTo(parts, "metal", vec(bb.x, bb.y - ringRadius, 0.046), vec(rear.x + 0.02, rear.y - 0.075, 0.046), 0.005, chain, 4);
  parts.metal.push(box(0.03, 0.05, 0.015, dark, rear.x + 0.01, rear.y - 0.045, 0.062), box(0.022, 0.07, 0.008, colour("#4a4d50"), rear.x + 0.02, rear.y - 0.09, 0.058));
  if (T.rings.length > 1) parts.metal.push(box(0.05, 0.02, 0.02, dark, bb.x + 0.07 * sd.x - 0.02, bb.y + 0.11, 0.035));
  if (T.disc) parts.metal.push(box(0.05, 0.03, 0.02, dark, rear.x + 0.06, rear.y + 0.05, -0.06));
  else for (const z of [-0.04, 0.04]) parts.metal.push(box(0.012, 0.05, 0.01, dark, rear.x + 0.07, rear.y + T.R - 0.03, z));
  if (T.guard) parts.paint.push(box(0.02, 0.02, 0.02, frameColour, bb.x, bb.y, 0));

  // lamps: a tail light on the seatpost or rack, a head lamp under the bar or on the fork crown
  const tailPosition = T.rack ? vec(rear.x - 0.19, rear.y + T.R + 0.03) : saddle.clone().addScaledVector(sd, -0.16).add(vec(-0.025, 0));
  parts.glow.push(box(0.02, 0.05, 0.03, colour("#d82a20"), tailPosition.x, tailPosition.y, tailPosition.z));
  flush(parts, root, kit);

  // ---- rear wheel
  const rearWheel = buildWheel(fit, { rear: true, rimColour: rimColor, wall }, kit);
  rearWheel.position.copy(rear);
  root.add(rearWheel);

  // ---- steering assembly (fork, front wheel, stem, bars, accessories) pivots on the steering axis
  const steer = new THREE.Group();
  steer.position.copy(headTop);
  root.add(steer);
  const steerParts = bucket();
  const crown = headBot.clone().addScaledVector(ax, 0.02);
  if (T.susp) {
    const gold = "#c9a44a";
    for (const z of [-0.058, 0.058]) {
      const top = crown.clone().add(vec(0, 0, z));
      const mid = crown.clone().addScaledVector(ax, 0.17).add(vec(0, 0, z));
      rodTo(steerParts, "metal", top, mid, 0.017, gold, 10);
      rodTo(steerParts, "paint", mid.clone().addScaledVector(ax, -0.02), front.clone().add(vec(0, 0, z)), 0.022, black, 10);
    }
    const arch = crown.clone().addScaledVector(ax, 0.2);
    tubeTo(steerParts, "paint", [arch.clone().add(vec(0, 0, -0.058)), arch.clone().add(vec(0.03, 0.03, 0)), arch.clone().add(vec(0, 0, 0.058))], 0.012, black, 10, 6);
    steerParts.paint.push(box(0.05, 0.035, 0.14, black, crown.x, crown.y + 0.01, 0));
  } else {
    const forkColour = T.step || type === "road" ? frameColour : accentColour;
    for (const side of [-1, 1]) {
      const top = crown.clone().add(vec(0, 0, side * 0.04));
      const bottom = front.clone().add(vec(0, 0, side * 0.055));
      tubeTo(steerParts, "paint", [top, top.clone().lerp(bottom, 0.6).addScaledVector(fwd, 0.012), bottom], 0.0175, forkColour, 16, 8);
    }
    steerParts.paint.push(box(0.05, 0.03, 0.1, frameColour, crown.x, crown.y + 0.012, 0));
  }
  rodTo(steerParts, "metal", headTop, fit.steererTop, 0.019, dark, 12); // spacers and steerer
  rodTo(steerParts, "metal", fit.steererTop.clone().addScaledVector(up, -0.005), fit.clamp, 0.021, black, 10); // stem
  steerParts.metal.push(cylinder(0.02, 0.02, 0.05, 12, black).rotateX(Math.PI / 2).translate(fit.clamp.x, fit.clamp.y, 0));
  if (T.disc) steerParts.metal.push(box(0.05, 0.03, 0.02, dark, front.x - 0.06, front.y + 0.06, -0.065));
  else for (const z of [-0.045, 0.045]) steerParts.metal.push(box(0.012, 0.05, 0.01, dark, front.x - 0.02, front.y + T.R - 0.02, z));
  const cp = fit.clamp;
  const tapeColour = colour(tape);
  const alloy = "#c9cdd2";
  if (T.bar === "drop" || T.bar === "flare") {
    const half = T.barW / 2;
    const flare = T.bar === "flare" ? 0.035 : 0;
    rodTo(steerParts, "metal", cp.clone().add(vec(0, 0, -0.1)), cp.clone().add(vec(0, 0, 0.1)), 0.016, black, 10);
    for (const sign of [-1, 1]) {
      const P = (x, y, z) => cp.clone().add(vec(x, y, sign * z));
      tubeTo(steerParts, "rubber", [P(0, 0, 0.09), P(0, 0, half - 0.025), P(0.045, 0.004, half - 0.004), P(0.085, -0.012, half), P(0.102, -0.06, half + flare * 0.4), P(0.075, -0.115, half + flare * 0.8), P(0.02, -0.122, half + flare), P(-0.035, -0.118, half + flare)], 0.0155, tapeColour, 40, 8);
      steerParts.rubber.push(painted(new THREE.BoxGeometry(0.08, 0.04, 0.034), black).rotateZ(0.5).translate(cp.x + 0.088, cp.y + 0.012, cp.z + sign * half));
      tubeTo(steerParts, "metal", [P(0.115, 0.02, half), P(0.128, -0.03, half), P(0.11, -0.09, half + flare * 0.5)], 0.005, dark, 10, 5); // brake lever
      tubeTo(steerParts, "rubber", [P(0.1, 0.02, half - 0.01), P(0.05, -0.06, half - 0.05), P(0, -0.1, 0.06), headTop.clone().add(vec(0.02, -0.05, sign * 0.03))], 0.0025, black, 14, 4); // cable housing
    }
  } else if (T.bar === "flat") {
    const half = T.barW / 2;
    tubeTo(steerParts, "metal", [cp.clone().add(vec(0, 0.015, -half)), cp.clone().add(vec(0, 0.004, -0.15)), cp.clone(), cp.clone().add(vec(0, 0.004, 0.15)), cp.clone().add(vec(0, 0.015, half))], 0.015, black, 20, 8);
    for (const sign of [-1, 1]) {
      rodTo(steerParts, "rubber", cp.clone().add(vec(0, 0.015, sign * (half - 0.13))), cp.clone().add(vec(0, 0.015, sign * half)), 0.02, tapeColour, 10);
      tubeTo(steerParts, "metal", [cp.clone().add(vec(0, 0.02, sign * (half - 0.15))), cp.clone().add(vec(0.06, 0.02, sign * (half - 0.1))), cp.clone().add(vec(0.08, 0.01, sign * (half - 0.04)))], 0.004, dark, 8, 4);
      steerParts.metal.push(box(0.03, 0.02, 0.03, dark, cp.x, cp.y + 0.005, cp.z + sign * (half - 0.17)));
    }
  } else if (T.bar === "swept") {
    const half = T.barW / 2;
    for (const sign of [-1, 1]) {
      const P = (x, y, z) => cp.clone().add(vec(x, y, sign * z));
      tubeTo(steerParts, "metal", [P(0, 0, 0), P(0.03, 0.02, 0.1), P(-0.02, 0.05, half * 0.75), P(-0.13, 0.05, half - 0.02), P(-0.2, 0.05, half)], 0.015, alloy, 24, 8);
      rodTo(steerParts, "rubber", P(-0.1, 0.05, half - 0.03), P(-0.22, 0.05, half - 0.01), 0.017, tapeColour, 10);
      tubeTo(steerParts, "metal", [P(-0.06, 0.06, half - 0.04), P(-0.02, 0.04, half - 0.01), P(0, 0.03, half - 0.12)], 0.004, dark, 8, 4);
    }
    steerParts.metal.push(cylinder(0.018, 0.018, 0.012, 12, colour(alloy)).translate(cp.x - 0.04, cp.y + 0.065, cp.z - 0.17));
  } else if (T.bar === "aero") {
    for (const sign of [-1, 1]) {
      const P = (x, y, z) => cp.clone().add(vec(x, y, sign * z));
      steerParts.metal.push(painted(new THREE.BoxGeometry(0.05, 0.014, 0.2), black).translate(cp.x, cp.y - 0.004, cp.z + sign * 0.1));
      tubeTo(steerParts, "rubber", [P(0, -0.004, 0.19), P(0.04, -0.008, 0.205), P(0.11, -0.01, 0.2)], 0.011, tapeColour, 10, 6);
      tubeTo(steerParts, "metal", [P(0.02, 0.07, 0.055), P(0.25, 0.07, 0.055), P(0.33, 0.085, 0.055), P(0.36, 0.11, 0.055)], 0.011, black, 16, 8);
      rodTo(steerParts, "metal", P(0.03, 0, 0.07), P(0.03, 0.065, 0.07), 0.01, black, 6);
      steerParts.rubber.push(box(0.12, 0.02, 0.075, dark, cp.x + 0.03, cp.y + 0.078, cp.z + sign * 0.1));
    }
  }
  if (basket ?? T.basket) {
    const bp = cp.clone().add(vec(0.17, -0.03));
    const wicker = "#b08a55";
    for (let i = 0; i <= 5; i += 1) {
      const y = bp.y - 0.2 + i * 0.04;
      for (const [a, b] of [[vec(bp.x - 0.12, y, -0.17), vec(bp.x + 0.12, y, -0.17)], [vec(bp.x - 0.12, y, 0.17), vec(bp.x + 0.12, y, 0.17)], [vec(bp.x + 0.12, y, -0.17), vec(bp.x + 0.12, y, 0.17)], [vec(bp.x - 0.12, y, -0.17), vec(bp.x - 0.12, y, 0.17)]]) rodTo(steerParts, "rubber", a, b, 0.006, wicker, 4);
    }
    for (let k = -3; k <= 3; k += 1) for (const x of [-0.12, 0.12]) rodTo(steerParts, "rubber", vec(bp.x + x, bp.y - 0.2, k * 0.055), vec(bp.x + x, bp.y, k * 0.055), 0.004, "#9a7848", 4);
    steerParts.rubber.push(box(0.24, 0.012, 0.34, colour("#9a7848"), bp.x, bp.y - 0.2, 0));
    rodTo(steerParts, "metal", bp.clone().add(vec(-0.12, -0.2)), front.clone().add(vec(0.02, 0.05)), 0.004, black, 4);
  }
  if (T.lights) steerParts.metal.push(cylinder(0.022, 0.026, 0.05, 12, black).rotateZ(Math.PI / 2).translate(crown.x + 0.05, crown.y + 0.01, 0));
  if (T.fenders) steerParts.paint.push(painted(new THREE.TorusGeometry(T.R + 0.028, 0.012, 5, 30, Math.PI * 0.7), frameColour).scale(1, 1, 2.4).rotateZ(Math.PI * 0.15).translate(front.x, front.y, 0));
  // head lamp: on the fork crown (city) or under the bar, with a glowing lens
  const lamp = T.lights ? vec(crown.x + 0.076, crown.y + 0.01) : cp.clone().add(vec(0.03, -0.035, 0));
  const lampZ = T.lights ? 0 : -0.06;
  if (!T.lights) steerParts.metal.push(painted(new THREE.CylinderGeometry(0.019, 0.022, 0.05, 12).rotateZ(Math.PI / 2), "#2a2c2e").translate(lamp.x - 0.03, lamp.y, lampZ));
  steerParts.glow.push(painted(new THREE.CircleGeometry(0.018, 12).rotateY(Math.PI / 2), "#fff3c4").translate(lamp.x - 0.004, lamp.y, lampZ));
  flush(steerParts, steer, kit, headTop);
  const frontWheel = buildWheel(fit, { rear: false, rimColour: rimColor, wall }, kit);
  frontWheel.position.copy(front).sub(headTop);
  steer.add(frontWheel);

  // ---- crankset (turns about the BB) and pedals (kept level, ankled by the rider)
  const crank = new THREE.Group();
  crank.position.copy(bb);
  root.add(crank);
  const crankParts = bucket();
  const length = fit.crankLen;
  T.rings.forEach((teeth, i) => crankParts.metal.push(chainring(teeth, 0.046 - i * 0.007, i ? "#4a4d50" : "#2a2c2e")));
  crankParts.metal.push(painted(new THREE.TorusGeometry(ringRadius + 0.002, 0.003, 4, 40), chain).translate(0, 0, 0.046));
  for (let k = 0; k < 4; k += 1) {
    const angle = (k / 4) * Math.PI * 2 + 0.4;
    crankParts.metal.push(rodBetween(vec(0, 0, 0.05), vec(Math.cos(angle) * ringRadius * 0.85, Math.sin(angle) * ringRadius * 0.85, 0.05), 0.006, dark, 4));
  }
  crankParts.metal.push(box(length, 0.03, 0.018, dark, length / 2, 0, 0.08), box(length, 0.03, 0.018, dark, -length / 2, 0, -0.08), cylinder(0.012, 0.012, 0.16, 8, colour("#8d949b")).rotateX(Math.PI / 2));
  flush(crankParts, crank, kit);
  const pedals = [-1, 1].map((side) => {
    const pedal = new THREE.Group();
    root.add(pedal);
    const pedalParts = bucket();
    if (T.pedal === "clip") pedalParts.metal.push(box(0.085, 0.016, 0.07, dark), box(0.06, 0.005, 0.05, colour(alloy), 0, 0.009, 0));
    else {
      pedalParts.metal.push(box(0.1, 0.014, 0.1, dark));
      for (const x of [-0.04, 0.04]) for (const z of [-0.04, 0.04]) pedalParts.metal.push(cylinder(0.003, 0.003, 0.02, 4, colour("#b9bec4"), x, 0.005, z));
    }
    pedalParts.metal.push(cylinder(0.005, 0.005, 0.03, 6, colour("#8d949b")).rotateX(Math.PI / 2).translate(0, 0, -side * 0.035));
    flush(pedalParts, pedal, kit);
    return pedal;
  });

  const steerAxis = up.clone().normalize();
  const bike = {
    object: root, fit, rearWheel, frontWheel, steer, crank, pedals,
    setWheels(distance) {
      rearWheel.rotation.z = -distance / T.R;
      frontWheel.rotation.z = -distance / T.R;
    },
    setSteer(angle) {
      steer.quaternion.setFromAxisAngle(steerAxis, angle);
    },
    pedalPos(side, angle, out = vec()) {
      const a = side > 0 ? angle : angle + Math.PI;
      return out.set(bb.x + Math.cos(a) * length, bb.y + Math.sin(a) * length, side * fit.q);
    },
    setCrank(angle, pitchL = 0, pitchR = 0) {
      crank.rotation.z = angle;
      bike.pedalPos(-1, angle, pedals[0].position);
      bike.pedalPos(1, angle, pedals[1].position);
      pedals[0].rotation.z = pitchL;
      pedals[1].rotation.z = pitchR;
    },
  };
  bike.setCrank(0.6);
  return bike;
}
