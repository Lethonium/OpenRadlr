/**
 * Winter's buildings and props. Each model keeps the footprint of its
 * temperate counterpart (so the layout, occupancy and camera never move) but
 * changes shape: steep snow-loaded roofs, balconies, timber, drifts.
 */
import { MeshBuilder } from "../../meshBuilder.js";
import {
  GYM_SIGN,
  buildOutdoorGymModel,
  buildVillageSign,
  buildWarningSign,
  gableRoof,
  roofSlab,
} from "../../structures.js";
import { SNOW, STONE, TIMBER_DARK, WINTER_PALETTE } from "./palette.js";

/** A gable roof with a thick layer of snow lying on both slopes. */
function snowyRoof(m, w, d, h, rise, overhang = 0.6, roofColor = TIMBER_DARK) {
  gableRoof(m, w, d, h, rise, roofColor, WINTER_PALETTE.walls[0], overhang);
  const ridge = [0, h + rise + 0.13, 0];
  roofSlab(m, [0, h + 0.13, -(d / 2 + overhang)], ridge, w + 2 * overhang, 0.14, SNOW, [0, 1, -1]);
  roofSlab(m, [0, h + 0.13, d / 2 + overhang], ridge, w + 2 * overhang, 0.14, SNOW, [0, 1, 1]);
}

/**
 * A roadside marker as a snowman: three snowballs, coal eyes, a carrot nose,
 * twig arms, a scarf and a red hat. The pair at every kilometre wears a yellow
 * scarf so the distance still reads at speed; the rest wear a red one.
 */
export function buildWinterPost(km = false) {
  const m = new MeshBuilder();
  const body = [0.97, 0.98, 1.0];
  const coal = [0.14, 0.15, 0.17];
  const carrot = [0.95, 0.5, 0.12];
  const red = [0.78, 0.2, 0.18];
  const yellow = [0.95, 0.78, 0.24];
  const scarf = km ? yellow : red;

  m.ellipsoid([0, 0.34, 0], [0.34, 0.34, 0.34], body, 3, 6);
  m.ellipsoid([0, 0.82, 0], [0.26, 0.26, 0.26], body, 3, 6);
  m.ellipsoid([0, 1.18, 0], [0.18, 0.18, 0.18], body, 3, 6);
  for (const x of [-0.06, 0.06]) m.box([x, 1.22, -0.15], [0.035, 0.035, 0.035], coal);
  m.segment([0, 1.15, -0.14], [0, 1.15, -0.36], 0.06, 0.06, carrot);
  for (const side of [-1, 1]) m.segment([side * 0.2, 0.9, 0], [side * 0.48, 1.07, 0], 0.04, 0.04, coal);
  m.box([0, 1.02, 0], [0.36, 0.1, 0.36], scarf);
  m.box([0.14, 0.93, -0.15], [0.09, 0.22, 0.06], scarf);
  m.cone([0, 1.33, 0], 0.22, 0.34, red, 6);
  return m.build();
}

/**
 * The bike café in winter: the same building and terrace footprint as the
 * temperate one, re-skinned as a timber chalet with a snow roof. A fire pit
 * warms the terrace; a snowman and a sled stand beside the sign.
 */
export function buildWinterCafe({ terraceDepth = 7 } = {}) {
  const m = new MeshBuilder();
  const bright = new MeshBuilder();
  const w = 13;
  const d = 8;
  const h = 3.7;
  const wood = [0.48, 0.33, 0.22];
  const woodDark = TIMBER_DARK;
  const front = -d / 2;

  // Stone plinth and timber building.
  m.box([0, (1.0 - 1.5) / 2, 0], [w + 0.14, 1.0 + 1.5, d + 0.14], STONE);
  m.box([0, (1.0 + h) / 2, 0], [w, h - 1.0, d], wood);
  snowyRoof(m, w, d, h, 3.1, 0.9);

  // Glass front with mullions, and a door.
  bright.box([-1.0, 1.8, front - 0.05], [8.8, 1.9, 0.06], [0.98, 0.86, 0.58]);
  for (let x = -5.5; x <= 3.2; x += 2.15) m.box([x, 1.8, front - 0.09], [0.12, 2.0, 0.06], woodDark);
  m.box([-1.0, 0.86, front - 0.09], [8.8, 0.1, 0.06], woodDark);
  m.box([4.7, 1.35, front - 0.06], [1.2, 2.3, 0.08], woodDark);

  // Timber canopy over the front, carrying snow.
  m.box([0, h - 0.5, front - 0.95], [w, 0.14, 2.0], woodDark);
  m.box([0, h - 0.36, front - 1.0], [w + 0.1, 0.12, 2.1], SNOW);

  // Wooden terrace with a railing.
  const tz = front - terraceDepth / 2;
  m.box([0, -0.4, tz], [w + 1, 0.8 + 0.12, terraceDepth], wood);
  for (let x = -w / 2; x <= w / 2; x += 1.1) m.box([x, 0.07, tz], [0.04, 0.02, terraceDepth], woodDark);
  for (const x of [-w / 2 - 0.3, w / 2 + 0.3]) {
    for (let z = front - 0.6; z > front - terraceDepth; z -= 1.6) m.box([x, 0.55, z], [0.1, 1.0, 0.1], woodDark);
    m.box([x, 1.0, tz], [0.1, 0.1, terraceDepth - 0.4], SNOW);
  }

  // Two tables with chairs, and a fire pit glowing in the middle.
  [-4.4, -0.8].forEach((x, i) => {
    const z = tz - 0.3 + (i % 2) * 0.6;
    m.box([x, 0.74, z], [1.5, 0.08, 1.5], wood);
    m.box([x, 0.38, z], [0.18, 0.7, 0.18], woodDark);
    for (const [cx, cz] of [
      [0.95, 0],
      [-0.95, 0],
      [0, 0.95],
    ]) {
      m.box([x + cx, 0.47, z + cz], [0.42, 0.06, 0.42], wood);
      m.box([x + cx * 1.25, 0.75, z + cz * 1.25], [cx ? 0.06 : 0.42, 0.5, cz ? 0.06 : 0.42], wood);
      for (const [lx, lz] of [
        [-0.17, -0.17],
        [0.17, -0.17],
        [-0.17, 0.17],
        [0.17, 0.17],
      ]) {
        m.box([x + cx + lx, 0.24, z + cz + lz], [0.04, 0.46, 0.04], woodDark);
      }
    }
  });
  const pit = [2.6, tz - 0.5];
  m.cylinder([pit[0], 0.1, pit[1]], 0.78, 0.34, STONE, 8);
  bright.ellipsoid([pit[0], 0.36, pit[1]], [0.42, 0.14, 0.42], [1.0, 0.62, 0.22], 2, 6);

  // Bike rack beside the terrace with two road bikes.
  const rackX = w / 2 + 1.2;
  const rackZ = tz + 1.2;
  m.box([rackX + 1.3, 0.45, rackZ], [2.8, 0.06, 0.06], WINTER_PALETTE.metal);
  for (const x of [rackX, rackX + 2.6]) m.box([x, 0.22, rackZ], [0.06, 0.45, 0.06], WINTER_PALETTE.metal);
  const frames = [
    [0.85, 0.16, 0.14],
    [0.2, 0.42, 0.85],
  ];
  frames.forEach((frame, i) => {
    const x = rackX + 0.7 + i * 1.3;
    const rear = [x, 0.34, rackZ + 0.5];
    const frontWheel = [x, 0.34, rackZ - 0.5];
    m.wheel(rear, 0.34, 0.04, WINTER_PALETTE.black, 10);
    m.wheel(frontWheel, 0.34, 0.04, WINTER_PALETTE.black, 10);
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
    m.box([x, seat[1] + 0.05, seat[2] + 0.05], [0.1, 0.05, 0.26], WINTER_PALETTE.black);
    m.box([x, bars[1] + 0.05, bars[2] - 0.05], [0.42, 0.05, 0.06], WINTER_PALETTE.black);
  });

  // Sign on two posts at the roadside, under a cap of snow, and the snowman.
  const sx = -w / 2 - 1.2;
  const sz = front - terraceDepth - 0.6;
  for (const x of [sx - 0.8, sx + 0.8]) m.box([x, 1.2, sz], [0.1, 2.4, 0.1], woodDark);
  bright.box([sx, 2.15, sz - 0.06], [2.2, 1.1, 0.06], [1.0, 0.48, 0.1]);
  bright.box([sx - 0.15, 2.05, sz - 0.1], [0.55, 0.5, 0.03], WINTER_PALETTE.white);
  bright.box([sx + 0.22, 2.1, sz - 0.1], [0.18, 0.24, 0.03], WINTER_PALETTE.white);
  m.box([sx, 2.15, sz + 0.02], [2.2, 1.1, 0.06], woodDark);
  m.box([sx, 2.73, sz + 0.02], [2.3, 0.1, 0.16], SNOW);

  const snowman = [sx + 2.6, sz - 0.4];
  m.ellipsoid([snowman[0], 0.45, snowman[1]], [0.5, 0.45, 0.5], SNOW, 3, 7);
  m.ellipsoid([snowman[0], 1.12, snowman[1]], [0.36, 0.34, 0.36], SNOW, 3, 7);
  m.ellipsoid([snowman[0], 1.62, snowman[1]], [0.26, 0.25, 0.26], SNOW, 3, 7);
  m.box([snowman[0], 1.7, snowman[1] - 0.28], [0.08, 0.1, 0.14], [0.95, 0.45, 0.12]);
  m.box([snowman[0], 1.28, snowman[1]], [0.5, 0.08, 0.5], [0.75, 0.2, 0.15]);

  // A sled leaning against the terrace.
  const sledX = w / 2 + 1.0;
  const sledZ = tz + 2.2;
  m.box([sledX, 0.42, sledZ], [0.5, 0.08, 1.3], wood);
  for (const x of [-0.22, 0.22]) m.box([sledX + x, 0.3, sledZ], [0.06, 0.06, 1.3], WINTER_PALETTE.metal);

  return { mesh: m.build(), bright: bright.build(), footprint: { w: w + 6, d: d + terraceDepth } };
}

/** Every model a winter world needs; the gym is functional and stays identical. */
export const winterModels = Object.freeze({
  post: buildWinterPost,
  warning: buildWarningSign,
  villageSign: buildVillageSign,
  cafe: buildWinterCafe,
  gym: buildOutdoorGymModel,
  gymSign: GYM_SIGN,
});
