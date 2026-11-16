/**
 * The village kit's assembler (#117): Kenney's town kit is a tile grid, and a
 * house is its parts laid out tile by tile. These pin the conventions that
 * make the walls meet and the door face the road.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PARTS, ROOFS, TILE, WALLS, building, cottage, farTwin, modelOf, put, recoloured } from "../../tools/scenery/assemble.mjs";

const PACK_WALL = [0.77, 0.81, 0.97];
const PACK_ROOF = [0.4, 0.78, 0.7];
const TIMBER = [0.84, 0.56, 0.42];
const DOOR = [0.5, 0.2, 0.1];

/** A wall panel the way the pack has one: a slab on the +x edge of its tile, one storey high. */
const panel = (colour) => [
  [0.4, 0, -0.5, ...colour],
  [0.5, 0, 0.5, ...colour],
  [0.5, 1, 0, ...colour],
];

/** Every part the assembler asks for, as a stand-in: walls on the tile edge, a door marked by its colour. */
function fakeParts() {
  const parts = {};
  for (const name of PARTS) parts[name] = panel(name.startsWith("roof") ? PACK_ROOF : PACK_WALL);
  for (const name of ["wall-door", "wall-wood-door"]) parts[name] = panel(DOOR);
  parts.chimney = panel(TIMBER);
  return parts;
}

const doorCorners = (tris) => tris.filter((t) => t[3] === DOOR[0] && t[4] === DOOR[1] && t[5] === DOOR[2]);

test("put turns a part a quarter at a time, +x to -z", () => {
  const out = [];
  put(out, [[1, 0, 0, ...TIMBER]], [10, 2, 0], 1);
  assert.deepEqual(out[0].slice(0, 3), [10, 2, -1]);
});

test("a cottage's door faces -z, the side placement turns to the road", () => {
  for (const gable of [false, true]) {
    const tris = cottage(fakeParts(), { length: 3, gable });
    const minZ = Math.min(...tris.map((t) => t[2]));
    const door = doorCorners(tris);
    assert.ok(door.length > 0, "the cottage has a door");
    for (const corner of door) assert.ok(corner[2] < minZ + 0.11, `gable ${gable}: door at z ${corner[2]}, front at ${minZ}`);
  }
});

test("a cottage is two tiles deep and as long as asked, with eaves to the street", () => {
  // The walls, not the chimney or the roof's overhang, are the footprint.
  const walls = cottage(fakeParts(), { length: 3, wall: WALLS.cream }).filter((t) => t.slice(3).join() === WALLS.cream.join());
  const span = (axis) => Math.max(...walls.map((t) => t[axis])) - Math.min(...walls.map((t) => t[axis]));
  assert.equal(span(0), 3);
  assert.equal(span(2), 2);
});

test("each storey adds a tile of height under the roof", () => {
  const one = modelOf("c", cottage(fakeParts(), { floors: 1 }));
  const two = modelOf("c", cottage(fakeParts(), { floors: 2 }));
  assert.equal(two.bounds.max[1] - one.bounds.max[1], TILE);
});

test("the pack's roof and wall colours take the building's own; timber keeps its colour", () => {
  const out = recoloured([[0, 0, 0, ...PACK_ROOF], [0, 0, 0, ...PACK_WALL], [0, 0, 0, ...TIMBER]], { roof: ROOFS.slate, wall: WALLS.ochre });
  assert.deepEqual(out.map((t) => t.slice(3)), [ROOFS.slate, WALLS.ochre, TIMBER]);
});

test("a model stands on the ground, centred on its footprint", () => {
  const model = modelOf("c", [[2, 1, 4, ...TIMBER], [4, 3, 6, ...TIMBER], [3, 2, 5, ...TIMBER]]);
  assert.deepEqual(model.bounds, { min: [-1 * TILE, 0, -1 * TILE], max: [1 * TILE, 2 * TILE, 1 * TILE] });
});

test("a far twin is a dozen faces in the building's colours, inside its footprint", () => {
  const tris = farTwin({ bounds: { min: [-4, 0, -3], max: [4, 0, 3] }, eaves: 3, top: 5, ridge: "x", wall: WALLS.cream, roof: ROOFS.tile });
  assert.equal(tris.length / 3, 14);
  const colours = new Set(tris.map((t) => t.slice(3).join()));
  assert.deepEqual(colours, new Set([WALLS.cream.join(), ROOFS.tile.join()]));
  assert.ok(tris.every((t) => Math.abs(t[0]) <= 4 && Math.abs(t[2]) <= 3 && t[1] >= 0 && t[1] <= 5));
});

test("a far twin's ridge runs the way the building's does", () => {
  const ridgeOf = (ridge) => farTwin({ bounds: { min: [-4, 0, -3], max: [4, 0, 3] }, eaves: 3, top: 5, ridge, wall: WALLS.cream, roof: ROOFS.tile }).filter((t) => t[1] === 5);
  assert.ok(ridgeOf("x").every((t) => t[2] === 0), "a ridge along x sits at z = 0");
  assert.ok(ridgeOf("z").every((t) => t[0] === 0), "a ridge along z sits at x = 0");
});

test("a building's far twin is as tall as the building at most", () => {
  const { near, far } = building("c", cottage(fakeParts(), { floors: 2 }), { floors: 2, wall: WALLS.cream, roof: ROOFS.tile });
  assert.ok(Math.max(...far.triangles.map((t) => t[1])) <= near.bounds.max[1]);
  assert.equal(far.name, "c-far");
});
