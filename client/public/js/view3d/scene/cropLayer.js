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

/** Side of the areas the extras are grouped in, so the camera culls the far ones. */
const CELL = 250;

/** One instanced mesh per area of `things`, each placed by `place(thing, matrix, colour)`; geometry and material are shared. */
function instances(things, geometry, material, own, place) {
  const cells = new Map();
  for (const thing of things) {
    const key = `${Math.floor(thing.x / CELL)},${Math.floor(thing.z / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(thing);
  }
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  return [...cells.values()].map((group) => {
    const mesh = own(new THREE.InstancedMesh(geometry, material, group.length));
    group.forEach((thing, n) => {
      place(thing, matrix, tint);
      mesh.setMatrixAt(n, matrix);
      if (thing.color) mesh.setColorAt(n, tint);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  });
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
    const meshes = instances(pumpkins, own(pumpkinGeometry()), own(bodyMaterial(uniforms, 0, 0.7)), own, (p, matrix, tint) => {
      matrix.compose(position.set(p.x, p.y, p.z), quaternion.setFromEuler(euler.set(0, p.yaw, 0)), scale.set(p.s, p.sy, p.s));
      tint.set(p.color);
      tint.setRGB(tint.r / PUMPKIN.r, tint.g / PUMPKIN.g, tint.b / PUMPKIN.b); // the geometry is painted orange: ratio to it
    });
    for (const mesh of meshes) mesh.name = "pumpkins";
    object.add(...meshes);
  }
  if (bales.length) {
    const meshes = instances(bales, own(baleGeometry(10)), own(bodyMaterial(uniforms, 0, 0.9)), own, (b, matrix) => {
      matrix.compose(position.set(b.x, b.y, b.z), quaternion.setFromEuler(euler.set(0, b.yaw, 0)), scale.setScalar(b.s));
    });
    for (const mesh of meshes) mesh.name = "bales";
    object.add(...meshes);
  }
  const extras = object.children.filter((child) => child.isInstancedMesh);
  const extrasReach = settings?.cropExtras?.reach ?? Infinity;
  const stalks = settings?.cropStalks && createStalkLayer(plan.fields, { settings: settings.cropStalks, heightAt, uniforms, own });
  if (stalks) object.add(stalks.object);
  return {
    object,
    fields,
    stalks,
    /** Plants the fields near the camera, and draws the bales and pumpkins of the areas within reach. */
    update(frame) {
      const { position } = frame.camera;
      for (const mesh of extras) {
        const { center, radius } = mesh.boundingSphere;
        mesh.visible = Math.hypot(center.x - position.x, center.y - position.y, center.z - position.z) - radius <= extrasReach;
      }
      stalks?.update(frame.camera.position);
    },
    setEnvironment() {},
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
