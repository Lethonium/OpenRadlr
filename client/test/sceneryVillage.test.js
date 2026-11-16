/**
 * A village laid out from a town kit (#117): street front, lane, square,
 * church and mill, in road coordinates and from the seed alone.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../public/js/view3d/noise.js";
import { VILLAGE, VILLAGE_ROLES, layVillage } from "../public/js/view3d/scenery/village.js";

/** A kit that holds every role, each a box of the given footprint. */
const SIZES = { houses: [9, 6], church: [6, 15], fountains: [6, 6], stalls: [3, 3], benches: [2, 1], lanterns: [1, 1], fences: [3, 0.3], hedges: [3, 1], carts: [3, 2], windmills: [4, 4], leafy: [3, 3] };
const pick = (role) => (SIZES[role] ? { role, width: SIZES[role][0], depth: SIZES[role][1] } : null);
const ZONE = { from: 0, to: 300, center: 150, edge: 10 };
const lay = (options = {}) => layVillage({ ...ZONE, random: seededRandom(7), pick, fits: () => true, ...options }).placed;
const of = (placed, role) => placed.filter((p) => p.role === role);

test("the same seed lays the same village", () => {
  assert.deepEqual(lay(), lay());
});

test("a village has a street front on both sides, a lane behind, a square and a windmill", () => {
  const placed = lay();
  const houses = of(placed, VILLAGE_ROLES.houses);
  for (const side of [-1, 1]) assert.ok(houses.filter((h) => Math.sign(h.s) === side).length >= 15, `side ${side}`);
  for (const role of ["fountains", "church", "stalls", "windmills", "fences"]) assert.ok(of(placed, VILLAGE_ROLES[role]).length > 0, role);
});

test("houses in a row stand apart and face the road, behind their front garden", () => {
  const front = of(lay(), VILLAGE_ROLES.houses).filter((h) => Math.abs(h.s) < 20);
  for (const side of [-1, 1]) {
    const row = front.filter((h) => Math.sign(h.s) === side).sort((a, b) => a.d - b.d);
    for (let i = 1; i < row.length; i += 1) assert.ok(row[i].d - row[i - 1].d >= 9 + VILLAGE.gap[0] - 1e-9, `houses at ${row[i - 1].d} and ${row[i].d} overlap`);
    for (const house of row) {
      assert.deepEqual(house.face, [0, -side]);
      assert.equal(Math.abs(house.s) - 3, ZONE.edge + VILLAGE.garden);
    }
  }
});

test("no house stands on the square, and the fountain and church are on it", () => {
  const placed = lay();
  const fountain = of(placed, VILLAGE_ROLES.fountains)[0];
  const side = Math.sign(fountain.s);
  const onSquare = of(placed, VILLAGE_ROLES.houses).filter((h) => Math.sign(h.s) === side && Math.abs(h.d - ZONE.center) < VILLAGE.squareHalf);
  assert.deepEqual(onSquare, []);
  const church = of(placed, VILLAGE_ROLES.church)[0];
  assert.equal(church.d, ZONE.center);
  assert.ok(Math.sign(church.s) === side && Math.abs(church.s) > Math.abs(fountain.s), "the church is behind the fountain");
});

test("the square is paved on the fountain's side, from the pavement to behind the stalls", () => {
  const { placed, square } = layVillage({ ...ZONE, random: seededRandom(7), pick, fits: () => true });
  const fountain = of(placed, VILLAGE_ROLES.fountains)[0];
  assert.equal(square.side, Math.sign(fountain.s));
  assert.equal(square.near, ZONE.edge);
  assert.ok(square.from < ZONE.center && square.to > ZONE.center);
  for (const stall of of(placed, VILLAGE_ROLES.stalls)) assert.ok(Math.abs(stall.s) < square.far, "the stalls stand on the paving");
});

test("a front fence leaves a gap at the door", () => {
  const placed = lay();
  const houses = of(placed, VILLAGE_ROLES.houses).filter((h) => Math.abs(h.s) < 20);
  const boundaries = placed.filter((p) => p.role === VILLAGE_ROLES.fences || p.role === VILLAGE_ROLES.hedges);
  for (const house of houses) {
    const atDoor = boundaries.filter((b) => Math.sign(b.s) === Math.sign(house.s) && Math.abs(b.d - house.d) < VILLAGE.panel / 2);
    assert.deepEqual(atDoor, [], `a fence across the door at ${house.d}`);
  }
  // The pack's panels run along their own z: turned to face along the road, they run beside it.
  for (const boundary of boundaries) assert.deepEqual(boundary.face, [1, 0]);
});

test("nothing is placed where it does not fit", () => {
  const fits = (d) => d < 100 || d > 200;
  const placed = lay({ fits });
  assert.deepEqual(placed.filter((p) => p.d >= 100 && p.d <= 200), []);
});

test("a kit with no buildings lays out nothing", () => {
  assert.deepEqual(lay({ pick: () => null }), []);
});
