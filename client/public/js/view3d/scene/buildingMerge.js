/**
 * What the building layers share: parts placed by `{x, y, z, yaw}` and merged into one geometry per group, the
 * near/far twin shown by distance, the shared materials (grain, cloud shadows, height fog), the glow that follows
 * the night and the parts that turn (sails, rotors, wheels).
 */
import * as THREE from "../../three.js";
import { merge } from "../assets/geom.js";
import { addHook, cloudShadows, grain, heightFog } from "../assets/materials.js";

/** The look of the grain on walls and roofs. */
const GRAIN = Object.freeze({ scale: 0.5, strength: 0.25, bump: 0 });
/** The colour of a lit window at full night (linear-ish, warm). */
const WINDOW = new THREE.Color(1, 0.78, 0.45);

/**
 * The materials a building layer shares: one lit, vertex-coloured material for walls and roofs, one flat one for
 * the glows.
 * @param {{uniforms: object, grain?: import("../../three.js").Texture, own: <T>(resource: T) => T}} options
 */
export function createBuildingMaterials({ uniforms, grain: texture, own }) {
  const solid = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  if (texture) addHook(solid, grain({ texture, ...GRAIN }));
  addHook(solid, cloudShadows(uniforms));
  addHook(solid, heightFog(uniforms));
  const glow = own(new THREE.MeshBasicMaterial({ color: 0x000000 }));
  addHook(glow, heightFog(uniforms));
  return { solid, glow };
}

/**
 * Scratch space for the parts of one build: assets register what they make here, and `release` frees it once the
 * copies are merged, so only the merged geometry stays.
 */
export function createScratch() {
  const made = [];
  return {
    own: (resource) => {
      made.push(resource);
      return resource;
    },
    release: () => made.splice(0).forEach((resource) => resource.dispose()),
  };
}

/** A copy of `geometry` scaled, turned by `yaw` about y (local +z goes to (sin yaw, cos yaw)) and moved to (x, y, z). */
export function placed(geometry, { x, y, z, yaw = 0, scale = 1 }) {
  const copy = geometry.clone();
  if (scale !== 1) copy.scale(scale, scale, scale);
  return copy.rotateY(yaw).translate(x, y, z);
}

/** Collects placed copies of building parts, then merges each list. */
export function createCollector() {
  const lists = { near: [], far: [], glows: [] };
  return {
    /** Adds `parts` (a building's `parts()` result) standing at `at`. */
    add(parts, at) {
      for (const { geometry } of parts.near) lists.near.push(placed(geometry, at));
      for (const { geometry } of parts.far) lists.far.push(placed(geometry, at));
      for (const geometry of parts.glows) lists.glows.push(placed(geometry, at));
    },
    /** Adds loose geometry already in world space to the near list (and the far list when `far`). */
    addWorld(geometries, { far = false } = {}) {
      lists.near.push(...geometries);
      if (far) lists.far.push(...geometries.map((geometry) => geometry.clone()));
    },
    /** One merged geometry per list (null where a list is empty), owned. */
    merged(own) {
      const one = (list) => (list.length ? own(merge(list)) : null);
      return { near: one(lists.near), far: one(lists.far), glows: one(lists.glows) };
    },
  };
}

/**
 * The near, far and glow meshes of one group, shown by the camera's distance to its centre.
 * @param {{near: object|null, far: object|null, glows: object|null}} geometry
 * @param {{materials: ReturnType<typeof createBuildingMaterials>, centre: number[], reach: {near: number, far: number}, name: string}} options
 */
export function createLod(geometry, { materials, centre, reach, name }) {
  const mesh = (geometries, material, suffix) => {
    if (!geometries) return null;
    const made = new THREE.Mesh(geometries, material);
    made.name = `${name}-${suffix}`;
    made.visible = false;
    return made;
  };
  const near = mesh(geometry.near, materials.solid, "near");
  const far = mesh(geometry.far, materials.solid, "far");
  const glow = mesh(geometry.glows, materials.glow, "glow");
  if (near) {
    near.castShadow = true;
    near.receiveShadow = true;
  }
  if (far) far.receiveShadow = true;
  const object = new THREE.Group();
  object.name = name;
  for (const part of [near, far, glow]) if (part) object.add(part);
  let lit = false;
  let close = false;
  return {
    object,
    near,
    far,
    glow,
    /** Shows the near mesh within `reach.near` of the centre, the far one out to `reach.far`; the glow (lit windows) shows with either, so far towns are lit at night. */
    update(camera) {
      const d = Math.hypot(camera.position.x - centre[0], camera.position.z - centre[1]);
      close = d < reach.near;
      if (near) near.visible = close;
      if (far) far.visible = !close && d < reach.far;
      if (glow) glow.visible = d < reach.far && lit;
    },
    /** Whether the glow shows at all (false by day). */
    light(on) {
      lit = on;
      if (glow) glow.visible = lit && (close || far?.visible === true);
    },
  };
}

/** Sets the glow material's colour for a night amount 0..1. Returns whether anything glows. */
export function setGlow(material, night) {
  material.color.copy(WINDOW).multiplyScalar(night);
  return night > 0.001;
}

/**
 * Parts that turn about a pivot: each stands in a group at its building's place, the mesh at the pivot, turned
 * about the axis by `t × speed + phase` while the camera is within `reach.near` of it, still beyond; hidden from
 * `far` metres away (`Infinity`: always shown).
 * @param {import("../../three.js").Group} object where the groups go
 * @param {import("../../three.js").Material} material
 * @param {<T>(resource: T) => T} own keeps each turning part's geometry (a copy: the asset's own goes with the build's scratch)
 */
export function createTurners(object, material, own) {
  const list = [];
  return {
    list,
    /**
     * @param {{geometry: import("../../three.js").BufferGeometry, x: number, y: number, z: number, axis: number[]}} mover
     * @param {{x: number, y: number, z: number, yaw: number}} at
     */
    add(mover, at, { speed = 1, phase = 0, far = Infinity } = {}) {
      const group = new THREE.Group();
      group.position.set(at.x, at.y, at.z);
      group.rotation.y = at.yaw;
      const mesh = new THREE.Mesh(own(mover.geometry.clone()), material);
      mesh.position.set(mover.x, mover.y, mover.z);
      mesh.castShadow = true;
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(...mover.axis), phase);
      group.add(mesh);
      object.add(group);
      list.push({ mesh, group, axis: new THREE.Vector3(...mover.axis), speed, phase, far, x: at.x, z: at.z });
      return mesh;
    },
    /** @param {{near: number}} reach metres within which the parts turn */
    update(frame, reach) {
      const { x, z } = frame.camera.position;
      for (const turner of list) {
        const d = Math.hypot(x - turner.x, z - turner.z);
        turner.group.visible = d < turner.far;
        if (d < reach.near) turner.mesh.quaternion.setFromAxisAngle(turner.axis, frame.t * turner.speed + turner.phase);
      }
    },
  };
}
