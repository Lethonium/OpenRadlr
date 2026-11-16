/**
 * What the land is for, across a whole map: where the forests stand, where the
 * fields are, and where a village has grown up (#117 follow-up).
 *
 * The island used to be one even scatter — trees thinned by a noise field, a
 * single village rowed along the road. That reads as "trees on grass". This
 * decides instead that some places are *woods* (dense, trees close together,
 * riding through them you cannot see out), some are *fields* (open, mown, with
 * only a hedge or a lone tree at the edge), and some are *villages* (built up,
 * with their own streets, a square and trees in the gardens).
 *
 * Everything here is a pure function of the map seed, no randomness that is
 * not seeded and no clock: every client builds the same island, and the server
 * — which copies these rules to keep bots and physics in step — can ask the
 * same questions and get the same answers.
 *
 * Units are metres in the world's own coordinates (x, z).
 */
import { fbm, valueNoise } from "../view3d/noise.js";

/** The kinds of ground this land knows. */
export const KIND = Object.freeze({
  /** Dense woodland: tall trees close together, almost no undergrowth to see past. */
  forest: "forest",
  /** Open farmland: grass, crops, the occasional hedge and a lone tree. */
  field: "field",
  /** Built up: a cluster of houses with lanes and a square. */
  village: "village",
  /** Meadows, verges, everywhere else: grass and the odd tree. */
  open: "open",
});

/**
 * How large the patches are, in metres. Woods at ~720 m and fields at ~340 m
 * give regions of half a kilometre and more across: a rider spends a minute
 * or two inside a wood instead of crossing it in ten seconds, and the island
 * has a handful of real woods and fields rather than a mottled quilt.
 */
const WOOD_SCALE = 720;
const FIELD_SCALE = 210;

/**
 * Where each field's noise has to pass to be a wood, or a field. Tuned over
 * four islands so that roughly a third is wooded, a third farmed and a third
 * open meadow, with the road passing through all of them.
 */
const WOOD_EDGE = 0.5;
const FIELD_EDGE = 0.49;

/**
 * The woodland density at a point, 0 (no wood) to 1 (deep inside one), with a
 * soft edge about 20 m wide so a wood thins out rather than stopping at a line.
 */
export function forestAt(x, z, seed) {
  // Two octaves at different sizes stop the woods from looking like blobs.
  const broad = fbm(x / WOOD_SCALE, z / WOOD_SCALE, seed + 0x50f3, 2);
  const fine = valueNoise(x / 90, z / 90, seed + 0x50f4) * 0.08;
  return smoothstep(WOOD_EDGE, WOOD_EDGE + 0.16, broad + fine);
}

/**
 * The farmland at a point, 0 to 1, from its own noise field so that fields are
 * their own shape: parcels of a few hundred metres, the way fields are, and
 * not just whatever ground the woods left bare. Where a wood stands the field
 * is pushed away, so the two never occupy the same spot.
 */
export function fieldAt(x, z, seed) {
  const broad = fbm(x / FIELD_SCALE, z / FIELD_SCALE, seed + 0x9c31, 3);
  const fine = valueNoise(x / 70, z / 70, seed + 0x9c32) * 0.12;
  // A wood is not farmed: the field fades out as the woods come in.
  const woods = forestAt(x, z, seed);
  return smoothstep(FIELD_EDGE, FIELD_EDGE + 0.16, broad + fine) * (1 - woods * 0.9);
}

/**
 * What kind of ground a point is.
 *
 * A wood wins over a field where the two cross, because a wood is the stronger
 * statement; a field wins over open land for the same reason. Villages are not
 * decided here — they are placed along the road, by `villageLots`, and the
 * world asks about them separately.
 */
export function kindAt(x, z, seed) {
  const forest = forestAt(x, z, seed);
  const field = fieldAt(x, z, seed);
  // The stronger claim wins: a wood over a field, a field over open land.
  if (forest > 0.5) return KIND.forest;
  if (field > 0.5) return KIND.field;
  return KIND.open;
}

/**
 * How far inside a wood a point is, as metres on the road to its heart: enough
 * to know whether a rider could see out from here. Deep wood is > 60 m in; the
 * view can then skip the far country, since nobody sees past the trunks.
 */
export function woodiness(x, z, seed) {
  return forestAt(x, z, seed);
}

/**
 * How many trees to draw at a point, against the open-land rate.
 *
 * Woods are dense (four times the scatter, so there is no ground showing
 * between trunks), fields are mown (a fifth, and none in the middle of a
 * harvested one), open land keeps the rate it had. This is the number that
 * decides whether a rider sees "a wood" or "trees on grass".
 */
export function treeFactor(x, z, seed) {
  const forest = forestAt(x, z, seed);
  const field = fieldAt(x, z, seed);
  // Dense in the wood: quadratic so the edge thins out gently and the heart is solid.
  const wood = 1 + 3.2 * forest * forest;
  // Mown in the field, with a hedge line kept round the edge of it.
  const mown = 1 - 0.85 * field;
  return wood * mown;
}

/**
 * Village centres along a road: the clusters of houses the world builds,
 * placed on the map rather than per view.
 *
 * A village sits at a stretch of the road given by the route's zones (the same
 * `{from, to}` the world has always had), but its *shape* is decided here: a
 * rough radius, and where its square sits, so that houses — and the lanes
 * between them — fall in the same places on every client. The square is a
 * quiet patch of ground beside the road, roughly in the middle of the stretch.
 *
 * @param {{from: number, to: number}} stretch a village zone, in metres along the road
 * @returns {{center: number, radius: number}} `center` is the middle of the
 *   stretch, in metres along the road; `radius` how far the lanes reach.
 */
export function villageShape(stretch) {
  const length = Math.max(50, stretch.to - stretch.from);
  const center = (stretch.from + stretch.to) / 2;
  // Grown villages are long and a few houses deep, not sprawling: this is the
  // distance from the road that the lanes reach.
  const radius = Math.min(70, 28 + length * 0.06);
  return { center, radius };
}

/**
 * The lots of a village, laid out as short rows of houses on both sides of
 * the road around a square: the street frontage, then a lane behind it, then
 * a garden row.
 *
 * A lot is a place on the road and a distance to its side — `position` metres
 * along the road, `side` metres to the right (or left, when negative) of its
 * centre line — so the caller, which knows how to walk the road, puts the
 * house on the ground. `buildable(lot)` decides whether the ground there
 * forgives a house (it may be a river bank, or the foot of a hill); those
 * lots are left empty, the way a real street has gaps. Everything else keeps
 * its place, so a village is laid out the same on every client.
 *
 * @returns {{position: number, side: number, row: number, lot: number, square: boolean}[]}
 *   `square` marks the lots that ring the village green: they stay empty, and
 *   the caller may put a bench or a tree there.
 */
export function villageLots(stretch, { spacing = 15, setbacks = [9.5, 21, 31], buildable = () => true } = {}) {
  const { center } = villageShape(stretch);
  // The stretch decides the length along the road.
  const reach = Math.max(34, (stretch.to - stretch.from) / 2);
  // The green is a short stretch in the middle where both sides stay clear.
  const squareHalf = 17;
  const lots = [];
  let lot = 0;
  for (const sign of [-1, 1]) {
    for (let row = 0; row < setbacks.length; row += 1) {
      // The first row fronts the street the whole length; the rows behind it
      // are shorter, so the village ends in a point rather than a wall.
      const rowReach = row === 0 ? reach : reach * (1 - row * 0.16);
      // Rows alternate their start, so a house in the lane behind is not
      // directly behind the one in front.
      const stagger = (row % 2) * spacing * 0.5;
      for (let offset = -rowReach + stagger; offset < rowReach; offset += spacing) {
        const position = center + offset;
        if (position <= stretch.from + 6 || position >= stretch.to - 6) continue;
        const square = row < 2 && Math.abs(offset) < squareHalf + (row === 0 ? 0 : 6);
        const candidate = { position, side: sign * setbacks[row], row, lot, square };
        lot += 1;
        if (square) {
          lots.push(candidate);
          continue;
        }
        if (buildable(candidate)) lots.push(candidate);
      }
    }
  }
  return lots;
}

/**
 * Where a village stands on the map, in the world's own x/z, for the scenery
 * to keep clear: its houses come from `villageLots`, which works in metres
 * along the road, and this takes the road walker the caller already has.
 *
 * `frameAt(position)` returns the road frame at a distance along it, so this
 * stays free of the world's geometry and can run on either side of the wire.
 *
 * @returns {{x: number, z: number, radius: number, lots: object[]}}
 */
export function villageOn(stretch, frameAt) {
  const { center, radius } = villageShape(stretch);
  const frame = frameAt(center);
  return { x: frame.center[0], z: frame.center[2], radius, lots: villageLots(stretch) };
}

/**
 * Whether a point is inside a village, and how central it is: villages keep
 * trees out of the street and the square, but their gardens are full of them.
 *
 * @returns {number} 0 outside, 1 in the middle; the soft edge matches the
 *   radius the village was built with.
 */
export function villageAt(x, z, villages) {
  let most = 0;
  for (const v of villages) {
    const distance = Math.hypot(x - v.x, z - v.z);
    const inside = smoothstep(v.radius + 20, v.radius - 10, distance);
    if (inside > most) most = inside;
  }
  return most;
}

/** The standard smoothstep, clamped so noise edges fade rather than snap. */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
