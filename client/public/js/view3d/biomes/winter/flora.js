/**
 * Winter's plants: snow-laden spruces, bare birches, drifts and a little dry
 * grass poking through. Same placements as every other season — only the
 * shapes change.
 */
import { PINE, ROCK, SNOW, SNOW_SHADE, TIMBER_DARK } from "./palette.js";

const BARK = [0.55, 0.54, 0.5];
const GRASS = Object.freeze([
  [0.64, 0.6, 0.46],
  [0.7, 0.66, 0.5],
  [0.58, 0.56, 0.44],
]);

/** A spruce: trunk, two or three dark tiers and a load of snow on the crown. */
function plantSpruce({ mesh, x, y, z, random }) {
  const height = 6 + random() * 7;
  const color = PINE;
  mesh.box([x, y + height * 0.12, z], [0.4, height * 0.24, 0.4], TIMBER_DARK);
  const tiers = random() < 0.5 ? 2 : 3;
  let lastBase = y;
  let lastRadius = 0;
  for (let t = 0; t < tiers; t += 1) {
    const base = y + height * (0.16 + t * 0.22);
    const radius = height * (0.3 - t * 0.07);
    mesh.cone([x, base, z], radius, height * (0.5 - t * 0.08), color, 7, random() * Math.PI);
    lastBase = base;
    lastRadius = radius;
  }
  // Snow sits on the upper half of the top tier.
  mesh.cone([x, lastBase + height * 0.14, z], lastRadius * 0.7, height * 0.3, SNOW, 7, random() * Math.PI);
  mesh.disc([x, y + 0.05, z], [height * 0.15, height * 0.15], SNOW_SHADE, 6, random() * Math.PI);
}

/** A birch without leaves: pale trunk, two dark limbs and snow on the crown. */
function plantBirch({ mesh, x, y, z, random }) {
  const height = 5 + random() * 4.5;
  const trunk = height * 0.7;
  mesh.box([x, y + trunk / 2, z], [0.24, trunk, 0.24], BARK);
  // Two limbs reach up into the snow crown, so the tree reads as one shape.
  for (let b = 0; b < 2; b += 1) {
    const angle = random() * Math.PI * 2;
    const start = [x, y + height * (0.42 + random() * 0.14), z];
    const length = height * (0.2 + random() * 0.1);
    const end = [start[0] + Math.cos(angle) * length, y + height * (0.7 + random() * 0.08), start[2] + Math.sin(angle) * length];
    mesh.segment(start, end, 0.06, 0.06, TIMBER_DARK);
  }
  mesh.ellipsoid([x, y + height * 0.76, z], [height * 0.1, height * 0.1, height * 0.1], SNOW, 2, 6, random() * Math.PI);
}

/** One tree, drift or rock at `[x, y, z]`; `kind` is the placement's random draw. */
export function plantTree({ mesh, x, y, z, kind, random }) {
  if (kind < 0.08) {
    const size = 0.8 + random() * 1.8;
    mesh.cone([x, y - 0.05, z], size, size * 0.55, ROCK, 6, random() * Math.PI);
  } else if (kind < 0.24) {
    const size = 1 + random() * 1.6;
    mesh.ellipsoid([x, y + size * 0.35, z], [size, size * 0.5, size], SNOW, 3, 7, random() * Math.PI);
  } else if (kind < 0.68) {
    plantSpruce({ mesh, x, y, z, random });
  } else {
    plantBirch({ mesh, x, y, z, random });
  }
}

/** Three thin, dry blades poking out of the snow. */
export function plantTuft({ mesh, x, y, z, random }) {
  const color = GRASS[Math.floor(random() * GRASS.length)];
  const height = 0.14 + random() * 0.2;
  const turn = random() * Math.PI;
  for (let blade = 0; blade < 3; blade += 1) {
    const angle = turn + (blade / 3) * Math.PI;
    const dx = Math.cos(angle) * 0.07;
    const dz = Math.sin(angle) * 0.07;
    mesh.triangle([x - dx, y, z - dz], [x + dx, y, z + dz], [x + (random() - 0.5) * 0.1, y + height, z + (random() - 0.5) * 0.1], color);
  }
}

/** Winter has no flowers; the density is zero and the placement is a no-op. */
export function plantFlower() {}
