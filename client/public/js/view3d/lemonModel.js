/**
 * A golden lemon floating over the road (see ride/lemons.js): a stretched
 * ellipsoid with a nub at each end and a leaf, centred on the origin with its
 * long axis along X. Drawn bright, so it glows a little in any light.
 */
import { MeshBuilder } from "./meshBuilder.js";

export const LEMON_COLORS = Object.freeze({ peel: [1.0, 0.8, 0.08], nub: [0.92, 0.68, 0.06], leaf: [0.24, 0.62, 0.22] });

/** About 1 m long: easy to spot close up, a yellow dot further on (an easter egg, not a beacon). */
export function buildLemon() {
  const m = new MeshBuilder();
  m.ellipsoid([0, 0, 0], [0.44, 0.3, 0.3], LEMON_COLORS.peel, 5, 10);
  for (const side of [-1, 1]) m.ellipsoid([side * 0.45, 0, 0], [0.08, 0.08, 0.08], LEMON_COLORS.nub, 3, 6);
  m.ellipsoid([0.3, 0.25, 0], [0.16, 0.03, 0.08], LEMON_COLORS.leaf, 2, 6);
  return m.build();
}
