/**
 * The winter workout figure: a penguin dressed on the rigged rider's skeleton. The rider's skin, helmet and glasses are
 * hidden; penguin parts (black back, white front, orange beak and feet, a scarf in the rider's tint) ride the same bones,
 * so our exercise clips play on it unchanged and `settleOnRig` keeps it on the ground through its own contact points.
 * Shapes follow `biomes/winter/people.js`'s penguin, built here in the rig's frame (forward +x, up +y, right +z).
 */
import * as THREE from "../../../three.js";
import { mergeGeometries } from "../../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { addHook, cloudShadows, createSharedUniforms, heightFog } from "../materials.js";

/** A penguin is smaller than the rider it is dressed on. */
export const PENGUIN_SCALE = 0.78;

const COAT = new THREE.Color(0.1, 0.12, 0.16);
const COAT_LIGHT = new THREE.Color(0.18, 0.21, 0.27);
const BELLY = new THREE.Color(0.96, 0.97, 1.0);
const BEAK = new THREE.Color(0.96, 0.56, 0.12);
const EYE = new THREE.Color(0.03, 0.03, 0.04);

const UP = new THREE.Vector3(0, 1, 0);
const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A non-indexed, uv-less geometry with a flat vertex colour. */
function painted(geometry, colour) {
  const out = geometry.index ? geometry.toNonIndexed() : geometry;
  out.deleteAttribute("uv");
  const count = out.attributes.position.count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colours.set([colour.r, colour.g, colour.b], i * 3);
  out.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return out;
}

const ellipsoid = (centre, radii, colour) =>
  painted(new THREE.SphereGeometry(1, 10, 8), colour).applyMatrix4(new THREE.Matrix4().compose(centre, new THREE.Quaternion(), vec(...radii)));

/** A tapering tube from `a` (radius `ra`) to `b` (radius `rb`). */
function tube(a, b, ra, rb, colour) {
  const direction = b.clone().sub(a);
  const geometry = painted(new THREE.CylinderGeometry(rb, ra, direction.length(), 8, 1), colour);
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize());
  return geometry.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), rotation, vec(1, 1, 1)));
}

const box = (centre, size, colour) => painted(new THREE.BoxGeometry(...size), colour).translate(centre.x, centre.y, centre.z);

/**
 * Dresses `rig` as a penguin, in place. Call it on a freshly built rig; the rider stays hidden for good.
 * @param {import("./rider.js").RiderRig} rig
 * @param {{own?: <T>(resource: T) => T, uniforms?: ReturnType<typeof createSharedUniforms>, scarf?: string}} [options]
 *   `scarf` is the tint, any CSS colour
 */
export function dressAsPenguin(rig, { own = (resource) => resource, uniforms = createSharedUniforms(), scarf = "#e8473f" } = {}) {
  const h = rig.height;
  const bones = {};
  rig.object.traverse((node) => {
    if (node.isBone) bones[node.name] = node;
  });
  rig.object.traverse((node) => {
    if (node.isMesh) node.visible = false; // the skin, helmet, straps and glasses
  });

  // the bind pose is the pose with no joints turned
  rig.poseJoints({ root: { y: 0, z: 0, pitch: 0 }, joints: {} });
  rig.object.updateMatrixWorld(true);
  const objectInverse = rig.object.matrixWorld.clone().invert();
  const joint = (bone) => rig.boneWorld(bone);
  const at = (x, y, z) => vec(x * h, y * h, z * h);

  /** @type {Record<string, {geometries: THREE.BufferGeometry[], tint: boolean}>} */
  const parts = {};
  const add = (bone, geometry, tint = false) => {
    const key = `${bone}${tint ? "/scarf" : ""}`;
    (parts[key] ??= { bone, geometries: [], tint }).geometries.push(geometry);
  };

  // body: a big egg over hips and chest, the white front standing proud of the black back
  add("hips", ellipsoid(at(-0.004, 0.55, 0), [0.13 * h, 0.14 * h, 0.15 * h], COAT));
  add("hips", ellipsoid(at(-0.13, 0.47, 0), [0.09 * h, 0.03 * h, 0.07 * h], COAT_LIGHT)); // the tail
  add("chest", ellipsoid(at(-0.004, 0.7, 0), [0.14 * h, 0.19 * h, 0.16 * h], COAT));
  add("chest", ellipsoid(at(0.065, 0.66, 0), [0.09 * h, 0.17 * h, 0.115 * h], BELLY));

  // head with a white face patch, orange cheeks, eyes and beak
  add("head", ellipsoid(at(0.008, 0.935, 0), [0.075 * h, 0.08 * h, 0.075 * h], COAT));
  add("head", ellipsoid(at(0.05, 0.925, 0), [0.04 * h, 0.06 * h, 0.06 * h], BELLY));
  for (const side of [-1, 1]) {
    add("head", ellipsoid(at(0.025, 0.92, side * 0.062), [0.03 * h, 0.04 * h, 0.022 * h], BEAK));
    add("head", ellipsoid(at(0.085, 0.95, side * 0.03), [0.011 * h, 0.011 * h, 0.011 * h], EYE));
  }
  add("head", tube(at(0.07, 0.918, 0), at(0.145, 0.9, 0), 0.03 * h, 0.008 * h, BEAK));

  // a knitted scarf around the neck and its loose end on the white chest, tinted per penguin
  add("neck", ellipsoid(at(0, 0.84, 0), [0.115 * h, 0.03 * h, 0.14 * h], COAT), true);
  add("neck", box(at(0.125, 0.77, 0.05), [0.02 * h, 0.1 * h, 0.045 * h], COAT), true);

  for (const side of ["L", "R"]) {
    // flippers and shoulder
    const shoulder = joint(`upperArm_${side}`);
    const elbow = joint(`forearm_${side}`);
    const wrist = joint(`hand_${side}`);
    const tip = wrist.clone().add(at(0.012, -0.093, 0));
    add(`upperArm_${side}`, ellipsoid(shoulder, [0.04 * h, 0.04 * h, 0.04 * h], COAT_LIGHT));
    add(`upperArm_${side}`, tube(shoulder, elbow, 0.032 * h, 0.04 * h, COAT_LIGHT));
    add(`forearm_${side}`, tube(elbow, tip, 0.04 * h, 0.012 * h, COAT_LIGHT));
    // legs, an orange ankle and the webbed foot
    const hip = joint(`thigh_${side}`);
    const knee = joint(`shin_${side}`);
    const ankle = joint(`foot_${side}`);
    add(`thigh_${side}`, tube(hip, knee, 0.05 * h, 0.038 * h, COAT));
    add(`shin_${side}`, tube(knee, ankle, 0.036 * h, 0.03 * h, COAT));
    add(`shin_${side}`, ellipsoid(ankle, [0.03 * h, 0.022 * h, 0.03 * h], BEAK));
    add(`foot_${side}`, box(ankle.clone().add(at(0.05, -0.031, 0)), [0.14 * h, 0.026 * h, 0.075 * h], BEAK));
  }

  const lit = (material) => addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms));
  const bodyMaterial = own(lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })));
  const scarfMaterial = own(lit(new THREE.MeshStandardMaterial({ color: new THREE.Color(scarf), roughness: 0.9 })));

  rig.contactPoints.length = 0;
  const local = vec();
  for (const { bone, geometries, tint } of Object.values(parts)) {
    const inverse = bones[bone].matrixWorld.clone().premultiply(objectInverse).invert();
    const geometry = own(mergeGeometries(geometries).applyMatrix4(inverse));
    for (const each of geometries) each.dispose();
    const mesh = new THREE.Mesh(geometry, tint ? scarfMaterial : bodyMaterial);
    Object.assign(mesh, { castShadow: true, receiveShadow: true, frustumCulled: false });
    mesh.userData.penguin = true;
    bones[bone].add(mesh);

    if (tint) continue;
    // the skin extremes along the bone's three axes stand in for the contact with the ground
    const position = geometry.attributes.position;
    const extremes = [];
    for (let i = 0; i < position.count; i += 1) {
      local.fromBufferAttribute(position, i);
      const values = [local.x, local.y, local.z];
      for (let axis = 0; axis < 3; axis += 1) {
        if (!extremes[axis * 2] || values[axis] < extremes[axis * 2].value) extremes[axis * 2] = { value: values[axis], at: local.clone() };
        if (!extremes[axis * 2 + 1] || values[axis] > extremes[axis * 2 + 1].value) extremes[axis * 2 + 1] = { value: values[axis], at: local.clone() };
      }
    }
    for (const entry of extremes) rig.contactPoints.push({ bone, local: entry.at });
  }

  rig.object.scale.setScalar(PENGUIN_SCALE);
}
