import { test } from "node:test";
import assert from "node:assert/strict";
import { boxOf, fakeIsland } from "./livingFixture.js";
import { buildFields, groundGrid } from "../public/js/view3d/living/fields.js";
import { paintGroundMap } from "../public/js/view3d/living/groundMap.js";
import { temperateLiving } from "../public/js/view3d/living/temperate.js";

function paint({ overlays = [], options, resolution } = {}) {
  const terrain = fakeIsland(options);
  const box = boxOf(terrain);
  const grid = groundGrid(terrain, box);
  const fields = buildFields(terrain, grid, { seed: terrain.seed, sea: 0, villages: () => false });
  return { fields, map: paintGroundMap({ fields, grid, box, overlays, crops: temperateLiving.crops, resolution: resolution ?? 512 }) };
}

const pixelAt = (map, x, z) => {
  const c = Math.floor(((x - map.x0) / map.size) * map.width);
  const r = Math.floor(((z - map.z0) / map.size) * map.height);
  const i = (r * map.width + c) * 4;
  return [...map.data.subarray(i, i + 4)];
};
const brightness = ([r, g, b]) => r + g + b;

test("the map is 2048² RGBA by default", () => {
  const { map } = paint({ resolution: 2048 });
  assert.equal(map.width, 2048);
  assert.equal(map.height, 2048);
  assert.equal(map.data.length, 2048 * 2048 * 4);
});

test("the map is empty under the sea", () => {
  const { map } = paint();
  assert.deepEqual(pixelAt(map, 1590, 0), [0, 0, 0, 0]);
});

test("land pixels are opaque", () => {
  const { map } = paint();
  assert.equal(pixelAt(map, 300, 500)[3], 255);
});

test("the map says where it covers", () => {
  const { map } = paint();
  assert.equal(map.size, 3200);
  assert.equal(map.x0, -1600);
  assert.equal(map.z0, -1600);
});

test("a river bed keeps the terrain's own colour", () => {
  const { map } = paint({ options: { riverDistance: (x) => Math.abs(x - 300) } });
  assert.equal(pixelAt(map, 300, 500)[3], 0);
  assert.equal(pixelAt(map, 318, 500)[3], 255, "the meadow beside it is painted");
});

test("a wood reads darker than a meadow", () => {
  const height = (x) => (x < 0 ? 30 : 80);
  const { fields, map } = paint({ options: { height } });
  let wood = null;
  let meadow = null;
  for (let x = -1400; x < 1400 && !(wood && meadow); x += 17) {
    for (let z = -1400; z < 1400; z += 17) {
      if (!wood && x > 0 && fields.woodAt(x, z) === 1) wood = [x, z];
      const parcel = fields.parcelAt(x, z);
      if (!meadow && parcel?.crop === "meadow") meadow = [x + 0, z];
    }
  }
  assert.ok(wood && meadow);
  assert.ok(brightness(pixelAt(map, ...wood)) < brightness(pixelAt(map, ...meadow)));
});

test("an overlay paints inside its box only", () => {
  const overlay = { x0: 200, z0: 200, x1: 260, z1: 260, paint: () => [255, 0, 255] };
  const { map: base } = paint();
  const { map } = paint({ overlays: [overlay] });
  assert.deepEqual(pixelAt(map, 230, 230), [255, 0, 255, 255]);
  assert.deepEqual(pixelAt(map, 300, 230), pixelAt(base, 300, 230));
});

test("an overlay's null leaves the ground as it was", () => {
  const overlay = { x0: 200, z0: 200, x1: 260, z1: 260, paint: () => null };
  const { map: base } = paint();
  const { map } = paint({ overlays: [overlay] });
  assert.deepEqual(pixelAt(map, 230, 230), pixelAt(base, 230, 230));
});

test("the same seed paints the same map", () => {
  assert.deepEqual(paint().map.data, paint().map.data);
});
