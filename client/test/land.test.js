/**
 * The land module (#117 follow-up): where the woods, fields and villages of a
 * map are, decided by the map seed and nothing else.
 *
 * These rules are shared — the world build, the server's copy of the world and
 * the tests all ask them the same questions — so a wood that grows on one
 * client grows in the same place on every other, at the same distance along
 * the road, and a village's houses stand on the same street.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { KIND, fieldAt, forestAt, kindAt, villageAt, villageLots, villageOn, villageShape } from "../public/js/land/land.js";

const SEED = 0x1234;
const AREA = 2000;

/** A grid of sample points over a square island, so a test can talk about areas. */
function* grid(step = 25) {
  for (let x = -AREA; x < AREA; x += step) {
    for (let z = -AREA; z < AREA; z += step) yield [x, z];
  }
}

test("a wood is a pure function of the map seed", () => {
  // Two clients, two builds, one island: the same seed grows the same wood.
  for (const [x, z] of [[0, 0], [512, -300], [-1200, 640]]) {
    assert.equal(forestAt(x, z, SEED), forestAt(x, z, SEED));
    assert.equal(kindAt(x, z, SEED), kindAt(x, z, SEED));
  }
});

test("a different seed grows a different island", () => {
  const differing = [...grid(50)].filter(([x, z]) => Math.abs(forestAt(x, z, SEED) - forestAt(x, z, SEED + 1)) > 0.05);
  assert.ok(differing.length > 100, `${differing.length} samples changed with the seed`);
});

test("there are real woods and real fields, not one even scatter", () => {
  // The point of the module: some large part of the island is dense wood and
  // another is open field. An even scatter would leave neither.
  let wood = 0;
  let field = 0;
  let total = 0;
  for (const [x, z] of grid()) {
    total += 1;
    const kind = kindAt(x, z, SEED);
    if (kind === KIND.forest) wood += 1;
    if (kind === KIND.field) field += 1;
  }
  assert.ok(wood / total > 0.2, `only ${((wood / total) * 100).toFixed(0)}% is wood`);
  assert.ok(field / total > 0.2, `only ${((field / total) * 100).toFixed(0)}% is field`);
  assert.ok(wood / total < 0.6, `${((wood / total) * 100).toFixed(0)}% is wood: the island has no open land`);
});

test("a wood has no holes of open land inside it", () => {
  // A wood you ride through should be a wood, not a polka dot: inside its
  // heart the density stays high, so trunks hide the country.
  for (const [x, z] of grid()) {
    if (forestAt(x, z, SEED) < 0.999) continue;
    for (const [dx, dz] of [[6, 0], [0, 6], [-8, -8]]) {
      assert.ok(forestAt(x + dx, z + dz, SEED) > 0.6, `open ground inside a wood at ${x + dx},${z + dz}`);
    }
  }
});

test("the wood thins out at its edge rather than stopping at a line", () => {
  let between = 0;
  for (const [x, z] of grid(10)) {
    const density = forestAt(x, z, SEED);
    if (density > 0.15 && density < 0.85) between += 1;
  }
  assert.ok(between > 200, `${between} samples on a wood's edge`);
});

test("a field is open ground, and only its far edge meets a wood", () => {
  // The field noise and the wood noise are independent, so where the two
  // cross the edge of a field may touch a wood. What must never happen is a
  // field whose *middle* is a wood: the two patches do not stand on each other.
  for (const [x, z] of grid()) {
    if (fieldAt(x, z, SEED) < 0.95) continue;
    assert.equal(kindAt(x, z, SEED), KIND.field, `a wood in the middle of a field at ${x},${z}`);
    if (fieldAt(x, z, SEED) > 0.95) assert.ok(forestAt(x, z, SEED) < 0.6, `deep wood inside the field at ${x},${z}`);
  }
});

test("a village's lots run along the road on both sides, with a green kept clear", () => {
  const stretch = { from: 1000, to: 1480 };
  const lots = villageLots(stretch);
  assert.ok(lots.length > 20, `${lots.length} lots in a 480 m village`);
  assert.ok(lots.every((lot) => lot.position > stretch.from && lot.position < stretch.to), "no lot outside the zone");
  assert.ok(lots.some((lot) => lot.side > 0) && lots.some((lot) => lot.side < 0), "houses on both sides");
  assert.ok(lots.some((lot) => lot.row > 0), "there is a lane behind the street");
  const { center } = villageShape(stretch);
  const square = lots.filter((lot) => lot.square);
  assert.ok(square.length > 0, "the village has a green");
  assert.ok(square.every((lot) => Math.abs(lot.position - center) < 30), "the green sits in the middle");
});

test("a lot the ground cannot hold a house on is left empty", () => {
  const stretch = { from: 0, to: 400 };
  const all = villageLots(stretch);
  // The river runs through the first half: no house there, the rest stands.
  const dry = villageLots(stretch, { buildable: (lot) => lot.position > 200 });
  assert.ok(dry.length < all.length);
  assert.ok(dry.every((lot) => lot.position > 200 || lot.square));
});

test("a village is laid out the same from the same stretch, lot for lot", () => {
  const stretch = { from: 900, to: 1300 };
  assert.deepEqual(villageLots(stretch), villageLots(stretch));
});

test("a village keeps its street clear and fades out beyond its edge", () => {
  const villages = [{ x: 0, z: 0, radius: 40 }];
  assert.equal(villageAt(0, 0, villages), 1);
  assert.ok(villageAt(35, 0, villages) > 0.3, "the edge still counts as village");
  assert.equal(villageAt(200, 0, villages), 0);
});

test("a village on the map points at the stretch of road it was laid along", () => {
  const stretch = { from: 500, to: 900 };
  const frameAt = (distance) => ({ center: [distance, 3, -distance / 2] });
  const village = villageOn(stretch, frameAt);
  assert.deepEqual([village.x, village.z], [700, -350], "its middle is the middle of the stretch");
  assert.ok(village.radius > 0);
  assert.equal(village.lots.length, villageLots(stretch).length);
});
