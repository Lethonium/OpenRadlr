/**
 * The plants of the island's regions (#117), in the low-poly style of the
 * temperate biome's trees and in real metres. Each draws at `[x, y, z]` with
 * `MeshBuilder` primitives; `far` draws a silhouette of at most 12 triangles
 * at the same size. Both passes consume the same random draws, so a plant is
 * the same plant at any distance. `colours.canopy` overrides the leaf colour.
 */

const TRUNK = [0.36, 0.27, 0.19];
const OLIVE_TRUNK = [0.42, 0.37, 0.3];
const OLIVE_LEAF = [0.52, 0.6, 0.45];
const PINE_LEAF = [0.2, 0.38, 0.2];
const ALMOND_LEAF = [0.45, 0.6, 0.3];
const WILLOW_LEAF = [0.5, 0.62, 0.32];
const LAVENDER = [0.58, 0.45, 0.78];
const LAVENDER_LEAF = [0.45, 0.55, 0.42];
const REED = [0.62, 0.56, 0.3];
const BROOM = [0.85, 0.75, 0.2];
const BROOM_LEAF = [0.35, 0.5, 0.25];
const FLOWERS = [[0.92, 0.85, 0.35], [0.9, 0.5, 0.55], [0.95, 0.95, 0.9], [0.55, 0.6, 0.9]];
const ALPINE = [[0.95, 0.9, 0.5], [0.7, 0.55, 0.9], [0.95, 0.95, 0.95]];
const GRASS = [0.4, 0.52, 0.25];
const SHRUB = [0.38, 0.46, 0.24];
const SHRUB_LIGHT = [0.5, 0.56, 0.3];
const WHEAT = [0.88, 0.74, 0.36];
const WHEAT_STALK = [0.74, 0.64, 0.3];

/** A flat two-triangle trunk for the far silhouettes. */
function trunkCard(mesh, x, y, z, height, width) {
  mesh.quad([x - width, y, z], [x + width, y, z], [x + width, y + height, z], [x - width, y + height, z], TRUNK);
}

const pick = (list, random) => list[Math.floor(random() * list.length)];
const lean = (random) => (random() - 0.5) * 0.5;

/** A thin vertical blade-like spike: one triangle. */
function spike(mesh, x, y, z, dx, dz, height, width, color) {
  mesh.triangle([x - dz * width, y, z + dx * width], [x + dz * width, y, z - dx * width], [x + dx * 0.3, y + height, z + dz * 0.3], color);
}

function umbrellaPine({ mesh, x, y, z, random, colours, far }) {
  const height = 10 + random() * 5;
  const leaf = colours.canopy ?? PINE_LEAF;
  // A stocky trunk to about two thirds of the height, then a wide flat crown
  // of two or three lobes that sits on its branches like a mushroom cap.
  const base = height * (0.6 + random() * 0.1);
  const crownHeight = (height - base) * 0.75;
  const radius = height * (0.42 + random() * 0.1);
  const rotation = random() * Math.PI;
  const bend = lean(random) * 1.4;
  const crownY = y + base + crownHeight * 0.6;
  if (far) {
    trunkCard(mesh, x, y, z, base, 0.45);
    mesh.ellipsoid([x + bend, crownY, z], [radius, crownHeight, radius], leaf, 2, 4, rotation);
    return;
  }
  const fork = [x + bend, y + base, z];
  mesh.segment([x, y, z], fork, 0.9, 0.65, TRUNK);
  const lobes = random() < 0.5 ? 2 : 3;
  const spread = random() * Math.PI;
  mesh.ellipsoid([fork[0], crownY, z], [radius * 0.8, crownHeight, radius * 0.8], leaf, 3, 8, rotation);
  for (let i = 0; i < lobes; i += 1) {
    const a = spread + (i / lobes) * Math.PI * 2;
    const r = radius * 0.5;
    const lx = fork[0] + Math.cos(a) * r;
    const lz = z + Math.sin(a) * r;
    const ly = crownY - crownHeight * (0.1 + random() * 0.25);
    mesh.segment(fork, [lx, ly - crownHeight * 0.5, lz], 0.3, 0.2, TRUNK);
    mesh.ellipsoid([lx, ly, lz], [radius * 0.55, crownHeight * 0.85, radius * 0.55], leaf, 2, 6, random() * Math.PI);
  }
}

function olive({ mesh, x, y, z, random, colours, far }) {
  const height = 5 + random() * 2;
  const leaf = colours.canopy ?? OLIVE_LEAF;
  const crown = height * (0.34 + random() * 0.08);
  const rotation = random() * Math.PI;
  const bendX = lean(random) * 1.6;
  const bendZ = lean(random) * 1.6;
  if (far) {
    trunkCard(mesh, x, y, z, height * 0.4, 0.3);
    mesh.ellipsoid([x + bendX, y + height * 0.68, z + bendZ], [crown, crown * 0.7, crown], leaf, 2, 5, rotation);
    return;
  }
  // A gnarled trunk: two leaning boxes that meet in a knot, then three clumps.
  const knot = [x + bendX * 0.5, y + height * 0.32, z + bendZ * 0.5];
  mesh.segment([x, y, z], knot, 0.7, 0.6, OLIVE_TRUNK);
  mesh.segment(knot, [x + bendX, y + height * 0.55, z + bendZ], 0.5, 0.45, OLIVE_TRUNK);
  const top = [x + bendX, y + height * 0.68, z + bendZ];
  mesh.ellipsoid(top, [crown, crown * 0.65, crown], leaf, 3, 7, rotation);
  mesh.ellipsoid([top[0] + crown * 0.5, top[1] - crown * 0.15, top[2] + crown * 0.3], [crown * 0.6, crown * 0.45, crown * 0.6], leaf, 2, 6, rotation + 1);
  mesh.ellipsoid([top[0] - crown * 0.45, top[1] - crown * 0.2, top[2] - crown * 0.35], [crown * 0.55, crown * 0.4, crown * 0.55], leaf, 2, 6, rotation + 2);
}

function almond({ mesh, x, y, z, random, colours, far }) {
  const height = 5 + random() * 2;
  const leaf = colours.canopy ?? ALMOND_LEAF;
  const crown = height * (0.38 + random() * 0.08);
  const rotation = random() * Math.PI;
  if (colours.bare) {
    // Under snow: a trunk and a few bare limbs, no crown. The draws above are
    // the same, so it stands where the leafy tree would.
    mesh.box([x, y + height * 0.25, z], [0.4, height * 0.5, 0.4], TRUNK);
    if (far) return;
    for (let i = 0; i < 4; i += 1) {
      const a = rotation + (i / 4) * Math.PI * 2;
      mesh.segment([x, y + height * 0.45, z], [x + Math.cos(a) * crown, y + height * (0.75 + 0.1 * (i % 2)), z + Math.sin(a) * crown], 0.2, 0.2, TRUNK);
    }
    return;
  }
  if (far) {
    trunkCard(mesh, x, y, z, height * 0.45, 0.25);
    mesh.ellipsoid([x, y + height * 0.7, z], [crown, crown * 0.8, crown], leaf, 2, 5, rotation);
    return;
  }
  mesh.box([x, y + height * 0.25, z], [0.4, height * 0.5, 0.4], TRUNK);
  mesh.ellipsoid([x, y + height * 0.7, z], [crown, crown * 0.8, crown], leaf, 4, 8, rotation);
  const dx = (random() - 0.5) * crown;
  const dz = (random() - 0.5) * crown;
  mesh.ellipsoid([x + dx, y + height * 0.9, z + dz], [crown * 0.65, crown * 0.55, crown * 0.65], leaf, 3, 7, random() * Math.PI);
  mesh.ellipsoid([x - dx, y + height * 0.62, z - dz], [crown * 0.6, crown * 0.5, crown * 0.6], leaf, 3, 7, random() * Math.PI);
}

function willow({ mesh, x, y, z, random, colours, far }) {
  const height = 10 + random() * 4;
  const leaf = colours.canopy ?? WILLOW_LEAF;
  const crown = height * (0.36 + random() * 0.06);
  const rotation = random() * Math.PI;
  const crownY = y + height * 0.72;
  if (far) {
    trunkCard(mesh, x, y, z, height * 0.5, 0.4);
    mesh.cone([x, y + height * 0.2, z], crown, height * 0.75, leaf, 4, rotation);
    return;
  }
  mesh.segment([x, y, z], [x + lean(random), y + height * 0.6, z], 0.7, 0.7, TRUNK);
  mesh.ellipsoid([x, crownY, z], [crown, crown * 0.55, crown], leaf, 3, 8, rotation);
  // Hanging fronds: long thin triangles from the crown's rim to near the ground.
  const fronds = 14;
  for (let i = 0; i < fronds; i += 1) {
    const a = rotation + (i / fronds) * Math.PI * 2;
    const rim = crown * (0.85 + random() * 0.15);
    const px = x + Math.cos(a) * rim;
    const pz = z + Math.sin(a) * rim;
    const len = height * (0.35 + random() * 0.2);
    const tx = -Math.sin(a) * 0.5;
    const tz = Math.cos(a) * 0.5;
    mesh.triangle([px - tx, crownY - crown * 0.1, pz - tz], [px + tx, crownY - crown * 0.1, pz + tz], [px * 0.98 + x * 0.02, crownY - len, pz * 0.98 + z * 0.02], leaf);
  }
}

function lavender({ mesh, x, y, z, random, far }) {
  const height = 0.5 + random() * 0.3;
  const rotation = random() * Math.PI;
  if (far) {
    mesh.ellipsoid([x, y + height * 0.4, z], [0.45, height * 0.45, 0.45], LAVENDER, 2, 5, rotation);
    return;
  }
  // Grey-green leaves at the foot, under a dome of purple flower heads with a
  // few spikes standing out of it, so a row reads as lavender from the saddle.
  mesh.ellipsoid([x, y + height * 0.2, z], [0.4, height * 0.24, 0.4], LAVENDER_LEAF, 2, 5, rotation);
  mesh.ellipsoid([x, y + height * 0.55, z], [0.42, height * 0.24, 0.42], LAVENDER, 2, 6, rotation + 0.3);
  for (let i = 0; i < 9; i += 1) {
    const a = rotation + (i / 9) * Math.PI * 2;
    const r = 0.12 + random() * 0.2;
    spike(mesh, x + Math.cos(a) * r, y + height * 0.2, z + Math.sin(a) * r, Math.cos(a) * 0.1, Math.sin(a) * 0.1, height * (0.75 + random() * 0.4), 0.04, LAVENDER);
  }
}

function wildflower({ mesh, x, y, z, random, colours, far }) {
  const color = pick(colours?.flowers ?? FLOWERS, random);
  const height = 0.35 + random() * 0.25;
  if (far) {
    mesh.triangle([x - 0.2, y, z], [x + 0.2, y, z], [x, y + height, z], color);
    return;
  }
  for (let i = 0; i < 4; i += 1) {
    const px = x + (random() - 0.5) * 0.5;
    const pz = z + (random() - 0.5) * 0.5;
    const h = height * (0.7 + random() * 0.5);
    spike(mesh, px, y, pz, lean(random), lean(random), h, 0.02, GRASS);
    mesh.ellipsoid([px, y + h, pz], [0.07, 0.04, 0.07], color, 2, 5, random() * Math.PI);
  }
}

function alpineFlower({ mesh, x, y, z, random, far }) {
  const color = pick(ALPINE, random);
  const height = 0.12 + random() * 0.1;
  if (far) {
    mesh.triangle([x - 0.12, y, z], [x + 0.12, y, z], [x, y + height, z], color);
    return;
  }
  for (let i = 0; i < 5; i += 1) {
    const px = x + (random() - 0.5) * 0.4;
    const pz = z + (random() - 0.5) * 0.4;
    spike(mesh, px, y, pz, lean(random) * 0.3, lean(random) * 0.3, height, 0.015, GRASS);
    mesh.ellipsoid([px, y + height, pz], [0.05, 0.03, 0.05], color, 2, 5, random() * Math.PI);
  }
}

function reeds({ mesh, x, y, z, random, far }) {
  const height = 1 + random() * 0.2;
  if (far) {
    mesh.triangle([x - 0.3, y, z], [x + 0.3, y, z], [x + 0.1, y + height, z], REED);
    mesh.triangle([x, y, z - 0.3], [x, y, z + 0.3], [x - 0.1, y + height, z], REED);
    return;
  }
  const stalks = 9;
  for (let i = 0; i < stalks; i += 1) {
    const a = (i / stalks) * Math.PI * 2 + random();
    const r = random() * 0.25;
    const h = height * (0.7 + random() * 0.4);
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    spike(mesh, px, y, pz, Math.cos(a) * 0.25, Math.sin(a) * 0.25, h, 0.03, REED);
    if (i % 3 === 0) mesh.ellipsoid([px + Math.cos(a) * 0.06, y + h, pz + Math.sin(a) * 0.06], [0.04, 0.12, 0.04], [0.45, 0.32, 0.2], 2, 4, 0);
  }
}

function broom({ mesh, x, y, z, random, far }) {
  const size = 0.6 + random() * 0.5;
  const rotation = random() * Math.PI;
  if (far) {
    mesh.ellipsoid([x, y + size * 0.4, z], [size, size * 0.5, size], BROOM_LEAF, 2, 5, rotation);
    return;
  }
  mesh.ellipsoid([x, y + size * 0.4, z], [size, size * 0.55, size], BROOM_LEAF, 2, 7, rotation);
  for (let i = 0; i < 4; i += 1) {
    const a = rotation + (i / 4) * Math.PI * 2;
    const r = size * (0.2 + random() * 0.5);
    mesh.ellipsoid([x + Math.cos(a) * r, y + size * (0.65 + random() * 0.2), z + Math.sin(a) * r], [0.12, 0.08, 0.12], BROOM, 2, 4, a);
  }
}

/** A tuft of grass blades: green or, with `colours.grass`, dry; a flat triangle far off. */
function grass({ mesh, x, y, z, random, colours, far }) {
  const color = colours?.grass ?? GRASS;
  const height = 0.3 + random() * 0.3;
  if (far) {
    mesh.triangle([x - 0.25, y, z], [x + 0.25, y, z], [x, y + height, z], color);
    return;
  }
  for (let i = 0; i < 7; i += 1) {
    const a = random() * Math.PI * 2;
    const r = random() * 0.22;
    spike(mesh, x + Math.cos(a) * r, y, z + Math.sin(a) * r, lean(random) * 0.8, lean(random) * 0.8, height * (0.6 + random() * 0.6), 0.035, color);
  }
}

/** A low rounded shrub in the dry green of the coast, a few small leaf clumps on it. */
function shrub({ mesh, x, y, z, random, colours, far }) {
  const size = 0.5 + random() * 0.5;
  const rotation = random() * Math.PI;
  const color = colours?.shrub ?? SHRUB;
  if (far) {
    mesh.ellipsoid([x, y + size * 0.3, z], [size, size * 0.5, size], color, 2, 5, rotation);
    return;
  }
  mesh.ellipsoid([x, y + size * 0.3, z], [size, size * 0.5, size], color, 2, 7, rotation);
  mesh.ellipsoid([x + size * 0.45, y + size * 0.25, z + size * 0.2], [size * 0.55, size * 0.35, size * 0.55], SHRUB_LIGHT, 2, 6, rotation + 1);
  mesh.ellipsoid([x - size * 0.4, y + size * 0.3, z - size * 0.3], [size * 0.5, size * 0.32, size * 0.5], color, 2, 6, rotation + 2);
}

/** A stand of ripe wheat: tall golden stalks, each topped with a small ear. */
function wheat({ mesh, x, y, z, random, far }) {
  const height = 0.8 + random() * 0.25;
  if (far) {
    mesh.triangle([x - 0.35, y, z], [x + 0.35, y, z], [x, y + height, z], WHEAT);
    return;
  }
  for (let i = 0; i < 7; i += 1) {
    const px = x + (random() - 0.5) * 0.6;
    const pz = z + (random() - 0.5) * 0.6;
    const h = height * (0.85 + random() * 0.3);
    spike(mesh, px, y, pz, lean(random) * 0.5, lean(random) * 0.5, h, 0.03, WHEAT_STALK);
    mesh.ellipsoid([px, y + h, pz], [0.04, 0.1, 0.04], WHEAT, 2, 3, 0);
  }
}

/** Plant builders by name: `({ mesh, x, y, z, random, colours, far })`. */
export const PLANTS = Object.freeze({
  umbrellaPine,
  olive,
  almond,
  willow,
  lavender,
  wildflower,
  alpineFlower,
  reeds,
  broom,
  grass,
  shrub,
  wheat,
});
