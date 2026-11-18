import assert from "node:assert/strict";
import { test } from "node:test";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { PLANTS } from "../public/js/view3d/regions/plants.js";
import { REGION_STYLES } from "../public/js/view3d/regions/styles.js";

const TREES = ["umbrellaPine", "olive", "almond", "willow"];
const COVER = ["lavender", "wildflower", "alpineFlower", "reeds", "broom", "grass", "shrub", "wheat"];
const PINK = [0.95, 0.72, 0.78];

function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function draw(name, { far = false, seed = 7, colours = {} } = {}) {
  const mesh = new MeshBuilder();
  PLANTS[name]({ mesh, x: 3, y: 2, z: -4, random: lcg(seed), colours, far });
  return mesh;
}
const triangles = (mesh) => mesh.vertexCount / 3;

test("PLANTS covers every plant a region style names", () => {
  const named = new Set();
  for (const style of Object.values(REGION_STYLES)) {
    for (const p of style.trees.plants) named.add(p);
    for (const p of style.cover.plants) named.add(p);
  }
  for (const name of named) assert.equal(typeof PLANTS[name], "function", name);
});

for (const name of [...TREES, ...COVER]) {
  test(`${name} draws triangles within budget, near and far`, () => {
    const near = triangles(draw(name));
    assert.ok(near > 0);
    assert.ok(near <= (TREES.includes(name) ? 400 : 60), `${near} near`);
    const far = triangles(draw(name, { far: true }));
    assert.ok(far > 0);
    assert.ok(far <= 12, `${far} far`);
  });

  test(`${name} is the same for the same seed`, () => {
    assert.deepEqual(draw(name).positions.toFloat32(), draw(name).positions.toFloat32());
  });
}

test("umbrellaPine has a crown wider than 1.5 times its height", () => {
  const mesh = draw("umbrellaPine");
  const pos = mesh.positions.toFloat32();
  const col = mesh.colors.toFloat32();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length / 3; i += 1) {
    const green = col[i * 4 + 1] > col[i * 4]; // foliage is greener than the brown trunk
    if (!green) continue;
    minX = Math.min(minX, pos[i * 3]);
    maxX = Math.max(maxX, pos[i * 3]);
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  assert.ok(maxX - minX > 1.5 * (maxY - minY), `${maxX - minX} wide, ${maxY - minY} tall`);
});

test("almond wears the canopy colour it is given", () => {
  const colours = new Set();
  const col = draw("almond", { colours: { canopy: PINK } }).colors.toFloat32();
  for (let i = 0; i < col.length; i += 4) colours.add(`${col[i].toFixed(2)},${col[i + 1].toFixed(2)},${col[i + 2].toFixed(2)}`);
  assert.ok(colours.has("0.95,0.72,0.78"));
});

test("trees stand in real metres", () => {
  const heights = { umbrellaPine: [9, 16], olive: [4, 8], almond: [4, 8], willow: [9, 15] };
  for (const [name, [lo, hi]] of Object.entries(heights)) {
    const pos = draw(name).positions.toFloat32();
    let top = -Infinity;
    for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i] - 2);
    assert.ok(top >= lo && top <= hi, `${name} ${top}`);
  }
});

test("lavender reads purple up close: most of its vertices are flower-coloured", () => {
  const col = draw("lavender").colors.toFloat32();
  let purple = 0;
  for (let i = 0; i < col.length / 4; i += 1) if (col[i * 4 + 2] > col[i * 4 + 1] + 0.15) purple += 1;
  assert.ok(purple / (col.length / 4) >= 0.6, `${purple} of ${col.length / 4}`);
});
