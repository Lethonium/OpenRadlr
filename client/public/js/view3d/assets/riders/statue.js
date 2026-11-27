/**
 * A statue's figure: the rigged rider (or its penguin outfit) posed, settled on the ground and baked into one static,
 * single-coloured geometry, so a statue costs no rig at draw time. Faces +x like the rig; the bronze patina colours the
 * lowest part of the figure. The scene's statue layer places, scales and merges these onto plinths.
 */
import * as THREE from "../../../three.js";
import { mergeGeometries } from "../../../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { createSharedUniforms } from "../materials.js";
import { createOwner } from "../owner.js";
import { dressAsPenguin } from "./penguinOutfit.js";
import { settleOnRig } from "./retarget.js";
import { BENCH_LOOK, createRider } from "./rider.js";

/** The lowest share of the figure's height that takes the patina colour. */
const PATINA_SHARE = 0.15;

/**
 * @param {{pose: import("../../riderPose.js").Pose, material: {figure: number[], accent?: number[]}, figure?: "rider" | "penguin", own?: <T>(resource: T) => T, uniforms?: object}} options
 * @returns {{geometry: THREE.BufferGeometry, box: THREE.Box3}} non-indexed position, normal and colour; `box` of the baked vertices
 */
export function bakeStatue({ pose, material, figure = "rider", own = (resource) => resource, uniforms = createSharedUniforms() }) {
  const temporary = createOwner();
  const rig = createRider(BENCH_LOOK, { own: temporary.own, uniforms });
  if (figure === "penguin") dressAsPenguin(rig, { own: temporary.own, uniforms });
  settleOnRig(rig, pose);
  rig.object.updateMatrixWorld(true);
  const pieces = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  rig.object.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible) return;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
    const source = mesh.geometry;
    const count = source.attributes.position.count;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, point);
      else point.fromBufferAttribute(source.attributes.position, i);
      point.applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    }
    let baked = new THREE.BufferGeometry();
    baked.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (source.index) baked.setIndex(source.index.clone());
    if (mesh.isSkinnedMesh) baked.computeVertexNormals();
    else {
      const normals = new Float32Array(count * 3);
      const matrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < count; i += 1) normal.fromBufferAttribute(source.attributes.normal, i).applyMatrix3(matrix).normalize().toArray(normals, i * 3);
      baked.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }
    if (baked.index) {
      const flat = baked.toNonIndexed();
      baked.dispose();
      baked = flat;
    }
    pieces.push(baked);
  });
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  temporary.disposeAll();

  const box = new THREE.Box3().setFromBufferAttribute(merged.attributes.position);
  const patinaTop = box.min.y + PATINA_SHARE * (box.max.y - box.min.y);
  const positions = merged.attributes.position;
  const colours = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i += 1) {
    const [r, g, b] = material.accent && positions.getY(i) < patinaTop ? material.accent : material.figure;
    colours.set([r, g, b], i * 3);
  }
  merged.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return { geometry: own(merged), box };
}

// ---------- the workbench's statue

/** A frozen squat, to look at the stone and the patina. */
const BENCH_POSE = Object.freeze({
  root: { y: 0, z: 0, pitch: 0 },
  joints: { hipL: -1.3, hipR: -1.3, kneeL: 1.9, kneeR: 1.9, ankleL: -0.5, ankleR: -0.5, shoulderL: -1.5, shoulderR: -1.5 },
});
const BENCH_MATERIALS = Object.freeze({
  marble: { figure: [0.93, 0.91, 0.86] },
  bronze: { figure: [0.72, 0.54, 0.2], accent: [0.25, 0.55, 0.45] },
  sandstone: { figure: [0.8, 0.62, 0.36] },
  granite: { figure: [0.6, 0.61, 0.63] },
});

export const meta = Object.freeze({
  id: "statue",
  name: "Statue (rigged)", // i18n-ok
  category: "Creatures", // i18n-ok
  description: "A gym statue: the rigged rider or penguin frozen mid-exercise and baked into one stone colour.", // i18n-ok
  options: Object.freeze({
    figure: Object.freeze({ type: "select", values: Object.freeze(["rider", "penguin"]), default: "rider" }),
    material: Object.freeze({ type: "select", values: Object.freeze(Object.keys(BENCH_MATERIALS)), default: "marble" }),
  }),
});

/** @param {{track?: (resource: any) => any, figure?: "rider" | "penguin", material?: string, uniforms?: object}} [options] */
export function create({ track, figure = "rider", material = "marble", uniforms } = {}) {
  const owner = createOwner(track);
  const { geometry } = bakeStatue({ pose: BENCH_POSE, material: BENCH_MATERIALS[material] ?? BENCH_MATERIALS.marble, figure, own: owner.own, uniforms });
  const stone = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  const mesh = new THREE.Mesh(geometry, stone);
  Object.assign(mesh, { castShadow: true, receiveShadow: true });
  const object = new THREE.Group();
  object.add(mesh);
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
