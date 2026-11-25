/**
 * Low-poly models of buildings, infrastructure, animals and people.
 *
 * Every builder returns a built mesh in local coordinates: origin on the
 * ground at the centre of the footprint, front facing −Z, up = +Y. The world
 * places them with MeshBuilder.append(mesh, placementMatrix). Walls reach
 * 1.5 m below the origin so buildings sit cleanly on sloping ground.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { add, cross, normalize, scale, sub } from "./math.js";

export const PALETTE = Object.freeze({
  walls: [
    [0.93, 0.91, 0.86],
    [0.95, 0.88, 0.7],
    [0.92, 0.8, 0.76],
    [0.82, 0.86, 0.88],
    [0.88, 0.84, 0.74],
    [0.76, 0.66, 0.55],
  ],
  roofs: [
    [0.66, 0.27, 0.19],
    [0.55, 0.22, 0.17],
    [0.3, 0.31, 0.34],
    [0.42, 0.3, 0.24],
  ],
  window: [0.2, 0.25, 0.32],
  door: [0.36, 0.24, 0.16],
  stone: [0.64, 0.6, 0.53],
  stoneDark: [0.52, 0.49, 0.44],
  pavement: [0.66, 0.66, 0.64],
  kerb: [0.55, 0.55, 0.53],
  forecourt: [0.7, 0.68, 0.64],
  forecourtEdge: [0.55, 0.55, 0.53],
  barn: [0.6, 0.2, 0.16],
  barnRoof: [0.28, 0.28, 0.3],
  silo: [0.82, 0.83, 0.84],
  hay: [0.86, 0.74, 0.4],
  metal: [0.74, 0.76, 0.78],
  white: [0.95, 0.95, 0.95],
  red: [0.82, 0.16, 0.14],
  yellow: [0.96, 0.8, 0.18],
  black: [0.08, 0.08, 0.09],
  lamp: [1.0, 0.92, 0.7],
  pole: [0.28, 0.3, 0.32],
  cowWhite: [0.93, 0.92, 0.88],
  cowBrown: [0.5, 0.33, 0.22],
  sheep: [0.92, 0.9, 0.84],
  dark: [0.12, 0.11, 0.1],
  skin: [0.9, 0.72, 0.58],
  pants: [0.2, 0.22, 0.28],
});

/** Sloped roof slab between an eave line and the ridge, `width` long along X, facing `hint`. */
export function roofSlab(m, eave, ridge, width, thickness, color, hint) {
  let u = [width, 0, 0];
  const v = sub(ridge, eave);
  let n = cross(u, v);
  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) {
    u = scale(u, -1);
    n = scale(n, -1);
  }
  const w = scale(normalize(n), thickness);
  const center = add(scale(add(eave, ridge), 0.5), scale(w, 0.5));
  m.orientedBox(center, u, v, w, color);
}

/** Gabled roof over a w × d footprint at height h, ridge along X. */
export function gableRoof(m, w, d, h, rise, color, wallColor, overhang = 0.45) {
  const ridge = [0, h + rise, 0];
  roofSlab(m, [0, h, -(d / 2 + overhang)], ridge, w + 2 * overhang, 0.18, color, [0, 1, -1]);
  roofSlab(m, [0, h, d / 2 + overhang], ridge, w + 2 * overhang, 0.18, color, [0, 1, 1]);
  const apex = h + (rise * (d / 2)) / (d / 2 + overhang);
  for (const side of [-1, 1]) {
    const x = (side * w) / 2;
    m.triangleFacing([x, h, -d / 2], [x, h, d / 2], [x, apex, 0], wallColor, [side, 0, 0]);
  }
}

/** Warning triangle sign on a post, facing −Z. */
export function buildWarningSign() {
  const post = new MeshBuilder();
  post.box([0, 1.1, 0], [0.08, 2.2, 0.08], PALETTE.metal);
  const face = new MeshBuilder();
  const tri = (r, z, color) => face.triangleFacing([-r, 2.1 - r * 0.6, z], [r, 2.1 - r * 0.6, z], [0, 2.1 + r * 1.1, z], color, [0, 0, -1]);
  tri(0.55, -0.06, PALETTE.red);
  tri(0.38, -0.08, PALETTE.white);
  face.triangleFacing([-0.22, 2.0, -0.1], [0.22, 2.0, -0.1], [0.22, 2.22, -0.1], PALETTE.black, [0, 0, -1]);
  return { post: post.build(), face: face.build() };
}

/** Yellow village name board on two posts, facing −Z. */
export function buildVillageSign() {
  const post = new MeshBuilder();
  for (const x of [-0.6, 0.6]) post.box([x, 0.9, 0], [0.07, 1.8, 0.07], PALETTE.metal);
  const face = new MeshBuilder();
  face.box([0, 1.75, -0.05], [1.6, 0.7, 0.05], PALETTE.black);
  face.box([0, 1.75, -0.08], [1.48, 0.58, 0.03], PALETTE.yellow);
  face.box([0, 1.75, -0.1], [1.0, 0.12, 0.02], PALETTE.black);
  return { post: post.build(), face: face.build() };
}
