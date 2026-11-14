/** The hand's bones in VR: one unit box each, scaled and turned per bone by `vr/hands.js`. */
import { MeshBuilder } from "./meshBuilder.js";

/** A 1 × 1 × 1 box centred on the origin, white so the glove colour tints it. */
export function buildHandBone() {
  const mesh = new MeshBuilder();
  mesh.box([0, 0, 0], [1, 1, 1], [1, 1, 1]);
  return mesh.build();
}
