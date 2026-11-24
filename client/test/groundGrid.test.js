import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERGE_REACH, groundGrid, groundColor } from "../public/js/world/groundGrid.js";
import { SEASON_LOOK } from "../public/js/world/seasons.js";
import { buildSceneNow, transferList } from "../public/js/view3d/worldScene.js";

const bounds = { x0: -64, z0: -32, x1: 64, z1: 32 };
const stub = (height, extra = {}) => ({ height, distanceToRoad: () => 1000, riverDistance: () => Infinity, ...extra });
const grid = (terrain, season = "summer", seed = 7) => groundGrid(terrain, { bounds, cell: 16, water: 0, season, seed });
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const base = { height: 20, slope: 0.05, roadDistance: 500, riverDistance: Infinity, noise: 0.3 };

test("the grid samples the terrain's heights", () => {
  const g = grid(stub((x) => x * 0.1));
  assert.equal(g.columns * g.rows, g.heights.length);
  for (const [i, j] of [[0, 0], [3, 2], [8, 4]]) {
    assert.ok(Math.abs(g.heights[j * g.columns + i] - (g.x0 + i * g.cell) * 0.1) < 1e-4);
  }
});

test("normals point up on flat ground", () => {
  const g = grid(stub(() => 5));
  const k = 3 * (2 * g.columns + 3);
  assert.deepEqual([...g.normals.slice(k, k + 3)], [0, 1, 0]);
});

test("steep ground is rock", () => {
  assert.deepEqual(groundColor({ ...base, slope: 0.9 }, SEASON_LOOK.summer, 0).map((c) => +c.toFixed(3)), groundColor({ ...base, slope: 0.7 }, SEASON_LOOK.summer, 0).map((c) => +c.toFixed(3)));
  const [r, g, b] = groundColor({ ...base, slope: 0.9 }, SEASON_LOOK.summer, 0);
  assert.ok(Math.abs(r - g) < 0.05 && Math.abs(g - b) < 0.05, "grey, not green");
});

test("a road verge is soil", () => {
  const [r, g] = groundColor({ ...base, roadDistance: 3.5 }, SEASON_LOOK.summer, 0);
  assert.ok(r > g, "brown: red above green");
});

test("summer meadow is olive green up to the verge, with no straw-yellow patch", () => {
  for (const noise of [0, 0.5, 1]) {
    const [r, g, b] = groundColor({ ...base, roadDistance: 6, noise }, SEASON_LOOK.summer, 0);
    assert.ok(g > r * 1.12 && g > b * 2, `noise ${noise}: green above red and blue`);
  }
  const edge = groundColor({ ...base, roadDistance: VERGE_REACH + 1.5, noise: 1 }, SEASON_LOOK.summer, 0);
  assert.deepEqual(edge, groundColor({ ...base, roadDistance: 40, noise: 1 }, SEASON_LOOK.summer, 0), "grass right after the short soil shoulder");
});

test("the beach is sand", () => {
  const [r, g, b] = groundColor({ ...base, height: 1.5 }, SEASON_LOOK.summer, 0);
  assert.ok(r > g && g > b, "sandy");
});

test("winter covers flat ground in snow", () => {
  const colour = groundColor(base, SEASON_LOOK.winter, 0);
  assert.ok(colour.every((c) => c > 0.7), colour.join());
});

test("summer grass is calmer than saturated", () => {
  const [r, g] = groundColor(base, SEASON_LOOK.summer, 0).map(toSrgb);
  assert.ok(g - r < 0.25, `${g - r}`);
});

test("colours are deterministic for a seed", () => {
  const terrain = stub((x, z) => Math.sin(x / 9) * 12 + z * 0.05 + 10);
  assert.deepEqual(grid(terrain, "autumn", 3).colors, grid(terrain, "autumn", 3).colors);
});

test("a route file without a network gets a ground grid", () => {
  const file = JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url)));
  const { ground } = buildSceneNow(file);
  assert.ok(ground.near.columns > 2 && ground.near.heights.length === ground.near.columns * ground.near.rows);
  assert.equal(ground.near.colors.length, ground.near.heights.length * 3);
  assert.equal(ground.far.cell, 140);
  assert.ok(ground.far.heights.every(Number.isFinite));
});

test("the ground grid is transferred, not copied", () => {
  const file = JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url)));
  const scene = buildSceneNow(file);
  const list = transferList(scene);
  for (const part of [scene.ground.near, scene.ground.far]) for (const key of ["heights", "normals", "colors"]) assert.ok(list.includes(part[key].buffer));
});

test("a region tint multiplies the grass", () => {
  const plain = groundColor(base, SEASON_LOOK.summer, 0);
  const tinted = groundColor({ ...base, tint: [0.5, 1, 1] }, SEASON_LOOK.summer, 0);
  assert.ok(Math.abs(tinted[0] - plain[0] * 0.5) < 1e-9);
  assert.equal(tinted[1], plain[1]);
});

test("a field is earth under its crop", () => {
  const [r, g] = groundColor({ ...base, field: true }, SEASON_LOOK.summer, 0);
  assert.ok(r > g, "brown: red above green");
});

test("the grid takes its tint from the regions and its earth from the field mask", () => {
  const regions = [{ id: "a", kind: "oliveTerraces", center: [0, 0], radius: 5000 }];
  const masks = { cell: 16, x0: -64, z0: -32, columns: 8, rows: 4, data: new Uint8Array(32) };
  for (let j = 0; j < 3; j += 1) for (let i = 3; i < 6; i += 1) masks.data[j * 8 + i] = 3; // a 3 by 3 block: its middle is the inside
  const options = { bounds, cell: 16, water: 0, season: "summer", seed: 7 };
  const plain = groundGrid(stub(() => 20), options);
  const g = groundGrid(stub(() => 20), { ...options, regions, masks });
  const at = (grid, i, j) => [...grid.colors.slice(3 * (j * grid.columns + i), 3 * (j * grid.columns + i) + 3)];
  assert.notDeepEqual(at(g, 1, 1), at(plain, 1, 1));
  const [r, gr] = at(g, 4, 1);
  assert.ok(r > gr, "the inside of the field is brown");
  const [rimR, rimG] = at(g, 3, 0);
  assert.ok(rimG > rimR, "its rim keeps the meadow's green");
});
