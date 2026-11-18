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

/** Landmark kinds by name. Tasks add the rest here. */
export const LANDMARKS = {
  lighthouse: { build: buildLighthouse },
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
