/**
 * Single crop plants for the edges of a field, close up: wheat ears, rapeseed
 * with yellow tops, sunflowers with heads, corn with leaves, short stubble and
 * lavender bushes. Each crop has a near version (a clump or plant with its
 * parts) and a cheap far one (a tapered tuft in the crop's colour). The world
 * instances them along the planned edge band; the painted field stays
 * underneath. Plants stand 1 : 1 in crop height (see `CROPS`), ground at y = 0.
 */
import * as THREE from "../../../three.js";
import { addHook, noFlip, windify } from "../materials.js";
import { bodyMaterial } from "./foliage.js";
import { lavender } from "./lavender.js";
import { colour, cone, deepFreeze, ico, merge, rod, shadeY } from "./geom.js";

/** Sway (metres per metre of height) of each crop's plants. */
export const STALK_WIND = deepFreeze({ wheat: 0.06, rapeseed: 0.045, sunflower: 0.02, corn: 0.03, stubble: 0.02, lavender: 0.03 });

/** A leaf: two quads and a tip, bending from `from` through `mid` to `to`. */
function blade(from, mid, to, width, angle, color) {
  const [dx, dz] = [Math.cos(angle) * width, Math.sin(angle) * width];
  const [ax, ay, az] = from;
  const [mx, my, mz] = mid;
  const quad = [[ax - dx, ay, az - dz], [ax + dx, ay, az + dz], [mx - dx * 0.8, my, mz - dz * 0.8], [mx + dx * 0.8, my, mz + dz * 0.8]];
  const [a, b, c, d] = quad;
  const list = [...a, ...b, ...c, ...b, ...d, ...c, ...c, ...d, ...to];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(list, 3));
  geometry.computeVertexNormals();
  const array = new Float32Array(9 * 3);
  for (let i = 0; i < 9; i += 1) array.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(array, 3));
  return geometry;
}

const rodAt = (x, top, z, lean, radius, color) => rod([x, 0, z], [x + Math.cos(lean.a) * lean.d, top, z + Math.sin(lean.a) * lean.d], radius, color, 3, true);

/** A deterministic 0..1 sequence so the geometry is the same every build. */
const sequence = (seed) => {
  let n = seed;
  return () => {
    n = (n * 16807) % 2147483647;
    return n / 2147483647;
  };
};

function wheat() {
  const random = sequence(11);
  const [stem, ear, leaf] = [colour("#e0c878"), colour("#f2d476"), colour("#aab255")];
  const near = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + random();
    const [x, z] = [Math.cos(a) * 0.08, Math.sin(a) * 0.08];
    const top = 0.78 + random() * 0.17;
    const lean = { a, d: 0.05 + random() * 0.08 };
    near.push(rodAt(x, top, z, lean, 0.011, stem), cone(0.045, 0.22, 4, ear, x + Math.cos(a) * lean.d, top + 0.06, z + Math.sin(a) * lean.d));
  }
  near.push(blade([0, 0.1, 0], [0.12, 0.45, 0.02], [0.3, 0.5, 0.05], 0.025, 1.2, leaf), blade([0, 0.1, 0], [-0.1, 0.4, -0.06], [-0.26, 0.42, -0.1], 0.025, 0.3, leaf));
  const far = shadeY(cone(0.26, 0.98, 5, colour("#dcb860"), 0, 0.49, 0), 0.7, 1.08, 0, 0.98);
  return { near: shadeY(merge(near), 0.88, 1.1, 0, 1), far };
}

function rapeseed() {
  const random = sequence(23);
  const [stem, flower, leaf] = [colour("#86a23f"), colour("#f1d42c"), colour("#7d9a3c")];
  const near = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + random();
    const [x, z] = [Math.cos(a) * 0.1, Math.sin(a) * 0.1];
    const top = 0.95 + random() * 0.2;
    near.push(rodAt(x, top, z, { a, d: 0.06 }, 0.014, stem), ico(0.15, 0, flower, x + Math.cos(a) * 0.06, top + 0.03, z + Math.sin(a) * 0.06).scale(1, 0.7, 1));
  }
  near.push(blade([0, 0.15, 0], [0.15, 0.4, 0], [0.34, 0.4, 0.02], 0.045, 0.8, leaf), blade([0, 0.15, 0], [-0.1, 0.35, 0.1], [-0.3, 0.33, 0.14], 0.045, 2.2, leaf));
  const far = merge([cone(0.28, 0.8, 5, colour("#7d9a3c"), 0, 0.4, 0), ico(0.34, 0, flower, 0, 1.0, 0).scale(1, 0.55, 1)]);
  return { near: shadeY(merge(near), 0.75, 1.05, 0, 1.2), far };
}

function sunflower() {
  const [stem, leaf, head, petal] = [colour("#5d8a32"), colour("#4f7a2e"), colour("#4a2f18"), colour("#f2b61f")];
  const tilt = (g, y) => g.rotateX(Math.PI / 2 - 0.35).translate(0, y, 0.08);
  const near = [
    rod([0, 0, 0], [0, 1.72, 0.04], 0.026, stem, 4, true),
    tilt(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 8), 1.78),
    tilt(new THREE.CylinderGeometry(0.31, 0.31, 0.03, 8), 1.775),
    blade([0, 0.8, 0], [0.2, 0.95, 0], [0.42, 0.85, 0.02], 0.1, 1.5, leaf),
    blade([0, 1.2, 0], [-0.18, 1.3, 0.05], [-0.4, 1.2, 0.1], 0.1, 0.4, leaf),
  ];
  // the two discs are plain cylinders: paint them (centre dark, ring yellow)
  const paintDisc = (g, color) => {
    g.deleteAttribute("uv");
    const flat = g.toNonIndexed();
    g.dispose();
    const array = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < array.length; i += 3) array.set([color.r, color.g, color.b], i);
    flat.setAttribute("color", new THREE.BufferAttribute(array, 3));
    return flat;
  };
  near[1] = paintDisc(near[1], head);
  near[2] = paintDisc(near[2], petal);
  const far = merge([rod([0, 0, 0], [0, 1.7, 0], 0.03, stem, 3, true), ico(0.26, 0, petal, 0, 1.78, 0.05)]);
  return { near: merge(near), far };
}

function corn() {
  const random = sequence(5);
  const [stem, leafA, leafB, tassel] = [colour("#6c9a38"), colour("#5d8a2c"), colour("#6d9c37"), colour("#d9c47a")];
  const near = [rod([0, 0, 0], [0, 1.95, 0], 0.03, stem, 4, true), cone(0.05, 0.32, 4, tassel, 0, 2.05, 0)];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + random() * 0.5;
    const y = 0.35 + i * 0.22;
    const reach = 0.7 - i * 0.04;
    near.push(blade([0, y, 0], [Math.cos(a) * reach * 0.5, y + 0.25, Math.sin(a) * reach * 0.5], [Math.cos(a) * reach, y + 0.12, Math.sin(a) * reach], 0.065, a + Math.PI / 2, i % 2 ? leafA : leafB));
  }
  const far = shadeY(cone(0.42, 2.0, 5, colour("#6a9634"), 0, 1.0, 0), 0.7, 1.05, 0, 2);
  return { near: shadeY(merge(near), 0.8, 1.05, 0, 2.1), far };
}

function stubble() {
  const random = sequence(31);
  const color = colour("#d8c488");
  const near = [];
  for (let i = 0; i < 6; i += 1) {
    const a = random() * Math.PI * 2;
    const d = 0.04 + random() * 0.09;
    near.push(rodAt(Math.cos(a) * d, 0.14 + random() * 0.16, Math.sin(a) * d, { a, d: 0.04 }, 0.008, color));
  }
  return { near: merge(near), far: cone(0.12, 0.18, 3, color, 0, 0.09, 0) };
}

/** Lavender bushes come from the lavender plant itself. */
function bush({ own, uniforms }) {
  const { near, far } = lavender.parts({ season: "summer", uniforms, own });
  return { near: near[0].geometry, far: far[0].geometry };
}

const MAKERS = Object.freeze({ wheat, rapeseed, sunflower, corn, stubble, lavender: bush });

/**
 * The near and far geometry of one crop's plant, or null where the crop has none (ploughed earth, pumpkins).
 * @param {string} crop a `CROPS` id
 * @param {{uniforms: ReturnType<typeof import("../materials.js").createSharedUniforms>, own: <T>(resource: T) => T}} options
 * @returns {{near: import("../../../three.js").BufferGeometry, far: import("../../../three.js").BufferGeometry, wind: number} | null}
 */
export function stalkGeometry(crop, { uniforms, own }) {
  const make = MAKERS[crop];
  if (!make) return null;
  const { near, far } = make({ uniforms, own });
  own(near);
  own(far);
  return { near, far, wind: STALK_WIND[crop] };
}

/** Collapses an instance to a point when its distance to the camera is outside `uRange`. */
const COLLAPSE = `{
  #ifdef USE_INSTANCING
    vec3 sIp = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  #else
    vec3 sIp = modelMatrix[3].xyz;
  #endif
  float sD = distance(sIp.xz, cameraPosition.xz);
  if (sD < uRange.x || sD >= uRange.y) transformed = vec3(0.0);
}
#include <project_vertex>`; // i18n-ok

/**
 * A vertex-coloured, wind-swayed material that draws only the instances whose distance to the camera
 * (on the ground plane) is within `range`: collapses the others to a point. Change `material.userData.range.value`
 * to move the limits.
 * @param {ReturnType<typeof import("../materials.js").createSharedUniforms>} uniforms
 * @param {number} wind
 * @param {[number, number]} range metres from the camera: from (included) to (excluded)
 * @returns {import("../../../three.js").MeshStandardMaterial}
 */
export function stalkMaterial(uniforms, wind, range) {
  const material = bodyMaterial(uniforms, 0, 0.9);
  material.side = THREE.DoubleSide;
  const limit = { value: new THREE.Vector2(range[0], range[1]) };
  material.userData.range = limit;
  noFlip(windify(material, wind, uniforms));
  const hook = (shader) => {
    shader.uniforms.uRange = limit;
    shader.vertexShader = `uniform vec2 uRange;\n${shader.vertexShader.replace("#include <project_vertex>", COLLAPSE)}`; // i18n-ok
  };
  addHook(material, Object.assign(hook, { key: "stalkRange" }));
  return material;
}
