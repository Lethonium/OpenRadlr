/**
 * The stone arch bridge where a road crosses a river, as one vertex-coloured geometry of boxes (the world plans
 * them: world/bridgePlan.js). The workbench shows one over a dry valley on a straight road.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { merge, orientedBox } from "../geom.js";
import { bridgeBoxes } from "../../../world/bridgePlan.js";
import { BRIDGE_HALF_LENGTH } from "../../../world/rivers.js";

/**
 * @param {{boxes: Float32Array, colors: Float32Array}} bridges twelve numbers per box (centre, three edge vectors) and its colour
 * @returns {import("../../../three.js").BufferGeometry}
 */
export function bridgeGeometry({ boxes, colors }) {
  const parts = [];
  for (let i = 0; i < boxes.length; i += 12) {
    const at = (k) => Array.from(boxes.subarray(i + k, i + k + 3));
    const color = new THREE.Color().setRGB(colors[(i / 12) * 3], colors[(i / 12) * 3 + 1], colors[(i / 12) * 3 + 2]);
    parts.push(orientedBox(at(0), at(3), at(6), at(9), color));
  }
  return merge(parts);
}

/** The bridge on a straight, level road 8 m above a valley floor, in the colours of the temperate stone. */
function sampleBridge() {
  const list = bridgeBoxes({
    frameAt: (s) => ({ center: [0, 8, -s], forward: [0, 0, -1], right: [1, 0, 0] }),
    groundAt: () => 0,
    half: 4.6,
    halfLength: BRIDGE_HALF_LENGTH,
    stone: [0.64, 0.6, 0.53],
    stoneDark: [0.52, 0.49, 0.44],
  });
  const boxes = new Float32Array(list.length * 12);
  const colors = new Float32Array(list.length * 3);
  list.forEach(({ center, u, v, w, color }, i) => {
    boxes.set([...center, ...u, ...v, ...w], i * 12);
    colors.set(color, i * 3);
  });
  return { boxes, colors };
}

export const meta = Object.freeze({
  id: "bridge",
  name: "Stone bridge", // i18n-ok
  category: "props", // i18n-ok
  description: "The stone arch bridge where a road crosses a river: a deck with parapets, a pier on each bank and arches under it.", // i18n-ok
  options: Object.freeze({}),
});

/** @param {{track?: (resource: any) => any}} [options] */
export function create({ track } = {}) {
  const owner = createOwner(track);
  const mesh = new THREE.Mesh(owner.own(bridgeGeometry(sampleBridge())), owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })));
  mesh.castShadow = mesh.receiveShadow = true;
  const object = new THREE.Group();
  object.add(mesh);
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
