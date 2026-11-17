/**
 * A town is a network, not a row (#117): streets, junctions, blocks, plots and
 * a square, decided from the seed before a single triangle is built.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { SETTLEMENT_KIND, layoutSettlement } from "../public/js/land/settlement.js";

const TERRAIN = { height: () => 10 };
const ROAD = new RouteGeometry({ id: "road", name: "Road", points: [[-1000, 0], [1000, 0]], lanes: 4, markers: [], zones: [], closed: false });

const city = (options = {}) =>
  layoutSettlement({ id: "hilltop", kind: SETTLEMENT_KIND.city, center: [0, 0], radius: 400, seed: 2026, terrain: TERRAIN, roads: [ROAD], ...options });
const village = (options = {}) =>
  layoutSettlement({ id: "southwest", kind: SETTLEMENT_KIND.village, center: [0, 0], radius: 220, seed: 2026, terrain: TERRAIN, roads: [ROAD], ...options });

const distanceToLine = (x, z, points) => {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l));
    best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
  }
  return best;
};

test("a city has streets, junctions, blocks, plots and a square", () => {
  const layout = city();
  assert.ok(layout.streets.length >= 8, `streets ${layout.streets.length}`);
  assert.ok(layout.junctions.length >= 12, `junctions ${layout.junctions.length}`);
  assert.ok(layout.blocks.length >= 8, `blocks ${layout.blocks.length}`);
  assert.ok(layout.plots.length >= 40, `plots ${layout.plots.length}`);
  assert.ok(layout.square, "a city has a market square");
  assert.ok(layout.lamps.length >= 20, `lamps ${layout.lamps.length}`);
  assert.ok(layout.streets.some((s) => s.existing), "the main road is reused, not drawn twice");
});

test("a village is smaller and has no grid", () => {
  const layout = village();
  assert.ok(layout.streets.length <= 5, `streets ${layout.streets.length}`);
  assert.ok(layout.plots.length < city().plots.length);
  assert.ok(layout.junctions.length <= 4, `junctions ${layout.junctions.length}`);
});

test("the same seed lays out the same town", () => {
  assert.deepEqual(city(), city());
});

test("different seeds lay out different towns", () => {
  assert.notDeepEqual(city({ seed: 1 }).plots, city({ seed: 2 }).plots);
});

test("no plot stands in a street, the square or another plot", () => {
  const layout = city();
  for (const plot of layout.plots) {
    for (const street of layout.streets) {
      assert.ok(distanceToLine(plot.x, plot.z, street.points) >= street.width / 2, `${plot.street} plot ${plot.x},${plot.z} is in ${street.id}`);
    }
    if (layout.square) {
      const d = [plot.x - layout.center[0], plot.z - layout.center[1]];
      const a = d[0] * layout.frame.u[0] + d[1] * layout.frame.u[1];
      const b = d[0] * layout.frame.v[0] + d[1] * layout.frame.v[1];
      const inside = a > layout.square.a0 - 2 && a < layout.square.a1 + 2 && b > layout.square.b0 - 2 && b < layout.square.b1 + 2;
      assert.equal(inside, false, `plot ${plot.x},${plot.z} is on the square`);
    }
  }
  for (let i = 0; i < layout.plots.length; i += 1) {
    for (let j = i + 1; j < layout.plots.length; j += 1) {
      const a = layout.plots[i];
      const b = layout.plots[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > Math.min(a.width, b.width) * 0.5, `plots ${i} and ${j} overlap`);
    }
  }
});

test("houses face the street on both sides", () => {
  const layout = city();
  const sides = new Set(layout.plots.map((plot) => Math.sign(plot.side)));
  assert.deepEqual([...sides].sort(), [-1, 1]);
  for (const plot of layout.plots) {
    assert.ok(Math.abs(plot.yaw) <= Math.PI + 1e-9);
    assert.ok(plot.width >= 5 && plot.depth >= 5);
  }
});
