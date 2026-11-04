/**
 * Winter's buildings and props. Each model keeps the footprint of its
 * temperate counterpart (so the layout, occupancy and camera never move) but
 * changes shape: steep snow-loaded roofs, balconies, timber, drifts.
 */
import { MeshBuilder } from "../../meshBuilder.js";
import { placement } from "../../math.js";
import {
  GYM_SIGN,
  buildOutdoorGymModel,
  buildTurbineTower,
  buildVillageSign,
  buildWarningSign,
  gableRoof,
  roofSlab,
} from "../../structures.js";
import { buildCaribou, buildPolarBear, buildWalrus } from "./animals.js";
import { SNOW, STONE, STONE_DARK, TIMBER, TIMBER_DARK, WINDOW, WINTER_PALETTE } from "./palette.js";

const IDENTITY = placement([0, 0, 0]);

/** A gable roof with a thick layer of snow lying on both slopes. */
function snowyRoof(m, w, d, h, rise, overhang = 0.6, roofColor = TIMBER_DARK) {
  gableRoof(m, w, d, h, rise, roofColor, WINTER_PALETTE.walls[0], overhang);
  const ridge = [0, h + rise + 0.13, 0];
  roofSlab(m, [0, h + 0.13, -(d / 2 + overhang)], ridge, w + 2 * overhang, 0.14, SNOW, [0, 1, -1]);
  roofSlab(m, [0, h + 0.13, d / 2 + overhang], ridge, w + 2 * overhang, 0.14, SNOW, [0, 1, 1]);
}

/**
 * A mountain chalet: stone base, timber upper floors, a steep snow-covered
 * roof and a balcony on the first floor.
 */
export function buildChalet({ w, d, floors, wall, roof, chimney = false }) {
  const m = new MeshBuilder();
  const h = floors * 2.8 + 0.3;
  const body = wall ?? WINTER_PALETTE.walls[0];
  const roofColor = roof ?? WINTER_PALETTE.roofs[0];

  // Stone plinth, then the timber body above it.
  m.box([0, (1.1 - 1.5) / 2, 0], [w + 0.14, 1.1 + 1.5, d + 0.14], STONE);
  m.box([0, (1.1 + h) / 2, 0], [w, h - 1.1, d], body);
  // Timber bands at the floor lines.
  for (let f = 1; f < floors; f += 1) m.box([0, 1.1 + f * 2.8, 0], [w + 0.05, 0.12, d + 0.05], TIMBER_DARK);

  snowyRoof(m, w, d, h, d * 0.58, 0.7, roofColor);

  // Windows on the road-facing wall and the back.
  const cols = Math.max(2, Math.floor((w - 1.5) / 2.3));
  for (let f = 0; f < floors; f += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = ((i + 0.5) / cols - 0.5) * (w - 1.3);
      const y = 2.0 + f * 2.8;
      m.box([x, y, -d / 2 - 0.04], [0.78, 1.0, 0.08], WINDOW);
      m.box([x, y, d / 2 + 0.04], [0.78, 1.0, 0.08], WINDOW);
    }
  }
  m.box([-w * 0.16, 1.05, -d / 2 - 0.06], [1.0, 1.9, 0.1], TIMBER_DARK);

  // Balcony along the front on the first floor.
  if (floors >= 2) {
    const by = 1.1 + 2.8;
    const bz = -d / 2 - 0.8;
    m.box([0, by, bz], [w * 0.9, 0.14, 1.6], TIMBER);
    for (let x = -w * 0.42; x <= w * 0.42 + 0.01; x += 0.75) m.box([x, by + 0.5, bz - 0.7], [0.06, 1.0, 0.06], TIMBER_DARK);
    m.box([0, by + 0.98, bz - 0.7], [w * 0.86, 0.08, 0.08], TIMBER_DARK);
    m.box([0, by + 1.04, bz - 0.7], [w * 0.88, 0.06, 0.14], SNOW); // snow on the rail
  }

  if (chimney) {
    const cx = -w * 0.25;
    const cz = d * 0.1;
    m.box([cx, h + d * 0.32, cz], [0.6, d * 0.6 + 0.9, 0.6], STONE_DARK);
    m.box([cx, h + d * 0.62 + 0.22, cz], [0.72, 0.14, 0.72], SNOW);
  }

  // A drift banked against the front wall.
  m.ellipsoid([w * 0.18, 0.08, -d / 2 - 0.5], [w * 0.3, 0.28, 0.55], SNOW, 3, 6);
  return m.build();
}

/** A chapel: stone nave with a snow roof, a low belfry and a snowy spire. */
export function buildChapel() {
  const m = new MeshBuilder();
  const w = 9;
  const d = 17;
  const h = 6.8;

  // Nave, modelled with its ridge along X and then turned to run away from the road.
  const nave = new MeshBuilder();
  nave.box([0, (h - 1.5) / 2, 0], [d, h + 1.5, w], STONE);
  snowyRoof(nave, d, w, h, 3.9, 0.5);
  for (let i = 0; i < 4; i += 1) {
    for (const side of [-1, 1]) nave.box([-5.4 + i * 3.6, 3.2, side * (w / 2 + 0.04)], [0.9, 2.2, 0.08], WINDOW);
  }
  m.append(nave.build(), placement([0, 0, 1], Math.PI / 2));

  // Stone tower with a timber belfry and a snow-covered spire at the front.
  const tz = 1 - d / 2 - 2.2;
  m.box([0, (11 - 1.5) / 2, tz], [4.6, 11 + 1.5, 4.6], STONE);
  m.box([0, 12.2, tz], [4.2, 2.4, 4.2], TIMBER_DARK);
  for (const [dx, dz] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    m.box([dx * 2.12, 12.2, tz + dz * 2.12], [dx ? 0.1 : 1.6, 1.6, dz ? 0.1 : 1.6], [0.08, 0.09, 0.11]);
  }
  m.cone([0, 13.4, tz], 3.5, 7, SNOW, 4, Math.PI / 4);
  m.box([0, 9.4, tz - 2.34], [1.6, 1.6, 0.08], WINTER_PALETTE.white);
  m.box([0, 9.6, tz - 2.4], [0.1, 0.65, 0.04], WINTER_PALETTE.black);
  m.box([0, 1.4, tz - 2.34], [1.5, 2.8, 0.12], TIMBER_DARK);
  m.ellipsoid([0, 0.08, tz - 2.7], [2.6, 0.3, 0.8], SNOW, 3, 6);
  return m.build();
}

/** A timber barn with plank walls, a steep snowy roof and a drift at the door. */
export function buildWinterBarn() {
  const m = new MeshBuilder();
  const w = 15;
  const d = 10;
  const h = 4.8;
  m.box([0, (h - 1.5) / 2, 0], [w, h + 1.5, d], TIMBER);
  for (let x = -w / 2 + 1; x < w / 2; x += 1.7) m.box([x, (h - 1.5) / 2, -d / 2 - 0.03], [0.09, h + 1.5, 0.06], TIMBER_DARK);
  snowyRoof(m, w, d, h, 4.9, 0.7);
  m.box([0, 1.9, -d / 2 - 0.05], [4.2, 3.8, 0.1], TIMBER_DARK);
  m.box([0, 1.9, -d / 2 - 0.1], [0.16, 3.8, 0.06], WINTER_PALETTE.white);
  m.box([0, 2.6, -d / 2 - 0.1], [4.2, 0.16, 0.06], WINTER_PALETTE.white);
  m.ellipsoid([0, 0.05, -d / 2 - 0.7], [3.2, 0.34, 0.9], SNOW, 3, 7);
  return m.build();
}

/** A silo under a cap of snow, with a little vent on top. */
export function buildWinterSilo() {
  const m = new MeshBuilder();
  m.cylinder([0, -1, 0], 2.3, 13, WINTER_PALETTE.silo, 12, 2.3, true);
  m.cone([0, 12, 0], 2.5, 2.4, SNOW, 12);
  m.box([0, 14.35, 0], [0.24, 0.4, 0.24], WINTER_PALETTE.metal);
  return m.build();
}

/** A stack of split logs under a cap of snow, with an axe left in the top log. */
export function buildWinterWoodpile() {
  const m = new MeshBuilder();
  const bark = [0.4, 0.29, 0.19];
  const barkShade = [0.32, 0.22, 0.15];
  const rows = [
    { y: 0.11, zs: [-0.45, 0, 0.45] },
    { y: 0.31, zs: [-0.22, 0.22] },
    { y: 0.51, zs: [-0.15, 0.15] },
  ];
  for (const [row, { y, zs }] of rows.entries()) {
    for (const [i, z] of zs.entries()) {
      m.wheel([0, y, z], 0.1, 1.35, (row + i) % 2 === 0 ? bark : barkShade, 6);
    }
  }
  m.ellipsoid([0, 0.66, 0], [0.72, 0.1, 0.5], SNOW, 2, 5); // snow on the top course
  // The axe, left standing in the top log.
  m.segment([0.35, 0.6, 0.15], [0.42, 0.95, 0.15], 0.05, 0.05, WINTER_PALETTE.pole);
  m.box([0.42, 0.93, 0.15], [0.18, 0.14, 0.05], WINTER_PALETTE.metal);
  return m.build();
}

/**
 * A village lantern: a tapered wooden post with an iron bracket and a lantern
 * that reads as one solid object — dark body, four warm panes, a dark rim and
 * a snow-covered roof. The panes are the glowing `head`.
 */
export function buildWinterLamp() {
  const pole = new MeshBuilder();
  const head = new MeshBuilder();
  const wood = [0.36, 0.25, 0.17];
  const iron = [0.18, 0.19, 0.21];
  const warm = [1.0, 0.86, 0.55];
  const height = 3.1;

  pole.cylinder([0, 0, 0], 0.1, height, wood, 6, 0.075);
  pole.cone([0, height - 0.01, 0], 0.11, 0.12, SNOW, 6); // snow on the post cap
  const z = -0.5;
  pole.segment([0, height - 0.2, 0], [0, height, z], 0.07, 0.07, iron); // bracket over the kerb
  pole.segment([0, height - 0.02, z], [0, height - 0.18, z], 0.035, 0.035, iron); // chain

  // The lantern body: dark shell, rim, base and snow roof all touch.
  const y = height - 0.55;
  pole.box([0, y, z], [0.34, 0.46, 0.34], iron);
  pole.box([0, y - 0.25, z], [0.4, 0.06, 0.4], iron);
  pole.box([0, y + 0.25, z], [0.44, 0.06, 0.44], iron);
  pole.cone([0, y + 0.29, z], 0.3, 0.2, SNOW, 4, Math.PI / 4);

  // Glowing panes just proud of the dark shell, one on each side.
  const p = 0.176;
  head.box([0, y + 0.02, z - p], [0.26, 0.3, 0.03], warm);
  head.box([0, y + 0.02, z + p], [0.26, 0.3, 0.03], warm);
  head.box([-p, y + 0.02, z], [0.03, 0.3, 0.26], warm);
  head.box([p, y + 0.02, z], [0.03, 0.3, 0.26], warm);
  return { pole: pole.build(), head: head.build() };
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

/** A wind turbine with snow on the nacelle. */
export function buildWinterTurbine(height = 62) {
  const m = new MeshBuilder();
  m.append(buildTurbineTower(height), IDENTITY);
  m.box([0.6, height + 2.56, 0], [6.8, 0.12, 2.5], SNOW);
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
  house: buildChalet,
  church: buildChapel,
  barn: buildWinterBarn,
  silo: buildWinterSilo,
  bale: buildWinterWoodpile,
  lamp: buildWinterLamp,
  post: buildWinterPost,
  warning: buildWarningSign,
  villageSign: buildVillageSign,
  animal1: buildCaribou,
  animal2: buildPolarBear,
  animal3: buildWalrus,
  cafe: buildWinterCafe,
  gym: buildOutdoorGymModel,
  gymSign: GYM_SIGN,
  turbine: buildWinterTurbine,
});
