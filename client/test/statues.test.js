import assert from "node:assert/strict";
import test from "node:test";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { PLINTHS, STATUE_MATERIALS, buildStatues, statueSlots } from "../public/js/view3d/statues.js";
import { STATUE_MOMENT } from "../public/js/view3d/clips.js";

const colorAt = (mesh, i) => [0, 1, 2].map((k) => Math.fround(mesh.colors[i * 4 + k]));
const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-5);
/** Vertices (`{p, i}`) of the mesh painted `rgb`. */
const painted = (mesh, rgb) => {
  const out = [];
  for (let i = 0; i < mesh.vertexCount; i += 1) if (near(colorAt(mesh, i), rgb)) out.push([mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]);
  return out;
};

test("statue slots spread over the row", () => {
  assert.deepEqual(statueSlots(1), [{ x: 0 }]);
  assert.deepEqual(statueSlots(6).map((s) => s.x), [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]);
  assert.deepEqual(statueSlots(2).map((s) => s.x), [-1.5, 1.5]);
});

test("a row has a glow ring and a plinth height per figure", () => {
  const row = buildStatues(["squats", "plank"], "marble");
  assert.equal(row.glows.length, 2);
  assert.deepEqual(row.tops, [1.0, 0.6]);
  assert.ok(row.glows.every((g) => g.vertexCount > 0));
});

test("each figure stands or lies on its plinth, inside its slot", () => {
  const figures = ["squats", "pushups", "plank", "situps", "jumping_jacks", "burpees"];
  const row = buildStatues(figures, "marble");
  const slots = statueSlots(figures.length);
  const body = painted(row.mesh, STATUE_MATERIALS.marble.figure);
  figures.forEach((name, i) => {
    const mine = body.filter(([x]) => Math.abs(x - slots[i].x) < 1.5);
    assert.ok(mine.length > 0, name);
    const low = Math.min(...mine.map((p) => p[1]));
    assert.ok(Math.abs(low - row.tops[i]) < 0.01, `${name}: lowest ${low}, plinth ${row.tops[i]}`);
    const lying = row.tops[i] < 0.9;
    // A jumping jack's raised arms may reach past the 0.9 m plinth, but not far.
    const half = lying ? 1.0 : 0.65;
    const xs = mine.map((p) => p[0] - slots[i].x);
    assert.ok(Math.min(...xs) >= -half - 0.01 && Math.max(...xs) <= half + 0.01, `${name}: x ${Math.min(...xs)}..${Math.max(...xs)}`);
  });
});

test("the figure is painted in the material's colour", () => {
  for (const [material, { figure }] of Object.entries(STATUE_MATERIALS)) {
    const row = buildStatues(["squats"], material);
    assert.ok(painted(row.mesh, figure).length > 100, material);
  }
});

test("a biome rig casts its own figures on the same plinths", () => {
  const winter = resolveBiome("winter");
  const figures = ["squats", "pushups", "plank", "situps", "jumping_jacks", "burpees"];
  const row = buildStatues(figures, "marble", winter.workout);
  const human = buildStatues(figures, "marble");
  assert.deepEqual(row.tops, human.tops, "the plinths stay put");
  assert.notEqual(row.mesh.vertexCount, human.mesh.vertexCount, "winter's figures are penguins");

  const slots = statueSlots(figures.length);
  const body = painted(row.mesh, STATUE_MATERIALS.marble.figure);
  figures.forEach((name, i) => {
    const mine = body.filter(([x]) => Math.abs(x - slots[i].x) < 1.5);
    assert.ok(mine.length > 0, name);
    const low = Math.min(...mine.map((p) => p[1]));
    assert.ok(Math.abs(low - row.tops[i]) < 0.01, `${name}: lowest ${low}, plinth ${row.tops[i]}`);
  });
});

test("the bronze band stays below the plinth top", () => {
  const row = buildStatues(["squats"], "bronze");
  const band = painted(row.mesh, STATUE_MATERIALS.bronze.accent);
  assert.ok(band.length > 0);
  const highest = Math.max(...band.map((p) => p[1]));
  assert.ok(highest <= row.tops[0] - 0.005, `band top ${highest}, plinth top ${row.tops[0]}`);
});

test("the glow ring lies outside the plinth", () => {
  const row = buildStatues(["squats"], "marble");
  const [sx, , sz] = PLINTHS[STATUE_MOMENT.squats.plinth];
  const { positions, vertexCount } = row.glows[0];
  assert.ok(vertexCount > 0);
  for (let i = 0; i < vertexCount; i += 1) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    const outside = Math.abs(x) >= sx / 2 + 0.005 || Math.abs(z) >= sz / 2 + 0.005;
    assert.ok(outside, `glow vertex (${x}, ${z}) inside the plinth footprint`);
  }
});

test("an unknown material throws", () => {
  assert.throws(() => buildStatues(["squats"], "jade"), /material/i);
});
