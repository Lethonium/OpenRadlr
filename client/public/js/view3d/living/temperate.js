/** Temperate's Living look: what its fields, moors and beaches are coloured like. */
/** A flat-lit tuft blade: seen from above it should read as grass, not as a black spike. */
function plantLivingTuft({ mesh, x, y, z, random }) {
  const color = TUFT_COLORS[Math.floor(random() * TUFT_COLORS.length)];
  const height = 0.3 + random() * 0.4;
  const turn = random() * Math.PI;
  for (let blade = 0; blade < 3; blade += 1) {
    const angle = turn + (blade / 3) * Math.PI;
    const dx = Math.cos(angle) * 0.12;
    const dz = Math.sin(angle) * 0.12;
    mesh.triangleLit([x - dx, y, z - dz], [x + dx, y, z + dz], [x + (random() - 0.5) * 0.2, y + height, z + (random() - 0.5) * 0.2], color, UP);
  }
}

/** A wildflower: bigger heads than plain 3D's, so the verges show colour. */
function plantLivingFlower({ mesh, x, y, z, random }) {
  const height = 0.35 + random() * 0.3;
  const top = [x, y + height, z];
  mesh.triangleLit([x - 0.02, y, z], [x + 0.02, y, z], top, TUFT_COLORS[0], UP);
  const color = FLOWER_COLORS[Math.floor(random() * FLOWER_COLORS.length)];
  const r = 0.09 + random() * 0.06;
  mesh.ellipsoid(top, [r, r * 0.6, r], color, 2, 5, random() * Math.PI);
}

const UP = Object.freeze([0, 1, 0]);
const TUFT_COLORS = Object.freeze([
  [0.32, 0.56, 0.22],
  [0.4, 0.62, 0.24],
  [0.48, 0.66, 0.26],
]);
const FLOWER_COLORS = Object.freeze([
  [0.95, 0.85, 0.2],
  [0.92, 0.42, 0.62],
  [0.62, 0.48, 0.92],
  [0.95, 0.95, 0.9],
]);

export const temperateLiving = Object.freeze({
  /** Vertex budgets on the valley map, the levers if Living is too heavy. */
  budgets: Object.freeze({ woods: 400_000, hedges: 400_000, props: 200_000, orchards: 80_000, fences: 60_000, coast: 80_000 }),
  flora: Object.freeze({ tuft: plantLivingTuft, flower: plantLivingFlower }),
  hedge: Object.freeze([
    [0.24, 0.4, 0.18],
    [0.2, 0.36, 0.17],
    [0.29, 0.44, 0.19],
  ]),
  wall: Object.freeze([
    [0.56, 0.55, 0.5],
    [0.5, 0.49, 0.45],
  ]),
  woodland: Object.freeze([
    [0.15, 0.33, 0.17],
    [0.2, 0.39, 0.18],
    [0.12, 0.28, 0.16],
    [0.27, 0.44, 0.2],
  ]),
  orchard: Object.freeze([
    [0.33, 0.52, 0.2],
    [0.4, 0.58, 0.22],
  ]),
  fruit: Object.freeze([0.85, 0.25, 0.18]),
  wood: Object.freeze([0.42, 0.3, 0.2]),
  woodLight: Object.freeze([0.62, 0.46, 0.28]),
  paint: Object.freeze([
    [0.8, 0.26, 0.22],
    [0.22, 0.46, 0.72],
    [0.88, 0.7, 0.2],
    [0.28, 0.58, 0.38],
  ]),
  crops: Object.freeze({
    meadow: [0.42, 0.62, 0.27],
    pasture: [0.34, 0.54, 0.24],
    wheat: [0.82, 0.69, 0.33],
    rapeseed: [0.92, 0.82, 0.18],
    ploughed: [0.45, 0.34, 0.24],
    hay: [0.74, 0.7, 0.38],
    lavender: [0.54, 0.44, 0.7],
    sunflower: [0.9, 0.72, 0.16],
    woods: [0.17, 0.32, 0.17],
    woodsDeep: [0.11, 0.24, 0.13],
    garden: [
      [0.38, 0.5, 0.26],
      [0.5, 0.4, 0.3],
      [0.6, 0.58, 0.3],
      [0.32, 0.56, 0.32],
    ],
    river: [0.32, 0.58, 0.28],
    rough: [0.46, 0.53, 0.3],
    moor: [0.52, 0.36, 0.5],
    moorHeath: [0.44, 0.5, 0.28],
    scree: [0.54, 0.52, 0.5],
    rock: [0.48, 0.47, 0.45],
    sand: [0.86, 0.79, 0.59],
    wetSand: [0.69, 0.61, 0.44],
    dunes: [0.6, 0.65, 0.4],
    track: [0.76, 0.7, 0.56],
    edge: [0.26, 0.36, 0.18],
  }),
});
