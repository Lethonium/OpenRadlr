/**
 * The outdoor gym (a calisthenics park) beside a café: a gravel pad edged with kerb stones, a rubber mat with tile
 * seams, a pull-up rig, dip bars, an inclined sit-up bench, a low beam with a step block and a roadside sign reading
 * OUTDOOR GYM. The front, towards the road, is -z; the mat is centred on the origin with its top at `GYM_TOP`. The
 * pad reaches `drop` metres down so it never floats on a slope, and the sign's posts start `signLift` metres over
 * the pad's origin (the ground at the roadside). No athletes: the athlete layer draws those. Colours are linear RGB.
 */
import * as THREE from "../../../three.js";
import { seededRandom } from "../../../world/noise.js";
import { GYM_MAT, GYM_PAD, GYM_SIGN, GYM_TOP } from "../../../world/venues.js";
import { createOwner } from "../owner.js";
import { addHook, cloudShadows, heightFog } from "../materials.js";
import { box, merge, rod } from "../geom.js";
import { textTexture, toSrgb } from "../textTexture.js";

/** The gym's colours: they read against grass and asphalt alike. */
export const GYM_COLORS = Object.freeze({
  pad: [0.68, 0.6, 0.48],
  padEdge: [0.56, 0.54, 0.5],
  mat: [0.6, 0.17, 0.14],
  seam: [0.42, 0.11, 0.09],
  frame: [0.96, 0.6, 0.1],
  bar: [0.8, 0.82, 0.85],
  cushion: [0.16, 0.26, 0.42],
  wood: [0.62, 0.43, 0.26],
  sign: [0.12, 0.46, 0.32],
  ink: [0.95, 0.95, 0.92],
});

/** The sign board: width, height, how high its centre stands over the posts' foot, and the texture's width in texels. */
const BOARD = Object.freeze({ width: 2.4, height: 1.2, centre: 2.2, texels: 512 });
/** Pebbles scattered over the pad, and their seed. */
const PEBBLES = Object.freeze({ count: 70, seed: 0x6b79 });

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);

export const meta = Object.freeze({
  id: "outdoor-gym",
  name: "Outdoor gym", // i18n-ok
  category: "props", // i18n-ok
  description: "The roadside calisthenics park: pad, mat, pull-up rig, dip bars, sit-up bench, beam and sign.", // i18n-ok
  options: Object.freeze({}),
});

/** The pad, mat, rig, bars, bench and beam as vertex-coloured geometry. */
function solidParts(drop, signLift) {
  const c = Object.fromEntries(Object.entries(GYM_COLORS).map(([name, value]) => [name, linear(value)]));
  const { w, d } = GYM_MAT;
  const parts = [];
  const pad = GYM_PAD;
  const padW = pad.x1 - pad.x0;
  const padD = pad.z1 - pad.z0;
  const padZ = (pad.z0 + pad.z1) / 2;
  parts.push(box(padW, drop + 0.02, padD, c.pad, 0, (0.02 - drop) / 2, padZ));
  for (const z of [pad.z0, pad.z1]) parts.push(box(padW + 0.2, 0.1, 0.2, c.padEdge, 0, 0.04, z));
  for (const x of [pad.x0, pad.x1]) parts.push(box(0.2, 0.1, padD, c.padEdge, x, 0.04, padZ));
  const random = seededRandom(PEBBLES.seed);
  for (let i = 0; i < PEBBLES.count; i += 1) {
    const size = 0.05 + random() * 0.07;
    const shade = 0.8 + random() * 0.3;
    const x = pad.x0 + 0.2 + random() * (padW - 0.4);
    const z = pad.z0 + 0.2 + random() * (padD - 0.4);
    // None under the mat.
    if (Math.abs(x) > w / 2 + 0.1 || Math.abs(z) > d / 2 + 0.1) parts.push(box(size, size * 0.5, size, c.pad.clone().multiplyScalar(shade), x, 0.03, z));
  }

  // The mat with its tile seams.
  parts.push(box(w, GYM_TOP, d, c.mat, 0, GYM_TOP / 2, 0));
  for (let x = -w / 2 + 1; x < w / 2; x += 1) parts.push(box(0.05, 0.006, d, c.seam, x, GYM_TOP + 0.003, 0));
  for (let z = -d / 2 + 1; z < d / 2; z += 1) parts.push(box(w, 0.006, 0.05, c.seam, 0, GYM_TOP + 0.003, z));

  const post = (x, z, height) => parts.push(box(0.14, height, 0.14, c.frame, x, height / 2, z));
  const barZ = (x, y, z0, z1) => parts.push(rod([x, y, z0], [x, y, z1], 0.035, c.bar, 10));

  // Pull-up rig beside the mat: three posts, a high and a lower bar, footings.
  const rigX = -6.6;
  for (const z of [-1.9, 0, 1.9]) {
    post(rigX, z, 2.75);
    parts.push(box(0.4, 0.12, 0.4, c.padEdge, rigX, 0.06, z), box(0.22, 0.1, 0.22, c.frame, rigX, 2.8, z));
  }
  barZ(rigX, 2.55, -1.9, 0);
  barZ(rigX, 2.1, 0, 1.9);
  parts.push(box(0.12, 0.12, 3.95, c.frame, rigX, 2.72, 0));

  // Parallel bars (dip station) on the other side.
  const dipX = 6.4;
  for (const x of [dipX - 0.3, dipX + 0.3]) {
    for (const z of [-1.3, 1.3]) post(x, z, 1.25);
    barZ(x, 1.28, -1.6, 1.6);
  }
  parts.push(box(0.6, 0.08, 0.08, c.frame, dipX, 0.35, -1.3), box(0.6, 0.08, 0.08, c.frame, dipX, 0.35, 1.3));

  // Behind the mat: an inclined sit-up bench with a foot roller…
  const benchZ = 4.8;
  const high = [-4.6, 0.78];
  const low = [-2.4, 0.38];
  const length = Math.hypot(low[0] - high[0], low[1] - high[1]);
  const slope = Math.atan2(low[1] - high[1], low[0] - high[0]);
  parts.push(box(length, 0.2, 0.5, c.cushion, 0, 0, 0).rotateZ(slope).translate((high[0] + low[0]) / 2, (high[1] + low[1]) / 2, benchZ));
  for (const [x, y] of [[high[0] + 0.15, high[1]], [low[0] - 0.15, low[1]]]) for (const z of [benchZ - 0.18, benchZ + 0.18]) post(x, z, y - 0.04);
  parts.push(box(0.16, 0.16, 0.6, c.cushion, high[0] - 0.05, high[1] + 0.12, benchZ), box(0.1, 0.1, 0.5, c.frame, high[0] + 0.15, 0.08, benchZ));

  // …and a low wooden beam on two feet, with a step block at its end.
  const beam = { x0: 0.6, x1: 4.2, y: 0.42 };
  parts.push(box(beam.x1 - beam.x0, 0.2, 0.22, c.wood, (beam.x0 + beam.x1) / 2, beam.y - 0.1, benchZ));
  for (const x of [beam.x0 + 0.4, beam.x1 - 0.4]) parts.push(box(0.14, beam.y - 0.2, 0.14, c.frame, x, (beam.y - 0.2) / 2, benchZ), box(0.14, 0.08, 0.7, c.frame, x, 0.04, benchZ));
  parts.push(box(0.8, 0.5, 0.8, c.wood, 5.4, 0.25, benchZ), box(0.84, 0.03, 0.84, c.seam, 5.4, 0.505, benchZ));

  // The sign's posts and the board's back, on the ground at the roadside.
  const { x: sx, z: sz } = GYM_SIGN;
  for (const x of [sx - BOARD.width / 2 + 0.1, sx + BOARD.width / 2 - 0.1]) parts.push(box(0.1, 2.9, 0.1, c.frame, x, signLift + 1.15, sz));
  parts.push(box(BOARD.width, BOARD.height, 0.06, c.frame, sx, signLift + BOARD.centre, sz + 0.03));
  return parts;
}

/**
 * @param {{drop?: number, signLift?: number, own?: Function, uniforms?: object}} [options] `own` registers resources
 * @returns {import("../../../three.js").Group} named `outdoor-gym`; the solid mesh and the sign's face
 */
export function createOutdoorGym({ drop = 0.4, signLift = 0, own = (resource) => resource, uniforms } = {}) {
  const hook = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const group = new THREE.Group();
  group.name = "outdoor-gym";
  const solid = new THREE.Mesh(own(merge(solidParts(drop, signLift))), hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }))));
  solid.castShadow = true;
  solid.receiveShadow = true;
  group.add(solid);

  const map = textTexture("OUTDOOR GYM", { background: toSrgb(GYM_COLORS.sign), ink: toSrgb(GYM_COLORS.ink), width: BOARD.texels, height: Math.round((BOARD.texels * BOARD.height) / BOARD.width) }, own);
  const face = new THREE.Mesh(own(new THREE.PlaneGeometry(BOARD.width - 0.16, BOARD.height - 0.16)), hook(own(new THREE.MeshStandardMaterial({ map, roughness: 0.6 }))));
  face.name = "sign-face";
  // The plane faces +z; the sign's face looks towards the road, -z.
  face.rotation.y = Math.PI;
  face.position.set(GYM_SIGN.x, signLift + BOARD.centre, GYM_SIGN.z - 0.005);
  group.add(face);
  return group;
}

/** Workbench entry: the gym with the usual look. */
export function create({ track, uniforms } = {}) {
  const owner = createOwner(track);
  const object = createOutdoorGym({ own: owner.own, uniforms });
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
