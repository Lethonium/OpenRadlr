/**
 * A village laid out from a kit's buildings (#117).
 *
 * The procedural village is a row of boxes. With a town kit the village gets
 * what a village has: a street front of cottages behind their front gardens,
 * a second row along the lane behind, a square with a fountain, market stalls
 * and the church on its far side, and a windmill out past the last house.
 *
 * Everything here is in road coordinates, `d` metres along the road and `s`
 * metres to its right (negative: left), and every choice comes from the seeded
 * `random`, so the caller — which knows how to walk the road and where the
 * ground is — puts the same village in the same place on every client.
 * `fits(d, s, radius)` says whether something that wide may stand there: not
 * in a river, not on another road, not on a house already placed.
 */

/** The roles a village asks its kit for. */
export const VILLAGE_ROLES = Object.freeze({
  houses: "houses",
  church: "church",
  fountains: "fountains",
  stalls: "stalls",
  benches: "benches",
  lanterns: "lanterns",
  fences: "fences",
  hedges: "hedges",
  carts: "carts",
  windmills: "windmills",
  trees: "leafy",
});

/** Metres. A front garden, the gap between houses, the lane between the rows. */
export const VILLAGE = Object.freeze({
  garden: 3,
  gap: [2.5, 6],
  lane: 9,
  /** The square: how far it reaches along the road either side of its middle, and how deep. */
  squareHalf: 18,
  squareDepth: 34,
  /** A fence panel's length: one tile of the town kit. */
  panel: 3,
  /** How far past the village the windmill stands, along the road and out from it. */
  mill: [45, 50],
});

/**
 * The village's furniture, as placements.
 *
 * @param {{from: number, to: number, center: number, edge: number, random: () => number,
 *   pick: (role: string, random: () => number) => ({width: number, depth: number}|null),
 *   fits: (d: number, s: number, radius: number) => boolean}} options
 *   `edge` is the distance from the road's centre line to the back of its
 *   pavement; `pick` chooses a model of a role and says its footprint (width
 *   along the road, depth away from it), or null when the kit has none.
 * @returns {{placed: {role: string, item: object, d: number, s: number, face: [number, number], radius: number, of: object|null}[],
 *   square: {from: number, to: number, side: number, near: number, far: number}}}
 *   `square` is the paved ground of the square, along the road and out from
 *   it on its `side`. Each placement's `face` is the direction its front
 *   looks, as `[along, out]`; `of`
 *   is the house a fence or a garden tree belongs to, so a caller that has to
 *   drop a house (on the inside of a bend, where a row closes up) drops its
 *   garden with it.
 */
export function layVillage({ from, to, center, edge, random, pick, fits }) {
  const placed = [];
  const place = (role, item, d, s, face, radius, of = null) => {
    if (!fits(d, s, radius)) return null;
    const entry = { role, item, d, s, face, radius, of };
    placed.push(entry);
    return entry;
  };
  // The square opens on one side of the road; which one is the village's own.
  const squareSide = random() < 0.5 ? -1 : 1;
  const onSquare = (d, side) => side === squareSide && Math.abs(d - center) < VILLAGE.squareHalf + 4;

  for (const side of [-1, 1]) {
    // The street front, house after house behind its garden, door to the road.
    const front = row({ from, to, side, setback: edge + VILLAGE.garden, random, pick, skip: (d) => onSquare(d, side) });
    for (const house of front) {
      const entry = place(VILLAGE_ROLES.houses, house.item, house.d, side * house.s, [0, -side], house.radius);
      if (entry) fence(placed, { house, entry, side, edge, random, pick, fits });
    }
    // The lane behind, where a house stands in most plots but not all, with a
    // tree in its garden.
    const lane = edge + VILLAGE.garden + 10 + VILLAGE.lane;
    const back = row({ from: from + 8, to: to - 8, side, setback: lane, random, pick, skip: (d) => onSquare(d, side), sparse: 0.75 });
    for (const house of back) {
      const entry = place(VILLAGE_ROLES.houses, house.item, house.d, side * house.s, [0, -side], house.radius);
      if (!entry) continue;
      const tree = pick(VILLAGE_ROLES.trees, random);
      if (tree && random() < 0.7) place(VILLAGE_ROLES.trees, tree, house.d + (random() - 0.5) * house.width * 0.6, side * (house.s + house.depth / 2 + 5), [0, -side], 2, entry);
    }
  }

  square(placed, { center, edge: edge + 2, side: squareSide, random, pick, place });
  const paved = { from: center - VILLAGE.squareHalf, to: center + VILLAGE.squareHalf, side: squareSide, near: edge, far: edge + 2 + VILLAGE.squareDepth };

  // A windmill on the open ground past one end of the village.
  const mill = pick(VILLAGE_ROLES.windmills, random);
  if (mill) {
    const [past, out] = VILLAGE.mill;
    const end = random() < 0.5 ? from - past : to + past;
    place(VILLAGE_ROLES.windmills, mill, end, -squareSide * (edge + out), [0, squareSide], 10);
  }
  return { placed, square: paved };
}

/**
 * Houses packed along one side of the road: each as wide as its model, a gap
 * between, front face `setback` metres out. Where a house does not fit, the
 * plot moves on a little, the way a real street has a gap at a bank or a lane.
 */
function row({ from, to, side, setback, random, pick, skip, sparse = 1 }) {
  const out = [];
  let d = from + 6 + random() * 4;
  while (d < to - 6) {
    const item = pick(VILLAGE_ROLES.houses, random);
    if (!item) break;
    const { width, depth } = item;
    const middle = d + width / 2;
    if (middle + width / 2 > to - 4) break;
    const keep = !skip(middle) && random() < sparse;
    if (keep) out.push({ item, d: middle, s: setback + depth / 2, width, depth, radius: Math.max(width, depth) / 2, side });
    const [lo, hi] = VILLAGE.gap;
    d += width + lo + random() * (hi - lo);
  }
  return out;
}

/**
 * A front garden's boundary: fence panels or a hedge along the pavement, the
 * width of the house, with a gap for the path to the door.
 */
function fence(placed, { house, entry, side, edge, random, pick, fits }) {
  const role = random() < 0.6 ? VILLAGE_ROLES.fences : VILLAGE_ROLES.hedges;
  const item = pick(role, random);
  if (!item) return;
  const panels = Math.max(2, Math.round(house.width / VILLAGE.panel));
  const start = house.d - (panels * VILLAGE.panel) / 2 + VILLAGE.panel / 2;
  const s = side * (edge + 0.8);
  for (let i = 0; i < panels; i += 1) {
    const d = start + i * VILLAGE.panel;
    // The path to the door, in the middle.
    if (Math.abs(d - house.d) < VILLAGE.panel / 2) continue;
    // The pack's fence panel runs along its own z, so it faces along the road
    // to run beside it.
    if (fits(d, s, 0.5)) placed.push({ role, item, d, s, face: [1, 0], radius: 0.5, of: entry });
  }
}

/**
 * The square: a fountain in the middle, benches either side of it, market
 * stalls behind it, lanterns at its corners, a cart, and the church on its far
 * side with its tower to the square.
 */
function square(placed, { center, edge, side, random, pick, place }) {
  const out = (s) => side * (edge + s);
  const fountain = pick(VILLAGE_ROLES.fountains, random);
  if (fountain) place(VILLAGE_ROLES.fountains, fountain, center, out(12), [0, -side], 4);
  for (const along of [-1, 1]) {
    const bench = pick(VILLAGE_ROLES.benches, random);
    // The pack's benches and stalls are long along their own z: a bench beside
    // the fountain turns that across the road, a row of stalls along it.
    if (bench) place(VILLAGE_ROLES.benches, bench, center + along * 7, out(12), [0, -side], 1);
  }
  for (const along of [-10, 0, 10]) {
    const stall = pick(VILLAGE_ROLES.stalls, random);
    if (stall) place(VILLAGE_ROLES.stalls, stall, center + along, out(21), [1, 0], 2.5);
  }
  const cart = pick(VILLAGE_ROLES.carts, random);
  if (cart) place(VILLAGE_ROLES.carts, cart, center + 15, out(17), [1, 0], 1.5);
  for (const along of [-1, 1]) {
    for (const depth of [1, VILLAGE.squareDepth - 6]) {
      const lantern = pick(VILLAGE_ROLES.lanterns, random);
      if (lantern) place(VILLAGE_ROLES.lanterns, lantern, center + along * (VILLAGE.squareHalf - 1), out(depth), [0, -side], 0.5);
    }
  }
  const church = pick(VILLAGE_ROLES.church, random);
  if (church) place(VILLAGE_ROLES.church, church, center, out(VILLAGE.squareDepth - 4 + church.depth / 2), [0, -side], Math.max(church.width, church.depth) / 2);
}
