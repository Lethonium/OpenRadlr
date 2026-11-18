/**
 * Landmarks (#117): a few hand-placed things the map names, each visible from
 * afar and anchoring a region. A landmark kind is one entry of `LANDMARKS`; it
 * builds a near mesh, a cheap far twin and optionally an emissive `bright`
 * mesh in its own frame (ground at y = 0), and `buildLandmarks` places them
 * into the village groups and reserves the apron before anything scatters.
 *
 * Runs in the world worker: no DOM, no clock. Moving parts are returned as
 * `movers` (data the view animates from its own clock), never baked in.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { placement } from "./math.js";
import { seededRandom } from "./noise.js";

const WHITE = [0.93, 0.92, 0.87];
const RED = [0.72, 0.16, 0.13];
const STONE = [0.62, 0.6, 0.56];
const IRON = [0.2, 0.2, 0.23];
const ROOF = [0.55, 0.14, 0.12];
const LAMP = [1, 0.88, 0.5];

/** Highest and lowest terrain under a round footprint, so a foot never floats. */
function footprint(terrain, [x, z], radius) {
  let low = Infinity;
  let high = -Infinity;
  const probes = [[0, 0]];
  for (let i = 0; i < 8; i += 1) probes.push([Math.cos((i / 8) * Math.PI * 2) * radius, Math.sin((i / 8) * Math.PI * 2) * radius]);
  for (const [dx, dz] of probes) {
    const h = terrain.height(x + dx, z + dz);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  return { low, high };
}

/** The lighthouse: a tapering white tower with red bands, gallery and a lit lantern. */
function buildLighthouse({ terrain, center }) {
  const { low, high } = footprint(terrain, center, 7);
  const at = [center[0], high, center[1]];
  const sink = high - low + 1.5;
  const tower = { base: 4.2, top: 2.7, height: 30 };
  const radiusAt = (y) => tower.base + (tower.top - tower.base) * (y / tower.height);
  // Bands bottom to top, as fractions of the tower: white, red, white, red.
  const bands = [[0, 0.25, WHITE], [0.25, 0.5, RED], [0.5, 0.75, WHITE], [0.75, 1, RED]];

  const near = new MeshBuilder();
  const far = new MeshBuilder();
  const bright = new MeshBuilder();

  // Stone foot reaching down into the slope.
  near.cylinder([0, -sink, 0], 6.2, sink + 1.2, STONE, 10, 5.2, true);
  for (const [from, to, color] of bands) {
    const y0 = from * tower.height;
    const y1 = to * tower.height;
    near.cylinder([0, y0, 0], radiusAt(y0), y1 - y0, color, 10, radiusAt(y1), false);
    far.cylinder([0, y0, 0], radiusAt(y0), y1 - y0, color, 6, radiusAt(y1), false);
  }
  // Gallery, lantern room, lamp and roof.
  const top = tower.height;
  near.cylinder([0, top, 0], 4.1, 0.5, IRON, 10, 4.1, true);
  near.cylinder([0, top + 0.5, 0], 2.5, 3.6, [0.55, 0.7, 0.75], 8, 2.3, false);
  bright.cylinder([0, top + 0.9, 0], 1.3, 2.4, LAMP, 8, 1.3, true);
  near.cone([0, top + 3.9, 0], 3, 2.6, ROOF, 8);
  near.cylinder([0, top + 6.4, 0], 0.15, 1.2, IRON, 4, 0.15, true);
  far.cone([0, top, 0], 3, 6.5, ROOF, 6);
  // The keeper's cottage beside the tower.
  const cx = 7;
  near.box([cx, 1.6, 0], [6, 3.2, 4.2], WHITE);
  near.cone([cx, 3.2, 0], 4.4, 2.2, ROOF, 4, Math.PI / 4);
  near.box([cx - 3.05, 1.2, 0], [0.12, 2.1, 1.2], IRON);

  const build = (b) => {
    const mesh = b.build();
    b.release();
    return mesh;
  };
  return { near: build(near), far: build(far), bright: build(bright), at };
}

const STONES = [[0.62, 0.6, 0.56], [0.68, 0.64, 0.55], [0.56, 0.54, 0.5]];
const DARK = [0.23, 0.22, 0.21];

const finish = (b) => {
  const mesh = b.build();
  b.release();
  return mesh;
};

/**
 * The castle ruin: a broken rectangular curtain wall with a gate and breaches,
 * stub towers at three corners and one tall round keep. Every wall slab is
 * founded on the ground under it, so the ring follows the crag's slope.
 */
function buildCastle({ terrain, center, yaw, random }) {
  const half = [22, 16];
  const { high } = footprint(terrain, center, 27);
  const at = [center[0], high, center[1]];
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // Ground height, relative to `at`, under a point of the castle's own frame.
  const groundAt = (x, z) => terrain.height(center[0] + cy * x + sy * z, center[1] - sy * x + cy * z) - high;

  const near = new MeshBuilder();
  const far = new MeshBuilder();
  const corners = [[-half[0], -half[1]], [half[0], -half[1]], [half[0], half[1]], [-half[0], half[1]]];
  const sides = [
    { a: corners[0], b: corners[1], runs: [[0, 0.35, 7], [0.35, 1, 5]] },
    { a: corners[1], b: corners[2], runs: [[0, 0.4, 6.5], [0.4, 0.55, 0], [0.55, 1, 3.5]] },
    { a: corners[3], b: corners[2], runs: [[0, 0.3, 6], [0.3, 0.45, 0], [0.45, 1, 7]] },
    { a: corners[0], b: corners[3], runs: [[0, 0.6, 5], [0.6, 0.8, 0], [0.8, 1, 4]] },
  ];
  const thick = 2.4;
  const slab = 3.2;
  const walls = [];
  let gaps = 0;
  let wallHeight = 0;
  for (const { a, b, runs } of sides) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    for (const [from, to, height] of runs) {
      if (height === 0) {
        gaps += 1;
        continue;
      }
      walls.push({ from: [a[0] + (b[0] - a[0]) * from, a[1] + (b[1] - a[1]) * from], to: [a[0] + (b[0] - a[0]) * to, a[1] + (b[1] - a[1]) * to], height });
      wallHeight = Math.max(wallHeight, height);
      const count = Math.max(1, Math.round(((to - from) * length) / slab));
      for (let i = 0; i < count; i += 1) {
        const f = from + ((i + 0.5) / count) * (to - from);
        const len = ((to - from) * length) / count;
        const x = a[0] + (b[0] - a[0]) * f;
        const z = a[1] + (b[1] - a[1]) * f;
        // The foot sits below the lowest ground under the slab; the top is ragged.
        const reach = [-0.5, 0, 0.5].map((k) => groundAt(x + (alongX ? k * len : 0), z + (alongX ? 0 : k * len)));
        const bottom = Math.min(...reach) - 1.2;
        const top = groundAt(x, z) + height * (0.65 + random() * 0.35);
        const size = alongX ? [len + 0.05, top - bottom, thick] : [thick, top - bottom, len + 0.05];
        near.box([x, (top + bottom) / 2, z], size, STONES[Math.floor(random() * STONES.length)]);
      }
    }
  }
  // Stub towers at three corners, the keep at the fourth.
  for (const [x, z] of [corners[0], corners[2], corners[3]]) {
    const bottom = groundAt(x, z) - 2;
    near.cylinder([x, bottom, z], 3.8, groundAt(x, z) + 7 + random() * 2 - bottom, STONES[0], 8, 3, true);
  }
  const [kx, kz] = corners[1];
  const towerHeight = 20;
  const keepTop = groundAt(kx, kz) + towerHeight;
  const keepBase = groundAt(kx, kz) - 2.5;
  near.cylinder([kx, keepBase, kz], 6, keepTop - keepBase, STONES[1], 12, 5, true);
  for (let i = 0; i < 12; i += 1) {
    if (i % 3 === 1) continue; // broken crenellation
    const angle = (i / 12) * Math.PI * 2;
    near.box([kx + Math.cos(angle) * 4.6, keepTop + 0.7, kz + Math.sin(angle) * 4.6], [1.5, 1.4, 1.5], STONES[2]);
  }
  for (const angle of [0.6, 2.4, 4.1]) {
    near.box([kx + Math.cos(angle) * 5.2, groundAt(kx, kz) + towerHeight * 0.65, kz + Math.sin(angle) * 5.2], [0.9, 2.2, 0.9], DARK);
  }

  // Far twin: three wall blocks and the keep, under 60 triangles.
  for (const { from, to, height } of [walls[0], walls[2], walls[5]]) {
    const x = (from[0] + to[0]) / 2;
    const z = (from[1] + to[1]) / 2;
    const bottom = Math.min(groundAt(from[0], from[1]), groundAt(to[0], to[1])) - 1.5;
    const size = [Math.abs(to[0] - from[0]) + thick, groundAt(x, z) + height * 0.8 - bottom, Math.abs(to[1] - from[1]) + thick];
    far.box([x, bottom + size[1] / 2, z], size, STONES[0]);
  }
  far.cylinder([kx, keepBase, kz], 6, keepTop - keepBase, STONES[1], 6, 5, true);

  return { near: finish(near), far: finish(far), at, walls, gaps, wallHeight, towerHeight, corners };
}

const LIMESTONE = [[0.95, 0.9, 0.8], [0.9, 0.85, 0.74], [0.97, 0.93, 0.84], [0.88, 0.82, 0.7]];
const OCHRE = [0.8, 0.62, 0.38];
const SUBMERGED = [0.5, 0.42, 0.3];

/**
 * A rock swept along `rings` (each `{ c: [x, y], n: [nx, ny], t, d }`: centre in
 * the arch's plane, outward normal, half thickness in that plane and half
 * depth across it). Every ring has the same rough section of `sides` points,
 * so the faces run as ridges along the rock; `rough` jitters each ring.
 */
function sweepRock(mesh, rings, { sides, random, rough = 0.08, tone }) {
  const shape = Array.from({ length: sides }, () => 0.82 + random() * 0.36);
  const sections = rings.map(({ c, n, t, d }) =>
    shape.map((r, k) => {
      const a = (k / sides) * Math.PI * 2;
      const s = r * (1 + (random() - 0.5) * 2 * rough);
      const across = Math.cos(a) * t * s;
      return [c[0] + n[0] * across, c[1] + n[1] * across, Math.sin(a) * d * s];
    }),
  );
  for (let i = 0; i + 1 < sections.length; i += 1) {
    const centre = [(rings[i].c[0] + rings[i + 1].c[0]) / 2, (rings[i].c[1] + rings[i + 1].c[1]) / 2, 0];
    for (let k = 0; k < sides; k += 1) {
      const a = sections[i][k];
      const b = sections[i][(k + 1) % sides];
      const c = sections[i + 1][(k + 1) % sides];
      const d = sections[i + 1][k];
      const mid = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
      const out = [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]];
      const color = tone(mid[1]);
      mesh.triangleFacing(a, b, c, color, out);
      mesh.triangleFacing(a, c, d, color, out);
    }
  }
}

/**
 * The rings of the arch: down each leg from the seabed to the water, then
 * over the top along a half ellipse. Legs flare towards the foot.
 */
function archRings({ reach, rise, foot, crown, depth, steps, seabed }) {
  const rings = [];
  const leg = (side) => {
    const x = side * reach;
    const bottom = seabed(x);
    const n = [side, 0];
    return [
      { c: [x, bottom], n, t: foot * 1.35, d: depth * 1.25 },
      { c: [x, bottom / 2], n, t: foot * 1.15, d: depth * 1.1 },
    ];
  };
  rings.push(...leg(-1));
  for (let i = 0; i <= steps; i += 1) {
    const theta = Math.PI * (1 - i / steps);
    const along = Math.sin(theta); // 0 at the feet, 1 at the crown
    const normal = [Math.cos(theta) / reach, Math.sin(theta) / rise];
    const length = Math.hypot(normal[0], normal[1]);
    rings.push({
      c: [reach * Math.cos(theta), rise * along],
      n: [normal[0] / length, normal[1] / length],
      t: foot + (crown - foot) * along,
      d: depth * (1 - 0.15 * along),
    });
  }
  rings.push(...leg(1).reverse());
  return rings;
}

/**
 * The sea arch (after Es Pontas): one heavy limestone body swept over a boat
 * sized hole, legs flaring into the sea, the rock darker ochre at the water
 * line, and a few broken boulders beside it. Local zero is the water line;
 * the legs run down to the seabed.
 */
function buildSeaArch({ terrain, center, yaw, water, random }) {
  const reach = 18; // from the middle to a leg's centre line
  const rise = 23; // the centre line's height over the water at the crown
  const foot = 8; // half a leg's thickness at the water
  const crown = 7; // half the deck's thickness
  const depth = 10;
  const span = 2 * (reach + foot);
  const at = [center[0], water, center[1]];
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const seabed = (x) => Math.min(-6, Math.max(-45, terrain.height(center[0] + cy * x, center[1] - sy * x) - water - 1.5));
  const pale = () => LIMESTONE[Math.floor(random() * LIMESTONE.length)];
  const tone = (y) => (y < -3 ? SUBMERGED : y < 1.5 ? OCHRE : pale());

  const near = new MeshBuilder();
  sweepRock(near, archRings({ reach, rise, foot, crown, depth, steps: 12, seabed }), { sides: 7, random, tone });
  // Broken boulders in the water to the sides.
  for (const [x, z, size] of [[-span / 2 - 14, -9, 6], [span / 2 + 17, 11, 8], [span / 2 + 9, -14, 3.5]]) {
    near.ellipsoid([x, size * 0.25, z], [size, size * 0.9, size * 0.8], pale(), 3, 6, random() * Math.PI);
    near.ellipsoid([x, -0.6, z], [size * 1.15, 1.6, size * 0.95], OCHRE, 2, 6, random() * Math.PI);
  }

  const far = new MeshBuilder();
  sweepRock(far, archRings({ reach, rise, foot, crown, depth, steps: 4, seabed }).filter((_, i, all) => i !== 1 && i !== all.length - 2), { sides: 4, random, rough: 0, tone: () => LIMESTONE[0] });
  return { near: finish(near), far: finish(far), at, span };
}

/** Landmark kinds by name. Tasks add the rest here. */
export const LANDMARKS = {
  lighthouse: { build: buildLighthouse },
  castle: { build: buildCastle },
  seaArch: { build: buildSeaArch },
};

/**
 * Places every landmark of the map. Each reserves its apron in `occupancy`
 * so trees, cover, props and houses keep clear.
 * @returns {{movers: object[]}}
 */
export function buildLandmarks(list, { terrain, near, far = null, bright = null, occupancy = null, water = -Infinity } = {}) {
  const movers = [];
  for (const landmark of list ?? []) {
    const kind = LANDMARKS[landmark.kind];
    if (!kind) continue;
    const [x, z] = landmark.center;
    const yaw = Number(landmark.yaw ?? 0);
    const random = seededRandom(hashOf(landmark.id ?? landmark.kind));
    const built = kind.build({ terrain, center: landmark.center, yaw, water, random });
    occupancy?.add(x, z, landmark.apron ?? 25);
    const matrix = placement(built.at, yaw);
    near.append(built.near, matrix);
    if (far && built.far) far.append(built.far, matrix);
    if (bright && built.bright) bright.append(built.bright, matrix);
    for (const mover of built.movers ?? []) movers.push(mover);
  }
  return { movers };
}

function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
