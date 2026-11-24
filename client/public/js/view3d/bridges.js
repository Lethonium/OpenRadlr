/**
 * Stone arch bridges where a road crosses a river: a deck with parapets, two
 * piers on the banks and arches under the deck. One built mesh (the
 * adapter's flat-shaded format) for all rivers; the river layer draws it.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { add, scale, sub } from "./math.js";
import { temperate } from "./biomes/index.js";
import { VERGE, roadFrame, roadHalfWidth } from "../world/roads.js";
import { BRIDGE_HALF_LENGTH } from "../world/rivers.js";

/** One bridge, written into `into`. */
function addBridge(route, terrain, river, into, biome) {
  const half = roadHalfWidth(route.lanes) + VERGE;
  const L = BRIDGE_HALF_LENGTH;
  const palette = biome.palette;
  const stone = palette.stone;
  const deckThickness = 1.4;
  const frameAt = (s) => roadFrame(route, river.at + s);
  const deckBottom = (s) => frameAt(s).center[1] - deckThickness;

  for (let s = -L; s < L; s += 2) {
    const f0 = frameAt(s);
    const f1 = frameAt(s + 2);
    const back = sub(f0.center, f1.center);
    const mid = scale(add(f0.center, f1.center), 0.5);
    into.orientedBox(add(mid, [0, -deckThickness / 2 + 0.02, 0]), scale(f0.right, 2 * half + 0.8), [0, deckThickness, 0], back, stone);
    for (const side of [-1, 1]) {
      into.orientedBox(add(add(mid, scale(f0.right, side * (half + 0.2))), [0, 0.38, 0]), scale(f0.right, 0.45), [0, 0.76, 0], back, stone);
      into.orientedBox(add(add(mid, scale(f0.right, side * (half + 0.2))), [0, 0.82, 0]), scale(f0.right, 0.6), [0, 0.12, 0], back, palette.stoneDark);
    }
  }

  // Piers on the banks and arches between them and the abutments.
  for (const s of [-16, 16]) {
    const f = frameAt(s);
    const top = deckBottom(s);
    const ground = terrain.height(f.center[0], f.center[2]) - 1;
    const back = scale(f.forward, -2.4);
    into.orientedBox(add(f.center, [0, (top + ground) / 2 - f.center[1], 0]), scale(f.right, 2 * half + 0.4), [0, top - ground, 0], [back[0], 0, back[2]], stone);
  }
  const spans = [
    [-L, -16, 3.5],
    [-16, 16, 6.5],
    [16, L, 3.5],
  ];
  for (const [s0, s1, rise] of spans) {
    const steps = Math.max(6, Math.round((s1 - s0) / 1.5));
    for (let k = 0; k < steps; k += 1) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const sa = s0 + (s1 - s0) * t0;
      const sb = s0 + (s1 - s0) * t1;
      const depth = Math.max(0.5, rise * (1 - Math.sin(Math.PI * ((t0 + t1) / 2))));
      const fa = frameAt(sa);
      const fb = frameAt(sb);
      const mid = scale(add(fa.center, fb.center), 0.5);
      const bottom = (deckBottom(sa) + deckBottom(sb)) / 2;
      into.orientedBox([mid[0], bottom - depth / 2, mid[2]], scale(fa.right, 2 * half + 0.3), [0, depth, 0], sub([fa.center[0], 0, fa.center[2]], [fb.center[0], 0, fb.center[2]]), palette.stoneDark);
    }
  }
}

/**
 * The bridges of `rivers` (each carries its `route` and the distance `at` where the road crosses).
 * @returns {{positions: Float32Array, normals: Float32Array, colors: Float32Array, vertexCount: number}}
 */
export function buildBridges(rivers, terrain, biome = temperate) {
  const mesh = new MeshBuilder();
  for (const river of rivers) addBridge(river.route, terrain, river, mesh, biome);
  return mesh.build();
}
