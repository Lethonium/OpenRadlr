/**
 * Low-poly models of buildings, infrastructure, animals and people.
 *
 * Every builder returns a built mesh in local coordinates: origin on the
 * ground at the centre of the footprint, front facing −Z, up = +Y. The world
 * places them with MeshBuilder.append(mesh, placementMatrix). Walls reach
 * 1.5 m below the origin so buildings sit cleanly on sloping ground.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { add, cross, normalize, placement, scale, sub } from "./math.js";

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
function roofSlab(m, eave, ridge, width, thickness, color, hint) {
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
function gableRoof(m, w, d, h, rise, color, wallColor, overhang = 0.45) {
  const ridge = [0, h + rise, 0];
  roofSlab(m, [0, h, -(d / 2 + overhang)], ridge, w + 2 * overhang, 0.18, color, [0, 1, -1]);
  roofSlab(m, [0, h, d / 2 + overhang], ridge, w + 2 * overhang, 0.18, color, [0, 1, 1]);
  const apex = h + (rise * (d / 2)) / (d / 2 + overhang);
  for (const side of [-1, 1]) {
    const x = (side * w) / 2;
    m.triangleFacing([x, h, -d / 2], [x, h, d / 2], [x, apex, 0], wallColor, [side, 0, 0]);
  }
}

/** Windows on one wall: `normal` is the outward wall direction (±X or ±Z). */
function windows(m, w, d, floors, normal, color) {
  const along = normal[0] !== 0 ? d : w;
  const count = Math.max(1, Math.floor((along - 1.5) / 2.4));
  for (let f = 0; f < floors; f += 1) {
    const y = 1.6 + f * 2.8;
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count - 0.5;
      const offset = t * (along - 1.2);
      const pos = normal[0] !== 0 ? [(normal[0] * w) / 2 + normal[0] * 0.04, y, offset] : [offset, y, (normal[2] * d) / 2 + normal[2] * 0.04];
      m.box(pos, normal[0] !== 0 ? [0.08, 1.0, 0.85] : [0.85, 1.0, 0.08], color);
    }
  }
}

/**
 * A house: `w` wide (along the road), `d` deep, `floors` storeys.
 * @param {{w: number, d: number, floors: number, wall: number[], roof: number[], chimney?: boolean}} spec
 */
export function buildHouse({ w, d, floors, wall, roof, chimney = false }) {
  const m = new MeshBuilder();
  const h = floors * 2.8 + 0.3;
  m.box([0, (h - 1.5) / 2, 0], [w, h + 1.5, d], wall);
  gableRoof(m, w, d, h, d * 0.42, roof, wall);
  m.box([w * 0.18, 1.05, -d / 2 - 0.04], [1.0, 2.1, 0.1], PALETTE.door);
  for (const normal of [
    [0, 0, -1],
    [0, 0, 1],
    [1, 0, 0],
    [-1, 0, 0],
  ]) {
    windows(m, w, d, floors, normal, PALETTE.window);
  }
  if (chimney) m.box([-w * 0.25, h + d * 0.3, d * 0.12], [0.6, d * 0.42, 0.6], PALETTE.stoneDark);
  return m.build();
}

/** A village church: nave with a tower and spire facing the road. */
export function buildChurch() {
  const m = new MeshBuilder();
  const w = 9;
  const d = 17;
  const h = 7.5;
  // Nave: modelled with its ridge along X, then turned so the ridge runs away from the road.
  const nave = new MeshBuilder();
  nave.box([0, (h - 1.5) / 2, 0], [d, h + 1.5, w], PALETTE.walls[0]);
  gableRoof(nave, d, w, h, 4.2, PALETTE.roofs[2], PALETTE.walls[0], 0.5);
  for (let i = 0; i < 4; i += 1) {
    for (const side of [-1, 1]) nave.box([-5.4 + i * 3.6, 3.4, side * (w / 2 + 0.04)], [1.0, 2.6, 0.08], PALETTE.window);
  }
  m.append(nave.build(), placement([0, 0, 1], Math.PI / 2));
  // Tower with clock and spire at the front.
  const tz = 1 - d / 2 - 2.2;
  m.box([0, (16 - 1.5) / 2, tz], [4.4, 16 + 1.5, 4.4], PALETTE.walls[1]);
  m.cone([0, 16, tz], 3.3, 9, PALETTE.roofs[2], 4, Math.PI / 4);
  m.box([0, 13, tz - 2.24], [1.6, 1.6, 0.08], PALETTE.white);
  m.box([0, 13.2, tz - 2.3], [0.1, 0.65, 0.04], PALETTE.black);
  m.box([0, 1.4, tz - 2.24], [1.4, 2.8, 0.1], PALETTE.door);
  return m.build();
}

export function buildBarn() {
  const m = new MeshBuilder();
  const w = 15;
  const d = 10;
  const h = 5;
  m.box([0, (h - 1.5) / 2, 0], [w, h + 1.5, d], PALETTE.barn);
  gableRoof(m, w, d, h, 4.2, PALETTE.barnRoof, PALETTE.barn, 0.6);
  m.box([0, 1.9, -d / 2 - 0.05], [4.2, 3.8, 0.1], PALETTE.door);
  m.box([0, 1.9, -d / 2 - 0.09], [0.15, 3.8, 0.06], PALETTE.white);
  return m.build();
}

export function buildSilo() {
  const m = new MeshBuilder();
  m.cylinder([0, -1, 0], 2.3, 13, PALETTE.silo, 12, 2.3, false);
  m.cone([0, 12, 0], 2.4, 2.2, PALETTE.metal, 12);
  return m.build();
}

/** A round hay bale lying on its side (axis along X). */
export function buildHayBale() {
  const m = new MeshBuilder();
  m.wheel([0, 0.7, 0], 0.72, 1.25, PALETTE.hay, 10);
  return m.build();
}

/** Street lamp at the kerb; the arm reaches over the road along −Z. */
export function buildStreetLamp() {
  const pole = new MeshBuilder();
  pole.cylinder([0, 0, 0], 0.08, 5.2, PALETTE.pole, 6, 0.06);
  pole.segment([0, 5.1, 0], [0, 5.3, -1.3], 0.06, 0.06, PALETTE.pole);
  const head = new MeshBuilder();
  head.box([0, 5.18, -1.45], [0.32, 0.12, 0.55], PALETTE.lamp);
  return { pole: pole.build(), head: head.build() };
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

/** Wind turbine tower and nacelle; the rotor is a separate, spinning mesh. */
export function buildTurbineTower(height = 62) {
  const m = new MeshBuilder();
  m.cylinder([0, -2, 0], 2.1, height + 2, PALETTE.white, 10, 1.2);
  m.box([0.6, height + 1.2, 0], [7, 2.6, 2.6], PALETTE.white);
  return m.build();
}

/** Three-bladed rotor in the YZ plane, spinning around X; hub at the origin. */
export function buildRotor(radius = 24) {
  const m = new MeshBuilder();
  m.ellipsoid([0, 0, 0], [1.6, 1.1, 1.1], PALETTE.white, 3, 8);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const tip = [0, Math.cos(angle) * radius, Math.sin(angle) * radius];
    const mid = [0, Math.cos(angle + 0.04) * radius * 0.35, Math.sin(angle + 0.04) * radius * 0.35];
    m.segment([0, 0, 0], mid, 0.35, 1.6, PALETTE.white);
    m.segment(mid, tip, 0.25, 0.9, PALETTE.white);
  }
  return m.build();
}

export function buildCow(brown = false) {
  const m = new MeshBuilder();
  const coat = brown ? PALETTE.cowBrown : PALETTE.cowWhite;
  m.box([0, 1.15, 0], [0.85, 0.95, 2.0], coat);
  if (!brown) {
    m.box([0.43, 1.2, 0.3], [0.04, 0.5, 0.7], PALETTE.dark);
    m.box([-0.43, 1.1, -0.4], [0.04, 0.45, 0.6], PALETTE.dark);
  }
  m.box([0, 1.3, -1.2], [0.5, 0.55, 0.65], coat);
  m.box([0, 1.15, -1.55], [0.42, 0.3, 0.12], PALETTE.skin);
  for (const [x, z] of [
    [-0.3, -0.75],
    [0.3, -0.75],
    [-0.3, 0.75],
    [0.3, 0.75],
  ]) {
    m.box([x, 0.38, z], [0.18, 0.8, 0.18], coat);
  }
  return m.build();
}

export function buildSheep() {
  const m = new MeshBuilder();
  m.ellipsoid([0, 0.75, 0], [0.45, 0.4, 0.65], PALETTE.sheep, 3, 7);
  m.box([0, 0.85, -0.68], [0.24, 0.28, 0.3], PALETTE.dark);
  for (const [x, z] of [
    [-0.2, -0.35],
    [0.2, -0.35],
    [-0.2, 0.35],
    [0.2, 0.35],
  ]) {
    m.box([x, 0.25, z], [0.09, 0.5, 0.09], PALETTE.dark);
  }
  return m.build();
}

/** A spectator facing −Z. The shirt is tinted per person (alpha = 1). */
export function buildSpectator(armsUp) {
  const m = new MeshBuilder();
  const shirt = [1, 1, 1, 1];
  for (const x of [-0.11, 0.11]) m.segment([x, 0, 0], [x, 0.85, 0], 0.13, 0.13, PALETTE.pants);
  m.box([0, 1.15, 0], [0.44, 0.62, 0.25], shirt);
  m.ellipsoid([0, 1.62, 0], [0.12, 0.14, 0.12], PALETTE.skin, 3, 6);
  for (const side of [-1, 1]) {
    const shoulder = [side * 0.26, 1.4, 0];
    const hand = armsUp ? [side * 0.42, 2.0, -0.05] : [side * 0.3, 0.9, -0.05];
    m.segment(shoulder, hand, 0.09, 0.09, shirt);
  }
  return m.build();
}

/**
 * A roadside bike café: a single-storey building with a big glass front and a
 * striped awning, a wooden terrace with tables and parasols, a bike rack with
 * bikes and a sign. Front faces −Z (the road); the terrace reaches
 * `terraceDepth` metres towards it. Sign faces and window glow go into `bright`.
 */
export function buildCafe({ terraceDepth = 7 } = {}) {
  const m = new MeshBuilder();
  const bright = new MeshBuilder();
  const w = 13;
  const d = 8;
  const h = 3.6;
  const wall = [0.95, 0.9, 0.8];
  const wood = [0.55, 0.38, 0.24];
  const woodDark = [0.4, 0.27, 0.17];
  const orange = [1.0, 0.48, 0.1];
  const front = -d / 2;

  // Building with a shallow roof and a timber band.
  m.box([0, (h - 1.5) / 2, 0], [w, h + 1.5, d], wall);
  gableRoof(m, w, d, h, 1.6, PALETTE.roofs[2], wall, 0.6);
  m.box([0, h - 0.25, front - 0.03], [w, 0.5, 0.08], woodDark);
  // Glass front with mullions, and a door.
  bright.box([-1.2, 1.55, front - 0.05], [8.6, 2.1, 0.06], [0.98, 0.84, 0.55]);
  for (let x = -5.5; x <= 3.2; x += 2.15) m.box([x, 1.55, front - 0.09], [0.12, 2.2, 0.06], woodDark);
  m.box([-1.2, 0.48, front - 0.09], [8.7, 0.12, 0.06], woodDark);
  m.box([4.6, 1.15, front - 0.06], [1.2, 2.3, 0.08], PALETTE.door);
  // Striped awning sloping down towards the road.
  for (let i = 0; i < 10; i += 1) {
    const x0 = -w / 2 + 0.2 + i * ((w - 0.4) / 10);
    const x1 = x0 + (w - 0.4) / 10;
    const color = i % 2 === 0 ? orange : PALETTE.white;
    m.quad([x0, h - 0.5, front], [x1, h - 0.5, front], [x1, h - 1.2, front - 2.4], [x0, h - 1.2, front - 2.4], color);
    m.quad([x0, h - 1.2, front - 2.4], [x1, h - 1.2, front - 2.4], [x1, h - 0.5, front], [x0, h - 0.5, front], color);
  }
  m.box([0, h - 1.38, front - 2.4], [w - 0.4, 0.35, 0.05], orange);

  // Wooden terrace with railing posts at the ends.
  const tz = front - terraceDepth / 2;
  m.box([0, -0.4, tz], [w + 1, 0.8 + 0.12, terraceDepth], wood);
  for (let x = -w / 2; x <= w / 2; x += 1.1) m.box([x, 0.07, tz], [0.04, 0.02, terraceDepth], woodDark);
  for (const x of [-w / 2 - 0.3, w / 2 + 0.3]) {
    for (let z = front - 0.6; z > front - terraceDepth; z -= 1.6) m.box([x, 0.55, z], [0.1, 1.0, 0.1], woodDark);
    m.box([x, 1.0, tz], [0.1, 0.08, terraceDepth - 0.4], woodDark);
  }

  // Tables with chairs and parasols.
  const parasolColors = [orange, PALETTE.white, orange, [0.2, 0.42, 0.85]];
  [-4.5, -0.8, 2.9].forEach((x, i) => {
    const z = tz - 0.3 + (i % 2) * 0.6;
    m.cylinder([x, 0.06, z], 0.06, 0.72, PALETTE.pole, 6);
    m.cylinder([x, 0.76, z], 0.48, 0.05, PALETTE.white, 10);
    for (const [cx, cz] of [
      [0.85, 0],
      [-0.85, 0],
      [0, 0.85],
    ]) {
      m.box([x + cx, 0.47, z + cz], [0.42, 0.06, 0.42], wood);
      m.box([x + cx * 1.25, 0.75, z + cz * 1.25], [cx ? 0.06 : 0.42, 0.5, cz ? 0.06 : 0.42], wood);
      for (const [lx, lz] of [
        [-0.17, -0.17],
        [0.17, -0.17],
        [-0.17, 0.17],
        [0.17, 0.17],
      ]) {
        m.box([x + cx + lx, 0.24, z + cz + lz], [0.04, 0.46, 0.04], PALETTE.pole);
      }
    }
    m.cylinder([x, 0.8, z], 0.035, 1.6, PALETTE.white, 5);
    m.cone([x, 2.15, z], 1.5, 0.55, parasolColors[i % parasolColors.length], 8);
  });

  // Bike rack beside the terrace with three road bikes (bikes point at the road, wheels turn about X).
  const rackX = w / 2 + 1.2;
  const rackZ = tz + 1.2;
  m.box([rackX + 2, 0.45, rackZ], [4.2, 0.06, 0.06], PALETTE.metal);
  for (const x of [rackX, rackX + 4]) m.box([x, 0.22, rackZ], [0.06, 0.45, 0.06], PALETTE.metal);
  const frames = [
    [0.85, 0.16, 0.14],
    [0.12, 0.12, 0.13],
    [0.2, 0.42, 0.85],
  ];
  frames.forEach((frame, i) => {
    const x = rackX + 0.7 + i * 1.3;
    const rear = [x, 0.34, rackZ + 0.5];
    const frontWheel = [x, 0.34, rackZ - 0.5];
    m.wheel(rear, 0.34, 0.04, PALETTE.black, 10);
    m.wheel(frontWheel, 0.34, 0.04, PALETTE.black, 10);
    const seat = [x, 0.92, rackZ + 0.25];
    const bars = [x, 0.95, rackZ - 0.35];
    const crank = [x, 0.36, rackZ + 0.05];
    for (const [a, b] of [
      [rear, seat],
      [rear, crank],
      [crank, seat],
      [seat, bars],
      [crank, bars],
      [bars, frontWheel],
    ]) {
      m.segment(a, b, 0.045, 0.045, frame);
    }
    m.box([x, seat[1] + 0.05, seat[2] + 0.05], [0.1, 0.05, 0.26], PALETTE.black);
    m.box([x, bars[1] + 0.05, bars[2] - 0.05], [0.42, 0.05, 0.06], PALETTE.black);
  });

  // Sign on two posts at the roadside: an orange board with a coffee cup.
  const sx = -w / 2 - 1.2;
  const sz = front - terraceDepth - 0.6;
  for (const x of [sx - 0.8, sx + 0.8]) m.box([x, 1.2, sz], [0.1, 2.4, 0.1], woodDark);
  bright.box([sx, 2.15, sz - 0.06], [2.2, 1.1, 0.06], orange);
  bright.box([sx - 0.15, 2.05, sz - 0.1], [0.55, 0.5, 0.03], PALETTE.white);
  bright.box([sx + 0.22, 2.1, sz - 0.1], [0.18, 0.24, 0.03], PALETTE.white);
  bright.box([sx - 0.15, 1.75, sz - 0.1], [0.8, 0.07, 0.03], PALETTE.white);
  m.box([sx, 2.15, sz + 0.02], [2.2, 1.1, 0.06], woodDark);

  return { mesh: m.build(), bright: bright.build(), footprint: { w: w + 6, d: d + terraceDepth } };
}

/** Colours of the outdoor gym: they read against grass and asphalt alike. */
export const GYM_COLORS = Object.freeze({
  pad: [0.68, 0.6, 0.48],
  padEdge: [0.56, 0.54, 0.5],
  mat: [0.6, 0.17, 0.14],
  seam: [0.42, 0.11, 0.09],
  frame: [0.96, 0.6, 0.1],
  bar: [0.8, 0.82, 0.85],
  pad3: [0.16, 0.26, 0.42],
  wood: [0.62, 0.43, 0.26],
  sign: [0.12, 0.46, 0.32],
});

/** Where the outdoor gym's sign stands, in the gym's frame (towards the road, off the pad). */
export const GYM_SIGN = Object.freeze({ x: -6.2, z: -9.4 });

/** The mat of the outdoor gym (metres): along the road, then away from it. */
export const GYM_MAT = Object.freeze({ w: 8, d: 5 });

/**
 * An outdoor gym (calisthenics park): a gravel pad with a rubber mat, a
 * pull-up rig, parallel bars, an inclined sit-up bench, a low beam and a
 * sign at the roadside. Front faces −Z (the road), the mat is centred on the
 * origin with its top at the returned `top`; the pad reaches `drop` metres
 * down so it never floats on a slope; the sign stands `signLift` metres
 * higher (or lower), on the ground at the roadside. The sign's face goes into `bright`.
 */
export function buildOutdoorGymModel({ drop = 0.4, signLift = 0 } = {}) {
  const m = new MeshBuilder();
  const bright = new MeshBuilder();
  const c = GYM_COLORS;
  const { w, d } = GYM_MAT;
  const top = 0.08;

  // Gravel pad under everything, edged with kerb stones.
  const pad = { x0: -8.6, x1: 8.6, z0: -3.6, z1: 6.6 };
  const padW = pad.x1 - pad.x0;
  const padD = pad.z1 - pad.z0;
  const padZ = (pad.z0 + pad.z1) / 2;
  m.box([0, (0.02 - drop) / 2, padZ], [padW, drop + 0.02, padD], c.pad);
  for (const z of [pad.z0, pad.z1]) m.box([0, 0.04, z], [padW + 0.2, 0.1, 0.2], c.padEdge);
  for (const x of [pad.x0, pad.x1]) m.box([x, 0.04, padZ], [0.2, 0.1, padD], c.padEdge);

  // Rubber mat with tile seams.
  m.box([0, top / 2, 0], [w, top, d], c.mat);
  for (let x = -w / 2 + 1; x < w / 2; x += 1) m.box([x, top + 0.003, 0], [0.05, 0.006, d], c.seam);
  for (let z = -d / 2 + 1; z < d / 2; z += 1) m.box([0, top + 0.003, z], [w, 0.006, 0.05], c.seam);

  const post = (x, z, height) => m.box([x, height / 2, z], [0.14, height, 0.14], c.frame);
  const barZ = (x, y, z0, z1) => m.box([x, y, (z0 + z1) / 2], [0.07, 0.07, z1 - z0], c.bar);

  // Pull-up rig beside the mat: three posts, a high and a lower bar, footings.
  const rigX = -6.6;
  for (const z of [-1.9, 0, 1.9]) {
    post(rigX, z, 2.75);
    m.box([rigX, 0.06, z], [0.4, 0.12, 0.4], c.padEdge);
    m.box([rigX, 2.8, z], [0.22, 0.1, 0.22], c.frame);
  }
  barZ(rigX, 2.55, -1.9, 0);
  barZ(rigX, 2.1, 0, 1.9);
  m.box([rigX, 2.72, 0], [0.12, 0.12, 3.95], c.frame);

  // Parallel bars (dip station) on the other side.
  const dipX = 6.4;
  for (const x of [dipX - 0.3, dipX + 0.3]) {
    for (const z of [-1.3, 1.3]) post(x, z, 1.25);
    barZ(x, 1.28, -1.6, 1.6);
  }
  m.box([dipX, 0.35, -1.3], [0.6, 0.08, 0.08], c.frame);
  m.box([dipX, 0.35, 1.3], [0.6, 0.08, 0.08], c.frame);

  // Behind the mat: an inclined sit-up bench with a foot roller…
  const benchZ = 4.8;
  const high = [-4.6, 0.78];
  const low = [-2.4, 0.38];
  const along = [low[0] - high[0], low[1] - high[1], 0];
  const length = Math.hypot(along[0], along[1]);
  const normal = [-along[1] / length, along[0] / length, 0];
  const mid = [(high[0] + low[0]) / 2, (high[1] + low[1]) / 2, benchZ];
  m.orientedBox(mid, along, [normal[0] * 0.1, normal[1] * 0.1, 0], [0, 0, 0.5], c.pad3);
  post(high[0] + 0.15, benchZ - 0.18, high[1] - 0.04);
  post(high[0] + 0.15, benchZ + 0.18, high[1] - 0.04);
  post(low[0] - 0.15, benchZ - 0.18, low[1] - 0.04);
  post(low[0] - 0.15, benchZ + 0.18, low[1] - 0.04);
  m.box([high[0] - 0.05, high[1] + 0.12, benchZ], [0.16, 0.16, 0.6], c.pad3);
  m.box([high[0] + 0.15, 0.08, benchZ], [0.1, 0.1, 0.5], c.frame);

  // …and a low wooden beam on two feet, with a step block at its end.
  const beam = { x0: 0.6, x1: 4.2, y: 0.42 };
  m.box([(beam.x0 + beam.x1) / 2, beam.y - 0.1, benchZ], [beam.x1 - beam.x0, 0.2, 0.22], c.wood);
  for (const x of [beam.x0 + 0.4, beam.x1 - 0.4]) {
    m.box([x, (beam.y - 0.2) / 2, benchZ], [0.14, beam.y - 0.2, 0.14], c.frame);
    m.box([x, 0.04, benchZ], [0.14, 0.08, 0.7], c.frame);
  }
  m.box([5.4, 0.25, benchZ], [0.8, 0.5, 0.8], c.wood);
  m.box([5.4, 0.505, benchZ], [0.84, 0.03, 0.84], c.seam);

  // Sign at the roadside, off the pad: it stands on the ground there
  // (`signLift` metres above the pad top), posts reaching into it.
  const { x: sx, z: sz } = GYM_SIGN;
  const y0 = signLift;
  for (const x of [sx - 0.7, sx + 0.7]) m.box([x, y0 + 1.0, sz], [0.1, 2.6, 0.1], c.frame);
  m.box([sx, y0 + 2.0, sz + 0.03], [1.7, 1.0, 0.06], c.frame);
  bright.box([sx, y0 + 2.0, sz - 0.02], [1.56, 0.86, 0.04], c.sign);
  const face = sz - 0.05;
  bright.box([sx, y0 + 2.32, face], [0.9, 0.06, 0.02], PALETTE.white);
  bright.box([sx, y0 + 2.17, face], [0.16, 0.16, 0.02], PALETTE.white);
  bright.box([sx, y0 + 1.94, face], [0.12, 0.3, 0.02], PALETTE.white);
  for (const x of [-0.17, 0.17]) {
    bright.box([sx + x, y0 + 2.15, face], [0.05, 0.3, 0.02], PALETTE.white);
    bright.box([sx + x * 0.6, y0 + 1.67, face], [0.06, 0.26, 0.02], PALETTE.white);
  }

  return { mesh: m.build(), bright: bright.build(), top };
}
