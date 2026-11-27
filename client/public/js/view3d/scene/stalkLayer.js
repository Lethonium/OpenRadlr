/**
 * The crop plants of the fields: individual wheat ears, corn, sunflowers and
 * so on along every field's edges and, at higher quality and close to the
 * camera, across the field. Fields are built when the camera first comes
 * within reach and hidden again when it leaves; each plant kind draws a
 * detailed version near the camera and a cheap tuft further out (the material
 * hides the instances outside its distance range).
 */
import * as THREE from "../../three.js";
import { STALK_STRIDE, STALK_CROPS, planStalks } from "../../world/plan/stalks.js";
import { stalkGeometry, stalkMaterial } from "../assets/nature/stalks.js";

/** Metres the plants sink into the ground, so none floats on a slope. */
const SINK = 0.03;

/**
 * @param {import("../../world/plan/fields.js").Field[]} fields
 * @param {{settings: import("../quality.js").QualitySettings["cropStalks"], heightAt: (x: number, z: number) => number, uniforms: object, own: <T>(resource: T) => T}} options
 * @returns {{object: import("../../three.js").Group, update: (camera: import("../../three.js").Vector3) => void, built: () => number}}
 */
export function createStalkLayer(fields, { settings, heightAt, uniforms, own }) {
  const object = new THREE.Group();
  object.name = "stalks";
  const kits = new Map();
  /** Geometry and materials of a crop, made on first use. */
  const kit = (crop) => {
    if (!kits.has(crop)) {
      const geometry = stalkGeometry(crop, { uniforms, own });
      const { nearReach, reach, interiorReach } = settings;
      kits.set(crop, {
        geometry,
        near: own(stalkMaterial(uniforms, geometry.wind, [0, nearReach])),
        far: own(stalkMaterial(uniforms, geometry.wind, [nearReach, reach])),
        interior: own(stalkMaterial(uniforms, geometry.wind, [0, interiorReach])),
      });
    }
    return kits.get(crop);
  };
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  /** One instanced mesh of the planted `data` (x, z, yaw, scale per plant). */
  const plants = (geometry, material, data, name) => {
    const count = data.length / STALK_STRIDE;
    const mesh = own(new THREE.InstancedMesh(geometry, material, count));
    for (let i = 0; i < count; i += 1) {
      const [x, z, yaw, size] = data.subarray(i * STALK_STRIDE, (i + 1) * STALK_STRIDE);
      matrix.compose(position.set(x, heightAt(x, z) - SINK, z), quaternion.setFromAxisAngle(axis, yaw), scale.setScalar(size));
      mesh.setMatrixAt(i, matrix);
      const shade = 0.95 + 0.25 * ((yaw * 7) % 1);
      mesh.setColorAt(i, tint.setRGB(shade, shade, shade));
    }
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.computeBoundingSphere();
    return mesh;
  };

  const entries = fields
    .filter((field) => STALK_CROPS[field.crop] && settings.edgeBand > 0)
    .map((field) => ({ field, radius: Math.hypot(field.width, field.depth) / 2, edge: null, interior: null }));
  const params = { edgeBand: settings.edgeBand, spacing: settings.spacing };

  const buildEdge = (entry) => {
    const { field } = entry;
    const { geometry, near, far } = kit(field.crop);
    const data = planStalks(field, params).edge;
    entry.edge = new THREE.Group();
    entry.edge.name = `stalks-${field.crop}`;
    if (data.length) entry.edge.add(plants(geometry.near, near, data, "near"), plants(geometry.far, far, data, "far"));
    object.add(entry.edge);
  };
  const buildInterior = (entry) => {
    const { field } = entry;
    const data = planStalks(field, { ...params, interior: { spacing: settings.interiorSpacing } }).interior;
    entry.interior = new THREE.Group();
    entry.interior.name = `stalks-inside-${field.crop}`;
    if (data.length) entry.interior.add(plants(kit(field.crop).geometry.near, kit(field.crop).interior, data, "inside"));
    object.add(entry.interior);
  };

  return {
    object,
    /** Builds and shows the fields within reach of the camera, hides the others. */
    update(camera) {
      for (const entry of entries) {
        const away = Math.hypot(entry.field.x - camera.x, entry.field.z - camera.z) - entry.radius;
        const edge = away < settings.reach;
        if (edge && !entry.edge) buildEdge(entry);
        if (entry.edge) entry.edge.visible = edge;
        const inside = settings.interiorReach > 0 && away < settings.interiorReach;
        if (inside && !entry.interior) buildInterior(entry);
        if (entry.interior) entry.interior.visible = inside;
      }
    },
    /** How many fields have their plants built. */
    built: () => entries.filter((entry) => entry.edge).length,
  };
}
