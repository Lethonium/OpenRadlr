/**
 * Cheap far riders: a cyclist baked into a frozen pose (one per quarter turn of the cranks) and drawn as instanced
 * meshes, two per pose. The jersey is its own mesh whose instance colour is the rider's tint; everything else (skin,
 * shorts, shoes, helmet, the whole bike) is one vertex-coloured mesh. Nothing turns at runtime: an entry takes the
 * pose whose crank angle is nearest. Faces +x like the cyclist; the layer places and turns each instance.
 */
import * as THREE from "../../../three.js";
import { mergeGeometries } from "../../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";
import { createOwner } from "../owner.js";
import { createCyclist } from "./cyclist.js";
import { paintKit } from "./kitPainter.js";
import { lookOf } from "./look.js";

const TAU = Math.PI * 2;
/** How many crank poses are baked, `k · π/2` each. */
export const CHEAP_BAKES = 4;
/** How many riders each pose can draw at once. */
const CAPACITY = 128;
/** The kit texture edge used to read colours back, pixels. */
const KIT_SIZE = 256;
/** The jersey is painted this colour on the neutral look to tell its texels from the rest. */
const JERSEY_MARK = "#ff00ff";
const NEUTRAL_ID = 1;
const NEUTRAL_SKIN = "tan";
/** The baking cyclist rides at this cadence (rpm) for the time it takes to reach the pose. */
const WIND_CADENCE = 60;

/**
 * @typedef {object} CheapEntry
 * @property {import("../../../three.js").Matrix4} matrix where the baked cyclist stands, in the world
 * @property {number} crank the rider's crank angle, radians; the nearest baked pose is drawn
 * @property {number[]} tint jersey colour, linear `[r, g, b]`
 * @property {number} [alpha] reserved for translucent riders; the batches are opaque
 */

/**
 * @typedef {object} CheapRiders
 * @property {import("../../../three.js").Group} object
 * @property {(entries: CheapEntry[]) => void} set draws exactly these entries (at most the capacity per pose)
 * @property {number} count how many entries are drawn now
 */

/** The jersey look: the neutral rider with a marker colour on the jersey and a plain pattern. */
const neutralLook = () => ({ ...lookOf(NEUTRAL_ID), skin: NEUTRAL_SKIN, kit: "road", pattern: "solid", primary: JERSEY_MARK });

/** Reads texels of a painted kit by uv. */
function kitSampler(look) {
  const bytes = paintKit(look, KIT_SIZE);
  return (u, v) => {
    const x = Math.min(KIT_SIZE - 1, Math.max(0, Math.floor(u * KIT_SIZE)));
    const y = Math.min(KIT_SIZE - 1, Math.max(0, Math.floor((1 - v) * KIT_SIZE)));
    const at = (y * KIT_SIZE + x) * 4;
    return [bytes[at], bytes[at + 1], bytes[at + 2]];
  };
}

const isMark = ([r, g, b]) => r > 240 && g < 16 && b > 240;

/**
 * The baked parts of one pose.
 * @param {ReturnType<typeof createCyclist>} cyclist posed, matrices current
 * @param {(u: number, v: number) => number[]} sample
 * @returns {{jersey: THREE.BufferGeometry | null, rest: THREE.BufferGeometry}}
 */
function bakePose(cyclist, sample) {
  const jersey = [];
  const rest = [];
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  cyclist.object.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const source = mesh.geometry;
    const count = source.attributes.position.count;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const marked = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, point);
      else point.fromBufferAttribute(source.attributes.position, i);
      point.applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
      if (mesh.isSkinnedMesh) {
        const [r, g, b] = sample(source.attributes.uv.getX(i), source.attributes.uv.getY(i));
        marked[i] = isMark([r, g, b]) ? 1 : 0;
        color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      } else {
        color.copy(mesh.material.color);
        if (source.attributes.color) color.multiply(new THREE.Color().fromBufferAttribute(source.attributes.color, i));
      }
      color.toArray(colours, i * 3);
    }
    const baked = new THREE.BufferGeometry();
    baked.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    baked.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    if (source.index) baked.setIndex(source.index.clone());
    if (mesh.isSkinnedMesh) baked.computeVertexNormals();
    else {
      for (let i = 0; i < count; i += 1) point.fromBufferAttribute(source.attributes.normal, i).applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
      baked.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }
    const flat = baked.index ? baked.toNonIndexed() : baked;
    if (!mesh.isSkinnedMesh) {
      rest.push(flat);
      return;
    }
    // split the skinned body per triangle: a triangle with two marked corners belongs to the jersey
    const order = source.index ? Array.from(source.index.array) : Array.from({ length: count }, (_, i) => i);
    const jerseyTriangles = [];
    const restTriangles = [];
    for (let t = 0; t < order.length; t += 3) {
      const corners = [order[t], order[t + 1], order[t + 2]];
      (corners.filter((index) => marked[index]).length >= 2 ? jerseyTriangles : restTriangles).push(t / 3);
    }
    const pick = (triangles) => {
      const part = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "color"]) {
        const from = flat.attributes[name];
        const array = new Float32Array(triangles.length * 9);
        triangles.forEach((triangle, slot) => array.set(from.array.subarray(triangle * 9, triangle * 9 + 9), slot * 9));
        part.setAttribute(name, new THREE.BufferAttribute(array, 3));
      }
      return part;
    };
    if (jerseyTriangles.length) jersey.push(pick(jerseyTriangles));
    if (restTriangles.length) rest.push(pick(restTriangles));
    baked.dispose();
    if (flat !== baked) flat.dispose();
  });
  const merged = (parts) => (parts.length ? mergeGeometries(parts) : null);
  const result = { jersey: merged(jersey), rest: merged(rest) };
  for (const part of [...jersey, ...rest]) part.dispose();
  return result;
}

/** One lit material on the scene's hooks. */
const lit = (material, own, uniforms) => own(addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)));

/**
 * Bakes the cheap riders: `CHEAP_BAKES` poses, each as a jersey and a rest instanced mesh.
 * @param {{own: <T>(resource: T) => T, uniforms?: ReturnType<typeof createSharedUniforms>}} options
 * @returns {CheapRiders}
 */
export function bakeCheapRiders({ own, uniforms = createSharedUniforms() }) {
  const look = neutralLook();
  const sample = kitSampler(look);
  const temporary = createOwner();
  const cyclist = createCyclist(look, { own: temporary.own, uniforms, seed: NEUTRAL_ID });
  const baked = [];
  for (let k = 0; k < CHEAP_BAKES; k += 1) {
    const target = (k * TAU) / CHEAP_BAKES;
    const behind = (((cyclist.crank - target) % TAU) + TAU) % TAU;
    cyclist.ride(behind / TAU / (WIND_CADENCE / 60), { cadence: WIND_CADENCE, speed: 0, grade: 0, t: 0, near: true, standing: false });
    cyclist.object.updateMatrixWorld(true);
    cyclist.object.traverse((child) => child.isSkinnedMesh && child.skeleton.update());
    baked.push(bakePose(cyclist, sample));
  }
  temporary.disposeAll();

  const jerseyMaterial = lit(new THREE.MeshStandardMaterial({ roughness: 0.62 }), own, uniforms);
  const restMaterial = lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), own, uniforms);
  const object = new THREE.Group();
  const batches = baked.map(({ jersey, rest }) => {
    const make = (geometry, material, name) => {
      const mesh = own(new THREE.InstancedMesh(own(geometry), material, CAPACITY));
      Object.assign(mesh, { name, castShadow: true, receiveShadow: true, frustumCulled: false, count: 0 });
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3).fill(1), 3);
      object.add(mesh);
      return mesh;
    };
    return { jersey: make(jersey, jerseyMaterial, "jersey"), rest: make(rest, restMaterial, "rest") };
  });

  const nearest = (crank) => {
    const turns = ((crank / TAU) % 1 + 1) % 1;
    return Math.round(turns * CHEAP_BAKES) % CHEAP_BAKES;
  };
  const colour = new THREE.Color();
  const cheap = {
    object,
    count: 0,
    set(entries) {
      for (const batch of batches) batch.jersey.count = batch.rest.count = 0;
      let drawn = 0;
      for (const { matrix, crank, tint } of entries) {
        const batch = batches[nearest(crank)];
        const slot = batch.rest.count;
        if (slot >= CAPACITY) continue;
        for (const mesh of [batch.jersey, batch.rest]) mesh.setMatrixAt(slot, matrix);
        batch.jersey.setColorAt(slot, colour.fromArray(tint));
        batch.jersey.count = batch.rest.count = slot + 1;
        drawn += 1;
      }
      for (const batch of batches) {
        for (const mesh of [batch.jersey, batch.rest]) mesh.instanceMatrix.needsUpdate = true;
        batch.jersey.instanceColor.needsUpdate = true;
      }
      cheap.count = drawn;
    },
  };
  return cheap;
}
