/**
 * The island's crop fields: one draped, shader-drawn rectangle per planned
 * field, and the pumpkins and round bales that lie on some of them.
 */
import * as THREE from "../../three.js";
import { seededRandom } from "../../world/noise.js";
import { baleGeometry, cropMaterial, fieldExtras, fieldGeometry, pumpkinGeometry } from "../assets/nature/crops.js";
import { bodyMaterial } from "../assets/nature/foliage.js";
import { colour } from "../assets/geom.js";
import { heightSampler } from "./grassField.js";
import { STALK_CROPS } from "../../world/plan/stalks.js";
import { createStalkLayer } from "./stalkLayer.js";
import { createOwner } from "./tracker.js";

/** Seed of the scatter on the fields. */
const SEED = 0x51f15e;
const PUMPKIN = colour("#f28a1e");

/** One instanced mesh of `things`, each placed by `place(thing, matrix, colour)`. */
function instances(things, geometry, material, own, place) {
  const mesh = own(new THREE.InstancedMesh(geometry, material, things.length));
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  things.forEach((thing, n) => {
    place(thing, matrix, tint);
    mesh.setMatrixAt(n, matrix);
    if (thing.color) mesh.setColorAt(n, tint);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * @param {{fields: import("../../world/plan/fields.js").Field[]}} plan
 * @param {{ground: {near: import("../../world/groundGrid.js").GroundGrid}, uniforms: object, track: import("./tracker.js").Tracker["track"], settings?: import("../quality.js").QualitySettings}} options
 *   `ground` gives the height the fields drape over; `settings` the crop plants along the edges (none without)
 */
export function createCropLayer(plan, { ground, uniforms, track, settings }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "crops";
  const heightAt = heightSampler(ground.near);
  const materials = new Map();
  const material = (crop) => {
    if (!materials.has(crop)) materials.set(crop, own(cropMaterial(crop, uniforms)));
    return materials.get(crop);
  };
  const random = seededRandom(SEED);
  const pumpkins = [];
  const bales = [];
  const fields = plan.fields.map((field) => {
    const mesh = new THREE.Mesh(own(fieldGeometry({ ...field, heightAt, edgeBand: STALK_CROPS[field.crop] ? (settings?.cropStalks?.edgeBand ?? 0) : 0 })), material(field.crop));
    mesh.receiveShadow = true;
    mesh.name = `field-${field.crop}`;
    object.add(mesh);
    const extras = fieldExtras({ ...field, heightAt, random });
    pumpkins.push(...extras.pumpkins);
    bales.push(...extras.bales);
    return mesh;
  });
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  if (pumpkins.length) {
    const mesh = instances(pumpkins, own(pumpkinGeometry()), own(bodyMaterial(uniforms, 0, 0.7)), own, (p, matrix, tint) => {
      matrix.compose(position.set(p.x, p.y, p.z), quaternion.setFromEuler(euler.set(0, p.yaw, 0)), scale.set(p.s, p.sy, p.s));
      tint.set(p.color);
      tint.setRGB(tint.r / PUMPKIN.r, tint.g / PUMPKIN.g, tint.b / PUMPKIN.b); // the geometry is painted orange: ratio to it
    });
    mesh.name = "pumpkins";
    object.add(mesh);
  }
  if (bales.length) {
    const mesh = instances(bales, own(baleGeometry(10)), own(bodyMaterial(uniforms, 0, 0.9)), own, (b, matrix) => {
      matrix.compose(position.set(b.x, b.y, b.z), quaternion.setFromEuler(euler.set(0, b.yaw, 0)), scale.setScalar(b.s));
    });
    mesh.name = "bales";
    object.add(mesh);
  }
  const stalks = settings?.cropStalks && createStalkLayer(plan.fields, { settings: settings.cropStalks, heightAt, uniforms, own });
  if (stalks) object.add(stalks.object);
  return {
    object,
    fields,
    stalks,
    /** Plants the fields near the camera. */
    update(frame) {
      stalks?.update(frame.camera.position);
    },
    setEnvironment() {},
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
