/**
 * The dry-stone walls and hedgerows along the parcels' sides: one instanced mesh per kind and 300 m area
 * of unit segments scaled along x, drawn within `settings.landUse.edges` of the camera. The segments are
 * planned in the worker (`plan.landEdges`, `EDGE_STRIDE` floats each) and follow the ground between their ends.
 */
import * as THREE from "../../three.js";
import { NATURE } from "../assets/nature/index.js";
import { EDGE_STRIDE } from "../../world/plan/landUse.js";
import { createOwner } from "./tracker.js";

/** Side of the areas the segments are grouped in, so the camera culls the far ones. */
const CELL = 300;
/** Metres the segments sit in the ground, so a wall on a bump does not hover. */
const SINK = 0.1;
/** Asset id of each edge kind. */
const ASSET = Object.freeze({ wall: "fieldWall", hedge: "hedge" });

/**
 * @param {{landEdges?: {wall?: Float32Array, hedge?: Float32Array}}} plan
 * @param {{assets?: Record<string, {parts: Function}>, season?: string, settings: import("../quality.js").QualitySettings,
 *   uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createFieldEdgeLayer(plan, { assets = NATURE, season = "summer", settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "fieldEdges";
  const reach = settings.landUse.edges;
  const chunks = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const roll = new THREE.Vector3(0, 0, 1);
  for (const kind of Object.keys(ASSET)) {
    const data = plan.landEdges?.[kind];
    if (!data?.length) continue;
    const [part] = assets[ASSET[kind]].parts({ season, detail: settings.detail, uniforms, own }).near;
    const cells = new Map();
    for (let i = 0; i < data.length; i += EDGE_STRIDE) {
      const key = `${Math.floor(data[i] / CELL)},${Math.floor(data[i + 2] / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    for (const offsets of cells.values()) {
      const mesh = own(new THREE.InstancedMesh(part.geometry, part.material, offsets.length));
      offsets.forEach((i, n) => {
        const pitch = data[i + 5];
        quaternion.setFromAxisAngle(up, -data[i + 3]).multiply(turn.setFromAxisAngle(roll, pitch));
        matrix.compose(position.set(data[i], data[i + 1] - SINK, data[i + 2]), quaternion, scale.set(data[i + 4] / Math.cos(pitch), 1, 1));
        mesh.setMatrixAt(n, matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${kind}s`;
      mesh.computeBoundingSphere();
      object.add(mesh);
      chunks.push({ kind, mesh, get count() { return mesh.count; }, get visible() { return mesh.visible; } });
    }
  }
  return {
    object,
    /** One entry per instanced mesh: its `kind`, `count` of segments and whether it is `visible`. */
    chunks,
    /** Draws the areas within reach of the camera. */
    update(frame) {
      const { position: eye } = frame.camera;
      for (const { mesh } of chunks) {
        const { center, radius } = mesh.boundingSphere;
        mesh.visible = Math.hypot(center.x - eye.x, center.y - eye.y, center.z - eye.z) - radius <= reach;
      }
    },
    setEnvironment() {},
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
