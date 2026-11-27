/**
 * A stone arch bridge as boxes, pure: a deck with parapets along the road, a pier on each bank and arches under the
 * deck. Each box is `{center, u, v, w, color}` with its edge vectors (full lengths), in world space, so the view only
 * has to draw them (view3d/assets/props/bridge.js).
 */
import { add, scale } from "./vec.js";

const sub = (a, b) => add(a, scale(b, -1));
const DECK_THICKNESS = 1.4;
/** How far from the crossing the piers stand. */
const PIER_AT = 16;

/**
 * @param {{frameAt: (s: number) => {center: number[], forward: number[], right: number[]}, groundAt: (x: number, z: number) => number,
 *   half: number, halfLength: number, stone: number[], stoneDark: number[]}} spec
 *   `frameAt` is the road's frame `s` metres from the crossing, `half` the road's width plus verge from its middle
 * @returns {{center: number[], u: number[], v: number[], w: number[], color: number[]}[]}
 */
export function bridgeBoxes({ frameAt, groundAt, half, halfLength, stone, stoneDark }) {
  const boxes = [];
  const box = (center, u, v, w, color) => boxes.push({ center, u, v, w, color });
  const L = halfLength;
  const deckBottom = (s) => frameAt(s).center[1] - DECK_THICKNESS;

  for (let s = -L; s < L; s += 2) {
    const f0 = frameAt(s);
    const f1 = frameAt(s + 2);
    const back = sub(f0.center, f1.center);
    const mid = scale(add(f0.center, f1.center), 0.5);
    box(add(mid, [0, -DECK_THICKNESS / 2 + 0.02, 0]), scale(f0.right, 2 * half + 0.8), [0, DECK_THICKNESS, 0], back, stone);
    for (const side of [-1, 1]) {
      box(add(add(mid, scale(f0.right, side * (half + 0.2))), [0, 0.38, 0]), scale(f0.right, 0.45), [0, 0.76, 0], back, stone);
      box(add(add(mid, scale(f0.right, side * (half + 0.2))), [0, 0.82, 0]), scale(f0.right, 0.6), [0, 0.12, 0], back, stoneDark);
    }
  }

  // Piers on the banks and arches between them and the abutments.
  for (const s of [-PIER_AT, PIER_AT]) {
    const f = frameAt(s);
    const top = deckBottom(s);
    const ground = groundAt(f.center[0], f.center[2]) - 1;
    const back = scale(f.forward, -2.4);
    box(add(f.center, [0, (top + ground) / 2 - f.center[1], 0]), scale(f.right, 2 * half + 0.4), [0, top - ground, 0], [back[0], 0, back[2]], stone);
  }
  const spans = [
    [-L, -PIER_AT, 3.5],
    [-PIER_AT, PIER_AT, 6.5],
    [PIER_AT, L, 3.5],
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
      box([mid[0], bottom - depth / 2, mid[2]], scale(fa.right, 2 * half + 0.3), [0, depth, 0], sub([fa.center[0], 0, fa.center[2]], [fb.center[0], 0, fb.center[2]]), stoneDark);
    }
  }
  return boxes;
}
