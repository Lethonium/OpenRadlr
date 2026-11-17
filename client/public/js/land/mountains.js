/**
 * The high country (#117): the treeline, the bare rock above it, and the
 * permanent snow on the highest ground.
 *
 * The island's north massif rises to about 370 m above the sea. The first
 * scenery pass grew trees by the same rule everywhere, so the map painted a
 * wood over ground the 3D world left bare, and the peaks had no snow at all.
 * These rules are shared by the world build, the ground colour and the
 * top-down map, so all three agree on where a tree may stand and where the
 * mountain shows through.
 *
 * Pure and seeded nowhere: height and slope are the terrain's, not the
 * season's, so every client draws the same mountain.
 */

/** Metres above the sea where trees stop. Below the snow, above the fields. */
export const TREELINE = 205;
/**
 * Metres above the sea where permanent snow starts, with a soft edge. The
 * island's high plateau is broad, so a low line would paint the whole north
 * white like a second winter; 330 m keeps the snow on the highest peaks and
 * the top of the pass, with rock and alpine grass showing through.
 */
export const SNOWLINE = 330;
/** Gradient (rise over run) at which the ground is bare rock. */
export const ROCK_SLOPE = 0.62;

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Snow cover at a height, 0 on the lowland, 1 on the peaks. */
export function snowAt(height, water) {
  if (!Number.isFinite(water)) return 0;
  return smoothstep(SNOWLINE - 12, SNOWLINE + 26, height - water);
}

/** Gradient of the ground at a point, as rise over run. */
export function slopeAt(terrain, x, z, step = 6) {
  const dx = terrain.height(x + step, z) - terrain.height(x - step, z);
  const dz = terrain.height(x, z + step) - terrain.height(x, z - step);
  return Math.hypot(dx, dz) / (2 * step);
}

/** Whether a tree may stand here: below the treeline and off the bare rock. */
export function canGrowTree(height, water, slope) {
  if (!Number.isFinite(water)) return true;
  return height - water < TREELINE && slope < ROCK_SLOPE;
}
